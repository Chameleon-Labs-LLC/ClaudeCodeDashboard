// components/panels/pressure-panel.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertOctagon, RefreshCw, Zap } from 'lucide-react';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import type { PressureData } from '@/types/observability';

interface Props {
  range: string;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function PressurePanel({ range }: Props) {
  const [data, setData] = useState<PressureData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/system/pressure?range=${encodeURIComponent(range)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PressureData>;
      })
      .then((json) => {
        setData(json);
        setError(null);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to fetch');
      })
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);
  useAutoRefresh(load, 60_000);

  if (loading) {
    return (
      <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5">
        <div className="h-4 w-36 bg-brand-navy/60 rounded animate-pulse mb-4" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-brand-navy/60 rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="h-16 bg-brand-navy/60 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5">
        <p className="text-xs font-mono uppercase tracking-widest text-gray-500 mb-3">
          System Pressure
        </p>
        <p className="text-chameleon-red text-sm mb-1">Failed to load pressure data.</p>
        <p className="text-gray-500 text-xs">
          {error ?? 'The /api/system/pressure endpoint returned no data.'} Try reloading the page
          or check the dev server logs for errors.
        </p>
      </div>
    );
  }

  const hasErrors = data.recentErrors.length > 0;
  const hasPressure = data.retryExhaustedCount > 0 || data.compactionCount > 0;

  return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5">
      <p className="text-xs font-mono uppercase tracking-widest text-gray-500 mb-4">
        System Pressure
      </p>

      {/* KPI tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        {/* Retry exhaustion */}
        <div
          className={`rounded-lg p-4 border ${
            data.retryExhaustedCount > 0
              ? 'bg-chameleon-red/5 border-chameleon-red/20'
              : 'bg-brand-navy/40 border-brand-navy-light/20'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <RefreshCw
              size={14}
              className={data.retryExhaustedCount > 0 ? 'text-chameleon-red' : 'text-gray-600'}
            />
            <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">
              Retry exhausted
            </span>
          </div>
          <p
            className={`text-2xl font-bold tabular-nums ${
              data.retryExhaustedCount > 0 ? 'text-chameleon-red' : 'text-gray-400'
            }`}
          >
            {data.retryExhaustedCount}
          </p>
          <p className="text-[10px] text-gray-600 mt-1 font-mono">
            threshold: {data.maxRetriesThreshold} attempts
          </p>
        </div>

        {/* Compaction */}
        <div
          className={`rounded-lg p-4 border ${
            data.compactionCount > 5
              ? 'bg-chameleon-amber/5 border-chameleon-amber/20'
              : 'bg-brand-navy/40 border-brand-navy-light/20'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <Zap
              size={14}
              className={data.compactionCount > 5 ? 'text-chameleon-amber' : 'text-gray-600'}
            />
            <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">
              Compactions
            </span>
          </div>
          <p
            className={`text-2xl font-bold tabular-nums ${
              data.compactionCount > 5 ? 'text-chameleon-amber' : 'text-gray-400'
            }`}
          >
            {data.compactionCount}
          </p>
          <p className="text-[10px] text-gray-600 mt-1 font-mono">context-length events</p>
        </div>

        {/* API errors */}
        <div
          className={`rounded-lg p-4 border ${
            hasErrors
              ? 'bg-chameleon-amber/5 border-chameleon-amber/20'
              : 'bg-brand-navy/40 border-brand-navy-light/20'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <AlertOctagon
              size={14}
              className={hasErrors ? 'text-chameleon-amber' : 'text-gray-600'}
            />
            <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">
              API errors
            </span>
          </div>
          <p
            className={`text-2xl font-bold tabular-nums ${
              hasErrors ? 'text-chameleon-amber' : 'text-gray-400'
            }`}
          >
            {data.recentErrors.length}
          </p>
          <p className="text-[10px] text-gray-600 mt-1 font-mono">
            last {data.recentErrors.length > 0 ? '10' : '0'} shown
          </p>
        </div>
      </div>

      {/* Recent errors list / All clear */}
      {!hasPressure && !hasErrors ? (
        <div className="text-center py-4">
          <p className="text-chameleon-green text-sm font-medium">All clear</p>
          <p className="text-gray-600 text-xs mt-1">
            No retry exhaustions, compactions, or API errors in this range.
          </p>
        </div>
      ) : hasErrors ? (
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-2">
            Recent API Errors
          </p>
          <div className="space-y-1.5">
            {data.recentErrors.map((e, i) => (
              <div
                key={`${e.timestamp}-${i}`}
                className="flex items-start gap-3 py-2 px-3 bg-brand-navy/40 rounded-lg text-xs"
              >
                <span className="text-gray-600 font-mono shrink-0 mt-0.5">
                  {timeAgo(e.timestamp)}
                </span>
                <span
                  className={`font-mono shrink-0 mt-0.5 ${
                    e.status_code && e.status_code >= 500
                      ? 'text-chameleon-red'
                      : 'text-chameleon-amber'
                  }`}
                >
                  {e.status_code ?? '—'}
                </span>
                <span
                  className="text-gray-400 truncate flex-1"
                  title={e.error_message ?? ''}
                >
                  {e.error_message ?? 'Unknown error'}
                </span>
                {e.attempt_count != null && (
                  <span className="text-gray-600 font-mono shrink-0">×{e.attempt_count}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-3">
          <p className="text-gray-500 text-xs">
            Pressure events recorded, but no recent API errors captured in this range.
          </p>
        </div>
      )}
    </div>
  );
}
