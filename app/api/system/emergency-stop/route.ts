import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getDb } from '@/lib/db';

/**
 * Emergency stop — terminates only dispatcher-launched `claude` children.
 *
 * PID files are the sole targeting mechanism (master plan risk #4). An
 * interactive `claude -p` started in another terminal has no PID file and
 * is completely invisible to this endpoint regardless of platform. The
 * `isClaudeProcess()` guard defends against PID recycling (the OS may
 * reassign a PID to an unrelated process after the dispatcher child died).
 *
 * Windows: SIGTERM via `process.kill()` is best-effort — `taskkill /T /F`
 * is the reliable termination. macOS/Linux: SIGTERM, fall back to SIGKILL
 * after a grace period if the process is still alive.
 */

const PID_DIR = path.join(process.cwd(), '.tmp', 'mission-control-queue', 'pids');
const IS_WIN32 = process.platform === 'win32';
const KILL_GRACE_MS = 2_000;

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function isClaudeProcess(pid: number): boolean {
  try {
    if (IS_WIN32) {
      const out = execSync(
        `tasklist /FI "PID eq ${pid}" /FO CSV /NH`,
        { encoding: 'utf-8', timeout: 5000 },
      ).toLowerCase();
      return out.includes('claude');
    } else {
      const out = execSync(
        `ps -p ${pid} -o command=`,
        { encoding: 'utf-8', timeout: 5000 },
      );
      return out.includes('claude') && out.includes('-p');
    }
  } catch {
    return false; // died between isAlive check and here
  }
}

function killProcess(pid: number): void {
  try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
  if (IS_WIN32) {
    try { execSync(`taskkill /pid ${pid} /T /F`, { timeout: 5000 }); } catch { /* already dead */ }
    return;
  }
  // POSIX: wait a short grace period, then SIGKILL if still alive.
  const deadline = Date.now() + KILL_GRACE_MS;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return;
    // Busy-wait with tiny delay; emergency stop favours speed over CPU.
    const until = Date.now() + 50;
    while (Date.now() < until) { /* noop */ }
  }
  try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
}

export async function POST() {
  let files: string[] = [];
  try { files = fs.readdirSync(PID_DIR); } catch { /* dir not created yet */ }

  let processesKilled = 0;
  let interactiveSpared = 0;

  for (const f of files) {
    const pid = parseInt(f, 10);
    if (isNaN(pid)) continue;
    const markerPath = path.join(PID_DIR, f);

    if (!isAlive(pid)) {
      try { fs.unlinkSync(markerPath); } catch { /* race */ }
      continue;
    }

    if (!isClaudeProcess(pid)) {
      // PID recycled to an unrelated process — spare it, clean the stale marker.
      try { fs.unlinkSync(markerPath); } catch { /* race */ }
      interactiveSpared++;
      continue;
    }

    killProcess(pid);
    try { fs.unlinkSync(markerPath); } catch { /* race */ }
    processesKilled++;
  }

  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO system_state(key,value,updated_at) VALUES('emergency_stop','1',?)
     ON CONFLICT(key) DO UPDATE SET value='1', updated_at=excluded.updated_at`,
  ).run(now);

  db.prepare(
    `UPDATE ops_tasks SET status='failed', error_message='Emergency stop triggered',
     completed_at=? WHERE status='running'`,
  ).run(now);

  return NextResponse.json({
    stopped: true,
    processes_killed: processesKilled,
    interactive_spared: interactiveSpared,
  });
}
