'use client';

import { useEffect, useState, useMemo } from 'react';
import { useSearchFocus } from '@/hooks/use-search-focus';

interface HistoryEntry {
  display: string;
  timestamp: string;
  project: string;
  projectName: string;
}

function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 30) return new Date(timestamp).toLocaleDateString();
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const searchRef = useSearchFocus<HTMLInputElement>();

  useEffect(() => {
    fetch('/api/history?limit=500')
      .then(r => r.json())
      .then(setEntries)
      .finally(() => setLoading(false));
  }, []);

  const projects = useMemo(() => {
    const names = new Set(entries.map(e => e.projectName).filter(Boolean));
    return Array.from(names).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    return entries.filter(e => {
      if (projectFilter !== 'all' && e.projectName !== projectFilter) return false;
      if (search) {
        return e.display.toLowerCase().includes(search.toLowerCase());
      }
      return true;
    });
  }, [entries, search, projectFilter]);

  return (
    <div>
      <h2 className="font-heading text-2xl text-brand-cyan mb-6">Prompt History</h2>

      <div className="flex flex-wrap gap-3 mb-6">
        <input
          ref={searchRef}
          type="text"
          placeholder="Search history... (press / to focus)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] max-w-md px-4 py-2 bg-brand-navy-dark border border-brand-navy-light/30 rounded-lg text-white text-sm placeholder:text-gray-500 focus:outline-hidden focus:border-brand-cyan/40"
        />
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="px-4 py-2 bg-brand-navy-dark border border-brand-navy-light/30 rounded-lg text-white text-sm focus:outline-hidden focus:border-brand-cyan/40"
        >
          <option value="all">All Projects</option>
          {projects.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-gray-400 animate-pulse">Loading...</p>
      ) : (
        <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-2">
          {filtered.map((entry, i) => (
            <div
              key={i}
              className="p-4 bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-lg hover:border-brand-cyan/20 transition-colors"
            >
              <p className="text-sm text-white leading-relaxed">{entry.display}</p>
              <div className="flex items-center gap-3 mt-2">
                {entry.projectName && (
                  <span className="text-xs text-chameleon-blue">{entry.projectName}</span>
                )}
                <span className="text-xs text-gray-500">{formatRelativeTime(entry.timestamp)}</span>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-gray-500 text-sm">
              {search || projectFilter !== 'all' ? 'No matches.' : 'No history entries found.'}
            </p>
          )}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <p className="text-gray-500 text-xs mt-4">
          Showing {filtered.length} of {entries.length} entries
        </p>
      )}
    </div>
  );
}
