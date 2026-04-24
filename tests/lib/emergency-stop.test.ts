import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'child_process';

const SCRATCH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), '.ccd-test-'));
const SCRATCH_DB = path.join(SCRATCH_DIR, 'emergency-stop.db');
process.env.CCD_DB_PATH = SCRATCH_DB;

import { getDb } from '../../lib/db';
import { createTask, getTask } from '../../lib/task-tracker';
import { PID_DIR, markPid } from '../../lib/dispatcher';
import { POST as stopHandler } from '../../app/api/system/emergency-stop/route';
import { POST as resumeHandler } from '../../app/api/system/emergency-resume/route';
import { GET as stateHandler } from '../../app/api/system/state/route';

getDb();

beforeEach(() => {
  getDb().prepare('DELETE FROM ops_tasks').run();
  getDb().prepare('DELETE FROM system_state').run();
  try { fs.rmSync(PID_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

after(() => {
  try { getDb().close(); } catch { /* already closed */ }
  fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
  try { fs.rmSync(PID_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

test('POST /api/system/emergency-stop flips the flag and marks running tasks failed', async () => {
  const task = createTask({ title: 'running task' });
  getDb().prepare(`UPDATE ops_tasks SET status='running' WHERE id=?`).run(task.id);

  const res = await stopHandler();
  const json = (await res.json()) as { stopped: boolean };
  assert.equal(json.stopped, true);

  // Flag set
  const stateRes = await stateHandler();
  const state = (await stateRes.json()) as Record<string, string>;
  assert.equal(state.emergency_stop, '1');

  // Running task flipped to failed
  const row = getTask(task.id)!;
  assert.equal(row.status, 'failed');
  assert.equal(row.error_message, 'Emergency stop triggered');
});

test('POST /api/system/emergency-resume clears the flag', async () => {
  // Preset stop flag
  getDb().prepare(
    `INSERT INTO system_state(key,value,updated_at) VALUES('emergency_stop','1',?)`,
  ).run(new Date().toISOString());

  const res = await resumeHandler();
  const json = (await res.json()) as { resumed: boolean };
  assert.equal(json.resumed, true);

  const stateRes = await stateHandler();
  const state = (await stateRes.json()) as Record<string, string>;
  assert.equal(state.emergency_stop, '0');
});

test('emergency-stop kills a dispatcher-launched child with a PID file; survival test for non-dispatched processes', async (t) => {
  // Skip on Windows — this test uses POSIX-only kill semantics.
  if (process.platform === 'win32') {
    t.skip('posix-only');
    return;
  }

  // Spawn a long-lived node child, mark its PID as dispatcher-launched.
  // The command substring must include "claude" and "-p" to pass
  // isClaudeProcess() — we inject that via process.title-like argv0.
  // The simplest way: use bash -c with a visible command-line pattern.
  const dispatched = spawn(
    'bash',
    ['-c', 'exec -a "claude -p dispatched-child" sleep 30'],
    { detached: false, stdio: 'ignore' },
  );
  // Wait for exec to rename so /proc command matches.
  await wait(250);
  const dispatchedPid = dispatched.pid!;
  assert.ok(isAlive(dispatchedPid), 'dispatched child must be alive before stop');
  markPid(dispatchedPid);

  // Spawn a second unrelated child without a PID file — this represents an
  // interactive `claude -p` running in another terminal. Must survive.
  const unrelated = spawn(
    'bash',
    ['-c', 'exec -a "claude -p UNRELATED" sleep 30'],
    { detached: false, stdio: 'ignore' },
  );
  await wait(250);
  const unrelatedPid = unrelated.pid!;
  assert.ok(isAlive(unrelatedPid), 'unrelated child must be alive');

  // Fire the emergency stop.
  const res = await stopHandler();
  const json = (await res.json()) as { processes_killed: number };
  assert.ok(json.processes_killed >= 1, `expected ≥1 kill, got ${json.processes_killed}`);

  // Give the kernel a moment to reap the dispatched child.
  await wait(500);
  assert.equal(isAlive(dispatchedPid), false, 'dispatched child must be dead');
  assert.equal(isAlive(unrelatedPid), true, 'unrelated child must survive');

  // Cleanup: terminate the unrelated child so the test suite exits cleanly.
  try { process.kill(unrelatedPid, 'SIGTERM'); } catch { /* already gone */ }
  await wait(200);
  try { process.kill(unrelatedPid, 'SIGKILL'); } catch { /* already gone */ }
});
