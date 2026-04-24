// components/panels/session-outcomes-card.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import type { OutcomeDay } from '@/types/observability';

interface Props { range: string }

const SEGMENTS = [
  { key: 'errored',     label: 'Errored',      color: '#F44336' },
  { key: 'rateLimited', label: 'Rate limited', color: '#FFC107' },
  { key: 'truncated',   label: 'Truncated',    color: '#FF9800' },
  { key: 'unfinished',  label: 'Unfinished',   color: '#5a5a70' },
  { key: 'ok',          label: 'OK',           color: '#4CAF50' },
] as const;

type SegmentKey = typeof SEGMENTS[number]['key'];

function StackedBar({ day }: { day: OutcomeDay }) {
  if (day.total === 0) return (
    <div className="h-full bg-brand-navy/40 rounded-sm" title={day.date} />
  );

  return (
    <div
      className="flex flex-col-reverse h-full rounded-sm overflow-hidden"
      title={
        `${day.date}\n` +
        SEGMENTS.map(s => `${s.label}: ${day[s.key as SegmentKey]}`).join('\n')
      }
    >
      {SEGMENTS.map(seg => {
        const count = day[seg.key as SegmentKey];
        if (count === 0) return null;
        const pct = (count / day.total) * 100;
        return (
          <div
            key={seg.key}
            style={{
              height: `${pct}%`,
              backgroundColor: seg.color,
              minHeight: count > 0 ? '2px' : '0',
            }}
          />
        );
      })}
    </div>
  );
}

export default function SessionOutcomesCard({ range }: Props) {
  const [daily, setDaily] = useState<OutcomeDay[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    fetch(`/api/sessions/outcomes?range=${range}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: { daily: OutcomeDay[] }) => setDaily(d.daily))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 60_000);

  if (loading) return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full">
      <div className="h-4 w-40 bg-brand-navy/60 rounded animate-pulse mb-4" />
      <div className="h-32 bg-brand-navy/60 rounded animate-pulse" />
    </div>
  );

  if (error || !daily) return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full">
      <p className="text-xs font-mono uppercase tracking-widest text-gray-500 mb-4">Session Outcomes</p>
      <p className="text-chameleon-red text-sm">Failed to load outcomes data.</p>
      <p className="text-gray-600 text-xs mt-2">
        Check that the observability database is available and retry.
      </p>
    </div>
  );

  const BAR_H = 100; // px

  return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full flex flex-col">
      <p className="text-xs font-mono uppercase tracking-widest text-gray-500 mb-4">Session Outcomes</p>

      {daily.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-600 text-xs text-center">
            No sessions in this range. Sessions will appear here after they complete.
          </p>
        </div>
      ) : (
        <>
          {/* Bars */}
          <div className="flex-1 min-h-0 flex items-end gap-1" style={{ height: BAR_H }}>
            {daily.map(day => (
              <div
                key={day.date}
                className="flex-1 flex flex-col justify-end"
                style={{ height: BAR_H }}
              >
                <StackedBar day={day} />
              </div>
            ))}
          </div>

          {/* X-axis labels — show first, middle, last */}
          <div className="flex justify-between mt-1">
            <span className="text-[9px] font-mono text-gray-600">{daily[0]?.date.slice(5)}</span>
            {daily.length > 2 && (
              <span className="text-[9px] font-mono text-gray-600">
                {daily[Math.floor(daily.length / 2)]?.date.slice(5)}
              </span>
            )}
            <span className="text-[9px] font-mono text-gray-600">
              {daily[daily.length - 1]?.date.slice(5)}
            </span>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3">
            {SEGMENTS.map(s => (
              <div key={s.key} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: s.color }} />
                <span className="text-[10px] text-gray-500">{s.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
