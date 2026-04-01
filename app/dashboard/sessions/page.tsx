'use client';

import { useEffect, useState } from 'react';
import SessionRow from '@/components/ui/session-row';
import type { Session } from '@/types/claude';

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    fetch('/api/sessions')
      .then(r => r.json())
      .then(setSessions)
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter
    ? sessions.filter(s =>
        s.projectName.toLowerCase().includes(filter.toLowerCase()) ||
        (s.summary || '').toLowerCase().includes(filter.toLowerCase())
      )
    : sessions;

  return (
    <div>
      <h2 className="font-heading text-2xl text-brand-cyan mb-6">Sessions</h2>

      <input
        type="text"
        placeholder="Filter sessions..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full max-w-md mb-6 px-4 py-2 bg-brand-navy-dark border border-brand-navy-light/30 rounded-lg text-white text-sm placeholder:text-gray-500 focus:outline-none focus:border-brand-cyan/40"
      />

      {loading ? (
        <p className="text-gray-400 animate-pulse">Loading sessions...</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((s) => (
            <SessionRow key={`${s.projectPath}-${s.id}`} session={s} />
          ))}
          {filtered.length === 0 && (
            <p className="text-gray-500 text-sm">
              {filter ? 'No sessions match your filter.' : 'No sessions found.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
