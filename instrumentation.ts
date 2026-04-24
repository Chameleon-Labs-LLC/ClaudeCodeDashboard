export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startSyncLoop } = await import('./lib/sync-sessions');
  startSyncLoop(); // runNow: true, interval: 120s
}
