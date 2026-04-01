'use client';

import { useEffect, useState } from 'react';
import type { Project } from '@/types/claude';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(setProjects)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h2 className="font-heading text-2xl text-brand-cyan mb-6">Projects</h2>

      {loading ? (
        <p className="text-gray-400 animate-pulse">Loading projects...</p>
      ) : (
        <div className="space-y-2">
          {projects.map((p) => (
            <div
              key={p.name}
              className="p-4 bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-lg hover:border-brand-cyan/20 transition-colors"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-white">{p.name}</h3>
                {p.lastActive && (
                  <span className="text-xs text-gray-500">{timeAgo(p.lastActive)}</span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-1 font-mono">{p.path}</p>
              <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                <span>{p.sessionCount} sessions</span>
                {p.hasClaudeMd && (
                  <span className="text-brand-cyan/60">CLAUDE.md</span>
                )}
                {p.hasMemory && (
                  <span className="text-chameleon-purple/60">Memory</span>
                )}
              </div>
            </div>
          ))}
          {projects.length === 0 && (
            <p className="text-gray-500 text-sm">No projects found.</p>
          )}
        </div>
      )}
    </div>
  );
}
