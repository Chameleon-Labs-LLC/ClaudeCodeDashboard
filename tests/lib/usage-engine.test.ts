import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseUsageFile,
  dedupeEntries,
  loadUsageEntries,
  clearUsageFileCache,
  buildUsageReport,
  weekStart,
  type UsageEntry,
} from '../../lib/usage-engine';
import { buildPricingMap } from '../../lib/litellm-pricing';
import { localDay } from '../../lib/local-day';

const TS = '2026-06-01T12:00:00.000Z';

function line(over: Record<string, unknown> = {}, usage: Record<string, unknown> = {}): string {
  return JSON.stringify({
    timestamp: TS,
    sessionId: 'sess-1',
    requestId: 'req-1',
    isSidechain: false,
    message: {
      role: 'assistant',
      id: 'msg-1',
      model: 'claude-opus-4-8',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 2,
        cache_read_input_tokens: 100,
        ...usage,
      },
    },
    ...over,
  });
}

function entry(over: Partial<UsageEntry> = {}): UsageEntry {
  return {
    messageId: 'msg-1',
    requestId: 'req-1',
    isSidechain: false,
    isFast: false,
    timestampMs: Date.parse(TS),
    model: 'claude-opus-4-8',
    sessionId: 'sess-1',
    projectName: 'proj-a',
    source: 'This machine',
    inputTokens: 10,
    outputTokens: 5,
    cacheCreationTokens: 2,
    cacheReadTokens: 100,
    ...over,
  };
}

test('parseUsageFile keeps assistant usage entries and drops malformed lines', () => {
  const content = [
    line(),
    JSON.stringify({ message: { role: 'user', content: 'hi' } }),
    JSON.stringify({ timestamp: TS, requestId: '', message: { role: 'assistant', usage: { input_tokens: 1 } } }),
    JSON.stringify({ message: { role: 'assistant', usage: { input_tokens: 1 } } }),
    line({ message: { role: 'assistant', id: 'msg-2', model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } } }),
    'not json {{{',
  ].join('\n');
  const entries = parseUsageFile(content, 'sess-1', 'proj-a');
  assert.equal(entries.length, 2);
  assert.equal(entries[0].model, 'claude-opus-4-8');
  assert.equal(entries[1].model, undefined);
});

test('parseUsageFile flags fast-mode entries', () => {
  const entries = parseUsageFile(line({}, { speed: 'fast' }), 'sess-1', 'proj-a');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].isFast, true);
});

test('parseUsageFile with isSidechain: true produces an entry with isSidechain === true', () => {
  const entries = parseUsageFile(line({ isSidechain: true }), 'sess-1', 'proj-a');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].isSidechain, true);
});

test('dedupeEntries keeps parent usage when a sidechain replays the message with a new requestId', () => {
  const out = dedupeEntries([
    entry({ messageId: 'msg-p', requestId: 'req-parent', isSidechain: false, cacheReadTokens: 20 }),
    entry({ messageId: 'msg-p', requestId: 'req-replay', isSidechain: true, cacheReadTokens: 50_000 }),
    entry({ messageId: 'msg-answer', requestId: 'req-answer', isSidechain: true, cacheReadTokens: 700 }),
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].requestId, 'req-parent');
  assert.equal(out[0].cacheReadTokens, 20);
});

test('dedupeEntries lets the parent replace an earlier sidechain replay', () => {
  const out = dedupeEntries([
    entry({ messageId: 'msg-p', requestId: 'req-replay', isSidechain: true, cacheReadTokens: 50_000 }),
    entry({ messageId: 'msg-p', requestId: 'req-parent', isSidechain: false, cacheReadTokens: 20 }),
    entry({ messageId: 'msg-p', requestId: 'req-parent', isSidechain: false, cacheReadTokens: 5, outputTokens: 5 }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].requestId, 'req-parent');
  assert.equal(out[0].cacheReadTokens, 20);
});

test('dedupeEntries removes exact (messageId, requestId) duplicates from resumed sessions', () => {
  const out = dedupeEntries([entry(), entry(), entry({ messageId: undefined })]);
  assert.equal(out.length, 2);
});

test('loadUsageEntries scans nested files, dedups across files, and reports raw count', () => {
  clearUsageFileCache();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-engine-'));
  try {
    const proj = path.join(root, '-mnt-demo');
    fs.mkdirSync(path.join(proj, 'sess-1', 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'sess-1.jsonl'), line() + '\n');
    fs.writeFileSync(path.join(proj, 'sess-1', 'subagents', 'worker.jsonl'), line() + '\n');
    const result = loadUsageEntries(root);
    assert.equal(result.rawEntryCount, 2);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].sessionId, 'sess-1');
    assert.equal(result.entries[0].projectName, '-mnt-demo');
    // warm-cache path: second call returns same counts
    const result2 = loadUsageEntries(root);
    assert.equal(result2.rawEntryCount, 2);
    assert.equal(result2.entries.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    clearUsageFileCache();
  }
});

const PRICING = {
  map: buildPricingMap({
    'claude-opus-4-8': { input_cost_per_token: 0.000005, output_cost_per_token: 0.000025 },
  } as never),
  source: 'fallback' as const,
};
const OPUS_ENTRY_COST =
  10 * 0.000005 + 5 * 0.000025 + 2 * 0.000005 * 1.25 + 100 * 0.000005 * 0.1;

test('buildUsageReport prices each entry by its own model and buckets by local day', () => {
  const report = buildUsageReport(
    { entries: [entry(), entry({ messageId: 'msg-2', model: undefined })], rawEntryCount: 3 },
    PRICING,
  );
  assert.equal(report.buckets.length, 1);
  assert.equal(report.buckets[0].period, localDay(Date.parse(TS)));
  assert.ok(Math.abs(report.byModel['claude-opus-4-8'].cost - OPUS_ENTRY_COST) < 1e-12);
  assert.equal(report.byModel['unknown'].cost, 0);
  assert.equal(report.meta.rawEntryCount, 3);
  assert.equal(report.meta.dedupedEntryCount, 2);
  assert.equal(report.meta.pricingSource, 'fallback');
});

test('buildUsageReport applies since/until/project/model filters', () => {
  const dayKey = localDay(Date.parse(TS));
  const load = {
    entries: [
      entry(),
      entry({ messageId: 'msg-2', projectName: 'proj-b' }),
      entry({ messageId: 'msg-3', timestampMs: Date.parse('2026-05-01T12:00:00Z') }),
    ],
    rawEntryCount: 3,
  };
  const filtered = buildUsageReport(load, PRICING, {
    since: dayKey,
    until: dayKey,
    projects: ['proj-a'],
  });
  assert.equal(filtered.sessions.length, 1);
  assert.equal(filtered.totals.inputTokens, 10);
  // option lists ignore filters so the UI can always render filter choices
  assert.deepEqual(filtered.meta.allProjects, ['proj-a', 'proj-b']);
  const byModel = buildUsageReport(load, PRICING, { models: ['claude-opus-4-8'] });
  assert.equal(byModel.totals.inputTokens, 30);
});

test('weekStart returns the Monday of the ISO week', () => {
  assert.equal(weekStart('2026-06-10'), '2026-06-08');
  assert.equal(weekStart('2026-06-14'), '2026-06-08');
  assert.equal(weekStart('2026-06-08'), '2026-06-08');
  assert.equal(weekStart('2026-01-01'), '2025-12-29'); // Thursday -> previous year's Monday
});

test('buildUsageReport groups by month when requested', () => {
  const report = buildUsageReport({ entries: [entry()], rawEntryCount: 1 }, PRICING, {
    granularity: 'month',
  });
  assert.equal(report.buckets[0].period, localDay(Date.parse(TS)).slice(0, 7));
});

test('buildUsageReport aggregates sessions with per-model breakdown and activity range', () => {
  const later = Date.parse('2026-06-01T15:00:00.000Z');
  const report = buildUsageReport(
    {
      entries: [
        entry(),
        entry({ messageId: 'msg-2', model: 'claude-haiku-4-5', timestampMs: later, outputTokens: 50 }),
      ],
      rawEntryCount: 2,
    },
    PRICING,
  );
  assert.equal(report.sessions.length, 1);
  const sess = report.sessions[0];
  assert.equal(sess.messageCount, 2);
  assert.deepEqual([...sess.models].sort(), ['claude-haiku-4-5', 'claude-opus-4-8']);
  assert.equal(sess.startedAt, TS);
  assert.equal(sess.lastActivityAt, new Date(later).toISOString());
  assert.equal(sess.byModel['claude-haiku-4-5'].outputTokens, 50);
});

test('buildUsageReport doubles opus-4-8 fast-mode cost and labels the model', () => {
  const report = buildUsageReport({ entries: [entry({ isFast: true })], rawEntryCount: 1 }, PRICING);
  const m = report.byModel['claude-opus-4-8-fast'];
  assert.ok(m);
  assert.ok(Math.abs(m.cost - OPUS_ENTRY_COST * 2) < 1e-12);
});

test('parseUsageFile tags entries with the given source label', () => {
  const out = parseUsageFile(line(), 'sess-1', 'proj-a', 'WSL Ubuntu');
  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'WSL Ubuntu');
});

test('parseUsageFile defaults source to "This machine"', () => {
  const out = parseUsageFile(line(), 'sess-1', 'proj-a');
  assert.equal(out[0].source, 'This machine');
});
