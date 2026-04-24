// components/panels/mcp-panel.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, Zap, AlertTriangle, Activity } from 'lucide-react';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import type { McpServer, McpTool } from '@/types/observability';

interface Props { range: string }

function fmtMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms >= 1_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

function SpeedTag({ p95Ms }: { p95Ms: number | null }) {
  if (p95Ms === null) return null;
  if (p95Ms >= 10_000) return (
    <span className="ml-2 text-[10px] font-mono uppercase tracking-widest text-chameleon-red border border-chameleon-red/30 px-1.5 py-0.5 rounded">
      · slow
    </span>
  );
  if (p95Ms < 500) return (
    <span className="ml-2 text-[10px] font-mono uppercase tracking-widest text-chameleon-green border border-chameleon-green/30 px-1.5 py-0.5 rounded">
      · fast
    </span>
  );
  return null;
}

function ToolRow({ tool }: { tool: McpTool }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-4 items-center
                    py-2 px-3 rounded-lg hover:bg-brand-navy/50 transition-colors text-sm">
      <span className="text-gray-200 font-mono truncate" title={tool.tool}>
        {tool.tool}
        <SpeedTag p95Ms={tool.p95Ms} />
      </span>
      <span className="text-gray-500 text-xs text-right tabular-nums">{tool.calls} calls</span>
      <span className="text-gray-400 text-xs text-right tabular-nums">{fmtMs(tool.p50Ms)}</span>
      <span className={`text-xs text-right tabular-nums font-semibold ${
        tool.p95Ms !== null && tool.p95Ms >= 10_000 ? 'text-chameleon-red' : 'text-gray-300'
      }`}>{fmtMs(tool.p95Ms)}</span>
      <span className="text-gray-500 text-xs text-right tabular-nums">{fmtMs(tool.maxMs)}</span>
      <span className={`text-xs text-right tabular-nums ${
        tool.errorRate > 0.1 ? 'text-chameleon-red' : tool.errorRate > 0 ? 'text-chameleon-amber' : 'text-gray-500'
      }`}>{tool.errors > 0 ? `${(tool.errorRate * 100).toFixed(0)}% err` : '—'}</span>
    </div>
  );
}

function ToolTableHeader() {
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-4 items-center
                    py-1 px-3 mb-1 text-[10px] font-mono uppercase tracking-widest text-gray-500">
      <span>Tool</span>
      <span className="text-right">N</span>
      <span className="text-right">p50</span>
      <span className="text-right">p95</span>
      <span className="text-right">max</span>
      <span className="text-right">err</span>
    </div>
  );
}

function ToolsPanel({ server, range }: { server: string; range: string }) {
  const [tools, setTools] = useState<McpTool[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    fetch(`/api/mcp/${encodeURIComponent(server)}/tools?range=${range}`)
      .then(r => r.json())
      .then(d => setTools(d.tools))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [server, range]);

  if (loading) return (
    <div className="mt-3 space-y-1.5 px-3">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-8 bg-brand-navy/60 rounded animate-pulse" />
      ))}
    </div>
  );

  if (error || !tools) return (
    <p className="mt-3 px-3 text-sm text-chameleon-red">Failed to load tools.</p>
  );

  if (tools.length === 0) return (
    <p className="mt-3 px-3 text-sm text-gray-500">
      No tool call data for <span className="text-gray-300 font-mono">{server}</span> in this range.
    </p>
  );

  return (
    <div className="mt-3 border border-brand-navy-light/30 rounded-lg overflow-hidden">
      <ToolTableHeader />
      <div className="divide-y divide-brand-navy-light/20">
        {tools.map(t => <ToolRow key={t.tool} tool={t} />)}
      </div>
    </div>
  );
}

function ServerRow({ server, range }: { server: McpServer; range: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`border rounded-xl transition-all duration-200 ${
      expanded
        ? 'border-brand-cyan/30 bg-brand-navy-dark shadow-lg shadow-brand-cyan/5'
        : 'border-brand-navy-light/30 bg-brand-navy-light/30 hover:border-brand-cyan/20 hover:bg-brand-navy-light/50'
    }`}>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 p-4 text-left"
      >
        <ChevronRight
          size={16}
          className={`text-gray-400 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />
        {/* Server name */}
        <span className="flex-1 font-mono text-sm text-white font-semibold truncate">
          {server.server}
          <SpeedTag p95Ms={server.p95Ms} />
        </span>
        {/* Stats row */}
        <div className="flex items-center gap-5 text-xs text-gray-400 font-mono shrink-0">
          <span className="flex items-center gap-1">
            <Activity size={11} className="text-brand-cyan/60" />
            {server.calls.toLocaleString()}
          </span>
          <span>
            avg <span className="text-gray-200">{fmtMs(server.avgMs)}</span>
          </span>
          <span>
            p95 <span className={`font-semibold ${
              server.p95Ms !== null && server.p95Ms >= 10_000
                ? 'text-chameleon-red'
                : 'text-gray-200'
            }`}>{fmtMs(server.p95Ms)}</span>
          </span>
          {server.errors > 0 && (
            <span className="flex items-center gap-1 text-chameleon-amber">
              <AlertTriangle size={11} />
              {(server.errorRate * 100).toFixed(0)}%
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-brand-navy-light/20 pt-2">
          <ToolsPanel server={server.server} range={range} />
        </div>
      )}
    </div>
  );
}

export default function McpPanel({ range }: Props) {
  const [data, setData] = useState<{ servers: McpServer[] } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch(`/api/mcp?range=${range}`)
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 60_000);

  if (loading) return (
    <div className="space-y-3">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-16 rounded-xl bg-brand-navy-light/50 animate-pulse border border-brand-navy-light/30" />
      ))}
    </div>
  );

  if (!data || data.servers.length === 0) return (
    <div className="border border-brand-navy-light/30 rounded-xl p-8 text-center">
      <Zap size={32} className="text-gray-600 mx-auto mb-3" />
      <p className="text-gray-400 text-sm font-medium">No MCP servers detected</p>
      <p className="text-gray-600 text-xs mt-2 max-w-xs mx-auto">
        Install an MCP server and use it in a session to see latency data here.
        Try: <code className="text-chameleon-amber bg-brand-navy-dark px-1 rounded">claude mcp add</code>
      </p>
    </div>
  );

  return (
    <div className="space-y-2">
      {data.servers.map(s => (
        <ServerRow key={s.server} server={s} range={range} />
      ))}
    </div>
  );
}
