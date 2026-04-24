// app/dashboard/observability/page.tsx
'use client';

import { useState } from 'react';
import CollapsibleSection from '@/components/ui/collapsible-section';
import McpPanel from '@/components/panels/mcp-panel';
import CacheEfficiencyCard from '@/components/panels/cache-efficiency-card';
import SessionOutcomesCard from '@/components/panels/session-outcomes-card';
import ToolLatencyCard from '@/components/panels/tool-latency-card';
import HookActivityCard from '@/components/panels/hook-activity-card';
import PressurePanel from '@/components/panels/pressure-panel';

type Range = 'today' | '7d' | '30d';

export default function ObservabilityPage() {
  const [range, setRange] = useState<Range>('7d');

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-heading text-2xl text-brand-cyan">Observability</h2>
        <div className="flex items-center gap-1 bg-brand-navy-dark border border-brand-navy-light/30 rounded-lg p-1">
          {(['today', '7d', '30d'] as Range[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 rounded-md text-xs font-mono transition-colors ${
                range === r
                  ? 'bg-brand-cyan/20 text-brand-cyan border border-brand-cyan/30'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* MCP centerpiece — full width, own section */}
      <CollapsibleSection id="obs-mcp" title="MCP Servers" subtitle="drill-down" defaultOpen>
        <McpPanel range={range} />
      </CollapsibleSection>

      {/* 2-col row: Cache + Outcomes */}
      <CollapsibleSection id="obs-cache-outcomes" title="Session Health" defaultOpen>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 [&>*]:h-full auto-rows-fr">
          <CacheEfficiencyCard range={range} />
          <SessionOutcomesCard range={range} />
        </div>
      </CollapsibleSection>

      {/* 2-col row: Tool Latency + Hook Activity */}
      <CollapsibleSection id="obs-latency-hooks" title="Tool & Hook Performance" defaultOpen>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 [&>*]:h-full auto-rows-fr">
          <ToolLatencyCard range={range} />
          <HookActivityCard range={range} />
        </div>
      </CollapsibleSection>

      {/* Full-width: Pressure */}
      <CollapsibleSection id="obs-pressure" title="System Pressure" defaultOpen>
        <PressurePanel range={range} />
      </CollapsibleSection>
    </div>
  );
}
