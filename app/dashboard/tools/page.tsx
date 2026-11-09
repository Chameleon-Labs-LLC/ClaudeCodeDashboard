'use client';

import { useEffect, useState } from 'react';

interface ToolUsageStat {
  tool: string;
  count: number;
  sessions: number;
}

interface ToolAnalytics {
  tools: ToolUsageStat[];
  totalToolCalls: number;
  topTools: ToolUsageStat[];
}

function fmt(n: number): string {
  return n.toLocaleString();
}

export default function ToolsPage() {
  const [data, setData] = useState<ToolAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/tools')
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-gray-400 animate-pulse">Loading...</p>;
  if (!data) return <p className="text-gray-500 text-sm">Failed to load tool analytics.</p>;

  const top20 = data.topTools.slice(0, 20);
  const maxCount = top20.length > 0 ? top20[0].count : 1;

  return (
    <div>
      <h2 className="font-heading text-2xl text-brand-cyan mb-6">Tool Analytics</h2>

      {/* Total stat */}
      <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 mb-8 inline-block">
        <p className="text-gray-400 text-sm">Total Tool Calls</p>
        <p className="text-white text-2xl font-bold mt-1">{fmt(data.totalToolCalls)}</p>
      </div>

      {/* Top 20 bar chart */}
      <h3 className="text-lg text-white font-semibold mb-4">Top 20 Tools</h3>
      <div className="space-y-2 mb-8">
        {top20.map(tool => (
          <div key={tool.tool} className="flex items-center gap-3">
            <span className="text-gray-300 text-xs w-40 shrink-0 truncate" title={tool.tool}>
              {tool.tool}
            </span>
            <div className="flex-1 h-6 bg-brand-navy-dark rounded-sm overflow-hidden">
              <div
                className="h-full bg-brand-cyan/60 rounded-sm flex items-center"
                style={{ width: `${(tool.count / maxCount) * 100}%`, minWidth: '2px' }}
              >
                <span className="text-xs text-white px-2 whitespace-nowrap">{fmt(tool.count)}</span>
              </div>
            </div>
            <span className="text-gray-500 text-xs w-24 text-right shrink-0">
              {tool.sessions} session{tool.sessions !== 1 ? 's' : ''}
            </span>
          </div>
        ))}
        {top20.length === 0 && (
          <p className="text-gray-500 text-sm">No tool usage data available.</p>
        )}
      </div>

      {/* Full tool list */}
      {data.tools.length > 20 && (
        <>
          <h3 className="text-lg text-white font-semibold mb-4">All Tools ({data.tools.length})</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.tools.map(tool => (
              <div
                key={tool.tool}
                className="p-4 bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-lg hover:border-brand-cyan/20 transition-colors"
              >
                <p className="text-white text-sm font-medium">{tool.tool}</p>
                <div className="flex gap-4 mt-1">
                  <span className="text-gray-400 text-xs">{fmt(tool.count)} calls</span>
                  <span className="text-gray-500 text-xs">{tool.sessions} sessions</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
