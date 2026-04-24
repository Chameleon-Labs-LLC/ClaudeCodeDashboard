// components/panels/tool-latency-card.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import type { ToolLatencyRow } from '@/types/observability';

interface Props { range: string }

function fmtMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms >= 1_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function P95Cell({ ms }: { ms: number | null }) {
  const slow = ms !== null && ms >= 10_000;
  const fast = ms !== null && ms < 500;
  return (
    <span className={`tabular-nums font-semibold ${
      slow ? 'text-chameleon-red' : fast ? 'text-chameleon-green' : 'text-gray-300'
    }`}>
      {fmtMs(ms)}
    </span>
  );
}

export default function ToolLatencyCard({ range }: Props) {
  const [tools, setTools] = useState<ToolLatencyRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch(`/api/tools/latency?range=${range}`)
      .then(r => r.json())
      .then((d: { tools: ToolLatencyRow[] }) => setTools(d.tools))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 60_000);

  if (loading) return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full">
      <div className="h-4 w-36 bg-brand-navy/60 rounded animate-pulse mb-4" />
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-8 bg-brand-navy/60 rounded animate-pulse" />)}
      </div>
    </div>
  );

  if (!tools) return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full">
      <p className="text-chameleon-red text-sm">Failed to load latency data.</p>
    </div>
  );

  return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full flex flex-col">
      <p className="text-xs font-mono uppercase tracking-widest text-gray-500 mb-3">Tool Latency</p>

      {tools.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-600 text-xs text-center">
            No tool call duration data yet. Tool latency is recorded from JSONL pairing during session sync.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 items-center
                          py-1 px-2 mb-1 text-[10px] font-mono uppercase tracking-widest text-gray-500 sticky top-0 bg-brand-navy-light">
            <span>Tool</span>
            <span className="text-right">N</span>
            <span className="text-right">p50</span>
            <span className="text-right">p95</span>
            <span className="text-right">max</span>
          </div>
          <div className="space-y-0.5">
            {tools.map(t => (
              <div key={t.tool}
                   className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 items-center
                              py-1.5 px-2 rounded hover:bg-brand-navy/40 transition-colors text-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-gray-200 font-mono truncate" title={t.tool}>{t.tool}</span>
                  {t.errorRate > 0 && (
                    <span className={`shrink-0 text-[9px] font-mono ${
                      t.errorRate > 0.1 ? 'text-chameleon-red' : 'text-chameleon-amber'
                    }`}>
                      {(t.errorRate * 100).toFixed(0)}%err
                    </span>
                  )}
                </div>
                <span className="text-gray-500 tabular-nums text-right">{t.calls}</span>
                <span className="text-gray-400 tabular-nums text-right">{fmtMs(t.p50Ms)}</span>
                <P95Cell ms={t.p95Ms} />
                <span className="text-gray-500 tabular-nums text-right">{fmtMs(t.maxMs)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
