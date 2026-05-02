'use client';

import { useEffect, useState, useMemo } from 'react';

interface SessionUsage {
  sessionId: string;
  projectName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  estimatedCost: number;
  messageCount: number;
  startedAt: string;
}

interface UsageStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheTokens: number;
  totalCost: number;
  sessionUsages: SessionUsage[];
  byModel: Record<string, { input: number; output: number; cost: number }>;
  byDay: Array<{ date: string; tokens: number; cost: number }>;
}

function fmt(n: number): string {
  return n.toLocaleString();
}

function fmtCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

type SortKey = 'projectName' | 'model' | 'inputTokens' | 'outputTokens' | 'estimatedCost' | 'startedAt';

export default function UsagePage() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('startedAt');
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    fetch('/api/usage')
      .then(r => r.json())
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  const sortedSessions = useMemo(() => {
    if (!stats) return [];
    const sorted = [...stats.sessionUsages].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string') return sortAsc ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return sorted;
  }, [stats, sortKey, sortAsc]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  }

  if (loading) return <p className="text-gray-400 animate-pulse">Loading...</p>;
  if (!stats) return <p className="text-gray-500 text-sm">Failed to load usage data.</p>;

  const maxDayTokens = Math.max(...stats.byDay.map(d => d.tokens), 1);

  return (
    <div>
      <h2 className="font-heading text-2xl text-brand-cyan mb-6">Usage &amp; Cost Tracking</h2>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Input Tokens', value: fmt(stats.totalInputTokens) },
          { label: 'Total Output Tokens', value: fmt(stats.totalOutputTokens) },
          { label: 'Total Cache Tokens', value: fmt(stats.totalCacheTokens) },
          { label: 'Estimated Total Cost', value: fmtCost(stats.totalCost) },
        ].map(s => (
          <div key={s.label} className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5">
            <p className="text-gray-400 text-sm">{s.label}</p>
            <p className="text-white text-2xl font-bold mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* By Model */}
      <h3 className="text-lg text-white font-semibold mb-4">By Model</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {Object.entries(stats.byModel).map(([model, data]) => (
          <div key={model} className="bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-lg p-4 hover:border-brand-cyan/20 transition-colors">
            <p className="text-brand-cyan text-sm font-medium mb-2">{model}</p>
            <div className="space-y-1 text-xs">
              <p className="text-gray-400">Input: <span className="text-white">{fmt(data.input)}</span></p>
              <p className="text-gray-400">Output: <span className="text-white">{fmt(data.output)}</span></p>
              <p className="text-gray-400">Cost: <span className="text-white">{fmtCost(data.cost)}</span></p>
            </div>
          </div>
        ))}
      </div>

      {/* By Day bar chart */}
      <h3 className="text-lg text-white font-semibold mb-4">Daily Usage (Last 30 Days)</h3>
      <div className="space-y-1.5 mb-8">
        {stats.byDay.slice(-30).map(day => (
          <div key={day.date} className="flex items-center gap-3">
            <span className="text-gray-500 text-xs w-20 shrink-0">{day.date}</span>
            <div className="flex-1 h-5 bg-brand-navy-dark rounded overflow-hidden">
              <div
                className="h-full bg-brand-cyan/60 rounded"
                style={{ width: `${(day.tokens / maxDayTokens) * 100}%` }}
              />
            </div>
            <span className="text-gray-400 text-xs w-28 text-right shrink-0">{fmt(day.tokens)} tok</span>
          </div>
        ))}
        {stats.byDay.length === 0 && (
          <p className="text-gray-500 text-sm">No daily data available.</p>
        )}
      </div>

      {/* Sessions table */}
      <h3 className="text-lg text-white font-semibold mb-4">Sessions</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-brand-navy-light/30">
              {([
                ['projectName', 'Project'],
                ['model', 'Model'],
                ['inputTokens', 'Input'],
                ['outputTokens', 'Output'],
                ['estimatedCost', 'Cost'],
                ['startedAt', 'Date'],
              ] as [SortKey, string][]).map(([key, label]) => (
                <th
                  key={key}
                  onClick={() => handleSort(key)}
                  className="px-3 py-2 cursor-pointer hover:text-white transition-colors text-xs"
                >
                  {label} {sortKey === key ? (sortAsc ? '\u2191' : '\u2193') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedSessions.map(s => (
              <tr key={`${s.projectName}/${s.sessionId}`} className="border-b border-brand-navy-light/20 hover:bg-brand-navy-light/30">
                <td className="px-3 py-2 text-white">{s.projectName}</td>
                <td className="px-3 py-2 text-chameleon-blue">{s.model}</td>
                <td className="px-3 py-2 text-gray-300">{fmt(s.inputTokens)}</td>
                <td className="px-3 py-2 text-gray-300">{fmt(s.outputTokens)}</td>
                <td className="px-3 py-2 text-chameleon-green">{fmtCost(s.estimatedCost)}</td>
                <td className="px-3 py-2 text-gray-500">{new Date(s.startedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
