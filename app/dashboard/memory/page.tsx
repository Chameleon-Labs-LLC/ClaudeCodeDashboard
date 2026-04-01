'use client';

import { useEffect, useState } from 'react';
import MemoryCard from '@/components/ui/memory-card';
import type { MemoryEntry } from '@/types/claude';

const typeFilters = ['all', 'user', 'feedback', 'project', 'reference'] as const;

export default function MemoryPage() {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/memory')
      .then(r => r.json())
      .then(setMemories)
      .finally(() => setLoading(false));
  }, []);

  const filtered = memories.filter(m => {
    if (typeFilter !== 'all' && m.type !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.content.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div>
      <h2 className="font-heading text-2xl text-brand-cyan mb-6">Memory</h2>

      <div className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          placeholder="Search memory..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] max-w-md px-4 py-2 bg-brand-navy-dark border border-brand-navy-light/30 rounded-lg text-white text-sm placeholder:text-gray-500 focus:outline-none focus:border-brand-cyan/40"
        />
        <div className="flex gap-1">
          {typeFilters.map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                typeFilter === t
                  ? 'bg-brand-cyan/10 border-brand-cyan/30 text-brand-cyan'
                  : 'border-brand-navy-light/30 text-gray-400 hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-gray-400 animate-pulse">Loading memory entries...</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((m) => (
            <MemoryCard key={m.fileName} memory={m} />
          ))}
          {filtered.length === 0 && (
            <p className="text-gray-500 text-sm col-span-2">
              {search || typeFilter !== 'all' ? 'No matches.' : 'No memory entries found.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
