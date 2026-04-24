// components/panels/hook-activity-card.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Webhook } from 'lucide-react';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import type { HookDay } from '@/types/observability';

interface Props { range: string }

interface HookActivityResponse {
  daily: HookDay[];
  totalFires: number;
}

function fmtMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms >= 1_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

function MiniBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max((value / max) * 100, 2) : 0;
  return (
    <div className="w-full h-1.5 bg-brand-navy/60 rounded-full overflow-hidden">
      <div
        className="h-full bg-brand-cyan/60 rounded-full"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function HookActivityCard({ range }: Props) {
  const [data, setData] = useState<HookActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/hooks/activity?range=${range}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json: HookActivityResponse) => {
        setData(json);
        setError(null);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 60_000);

  if (loading) return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full">
      <div className="h-4 w-32 bg-brand-navy/60 rounded animate-pulse mb-4" />
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-brand-navy/60 rounded animate-pulse" />
        ))}
      </div>
    </div>
  );

  if (error || !data) return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full">
      <p className="text-xs font-mono uppercase tracking-widest text-gray-500 mb-4">Hook Activity</p>
      <p className="text-chameleon-red text-sm">Failed to load hook data.</p>
      <p className="text-gray-600 text-xs mt-1">
        Check that the OTEL events table exists and the API route is reachable.
      </p>
    </div>
  );

  const { daily, totalFires } = data;
  const maxFires = Math.max(...daily.map((d) => d.fires), 1);

  return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-mono uppercase tracking-widest text-gray-500">Hook Activity</p>
        {totalFires > 0 && (
          <span className="text-xs font-mono text-gray-400">
            {totalFires.toLocaleString()} fires total
          </span>
        )}
      </div>

      {totalFires === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <Webhook size={28} className="text-gray-600" />
          <p className="text-gray-500 text-sm font-medium">No hook activity</p>
          <p className="text-gray-600 text-xs text-center max-w-xs">
            Hook events appear here when Claude Code runs pre/post-tool hooks.
            Configure hooks in{' '}
            <code className="text-chameleon-amber bg-brand-navy-dark px-1 rounded">
              ~/.claude/settings.json
            </code>
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto space-y-2">
          {daily.filter((d) => d.fires > 0).map((d) => (
            <div key={d.date} className="flex items-center gap-3">
              <span className="text-[10px] font-mono text-gray-500 w-12 shrink-0">{d.date.slice(5)}</span>
              <div className="flex-1">
                <MiniBar value={d.fires} max={maxFires} />
              </div>
              <span className="text-xs font-mono text-gray-400 w-10 text-right tabular-nums shrink-0">
                {d.fires}
              </span>
              {d.pairedCount > 0 && (
                <span className="text-[10px] font-mono text-gray-600 w-16 text-right shrink-0">
                  {fmtMs(d.avgDurationMs)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
