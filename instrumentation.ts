export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startSyncLoop } = await import('./lib/sync-sessions');
  startSyncLoop(); // runNow: true, interval: 120s

  // Warm the usage parse cache (memory + sqlite) and prefetch pricing so the
  // first /api/usage request doesn't pay the full JSONL parse.
  const { warmUsageCache } = await import('./lib/usage-warm');
  warmUsageCache();
}
