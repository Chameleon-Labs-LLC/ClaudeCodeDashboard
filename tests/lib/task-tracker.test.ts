import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRATCH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), '.ccd-test-'));
const SCRATCH_DB = path.join(SCRATCH_DIR, 'task-tracker.db');
process.env.CCD_DB_PATH = SCRATCH_DB;

import { openDb, getDb } from '../../lib/db';
import * as tt from '../../lib/task-tracker';

getDb();

beforeEach(() => {
  getDb().prepare('DELETE FROM ops_tasks').run();
});

after(() => {
  try { getDb().close(); } catch { /* already closed */ }
  fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
});

test('createTask returns a row with status=pending and consecutive_failures=0', () => {
  const task = tt.createTask({ title: 'hello', description: 'desc', priority: 5 });
  assert.equal(task.title, 'hello');
  assert.equal(task.status, 'pending');
  assert.equal(task.consecutive_failures, 0);
  assert.equal(task.execution_mode, 'stream');
});

test('claimPending transitions pending→running; second call returns null', () => {
  const task = tt.createTask({ title: 'claim me' });
  const first = tt.claimPending(task.id);
  assert.ok(first, 'first claim must succeed');
  assert.equal(first!.status, 'running');

  const second = tt.claimPending(task.id);
  assert.equal(second, null);
});

test('claimPending with two Database handles — exactly one wins', () => {
  const created = tt.createTask({ title: 'race me' });

  const handle = openDb(SCRATCH_DB);
  const now = new Date().toISOString();
  const claimDirect = handle
    .prepare(`UPDATE ops_tasks SET status='running', started_at=? WHERE id=? AND status='pending'`)
    .run(now, created.id);
  const winner = tt.claimPending(created.id);
  handle.close();

  const successes = (claimDirect.changes > 0 ? 1 : 0) + (winner ? 1 : 0);
  assert.equal(successes, 1, 'exactly one claim must win');
});

test('failTask sets status=failed and increments consecutive_failures each call', () => {
  const task = tt.createTask({ title: 'fail me' });
  tt.failTask(task.id, 'boom 1', 123);
  let row = tt.getTask(task.id)!;
  assert.equal(row.status, 'failed');
  assert.equal(row.consecutive_failures, 1);
  assert.equal(row.duration_ms, 123);

  tt.failTask(task.id, 'boom 2');
  row = tt.getTask(task.id)!;
  assert.equal(row.consecutive_failures, 2);
});

test('completeTask marks done and writes duration_ms', () => {
  const task = tt.createTask({ title: 'finish me' });
  tt.claimPending(task.id);
  tt.completeTask(task.id, 'all good', 42_000, 0.12);

  const row = tt.getTask(task.id)!;
  assert.equal(row.status, 'done');
  assert.equal(row.output_summary, 'all good');
  assert.equal(row.duration_ms, 42_000);
  assert.equal(row.cost_usd, 0.12);
});

test('listTasks filters by status', () => {
  const a = tt.createTask({ title: 'one' });
  tt.createTask({ title: 'two' });
  tt.failTask(a.id, 'nope');

  const failed = tt.listTasks({ status: 'failed' });
  const pending = tt.listTasks({ status: 'pending' });
  assert.equal(failed.length, 1);
  assert.equal(pending.length, 1);
});

test('updateTask only updates whitelisted columns', () => {
  const task = tt.createTask({ title: 'update me' });
  tt.updateTask(task.id, { session_id: 'abc123', risk_level: 'high' });
  const row = tt.getTask(task.id)!;
  assert.equal(row.session_id, 'abc123');
  assert.equal(row.risk_level, 'high');
});

test('deleteTask removes row', () => {
  const task = tt.createTask({ title: 'bye' });
  tt.deleteTask(task.id);
  assert.equal(tt.getTask(task.id), null);
});
