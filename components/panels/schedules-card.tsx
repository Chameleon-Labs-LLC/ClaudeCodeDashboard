'use client';

import { useCallback, useState } from 'react';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import type { OpsSchedule } from '@/types/mission-control';
import { formatFutureTime, formatRelativeTime } from '@/lib/format-time';

interface Props { onRefresh?: () => void }

export default function SchedulesCard({ onRefresh }: Props) {
  const [schedules, setSchedules] = useState<OpsSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/schedules');
      if (res.ok) setSchedules(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useAutoRefresh(load, 30_000);

  async function toggle(sched: OpsSchedule) {
    const newEnabled = sched.enabled === 1 ? false : true;
    // Optimistic update
    setSchedules((s) => s.map((x) => x.id === sched.id ? { ...x, enabled: newEnabled ? 1 : 0 } : x));
    try {
      await fetch(`/api/schedules?id=${sched.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newEnabled }),
      });
      onRefresh?.();
    } catch { load(); }
  }

  async function del(id: number) {
    try {
      await fetch(`/api/schedules?id=${id}`, { method: 'DELETE' });
      setConfirmingDelete(null);
      load();
      onRefresh?.();
    } catch { /* ignore */ }
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-12 bg-brand-navy-light/40 rounded animate-pulse" />
        <div className="h-12 bg-brand-navy-light/40 rounded animate-pulse" />
      </div>
    );
  }

  if (schedules.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No schedules yet — create one to automate recurring tasks.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {schedules.map((s) => {
        const nextMs = s.next_run_at ? new Date(s.next_run_at).getTime() : null;
        const stale =
          s.enabled === 1 && nextMs !== null && nextMs < Date.now() - 5 * 60_000;
        return (
          <div
            key={s.id}
            className="flex items-center gap-3 px-3 py-2 bg-brand-navy-light/40 border border-brand-navy-light/40 rounded-lg"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm text-white font-medium truncate">{s.name}</span>
                <code className="text-[10px] text-gray-400 bg-brand-navy/60 px-1.5 py-0.5 rounded">
                  {s.cron_expression}
                </code>
                {stale && <span title="stale" className="w-2 h-2 rounded-full bg-amber-400" />}
              </div>
              <div className="flex gap-3 text-[11px] text-gray-500 mt-0.5">
                <span>next: {formatFutureTime(s.next_run_at)}</span>
                <span>last: {formatRelativeTime(s.last_run_at)}</span>
              </div>
            </div>
            <label className="flex items-center gap-1 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={s.enabled === 1}
                onChange={() => toggle(s)}
              />
              enabled
            </label>
            {confirmingDelete === s.id ? (
              <>
                <button
                  type="button"
                  onClick={() => del(s.id)}
                  className="text-xs text-red-400 hover:text-red-300"
                >Confirm</button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(null)}
                  className="text-xs text-gray-500 hover:text-gray-400"
                >Cancel</button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(s.id)}
                className="text-xs text-gray-500 hover:text-red-400"
              >Delete</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
