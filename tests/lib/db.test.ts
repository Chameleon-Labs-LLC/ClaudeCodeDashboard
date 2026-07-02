import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, _migrateAddColumn, _bindingCandidates } from '../../lib/db';

const EXPECTED_TABLES = [
  'sessions', 'token_usage', 'tool_calls',
  'otel_events', 'otel_metrics',
  'ops_tasks', 'ops_schedules', 'ops_decisions', 'ops_inbox',
  'activities', 'live_session_state',
  'mcp_stats', 'mcp_schemas',
  'skills', 'system_state', 'notification_log',
];

test('openDb creates every spec table + enables WAL', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '.ccd-test-'));
  const dbPath = path.join(dir, 'test.db');
  const db = openDb(dbPath);

  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  const have = new Set(names.map(r => r.name));
  for (const t of EXPECTED_TABLES) {
    assert.ok(have.has(t), `missing table ${t}`);
  }

  const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
  assert.equal(mode.journal_mode.toLowerCase(), 'wal');

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('openDb is idempotent (runs twice without error)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '.ccd-test-'));
  const dbPath = path.join(dir, 'test.db');
  openDb(dbPath).close();
  openDb(dbPath).close(); // second call — no "table already exists" error
  fs.rmSync(dir, { recursive: true, force: true });
});

test('_bindingCandidates: default loader only when cwd is not the app tree', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '.ccd-test-'));
  try {
    assert.deepEqual(_bindingCandidates(dir), [undefined]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('_bindingCandidates: enumerates every .native binary, current platform first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '.ccd-test-'));
  try {
    fs.mkdirSync(path.join(dir, 'node_modules', 'better-sqlite3'), { recursive: true });
    const preferred = `${process.platform}-${process.arch}`;
    for (const plat of ['zzz-arch', preferred, 'aaa-arch']) {
      const d = path.join(dir, '.native', plat);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'better_sqlite3.node'), 'stub');
    }
    // empty .native dir without a binary must be skipped
    fs.mkdirSync(path.join(dir, '.native', 'empty-arch'), { recursive: true });

    const candidates = _bindingCandidates(dir);
    // default loader is always a candidate; side-loads follow, preferred platform first
    assert.equal(candidates[0], undefined);
    const sideLoads = candidates.slice(1) as string[];
    assert.equal(sideLoads.length, 3);
    assert.ok(sideLoads[0].includes(preferred));
    assert.ok(sideLoads.every((p) => p.endsWith('better_sqlite3.node')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('_bindingCandidates: CCD_NATIVE_BINDING override is the only candidate', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '.ccd-test-'));
  const bin = path.join(dir, 'custom.node');
  fs.writeFileSync(bin, 'stub');
  process.env.CCD_NATIVE_BINDING = bin;
  try {
    assert.deepEqual(_bindingCandidates(dir), [fs.realpathSync(bin)]);
  } finally {
    delete process.env.CCD_NATIVE_BINDING;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('_migrateAddColumn adds missing column and is a no-op when present', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '.ccd-test-'));
  const db = openDb(path.join(dir, 'm.db'));
  _migrateAddColumn(db, 'sessions', 'new_col', 'TEXT');
  _migrateAddColumn(db, 'sessions', 'new_col', 'TEXT'); // must not throw
  const cols = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
  assert.ok(cols.some(c => c.name === 'new_col'));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
