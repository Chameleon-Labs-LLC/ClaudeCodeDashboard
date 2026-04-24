// components/panels/cache-efficiency-card.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import type { CacheEfficiencyData, CacheDay } from '@/types/observability';

interface Props { range: string }

const TARGET_RATE = 0.70;
const SPARKLINE_H = 40;
const SPARKLINE_W = 200;

function Sparkline({ daily }: { daily: CacheDay[] }) {
  if (daily.length === 0) return null;

  const rates = daily.map(d => d.hitRate ?? 0);
  const max = Math.max(...rates, TARGET_RATE + 0.05, 0.01);

  const points = rates.map((r, i) => {
    const x = (i / Math.max(rates.length - 1, 1)) * SPARKLINE_W;
    const y = SPARKLINE_H - (r / max) * SPARKLINE_H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const targetY = SPARKLINE_H - (TARGET_RATE / max) * SPARKLINE_H;

  return (
    <svg
      viewBox={`0 0 ${SPARKLINE_W} ${SPARKLINE_H}`}
      className="w-full"
      preserveAspectRatio="none"
      style={{ height: SPARKLINE_H }}
      aria-hidden="true"
    >
      {/* Target line */}
      <line
        x1="0" y1={targetY} x2={SPARKLINE_W} y2={targetY}
        stroke="#FFC107" strokeWidth="1" strokeDasharray="3 3" opacity="0.6"
      />
      {/* Sparkline */}
      <polyline
        points={points}
        fill="none"
        stroke="#00D4FF"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Dots */}
      {rates.map((r, i) => {
        const x = (i / Math.max(rates.length - 1, 1)) * SPARKLINE_W;
        const y = SPARKLINE_H - (r / max) * SPARKLINE_H;
        return (
          <circle key={i} cx={x} cy={y} r="2.5" fill="#00D4FF" opacity="0.8" />
        );
      })}
    </svg>
  );
}

export default function CacheEfficiencyCard({ range }: Props) {
  const [data, setData] = useState<CacheEfficiencyData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch(`/api/usage/cache?range=${range}`)
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 60_000);

  if (loading) return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full">
      <div className="h-4 w-32 bg-brand-navy/60 rounded animate-pulse mb-4" />
      <div className="h-12 w-24 bg-brand-navy/60 rounded animate-pulse mb-4" />
      <div className="h-10 bg-brand-navy/60 rounded animate-pulse" />
    </div>
  );

  if (!data) return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full">
      <p className="text-chameleon-red text-sm">Failed to load cache data.</p>
    </div>
  );

  const hitPct = data.overallHitRate != null
    ? `${(data.overallHitRate * 100).toFixed(1)}%`
    : '—';

  const hitColor = data.overallHitRate == null
    ? 'text-gray-400'
    : data.overallHitRate >= TARGET_RATE
      ? 'text-chameleon-green'
      : data.overallHitRate >= 0.4
        ? 'text-chameleon-amber'
        : 'text-chameleon-red';

  const isEmpty = data.daily.length === 0;

  return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs font-mono uppercase tracking-widest text-gray-500 mb-0.5">Cache Efficiency</p>
          <div className="flex items-center gap-2">
            <span className={`text-4xl font-bold tabular-nums ${hitColor}`}>{hitPct}</span>
            {data.lowSample && (
              <span className="text-[10px] font-mono uppercase tracking-widest text-chameleon-amber border border-chameleon-amber/30 px-1.5 py-0.5 rounded">
                low sample
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Target</p>
          <p className="text-sm font-mono text-chameleon-amber">{(TARGET_RATE * 100).toFixed(0)}%</p>
        </div>
      </div>

      {/* Sparkline or empty */}
      <div className="flex-1 min-h-0">
        {isEmpty ? (
          <div className="flex items-center justify-center h-full min-h-[60px]">
            <p className="text-gray-600 text-xs text-center">
              No token usage recorded yet. Run sessions with Claude to see cache hit rates.
            </p>
          </div>
        ) : (
          <>
            <div className="relative">
              <Sparkline daily={data.daily} />
              <div className="absolute -top-3 right-0 flex items-center gap-1">
                <span className="w-3 border-t border-dashed border-chameleon-amber/60" />
                <span className="text-[9px] text-chameleon-amber/60 font-mono">70% target</span>
              </div>
            </div>
            <p className="text-xs text-gray-600 mt-2 font-mono text-right">
              {data.overallBillableTokens.toLocaleString()} billable tokens
            </p>
          </>
        )}
      </div>
    </div>
  );
}
