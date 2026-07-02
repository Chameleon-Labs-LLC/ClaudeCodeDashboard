import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseUsageFile,
  dedupeEntries,
  loadUsageEntries,
  loadAllUsageEntries,
  clearUsageFileCache,
  buildUsageReport,
  weekStart,
  type UsageEntry,
} from '../../lib/usage-engine';
import { buildPricingMap } from '../../lib/litellm-pricing';
import { localDay } from '../../lib/local-day';
import { saveSources } from '../../lib/usage-sources';
import { openDb } from '../../lib/db';

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
    { entries: [entry(), entry({ messageId: 'msg-2', model: undefined })], rawEntryCount: 3, unreachableSources: [] },
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
    unreachableSources: [],
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
  const report = buildUsageReport({ entries: [entry()], rawEntryCount: 1, unreachableSources: [] }, PRICING, {
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
      unreachableSources: [],
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
  const report = buildUsageReport({ entries: [entry({ isFast: true })], rawEntryCount: 1, unreachableSources: [] }, PRICING);
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

/** Build a fake .claude root containing one transcript line. */
function fakeClaudeRoot(jsonl: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccd-root-'));
  const proj = path.join(root, 'projects', 'proj-a');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'sess-1.jsonl'), jsonl + '\n');
  return root;
}

test('loadAllUsageEntries merges roots, tags sources, skips unreachable', () => {
  clearUsageFileCache();
  const primary = fakeClaudeRoot(line());
  // second root gets a DISTINCT message (msg-2/req-2) so it survives global dedup
  const wsl = fakeClaudeRoot(
    line({ requestId: 'req-2' }).replace('"msg-1"', '"msg-2"'),
  );
  const sourcesFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ccd-cfg-')), 'sources.json');
  saveSources(
    [
      { id: 'wsl', label: 'WSL Ubuntu', path: wsl, enabled: true },
      { id: 'gone', label: 'Old Laptop', path: path.join(os.tmpdir(), 'ccd-nope-xyz'), enabled: true },
      { id: 'off', label: 'Disabled', path: wsl, enabled: false },
    ],
    sourcesFile,
  );
  const result = loadAllUsageEntries({
    primaryProjectsDir: path.join(primary, 'projects'),
    sourcesFile,
  });
  assert.equal(result.entries.length, 2);
  assert.deepEqual(
    result.entries.map((e) => e.source).sort(),
    ['This machine', 'WSL Ubuntu'],
  );
  assert.deepEqual(result.unreachableSources, ['Old Laptop']);
});

test('loadAllUsageEntries dedups identical messages across roots', () => {
  clearUsageFileCache();
  const primary = fakeClaudeRoot(line());
  const copy = fakeClaudeRoot(line()); // same messageId/requestId — a copied folder
  const sourcesFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ccd-cfg-')), 'sources.json');
  saveSources([{ id: 'copy', label: 'Copy', path: copy, enabled: true }], sourcesFile);
  const result = loadAllUsageEntries({
    primaryProjectsDir: path.join(primary, 'projects'),
    sourcesFile,
  });
  assert.equal(result.entries.length, 1);
});

test('loadUsageEntries handles files with more entries than the spread-argument limit', () => {
  clearUsageFileCache();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-big-'));
  try {
    const proj = path.join(root, '-mnt-big');
    fs.mkdirSync(proj, { recursive: true });
    const COUNT = 130_000; // Array.prototype.push(...arr) throws RangeError near 125k
    const lines: string[] = new Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      lines[i] = line({ requestId: `req-${i}`, message: {
        role: 'assistant', id: `msg-${i}`, model: 'claude-opus-4-8',
        usage: { input_tokens: 1, output_tokens: 1 },
      } });
    }
    fs.writeFileSync(path.join(proj, 'sess-big.jsonl'), lines.join('\n') + '\n');
    const result = loadUsageEntries(root);
    assert.equal(result.entries.length, COUNT);
    const all = loadAllUsageEntries({
      primaryProjectsDir: root,
      sourcesFile: path.join(root, 'no-sources.json'),
    });
    assert.equal(all.entries.length, COUNT);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    clearUsageFileCache();
  }
});

test('loadUsageEntries persists parsed entries to sqlite and reuses them after a restart', () => {
  clearUsageFileCache();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-db-'));
  const db = openDb(path.join(root, 'cache.db'));
  try {
    const proj = path.join(root, 'projects', '-mnt-demo');
    fs.mkdirSync(proj, { recursive: true });
    const file = path.join(proj, 'sess-1.jsonl');
    const mtime = new Date('2026-06-01T00:00:00Z');
    fs.writeFileSync(file, line() + '\n');
    fs.utimesSync(file, mtime, mtime);

    const projectsDir = path.join(root, 'projects');
    const r1 = loadUsageEntries(projectsDir, undefined, db);
    assert.equal(r1.entries[0].inputTokens, 10);

    // Same size + mtime but different content: a re-parse would see 99, a
    // cache hit returns the original 10. Memory cache is cleared to simulate
    // a server restart, so only the sqlite layer can produce 10.
    fs.writeFileSync(file, (line() + '\n').replace('"input_tokens":10', '"input_tokens":99'));
    fs.utimesSync(file, mtime, mtime);
    clearUsageFileCache();
    const r2 = loadUsageEntries(projectsDir, undefined, db);
    assert.equal(r2.entries[0].inputTokens, 10);

    // without a db handle the engine re-parses from disk
    clearUsageFileCache();
    const r3 = loadUsageEntries(projectsDir);
    assert.equal(r3.entries[0].inputTokens, 99);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
    clearUsageFileCache();
  }
});

test('loadAllUsageEntries forwards the db handle to every root', () => {
  clearUsageFileCache();
  const primary = fakeClaudeRoot(line());
  const db = openDb(path.join(primary, 'cache.db'));
  try {
    const file = path.join(primary, 'projects', 'proj-a', 'sess-1.jsonl');
    const mtime = new Date('2026-06-01T00:00:00Z');
    fs.utimesSync(file, mtime, mtime);
    const sourcesFile = path.join(primary, 'sources.json');
    saveSources([], sourcesFile);
    const opts = { primaryProjectsDir: path.join(primary, 'projects'), sourcesFile, db };
    const r1 = loadAllUsageEntries(opts);
    assert.equal(r1.entries[0].inputTokens, 10);

    fs.writeFileSync(file, (line() + '\n').replace('"input_tokens":10', '"input_tokens":99'));
    fs.utimesSync(file, mtime, mtime);
    clearUsageFileCache();
    const r2 = loadAllUsageEntries(opts);
    assert.equal(r2.entries[0].inputTokens, 10);
  } finally {
    db.close();
    fs.rmSync(primary, { recursive: true, force: true });
    clearUsageFileCache();
  }
});

test('loadAllUsageEntries snapshots each source and serves the snapshot without re-sweeping', async () => {
  clearUsageFileCache();
  const primary = fakeClaudeRoot(line());
  const wsl = fakeClaudeRoot(line({ requestId: 'req-2' }).replace('"msg-1"', '"msg-2"'));
  const db = openDb(path.join(primary, 'cache.db'));
  const sourcesFile = path.join(primary, 'sources.json');
  saveSources([{ id: 'wsl', label: 'WSL Ubuntu', path: wsl, enabled: true }], sourcesFile);
  const opts = {
    primaryProjectsDir: path.join(primary, 'projects'),
    sourcesFile,
    db,
    sourceTtlMs: 60_000,
  };
  try {
    const r1 = loadAllUsageEntries(opts);
    assert.equal(r1.entries.length, 2);

    // delete the source root entirely — a fresh snapshot must keep serving it
    // with zero filesystem access, and without flagging it unreachable
    fs.rmSync(wsl, { recursive: true, force: true });
    clearUsageFileCache();
    const r2 = loadAllUsageEntries(opts);
    assert.equal(r2.entries.length, 2);
    assert.deepEqual(r2.unreachableSources, []);
    assert.ok(r2.entries.some((e) => e.source === 'WSL Ubuntu'));
  } finally {
    db.close();
    fs.rmSync(primary, { recursive: true, force: true });
    fs.rmSync(wsl, { recursive: true, force: true });
    clearUsageFileCache();
  }
});

test('loadAllUsageEntries refreshes a stale snapshot in the background', async () => {
  clearUsageFileCache();
  const primary = fakeClaudeRoot(line());
  const wsl = fakeClaudeRoot(line({ requestId: 'req-2' }).replace('"msg-1"', '"msg-2"'));
  const db = openDb(path.join(primary, 'cache.db'));
  const sourcesFile = path.join(primary, 'sources.json');
  saveSources([{ id: 'wsl', label: 'WSL Ubuntu', path: wsl, enabled: true }], sourcesFile);
  const opts = {
    primaryProjectsDir: path.join(primary, 'projects'),
    sourcesFile,
    db,
    sourceTtlMs: 0, // every snapshot is immediately stale
  };
  try {
    loadAllUsageEntries(opts); // writes the first snapshot

    // grow the source, then load again: the stale snapshot is served now…
    fs.writeFileSync(
      path.join(wsl, 'projects', 'proj-a', 'sess-2.jsonl'),
      line({ requestId: 'req-3' }).replace('"msg-1"', '"msg-3"') + '\n',
    );
    clearUsageFileCache();
    const stale = loadAllUsageEntries(opts);
    assert.equal(stale.entries.length, 2);

    // …and the background refresh lands on the next tick
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const fresh = loadAllUsageEntries(opts);
    assert.equal(fresh.entries.length, 3);
  } finally {
    db.close();
    fs.rmSync(primary, { recursive: true, force: true });
    fs.rmSync(wsl, { recursive: true, force: true });
    clearUsageFileCache();
  }
});

test('buildUsageReport: source filter, bySource totals, meta fields', () => {
  const load = {
    entries: [
      entry(),
      entry({ messageId: 'msg-9', requestId: 'req-9', source: 'WSL Ubuntu', outputTokens: 50 }),
    ],
    rawEntryCount: 2,
    unreachableSources: ['Old Laptop'],
  };
  const all = buildUsageReport(load, PRICING);
  assert.deepEqual(all.meta.allSources, ['This machine', 'WSL Ubuntu']);
  assert.deepEqual(all.meta.unreachableSources, ['Old Laptop']);
  assert.equal(all.bySource['WSL Ubuntu'].outputTokens, 50);
  assert.equal(all.bySource['This machine'].outputTokens, 5);

  const filtered = buildUsageReport(load, PRICING, { sources: ['WSL Ubuntu'] });
  assert.equal(filtered.totals.outputTokens, 50);
  // unfiltered option lists still expose every source
  assert.deepEqual(filtered.meta.allSources, ['This machine', 'WSL Ubuntu']);
});
