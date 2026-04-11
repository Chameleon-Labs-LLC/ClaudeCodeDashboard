'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import SessionRow from '@/components/ui/session-row';
import MemoryCard from '@/components/ui/memory-card';
import { formatClaudeProjectName } from '@/lib/claude-project-path';
import type { Session, MemoryEntry } from '@/types/claude';

export default function ProjectDetailPage() {
  const params = useParams<{ name: string }>();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'sessions' | 'memory'>('sessions');

  useEffect(() => {
    if (!params.name) return;
    Promise.all([
      fetch(`/api/sessions?project=${params.name}`).then(r => r.json()),
      fetch(`/api/memory?project=${params.name}`).then(r => r.json()),
    ])
      .then(([s, m]) => { setSessions(s); setMemories(m); })
      .finally(() => setLoading(false));
  }, [params.name]);

  return (
    <div>
      <Link href="/dashboard/projects" className="text-brand-cyan text-sm hover:underline">
        &larr; Back to projects
      </Link>

      <div className="mt-4 mb-6">
        <h2 className="font-heading text-2xl text-brand-cyan">{params.name}</h2>
        <p className="text-xs text-gray-500 mt-1 font-mono">
          {params.name ? formatClaudeProjectName(params.name) : ''}
        </p>
      </div>

      <div className="flex gap-2 mb-6">
        {(['sessions', 'memory'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
              tab === t
                ? 'bg-brand-cyan/10 border-brand-cyan/30 text-brand-cyan'
                : 'border-brand-navy-light/30 text-gray-400 hover:text-white'
            }`}
          >
            {t === 'sessions' ? `Sessions (${sessions.length})` : `Memory (${memories.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-400 animate-pulse">Loading...</p>
      ) : tab === 'sessions' ? (
        <div className="space-y-2">
          {sessions.map(s => (
            <SessionRow key={s.id} session={s} />
          ))}
          {sessions.length === 0 && (
            <p className="text-gray-500 text-sm">No sessions for this project.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {memories.map(m => (
            <MemoryCard key={m.fileName} memory={m} />
          ))}
          {memories.length === 0 && (
            <p className="text-gray-500 text-sm">No memory entries for this project.</p>
          )}
        </div>
      )}
    </div>
  );
}
