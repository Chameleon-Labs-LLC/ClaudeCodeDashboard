/**
 * Mission Control daemon entry point.
 *
 * Usage:
 *   npm run daemon                   # loop forever, 120s tick
 *   DAEMON_SINGLE_TICK=1 npm run daemon  # run one tick and exit (used by /api/dispatcher/trigger)
 */

import path from 'path';
import fs from 'fs';
import { runOnce } from '../lib/dispatcher';
import { materializeSchedules } from '../lib/heartbeat';

const TICK_MS = parseInt(process.env.DAEMON_INTERVAL_SECONDS ?? '120', 10) * 1000;
const SINGLE_TICK = process.env.DAEMON_SINGLE_TICK === '1';

async function tick(): Promise<void> {
  console.log(`[daemon] tick ${new Date().toISOString()}`);
  try { materializeSchedules(); } catch (e) { console.error('[daemon] heartbeat error:', e); }
  try { await runOnce(); } catch (e) { console.error('[daemon] dispatcher error:', e); }
  console.log('[daemon] tick done');
}

async function main(): Promise<void> {
  const pidDir = path.join(process.cwd(), '.tmp', 'mission-control-queue', 'pids');
  fs.mkdirSync(pidDir, { recursive: true });

  console.log(`[daemon] starting — interval=${TICK_MS}ms single=${SINGLE_TICK}`);
  await tick();

  if (SINGLE_TICK) {
    console.log('[daemon] single-tick mode — exiting');
    process.exit(0);
  }

  const interval = setInterval(tick, TICK_MS);

  function shutdown(): void {
    clearInterval(interval);
    console.log('[daemon] shutting down');
    process.exit(0);
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => { console.error('[daemon] fatal:', e); process.exit(1); });
