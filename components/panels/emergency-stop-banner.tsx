'use client';

import { useEffect, useState } from 'react';

/**
 * Emergency stop banner — two states:
 *   1. Inline red-bordered "Emergency stop" button with inline confirm.
 *   2. Full-width red banner when emergency_stop='1' with a "Resume" button.
 *
 * Fetches /api/system/state on mount to seed the active flag.
 */

interface Props { onChange?: () => void }

export default function EmergencyStopBanner({ onChange }: Props) {
  const [active, setActive] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await fetch('/api/system/state');
      const json = await res.json();
      setActive(json?.emergency_stop === '1');
    } catch { /* ignore */ }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, []);

  async function stop() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/system/emergency-stop', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setActive(true);
      setConfirming(false);
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Stop failed');
    } finally { setBusy(false); }
  }

  async function resume() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/system/emergency-resume', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setActive(false);
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Resume failed');
    } finally { setBusy(false); }
  }

  if (active) {
    return (
      <div className="w-full rounded-lg border border-red-500/50 bg-red-950/40 px-4 py-3 flex items-center justify-between">
        <div className="text-sm text-red-200">
          <span className="font-semibold">Emergency stop is active.</span>{' '}
          Dispatcher will not claim pending tasks.
        </div>
        <button
          type="button"
          onClick={resume}
          disabled={busy}
          className="px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-500 text-white text-sm disabled:opacity-50"
        >
          {busy ? 'Resuming…' : 'Resume dispatcher'}
        </button>
        {error && <span className="text-xs text-red-300 ml-3">{error}</span>}
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="rounded-lg border border-red-500/50 bg-red-950/30 px-4 py-2 flex items-center gap-3 text-sm">
        <span className="text-red-200">Kill all dispatcher-launched claude processes?</span>
        <button
          type="button"
          onClick={stop}
          disabled={busy}
          className="px-3 py-1 rounded-md bg-red-600 hover:bg-red-500 text-white text-xs disabled:opacity-50"
        >
          {busy ? 'Stopping…' : 'Confirm stop'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="px-3 py-1 rounded-md border border-gray-500 text-gray-300 hover:text-white text-xs"
        >
          Cancel
        </button>
        {error && <span className="text-xs text-red-300 ml-2">{error}</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="px-3 py-1.5 rounded-md border border-red-500/60 text-red-300 hover:bg-red-950/40 text-sm"
    >
      Emergency stop
    </button>
  );
}
