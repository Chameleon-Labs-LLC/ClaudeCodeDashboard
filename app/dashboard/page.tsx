'use client';

import { useEffect, useState } from 'react';
import StatCard from '@/components/ui/stat-card';
import SessionRow from '@/components/ui/session-row';
import type { DashboardStats } from '@/types/claude';

export default function DashboardOverview() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/stats')
      .then(r => r.json())
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-400 animate-pulse">Loading dashboard...</p>
      </div>
    );
  }

  if (!stats) {
    return <p className="text-red-400">Failed to load dashboard data.</p>;
  }

  return (
    <div>
      <h2 className="font-heading text-2xl text-brand-cyan mb-6">Overview</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <StatCard label="Total Sessions" value={stats.totalSessions} icon="◉" />
        <StatCard label="Projects" value={stats.totalProjects} icon="◆" />
        <StatCard label="Memory Entries" value={stats.totalMemories} icon="◈" />
      </div>

      <h3 className="text-lg text-white mb-4">Recent Sessions</h3>
      <div className="space-y-2">
        {stats.recentSessions.map((s) => (
          <SessionRow key={s.id} session={s} />
        ))}
        {stats.recentSessions.length === 0 && (
          <p className="text-gray-500 text-sm">No sessions found in ~/.claude/projects/</p>
        )}
      </div>
    </div>
  );
}
