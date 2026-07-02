/**
 * LiteLLM-based token pricing for Claude models.
 *
 * Same feed ccusage uses (so dashboard costs match `ccusage claude` output):
 * https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json
 * Rates are USD per **token** (not per MTok).
 *
 * Failure ladder mirrors lib/model-registry.ts: live fetch -> in-memory cache
 * (even expired) -> bundled fallback snapshot. Never throws once imported.
 * Refresh the snapshot with `npm run pricing:refresh`.
 */
import fallbackJson from './litellm-pricing.fallback.json';

export interface ModelPricing {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  inputAbove200k?: number;
  outputAbove200k?: number;
  cacheCreateAbove200k?: number;
  cacheReadAbove200k?: number;
}

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

interface LitellmEntry {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_creation_input_token_cost?: number;
  cache_read_input_token_cost?: number;
  input_cost_per_token_above_200k_tokens?: number;
  output_cost_per_token_above_200k_tokens?: number;
  cache_creation_input_token_cost_above_200k_tokens?: number;
  cache_read_input_token_cost_above_200k_tokens?: number;
}

export const LITELLM_PRICING_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

const TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const TIER_THRESHOLD = 200_000;

// ccusage parity: fast-mode billing multipliers by model generation
// (rust/crates/ccusage .../fast-multiplier-overrides.json)
const FAST_MULTIPLIERS: Array<[prefix: string, multiplier: number]> = [
  ['claude-opus-4-8', 2.0],
  ['claude-opus-4-7', 6.0],
  ['claude-opus-4-6', 6.0],
];

function bareModel(model: string): string {
  return model.replace(/\[.*\]$/, ''); // "claude-fable-5[1m]" -> "claude-fable-5"
}

export function fastMultiplier(model: string): number {
  const bare = bareModel(model);
  const hit = FAST_MULTIPLIERS.find(([prefix]) => bare.startsWith(prefix));
  return hit ? hit[1] : 1;
}

export function buildPricingMap(raw: Record<string, LitellmEntry>): Map<string, ModelPricing> {
  const map = new Map<string, ModelPricing>();
  for (const [key, e] of Object.entries(raw)) {
    if (typeof e?.input_cost_per_token !== 'number' || typeof e?.output_cost_per_token !== 'number') {
      continue;
    }
    const input = e.input_cost_per_token;
    map.set(key, {
      input,
      output: e.output_cost_per_token,
      // LiteLLM omissions default to Anthropic's standard cache ratios (ccusage parity)
      cacheCreate: e.cache_creation_input_token_cost ?? input * 1.25,
      cacheRead: e.cache_read_input_token_cost ?? input * 0.1,
      inputAbove200k: e.input_cost_per_token_above_200k_tokens,
      outputAbove200k: e.output_cost_per_token_above_200k_tokens,
      cacheCreateAbove200k: e.cache_creation_input_token_cost_above_200k_tokens,
      cacheReadAbove200k: e.cache_read_input_token_cost_above_200k_tokens,
    });
  }
  return map;
}

export function findPricing(
  map: Map<string, ModelPricing>,
  model: string,
): ModelPricing | undefined {
  const bare = bareModel(model);
  const direct = map.get(bare) ?? map.get(`anthropic/${bare}`);
  if (direct) return direct;
  // last resort: any provider-prefixed key ending in "/<model>"; prefer the longest
  const candidates = [...map.keys()].filter((k) => k.endsWith(`/${bare}`));
  candidates.sort((a, b) => b.length - a.length);
  return candidates.length ? map.get(candidates[0]) : undefined;
}

function tieredCost(tokens: number, base: number, above?: number): number {
  if (tokens > TIER_THRESHOLD && above !== undefined) {
    return TIER_THRESHOLD * base + (tokens - TIER_THRESHOLD) * above;
  }
  return tokens * base;
}

export function calculateCost(p: ModelPricing, t: TokenCounts, multiplier = 1): number {
  return (
    (tieredCost(t.inputTokens, p.input, p.inputAbove200k) +
      tieredCost(t.outputTokens, p.output, p.outputAbove200k) +
      tieredCost(t.cacheCreationTokens, p.cacheCreate, p.cacheCreateAbove200k) +
      tieredCost(t.cacheReadTokens, p.cacheRead, p.cacheReadAbove200k)) *
    multiplier
  );
}

const fallbackMap = buildPricingMap(fallbackJson as unknown as Record<string, LitellmEntry>);

export interface PricingResult {
  map: Map<string, ModelPricing>;
  source: 'live' | 'fallback';
}

let memo: { map: Map<string, ModelPricing>; ts: number; source: 'live' | 'fallback' } | null = null;

/** Negative cache: offline hosts would otherwise pay the full fetch timeout on
 *  every request until the network comes back. */
const FAILURE_TTL_MS = 5 * 60 * 1000;
let failedAt = 0;

export async function getPricingMap(fetchImpl: typeof fetch = fetch): Promise<PricingResult> {
  if (memo && Date.now() - memo.ts < TTL_MS) return { map: memo.map, source: memo.source };
  if (Date.now() - failedAt < FAILURE_TTL_MS) {
    if (memo) return { map: memo.map, source: memo.source };
    return { map: fallbackMap, source: 'fallback' };
  }
  try {
    const res = await fetchImpl(LITELLM_PRICING_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`pricing HTTP ${res.status}`);
    const json = (await res.json()) as Record<string, LitellmEntry>;
    const map = buildPricingMap(json);
    if (map.size === 0) throw new Error('pricing document had no usable entries');
    memo = { map, ts: Date.now(), source: 'live' };
    return { map, source: 'live' };
  } catch (err) {
    console.error('litellm-pricing fetch failed; using cache/fallback:', err);
    failedAt = Date.now();
    if (memo) return { map: memo.map, source: memo.source };
    return { map: fallbackMap, source: 'fallback' };
  }
}

/** Sync access for call sites that cannot await (sqlite sync loop). Bundled snapshot, no drift. */
export function getPricingMapSync(): PricingResult {
  return memo ? { map: memo.map, source: memo.source } : { map: fallbackMap, source: 'fallback' };
}

export function clearPricingCache(): void {
  memo = null;
  failedAt = 0;
}
