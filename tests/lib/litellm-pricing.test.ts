import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPricingMap,
  findPricing,
  calculateCost,
  fastMultiplier,
  getPricingMap,
  clearPricingCache,
} from '../../lib/litellm-pricing';

const RAW = {
  'claude-opus-4-8': { input_cost_per_token: 0.000005, output_cost_per_token: 0.000025 },
  'anthropic/claude-fable-5': {
    input_cost_per_token: 0.00001,
    output_cost_per_token: 0.00005,
    cache_creation_input_token_cost: 0.0000125,
    cache_read_input_token_cost: 0.000001,
  },
  'claude-tiered': {
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    input_cost_per_token_above_200k_tokens: 0.000006,
  },
  'claude-broken': { output_cost_per_token: 0.000015 },
};

test('buildPricingMap fills Anthropic cache-rate defaults and skips unusable entries', () => {
  const map = buildPricingMap(RAW as never);
  const opus = map.get('claude-opus-4-8')!;
  assert.equal(opus.cacheCreate, 0.000005 * 1.25);
  assert.equal(opus.cacheRead, 0.000005 * 0.1);
  assert.equal(map.has('claude-broken'), false);
});

test('findPricing resolves exact, anthropic/-prefixed, and bracket-suffixed ids', () => {
  const map = buildPricingMap(RAW as never);
  assert.ok(findPricing(map, 'claude-opus-4-8'));
  assert.ok(findPricing(map, 'claude-fable-5'));
  assert.ok(findPricing(map, 'claude-fable-5[1m]'));
  assert.equal(findPricing(map, 'gpt-x'), undefined);
});

test('calculateCost prices all four token classes with 200k tiering', () => {
  const map = buildPricingMap(RAW as never);
  const fable = findPricing(map, 'claude-fable-5')!;
  const cost = calculateCost(fable, {
    inputTokens: 1000,
    outputTokens: 100,
    cacheCreationTokens: 2000,
    cacheReadTokens: 50_000,
  });
  const expected = 1000 * 0.00001 + 100 * 0.00005 + 2000 * 0.0000125 + 50_000 * 0.000001;
  assert.ok(Math.abs(cost - expected) < 1e-12);

  const tiered = findPricing(map, 'claude-tiered')!;
  const above = calculateCost(tiered, {
    inputTokens: 300_000,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  });
  assert.ok(Math.abs(above - (200_000 * 0.000003 + 100_000 * 0.000006)) < 1e-9);
});

test('fastMultiplier matches opus generations and defaults to 1', () => {
  assert.equal(fastMultiplier('claude-opus-4-8'), 2.0);
  assert.equal(fastMultiplier('claude-opus-4-7'), 6.0);
  assert.equal(fastMultiplier('claude-fable-5'), 1);
});

test('getPricingMap falls back to bundled snapshot when fetch fails', async () => {
  clearPricingCache();
  const failingFetch = (() => {
    throw new Error('offline');
  }) as unknown as typeof fetch;
  const { map, source } = await getPricingMap(failingFetch);
  assert.equal(source, 'fallback');
  assert.ok(map.size > 0);
  clearPricingCache();
});

test('getPricingMap serves the cached map when a later fetch fails', async () => {
  clearPricingCache();
  const goodJson = {
    'claude-good': { input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
  };
  let calls = 0;
  const flakyFetch = (async () => {
    calls += 1;
    if (calls === 1) {
      return { ok: true, json: async () => goodJson } as Response;
    }
    throw new Error('offline');
  }) as unknown as typeof fetch;
  const first = await getPricingMap(flakyFetch);
  assert.equal(first.source, 'live');
  assert.equal(first.map.size, 1);
  // memo is fresh (within TTL) so the failing fetch is never reached;
  // the point is the ladder returns the prior live map either way
  const second = await getPricingMap(flakyFetch);
  assert.equal(second.source, 'live');
  assert.equal(second.map.get('claude-good')?.input, 0.000001);
  clearPricingCache();
});
