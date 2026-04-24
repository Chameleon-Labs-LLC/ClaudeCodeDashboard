import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRATCH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), '.ccd-test-'));
const SCRATCH_DB = path.join(SCRATCH_DIR, 'heartbeat.db');
process.env.CCD_DB_PATH = SCRATCH_DB;

import { getDb } from '../../lib/db';
import { parseCronSimple, materializeSchedules } from '../../lib/heartbeat';

getDb();

beforeEach(() => {
  getDb().prepare('DELETE FROM ops_tasks').run();
  getDb().prepare('DELETE FROM ops_schedules').run();
});

after(() => {
  try { getDb().close(); } catch { /* already closed */ }
  fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
});

test('parseCronSimple returns null for wrong number of parts', () => {
  assert.equal(parseCronSimple('* *', new Date()), null);
  assert.equal(parseCronSimple('1 2 3 4', new Date()), null);
});

test('parseCronSimple returns null for NaN or out-of-range fields', () => {
  assert.equal(parseCronSimple('abc 9 * * 0', new Date()), null);
  assert.equal(parseCronSimple('0 99 * * 0', new Date()), null);
  assert.equal(parseCronSimple('0 9 * * 99', new Date()), null);
  assert.equal(parseCronSimple('60 9 * * 0', new Date()), null);
});

test('parseCronSimple Mon 9am: returns next Monday when called from Sunday 09:01', () => {
  // Sun 2026-03-08 09:01 local time → next Mon 2026-03-09 09:00.
  const from = new Date(2026, 2, 8, 9, 1, 0); // Sun Mar 8 2026 09:01 local
  const next = parseCronSimple('0 9 * * 0', from);
  assert.ok(next, 'must return a date');
  assert.equal(next!.getHours(), 9);
  assert.equal(next!.getMinutes(), 0);
  // 2026-03-09 is a Monday (JS getDay()=1)
  assert.equal(next!.getDay(), 1, 'next run should be on Monday');
});

test('parseCronSimple same DOW but before target time: returns same-day hit', () => {
  // Mon 2026-03-09 08:00 → target Mon 09:00 same day.
  const from = new Date(2026, 2, 9, 8, 0, 0);
  const next = parseCronSimple('0 9 * * 0', from);
  assert.ok(next);
  assert.equal(next!.getDate(), 9);
  assert.equal(next!.getHours(), 9);
});

test('parseCronSimple: called AT target time advances to next week', () => {
  const from = new Date(2026, 2, 9, 9, 0, 0); // Mon 09:00
  const next = parseCronSimple('0 9 * * 0', from);
  assert.ok(next);
  // Not the same minute — must go to next Monday.
  assert.equal(next!.getDay(), 1);
  assert.notEqual(next!.getDate(), 9);
});

test('parseCronSimple DST: 9am wall-clock target survives spring-forward', () => {
  // 2026-03-08 is US DST spring forward (02:00 → 03:00 locally).
  // From 09:01 on that day, next Mon 9am must still return 9am wall-clock.
  const from = new Date(2026, 2, 8, 9, 1, 0);
  const next = parseCronSimple('0 9 * * 0', from);
  assert.ok(next);
  assert.equal(next!.getHours(), 9, 'hour must be 9 local wall-clock, not shifted');
});

test('materializeSchedules creates ops_tasks for due schedules and advances next_run_at', () => {
  const db = getDb();
  db.prepare(`
    INSERT INTO ops_schedules (name, cron_expression, task_title, enabled, next_run_at)
    VALUES ('sched1', '0 9 * * 0', 'weekly task', 1, ?)
  `).run(new Date(Date.now() - 60_000).toISOString()); // due 1 minute ago

  const created = materializeSchedules();
  assert.equal(created, 1);

  const tasks = db.prepare('SELECT * FROM ops_tasks').all() as any[];
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, 'weekly task');

  const sched = db.prepare('SELECT * FROM ops_schedules LIMIT 1').get() as any;
  assert.ok(sched.last_run_at);
  assert.ok(sched.next_run_at);
});

test('materializeSchedules skips schedules with future next_run_at', () => {
  const db = getDb();
  db.prepare(`
    INSERT INTO ops_schedules (name, cron_expression, task_title, enabled, next_run_at)
    VALUES ('future', '0 9 * * 0', 'not yet', 1, ?)
  `).run(new Date(Date.now() + 3_600_000).toISOString()); // 1h in future

  const created = materializeSchedules();
  assert.equal(created, 0);
  const tasks = db.prepare('SELECT COUNT(*) as n FROM ops_tasks').get() as { n: number };
  assert.equal(tasks.n, 0);
});

test('materializeSchedules called twice rapidly: exactly one task created per schedule', () => {
  const db = getDb();
  db.prepare(`
    INSERT INTO ops_schedules (name, cron_expression, task_title, enabled, next_run_at)
    VALUES ('once', '0 9 * * 0', 'fire once', 1, ?)
  `).run(new Date(Date.now() - 60_000).toISOString());

  // After the first call, next_run_at moves into the future, so the second
  // call should not re-fire it.
  materializeSchedules();
  materializeSchedules();

  const n = (db.prepare('SELECT COUNT(*) as n FROM ops_tasks').get() as { n: number }).n;
  assert.equal(n, 1);
});
