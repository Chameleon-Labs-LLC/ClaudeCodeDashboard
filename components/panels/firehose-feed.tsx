'use client';

import { useMemo, useState } from 'react';
import { Zap } from 'lucide-react';
import { useSSE } from '@/hooks/use-sse';
import type { FirehoseEvent } from '@/types/live';

export function FirehoseFeed() {
  const [filter, setFilter] = useState('');
  const { events, connected, lastError } = useSSE<FirehoseEvent>('/api/firehose', {
    eventName: 'otel',
    bufferLimit: 1000,
  });

  const filtered = useMemo(() => {
    if (!filter.trim()) return events;
    const q = filter.trim().toLowerCase();
    return events.filter(e => e.eventName.toLowerCase().includes(q));
  }, [events, filter]);

  const shown = [...filtered].reverse(); // newest on top

  return (
    <section className="rounded-lg border border-brand-navy-light bg-brand-navy p-4">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-brand-cyan">
          <Zap size={16} /> Telemetry Firehose
        </h2>
        <span className={`inline-block h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-zinc-500'}`} />
        <span className="text-[10px] text-zinc-400">{connected ? 'streaming' : 'disconnected'}</span>
        {lastError && <span className="text-[10px] text-amber-400">{lastError}</span>}
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="filter event.name…"
          className="ml-auto w-48 rounded border border-brand-navy-light bg-brand-navy-dark px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-brand-cyan focus:outline-none"
        />
      </header>

      <div className="max-h-[60vh] overflow-y-auto rounded border border-brand-navy-light bg-brand-navy-dark/40 font-mono text-[11px]">
        {shown.length === 0 && (
          <p className="p-3 text-zinc-500">
            {events.length === 0 ? 'Waiting for events…' : 'No events match filter.'}
          </p>
        )}
        <ul className="divide-y divide-brand-navy-light">
          {shown.map((e, i) => (
            <li key={`${e.receivedAt}-${i}`} className="px-3 py-1.5">
              <span className="text-zinc-500">{new Date(e.receivedAt).toLocaleTimeString()}</span>{' '}
              <span className="text-brand-cyan">{e.eventName}</span>
              {e.toolName && <span className="text-zinc-300"> · {e.toolName}</span>}
              {e.durationMs !== null && e.durationMs !== undefined && (
                <span className="text-zinc-400"> · {e.durationMs.toFixed(0)}ms</span>
              )}
              {e.costUsd !== null && e.costUsd !== undefined && (
                <span className="text-zinc-400"> · ${e.costUsd.toFixed(4)}</span>
              )}
              {e.sessionId && (
                <span className="text-zinc-600"> · {e.sessionId.slice(0, 8)}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
