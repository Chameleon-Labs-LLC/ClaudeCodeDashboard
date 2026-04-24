'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, Clock } from 'lucide-react';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import type { LiveSessionRow } from '@/types/live';
import { LiveSessionDetailSheet } from './live-session-detail-sheet';

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function LiveSessionsCard() {
  const [rows, setRows] = useState<LiveSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<LiveSessionRow | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions/live', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setRows(await res.json());
    } catch { /* transient — keep prior rows */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useAutoRefresh(load, 5000);

  return (
    <>
      <section className="rounded-lg border border-brand-navy-light bg-brand-navy p-4">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-brand-cyan">
            <Activity size={16} /> Live Sessions
            <span className="text-xs font-normal text-zinc-400">
              (last 5 min · {rows.length})
            </span>
          </h2>
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">auto · 5s</span>
        </header>

        {loading && <p className="text-xs text-zinc-500">Loading…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-xs text-zinc-500">No sessions active in the last 5 minutes.</p>
        )}

        <ul className="space-y-1">
          {rows.map(r => (
            <li key={r.id}>
              <button
                onClick={() => setSelected(r)}
                className="flex w-full items-center justify-between rounded border border-transparent bg-brand-navy-dark/40 px-3 py-2 text-left text-xs transition hover:border-brand-cyan/40 hover:bg-brand-navy-dark"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-zinc-100">{r.title}</span>
                  <span className="truncate text-[10px] text-zinc-500">
                    {r.projectName} · {r.model ?? 'unknown model'} · {r.tokenTotal.toLocaleString()} tok
                  </span>
                </span>
                <span className="ml-3 flex shrink-0 items-center gap-1 text-[10px] text-zinc-400">
                  <Clock size={10} /> {timeAgo(r.lastActiveAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <LiveSessionDetailSheet row={selected} onClose={() => setSelected(null)} />
    </>
  );
}
