'use client';

import { useEffect, useState } from 'react';
import SessionRow from '@/components/ui/session-row';
import ExportButton from '@/components/ui/export-button';
import { useSearchFocus } from '@/hooks/use-search-focus';
import type { Session } from '@/types/claude';

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const searchRef = useSearchFocus<HTMLInputElement>();

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
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-heading text-2xl text-brand-cyan">Sessions</h2>
        <ExportButton url="/api/export?type=sessions&format=json" label="Export JSON" />
      </div>

      <input
        ref={searchRef}
        type="text"
        placeholder="Filter sessions... (press / to focus)"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full max-w-md mb-6 px-4 py-2 bg-brand-navy-dark border border-brand-navy-light/30 rounded-lg text-white text-sm placeholder:text-gray-500 focus:outline-hidden focus:border-brand-cyan/40"
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
