'use client';

import { useState } from 'react';
import type { SearchResult } from '@/types/claude';

const typeColors: Record<string, string> = {
  session: 'text-chameleon-blue',
  memory: 'text-chameleon-purple',
  project: 'text-chameleon-green',
};

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      setResults(await res.json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2 className="font-heading text-2xl text-brand-cyan mb-6">Search</h2>

      <form onSubmit={handleSearch} className="flex gap-3 mb-8">
        <input
          type="text"
          placeholder="Search sessions, memory, projects..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 max-w-lg px-4 py-2.5 bg-brand-navy-dark border border-brand-navy-light/30 rounded-lg text-white text-sm placeholder:text-gray-500 focus:outline-none focus:border-brand-cyan/40"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-5 py-2.5 bg-brand-cyan text-brand-navy font-medium text-sm rounded-lg hover:bg-brand-cyan-light transition-colors disabled:opacity-50"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      <div className="space-y-3">
        {results.map((r, i) => (
          <div
            key={i}
            className="p-4 bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-lg"
          >
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium uppercase ${typeColors[r.type] || 'text-gray-400'}`}>
                {r.type}
              </span>
              <h3 className="text-sm text-white">{r.title}</h3>
            </div>
            <p className="text-xs text-gray-400 mt-1">{r.snippet}</p>
            {r.timestamp && (
              <p className="text-xs text-gray-600 mt-1">{new Date(r.timestamp).toLocaleString()}</p>
            )}
          </div>
        ))}
        {searched && !loading && results.length === 0 && (
          <p className="text-gray-500 text-sm">No results found for &quot;{query}&quot;.</p>
        )}
      </div>
    </div>
  );
}
