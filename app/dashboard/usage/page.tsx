'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

// --- API response types (mirror lib/usage-engine.ts) ---
interface TokenBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  cost: number;
}
interface UsageBucket extends TokenBreakdown {
  period: string;
  byModel: Record<string, TokenBreakdown>;
}
interface SessionUsage extends TokenBreakdown {
  sessionId: string;
  projectName: string;
  models: string[];
  messageCount: number;
  startedAt: string;
  lastActivityAt: string;
  byModel: Record<string, TokenBreakdown>;
}
interface UsageReport {
  totals: TokenBreakdown;
  buckets: UsageBucket[];
  byModel: Record<string, TokenBreakdown>;
  byProject: Record<string, TokenBreakdown>;
  sessions: SessionUsage[];
  meta: {
    granularity: 'day' | 'week' | 'month';
    rawEntryCount: number;
    dedupedEntryCount: number;
    allModels: string[];
    allProjects: string[];
    pricingSource: 'live' | 'fallback';
  };
}

type Granularity = 'day' | 'week' | 'month';
type Metric = 'cost' | 'tokens';
type TokenClass = 'inputTokens' | 'outputTokens' | 'cacheCreationTokens' | 'cacheReadTokens';
type SortKey = 'projectName' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cost' | 'lastActivityAt';

const TOKEN_CLASSES: Array<{ key: TokenClass; label: string; color: string }> = [
  { key: 'inputTokens', label: 'Input', color: 'bg-brand-cyan/80' },
  { key: 'outputTokens', label: 'Output', color: 'bg-chameleon-green/70' },
  { key: 'cacheCreationTokens', label: 'Cache write', color: 'bg-amber-400/60' },
  { key: 'cacheReadTokens', label: 'Cache read', color: 'bg-slate-500/50' },
];

function fmt(n: number): string {
  return n.toLocaleString();
}
function fmtCost(n: number): string {
  return `$${n.toFixed(2)}`;
}
function fmtCompact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}
function daysAgoKey(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localDateKey(d);
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const summary = selected.length === 0 ? 'All' : `${selected.length} selected`;
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none px-3 py-1.5 bg-brand-navy-light border border-brand-navy-light/50 rounded-lg text-sm text-gray-300 hover:border-brand-cyan/30">
        {label}: <span className="text-white">{summary}</span>
      </summary>
      <div className="absolute z-10 mt-1 max-h-64 w-72 overflow-y-auto bg-brand-navy-light border border-brand-navy-light/50 rounded-lg p-2 shadow-xl">
        {selected.length > 0 && (
          <button onClick={() => onChange([])} className="text-xs text-brand-cyan hover:underline mb-1">
            Clear
          </button>
        )}
        {options.map((opt) => (
          <label
            key={opt}
            className="flex items-center gap-2 px-1 py-0.5 text-xs text-gray-300 hover:text-white cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selected.includes(opt)}
              onChange={(e) =>
                onChange(e.target.checked ? [...selected, opt] : selected.filter((s) => s !== opt))
              }
            />
            <span className="truncate">{opt}</span>
          </label>
        ))}
        {options.length === 0 && <p className="text-gray-500 text-xs px-1">None found</p>}
      </div>
    </details>
  );
}

export default function UsagePage() {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // controls
  const [since, setSince] = useState<string>(daysAgoKey(29));
  const [until, setUntil] = useState<string>('');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [projects, setProjects] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [metric, setMetric] = useState<Metric>('cost');
  const [classes, setClasses] = useState<TokenClass[]>(TOKEN_CLASSES.map((c) => c.key));

  // sessions table state
  const [sortKey, setSortKey] = useState<SortKey>('lastActivityAt');
  const [sortAsc, setSortAsc] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams({ granularity });
    if (since) p.set('since', since);
    if (until) p.set('until', until);
    if (projects.length) p.set('projects', projects.join(','));
    if (models.length) p.set('models', models.join(','));
    return p.toString();
  }, [since, until, granularity, projects, models]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/usage?${query}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled) {
          setReport(data);
          setError(null);
        }
      })
      .catch((err) => {
        console.error('usage fetch failed:', err);
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const classSum = useCallback(
    (t: TokenBreakdown) => classes.reduce((sum, c) => sum + t[c], 0),
    [classes],
  );

  const sortedSessions = useMemo(() => {
    if (!report) return [];
    return [...report.sessions].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string') {
        return sortAsc ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      }
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [report, sortKey, sortAsc]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  /** Click a bucket: narrow the date range to that period and switch to daily view. */
  function drillIntoBucket(period: string) {
    if (granularity === 'day') {
      setSince(period);
      setUntil(period);
    } else if (granularity === 'week') {
      const end = new Date(`${period}T12:00:00`);
      end.setDate(end.getDate() + 6);
      setSince(period);
      setUntil(localDateKey(end));
    } else {
      const [y, m] = period.split('-').map(Number);
      setSince(`${period}-01`);
      setUntil(localDateKey(new Date(y, m, 0)));
    }
    setGranularity('day');
  }

  if (loading && !report) return <p className="text-gray-400 animate-pulse">Loading...</p>;
  if (error && !report) return <p className="text-gray-500 text-sm">Failed to load usage data: {error}</p>;
  if (!report) return <p className="text-gray-500 text-sm">No usage data.</p>;

  const bucketValue = (b: UsageBucket) => (metric === 'cost' ? b.cost : classSum(b));
  const maxValue = Math.max(...report.buckets.map(bucketValue), metric === 'cost' ? 0.01 : 1);
  const activeClasses = TOKEN_CLASSES.filter((c) => classes.includes(c.key));

  return (
    <div>
      <h2 className="font-heading text-2xl text-brand-cyan mb-2">Usage &amp; Cost Tracking</h2>
      <p className="text-gray-500 text-xs mb-6">
        {fmt(report.meta.dedupedEntryCount)} entries ({fmt(report.meta.rawEntryCount - report.meta.dedupedEntryCount)}{' '}
        duplicates removed) &middot; pricing: {report.meta.pricingSource === 'live' ? 'LiteLLM live' : 'bundled snapshot'}
        {loading ? ' · refreshing…' : ''}
        {error && report && <span className="text-amber-400 ml-2">&#9888; could not refresh — showing last loaded data</span>}
      </p>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex items-center gap-1">
          {([
            ['7d', 6],
            ['30d', 29],
            ['90d', 89],
          ] as Array<[string, number]>).map(([label, days]) => (
            <button
              key={label}
              onClick={() => {
                setSince(daysAgoKey(days));
                setUntil('');
              }}
              className="px-2 py-1 text-xs rounded bg-brand-navy-light text-gray-300 hover:text-white hover:border-brand-cyan/30 border border-brand-navy-light/50"
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => {
              setSince('');
              setUntil('');
            }}
            className="px-2 py-1 text-xs rounded bg-brand-navy-light text-gray-300 hover:text-white border border-brand-navy-light/50"
          >
            All
          </button>
        </div>
        <input
          type="date"
          value={since}
          onChange={(e) => setSince(e.target.value)}
          className="bg-brand-navy-light border border-brand-navy-light/50 rounded-lg px-2 py-1 text-sm text-gray-300"
          aria-label="Since"
        />
        <span className="text-gray-500 text-xs">to</span>
        <input
          type="date"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          className="bg-brand-navy-light border border-brand-navy-light/50 rounded-lg px-2 py-1 text-sm text-gray-300"
          aria-label="Until"
        />
        <select
          value={granularity}
          onChange={(e) => setGranularity(e.target.value as Granularity)}
          className="bg-brand-navy-light border border-brand-navy-light/50 rounded-lg px-2 py-1.5 text-sm text-gray-300"
        >
          <option value="day">Daily</option>
          <option value="week">Weekly</option>
          <option value="month">Monthly</option>
        </select>
        <MultiSelect label="Projects" options={report.meta.allProjects} selected={projects} onChange={setProjects} />
        <MultiSelect label="Models" options={report.meta.allModels} selected={models} onChange={setModels} />
        <div className="flex items-center gap-1">
          {(['cost', 'tokens'] as Metric[]).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`px-2 py-1 text-xs rounded border ${
                metric === m
                  ? 'bg-brand-cyan/20 border-brand-cyan/50 text-brand-cyan'
                  : 'bg-brand-navy-light border-brand-navy-light/50 text-gray-300 hover:text-white'
              }`}
            >
              {m === 'cost' ? 'Cost' : 'Tokens'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {TOKEN_CLASSES.map((c) => (
            <label key={c.key} className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={classes.includes(c.key)}
                onChange={(e) =>
                  setClasses(e.target.checked ? [...classes, c.key] : classes.filter((k) => k !== c.key))
                }
              />
              <span className={`inline-block w-2 h-2 rounded-sm ${c.color}`} />
              {c.label}
            </label>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Cost', value: fmtCost(report.totals.cost) },
          { label: 'Selected Tokens', value: fmt(classSum(report.totals)) },
          { label: 'Output Tokens', value: fmt(report.totals.outputTokens) },
          { label: 'Cache Read Tokens', value: fmt(report.totals.cacheReadTokens) },
        ].map((s) => (
          <div key={s.label} className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5">
            <p className="text-gray-400 text-sm">{s.label}</p>
            <p className="text-white text-2xl font-bold mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Buckets chart */}
      <h3 className="text-lg text-white font-semibold mb-4">
        {granularity === 'day' ? 'Daily' : granularity === 'week' ? 'Weekly' : 'Monthly'}{' '}
        {metric === 'cost' ? 'Cost' : 'Tokens'}
      </h3>
      <div className="space-y-1.5 mb-8">
        {report.buckets.map((b) => {
          const value = bucketValue(b);
          return (
            <div key={b.period} className="flex items-center gap-3">
              <button
                onClick={() => drillIntoBucket(b.period)}
                title="Drill into this period"
                className="text-gray-500 text-xs w-20 shrink-0 text-left hover:text-brand-cyan"
              >
                {b.period}
              </button>
              <div className="flex-1 h-5 bg-brand-navy-dark rounded overflow-hidden flex">
                {metric === 'tokens' ? (
                  activeClasses.map((c) => (
                    <div
                      key={c.key}
                      className={`h-full ${c.color}`}
                      style={{ width: `${(b[c.key] / maxValue) * 100}%` }}
                    />
                  ))
                ) : (
                  <div className="h-full bg-brand-cyan/60" style={{ width: `${(value / maxValue) * 100}%` }} />
                )}
              </div>
              <span className="text-gray-400 text-xs w-28 text-right shrink-0">
                {metric === 'cost' ? fmtCost(value) : `${fmtCompact(value)} tok`}
              </span>
            </div>
          );
        })}
        {report.buckets.length === 0 && <p className="text-gray-500 text-sm">No data in this range.</p>}
      </div>

      {/* By Model */}
      <h3 className="text-lg text-white font-semibold mb-4">By Model</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {Object.entries(report.byModel)
          .sort(([, a], [, b]) => b.cost - a.cost)
          .map(([model, data]) => (
            <div
              key={model}
              className="bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-lg p-4 hover:border-brand-cyan/20 transition-colors"
            >
              <p className="text-brand-cyan text-sm font-medium mb-2">{model}</p>
              <div className="space-y-1 text-xs">
                <p className="text-gray-400">
                  Input: <span className="text-white">{fmt(data.inputTokens)}</span> &middot; Output:{' '}
                  <span className="text-white">{fmt(data.outputTokens)}</span>
                </p>
                <p className="text-gray-400">
                  Cache write: <span className="text-white">{fmt(data.cacheCreationTokens)}</span> &middot; read:{' '}
                  <span className="text-white">{fmt(data.cacheReadTokens)}</span>
                </p>
                <p className="text-gray-400">
                  Cost: <span className="text-chameleon-green">{fmtCost(data.cost)}</span>
                </p>
              </div>
            </div>
          ))}
      </div>

      {/* Sessions */}
      <h3 className="text-lg text-white font-semibold mb-4">Sessions</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-brand-navy-light/30">
              {(
                [
                  ['projectName', 'Project'],
                  ['inputTokens', 'Input'],
                  ['outputTokens', 'Output'],
                  ['cacheReadTokens', 'Cache read'],
                  ['cost', 'Cost'],
                  ['lastActivityAt', 'Last activity'],
                ] as [SortKey, string][]
              ).map(([key, label]) => (
                <th
                  key={key}
                  onClick={() => handleSort(key)}
                  className="px-3 py-2 cursor-pointer hover:text-white transition-colors text-xs"
                >
                  {label} {sortKey === key ? (sortAsc ? '↑' : '↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedSessions.map((s) => {
              const rowKey = `${s.projectName}/${s.sessionId}`;
              const isOpen = expanded === rowKey;
              return (
                <SessionRow
                  key={rowKey}
                  session={s}
                  isOpen={isOpen}
                  onToggle={() => setExpanded(isOpen ? null : rowKey)}
                />
              );
            })}
          </tbody>
        </table>
        {sortedSessions.length === 0 && <p className="text-gray-500 text-sm mt-2">No sessions in this range.</p>}
      </div>
    </div>
  );
}

function SessionRow({
  session: s,
  isOpen,
  onToggle,
}: {
  session: SessionUsage;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-brand-navy-light/20 hover:bg-brand-navy-light/30 cursor-pointer"
      >
        <td className="px-3 py-2 text-white">
          <span className="text-gray-500 mr-1">{isOpen ? '▾' : '▸'}</span>
          {s.projectName}
        </td>
        <td className="px-3 py-2 text-gray-300">{fmt(s.inputTokens)}</td>
        <td className="px-3 py-2 text-gray-300">{fmt(s.outputTokens)}</td>
        <td className="px-3 py-2 text-gray-300">{fmt(s.cacheReadTokens)}</td>
        <td className="px-3 py-2 text-chameleon-green">{fmtCost(s.cost)}</td>
        <td className="px-3 py-2 text-gray-500">{new Date(s.lastActivityAt).toLocaleString()}</td>
      </tr>
      {isOpen && (
        <tr className="border-b border-brand-navy-light/20 bg-brand-navy-dark/40">
          <td colSpan={6} className="px-6 py-3">
            <p className="text-gray-500 text-xs mb-2">
              Session <span className="text-gray-300">{s.sessionId}</span> &middot; {s.messageCount} messages &middot;
              started {new Date(s.startedAt).toLocaleString()}
            </p>
            <table className="text-xs w-full max-w-2xl">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="pr-4 py-1">Model</th>
                  <th className="pr-4 py-1">Input</th>
                  <th className="pr-4 py-1">Output</th>
                  <th className="pr-4 py-1">Cache write</th>
                  <th className="pr-4 py-1">Cache read</th>
                  <th className="py-1">Cost</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(s.byModel).map(([model, d]) => (
                  <tr key={model}>
                    <td className="pr-4 py-1 text-chameleon-blue">{model}</td>
                    <td className="pr-4 py-1 text-gray-300">{fmt(d.inputTokens)}</td>
                    <td className="pr-4 py-1 text-gray-300">{fmt(d.outputTokens)}</td>
                    <td className="pr-4 py-1 text-gray-300">{fmt(d.cacheCreationTokens)}</td>
                    <td className="pr-4 py-1 text-gray-300">{fmt(d.cacheReadTokens)}</td>
                    <td className="py-1 text-chameleon-green">{fmtCost(d.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}
