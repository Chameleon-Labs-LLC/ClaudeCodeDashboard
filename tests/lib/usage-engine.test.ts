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
  type UsageEntry,
} from '../../lib/usage-engine';

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

export function entry(over: Partial<UsageEntry> = {}): UsageEntry {
  return {
    messageId: 'msg-1',
    requestId: 'req-1',
    isSidechain: false,
    isFast: false,
    timestampMs: Date.parse(TS),
    model: 'claude-opus-4-8',
    sessionId: 'sess-1',
    projectName: 'proj-a',
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
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    clearUsageFileCache();
  }
});
