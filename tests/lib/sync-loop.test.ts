import { test } from 'node:test';
import assert from 'node:assert/strict';

test('startSyncLoop is idempotent across repeated invocations (HMR-safe)', async () => {
  // Import twice — simulates Next.js HMR re-running instrumentation.ts
  const { startSyncLoop, _syncLoopStarted } = await import('../../lib/sync-sessions');
  const a = startSyncLoop({ intervalMs: 60_000, runNow: false });
  const b = startSyncLoop({ intervalMs: 60_000, runNow: false });
  assert.equal(a, b, 'second call must return the same timer handle');
  assert.ok(_syncLoopStarted(), 'sentinel should be set');
});

test('startSyncLoop uses setInterval().unref() so it does not block process exit', async () => {
  const { startSyncLoop } = await import('../../lib/sync-sessions');
  const handle = startSyncLoop({ intervalMs: 60_000, runNow: false });
  // Node timers expose `hasRef()` — false after unref()
  assert.equal(typeof (handle as any).hasRef, 'function');
  assert.equal((handle as any).hasRef(), false, 'timer must be unref\'d');
});
