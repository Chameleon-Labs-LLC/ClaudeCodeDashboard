'use client';

import { useEffect, useState } from 'react';
import type { OpsDecision } from '@/types/mission-control';
import { formatRelativeTime } from '@/lib/format-time';

export default function DecisionsCard() {
  const [items, setItems] = useState<OpsDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [openAnswer, setOpenAnswer] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const res = await fetch('/api/decisions?status=pending');
      if (res.ok) setItems(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  useEffect(() => {
    load();
    // 5s poll regardless of tab visibility (HITL reply latency matters).
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);

  async function submitAnswer(id: number) {
    if (!draft.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/decisions/${id}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: draft.trim() }),
      });
      if (res.ok) {
        setOpenAnswer(null);
        setDraft('');
        load();
      }
    } finally { setSubmitting(false); }
  }

  return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-4">
      <h3 className="text-sm font-medium text-gray-200 mb-2">Pending decisions</h3>
      {loading ? (
        <div className="h-12 bg-brand-navy/40 rounded animate-pulse" />
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-500">
          No pending decisions — DECISION: markers from running stream tasks appear here.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((d) => (
            <div key={d.id} className="p-3 bg-brand-navy/40 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                {d.task_id && (
                  <span className="text-[10px] text-brand-cyan">#{d.task_id}</span>
                )}
                <span className="text-[10px] text-gray-500">{formatRelativeTime(d.created_at)}</span>
              </div>
              <p className="text-sm text-white whitespace-pre-wrap line-clamp-3">{d.prompt}</p>
              {openAnswer === d.id ? (
                <div className="mt-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={2}
                    autoFocus
                    className="w-full rounded-md bg-brand-navy-light/40 border border-brand-navy-light/50 px-2 py-1 text-sm text-white"
                  />
                  <div className="flex justify-end gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => { setOpenAnswer(null); setDraft(''); }}
                      className="text-xs text-gray-500 hover:text-gray-300"
                    >Cancel</button>
                    <button
                      type="button"
                      onClick={() => submitAnswer(d.id)}
                      disabled={submitting || !draft.trim()}
                      className="text-xs text-brand-cyan hover:text-cyan-200 disabled:opacity-50"
                    >Send</button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setOpenAnswer(d.id); setDraft(''); }}
                  className="mt-1 text-xs text-brand-cyan hover:text-cyan-200"
                >Answer</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
