'use client';

import { useEffect, useState } from 'react';
import { X, Wrench, User, Bot, FileText } from 'lucide-react';
import { useSSE } from '@/hooks/use-sse';
import type { LiveSessionRow, LiveSessionState, LiveTimelineEntry } from '@/types/live';

interface Props {
  row: LiveSessionRow | null;
  onClose: () => void;
}

const ICONS: Record<LiveTimelineEntry['kind'], typeof User> = {
  user_message: User,
  assistant_message: Bot,
  tool_use: Wrench,
  tool_result: FileText,
  system: FileText,
};

export function LiveSessionDetailSheet({ row, onClose }: Props) {
  const [state, setState] = useState<LiveSessionState | null>(null);

  useEffect(() => {
    if (!row) { setState(null); return; }
    let cancelled = false;
    fetch(`/api/sessions/live/${row.id}/state`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (!cancelled) setState(j); })
      .catch(() => { /* fall back to null state */ });
    return () => { cancelled = true; };
  }, [row]);

  const { events, connected, lastError } = useSSE<LiveTimelineEntry>(
    row ? `/api/sessions/live/${row.id}/stream` : null,
    { eventName: 'timeline', bufferLimit: 500 },
  );

  if (!row) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <aside
        className="fixed right-0 top-0 z-50 flex h-full w-[460px] flex-col border-l border-brand-navy-light bg-brand-navy shadow-xl"
        role="dialog"
        aria-label="Live session detail"
      >
        <header className="flex items-center justify-between border-b border-brand-navy-light p-4">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-brand-cyan">{row.title}</h3>
            <p className="mt-1 truncate text-[10px] text-zinc-500">
              {row.projectName} · {state?.cwd ?? row.cwd ?? ''} · {state?.model ?? row.model ?? 'unknown'}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-brand-navy-dark hover:text-zinc-100">
            <X size={16} />
          </button>
        </header>

        <div className="flex items-center gap-2 border-b border-brand-navy-light px-4 py-2 text-[10px]">
          <span className={`inline-block h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-zinc-500'}`} />
          <span className="text-zinc-400">{connected ? 'streaming' : 'disconnected'}</span>
          {lastError && <span className="ml-2 text-amber-400">· {lastError}</span>}
          <span className="ml-auto text-zinc-500">{events.length} events</span>
        </div>

        <ol className="flex-1 overflow-y-auto p-4 text-xs">
          {events.length === 0 && <li className="text-zinc-500">Waiting for activity…</li>}
          {events.map((e, i) => {
            const Icon = ICONS[e.kind];
            return (
              <li key={i} className="mb-3 flex gap-2 border-l border-brand-navy-light pl-3">
                <Icon size={12} className="mt-0.5 shrink-0 text-brand-cyan" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-zinc-200">
                      {e.toolName ?? e.kind.replace('_', ' ')}
                    </span>
                    <span className="shrink-0 text-[10px] text-zinc-500">
                      {new Date(e.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  {e.preview && (
                    <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-zinc-400">
                      {e.preview}
                    </pre>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </aside>
    </>
  );
}
