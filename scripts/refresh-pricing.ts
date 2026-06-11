/**
 * Snapshot LiteLLM pricing for Claude models into lib/litellm-pricing.fallback.json.
 * Run via: npm run pricing:refresh
 */
import fs from 'node:fs';
import path from 'node:path';

const URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const OUT = path.resolve('lib/litellm-pricing.fallback.json');

const KEEP_FIELDS = [
  'input_cost_per_token',
  'output_cost_per_token',
  'cache_creation_input_token_cost',
  'cache_read_input_token_cost',
  'input_cost_per_token_above_200k_tokens',
  'output_cost_per_token_above_200k_tokens',
  'cache_creation_input_token_cost_above_200k_tokens',
  'cache_read_input_token_cost_above_200k_tokens',
] as const;

async function main() {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching LiteLLM pricing`);
  const all = (await res.json()) as Record<string, Record<string, unknown>>;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, entry] of Object.entries(all)) {
    const bare = key.includes('/') ? key.slice(key.lastIndexOf('/') + 1) : key;
    if (!bare.startsWith('claude-')) continue;
    const kept: Record<string, unknown> = {};
    for (const f of KEEP_FIELDS) if (entry[f] !== undefined) kept[f] = entry[f];
    if (kept.input_cost_per_token === undefined || kept.output_cost_per_token === undefined) continue;
    out[key] = kept;
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(`Wrote ${Object.keys(out).length} claude pricing entries to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
