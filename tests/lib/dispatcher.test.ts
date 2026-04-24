import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRATCH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), '.ccd-test-'));
const SCRATCH_DB = path.join(SCRATCH_DIR, 'dispatcher.db');
process.env.CCD_DB_PATH = SCRATCH_DB;

import { getDb } from '../../lib/db';
import * as disp from '../../lib/dispatcher';
import { createTask, getTask } from '../../lib/task-tracker';

getDb();

beforeEach(() => {
  getDb().prepare('DELETE FROM ops_tasks').run();
  getDb().prepare('DELETE FROM activities').run();
  getDb().prepare('DELETE FROM system_state').run();
  try { fs.rmSync(disp.PID_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

after(() => {
  try { getDb().close(); } catch { /* already closed */ }
  fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
  try { fs.rmSync(disp.PID_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('sweepStalePids removes files for dead PIDs, keeps live ones', () => {
  fs.mkdirSync(disp.PID_DIR, { recursive: true });
  // Definitely-dead PID (99999999 is above the default kernel pid_max on Linux).
  fs.writeFileSync(path.join(disp.PID_DIR, '99999999'), '99999999');
  // Live PID — this test process itself.
  const livePid = process.pid;
  fs.writeFileSync(path.join(disp.PID_DIR, String(livePid)), String(livePid));

  disp.sweepStalePids();

  assert.equal(
    fs.existsSync(path.join(disp.PID_DIR, '99999999')),
    false,
    'dead-PID file must be removed',
  );
  assert.equal(
    fs.existsSync(path.join(disp.PID_DIR, String(livePid))),
    true,
    'live-PID file must be kept',
  );
});

test('runOnce with emergency_stop=1 does not claim tasks', async () => {
  getDb()
    .prepare(
      `INSERT INTO system_state(key,value,updated_at) VALUES('emergency_stop','1',?)`,
    )
    .run(new Date().toISOString());
  const task = createTask({ title: 'should not run' });

  await disp.runOnce();

  const row = getTask(task.id)!;
  assert.equal(row.status, 'pending');

  // Heartbeat activity row written with tasks_dispatched: 0.
  const act = getDb()
    .prepare(`SELECT detail FROM activities ORDER BY id DESC LIMIT 1`)
    .get() as { detail: string };
  const parsed = JSON.parse(act.detail);
  assert.equal(parsed.tasks_dispatched, 0);
  assert.equal(parsed.emergency_stop, true);
});

test('runOnce promotes requires_approval tasks to awaiting_approval without spawning', async () => {
  const task = createTask({ title: 'needs approval', requires_approval: true });

  await disp.runOnce();

  const row = getTask(task.id)!;
  assert.equal(row.status, 'awaiting_approval');
});

test('markPid/unmarkPid round-trip: file created and removed', () => {
  const fakePid = 123456;
  disp.markPid(fakePid);
  assert.ok(fs.existsSync(path.join(disp.PID_DIR, String(fakePid))));
  disp.unmarkPid(fakePid);
  assert.equal(fs.existsSync(path.join(disp.PID_DIR, String(fakePid))), false);
});
