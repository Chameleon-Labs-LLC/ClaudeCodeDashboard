import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

/**
 * Spawn a detached single-tick daemon child. Returns immediately so the
 * HTTP request doesn't block for the tick duration.
 */
export async function POST() {
  const daemonScript = path.join(process.cwd(), 'scripts', 'daemon.ts');
  const child = spawn(
    'npx',
    ['tsx', daemonScript],
    {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, DAEMON_SINGLE_TICK: '1' },
    },
  );
  child.unref();
  return NextResponse.json({ triggered: true, pid: child.pid });
}
