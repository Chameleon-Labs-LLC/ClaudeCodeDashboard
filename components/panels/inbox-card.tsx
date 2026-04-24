'use client';

import { useEffect, useState } from 'react';
import type { OpsInboxItem } from '@/types/mission-control';
import { formatRelativeTime } from '@/lib/format-time';

export default function InboxCard() {
  const [items, setItems] = useState<OpsInboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [openReply, setOpenReply] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [justSent, setJustSent] = useState<number | null>(null);

  async function load() {
    try {
      const res = await fetch('/api/inbox?unread=1&max_age_days=30');
      if (res.ok) setItems(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, []);

  async function markRead(id: number) {
    try {
      await fetch(`/api/inbox/${id}/read`, { method: 'POST' });
      load();
    } catch { /* ignore */ }
  }

  async function reply(id: number) {
    if (!draft.trim()) return;
    try {
      const res = await fetch(`/api/inbox/${id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: draft.trim() }),
      });
      if (res.ok) {
        setJustSent(id);
        setOpenReply(null);
        setDraft('');
        setTimeout(() => setJustSent(null), 2000);
        load();
      }
    } catch { /* ignore */ }
  }

  return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-4">
      <h3 className="text-sm font-medium text-gray-200 mb-2">Inbox</h3>
      {loading ? (
        <div className="h-12 bg-brand-navy/40 rounded animate-pulse" />
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-500">
          No unread messages — agents running in Interactive mode send INBOX: messages here.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((m) => (
            <div key={m.id} className="p-3 bg-brand-navy/40 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                {m.session_id && (
                  <code className="text-[10px] text-gray-500">{m.session_id.slice(0, 8)}</code>
                )}
                <span className="text-[10px] text-gray-500">{formatRelativeTime(m.created_at)}</span>
              </div>
              <p className="text-sm text-gray-200 whitespace-pre-wrap line-clamp-3">{m.body}</p>
              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => markRead(m.id)}
                  className="text-xs text-gray-400 hover:text-white"
                >Mark read</button>
                <button
                  type="button"
                  onClick={() => { setOpenReply(m.id); setDraft(''); }}
                  className="text-xs text-brand-cyan hover:text-cyan-200"
                >Reply</button>
                {justSent === m.id && <span className="text-xs text-emerald-400">Sent</span>}
              </div>
              {openReply === m.id && (
                <div className="mt-2">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Reply (injected into stream-mode stdin)"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter') reply(m.id); }}
                    className="w-full rounded-md bg-brand-navy-light/40 border border-brand-navy-light/50 px-2 py-1 text-sm text-white"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
