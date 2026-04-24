import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, _migrateAddColumn } from '../../lib/db';

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
