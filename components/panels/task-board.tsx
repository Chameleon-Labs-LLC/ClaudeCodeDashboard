'use client';

import { useCallback, useState } from 'react';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import type { OpsTask, TaskStatus } from '@/types/mission-control';
import { formatRelativeTime } from '@/lib/format-time';

interface Props { onRefresh?: () => void }

const STATUS_COLOURS: Record<TaskStatus, string> = {
  pending: 'bg-blue-500/20 text-blue-200 border border-blue-500/40',
  awaiting_approval: 'bg-amber-500/20 text-amber-200 border border-amber-500/40',
  running: 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40 animate-pulse',
  done: 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40',
  failed: 'bg-red-500/20 text-red-200 border border-red-500/40',
  cancelled: 'bg-gray-500/20 text-gray-300 border border-gray-500/40',
};

function StatusPill({ status }: { status: TaskStatus }) {
  return (
    <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${STATUS_COLOURS[status]}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function TaskCard({ task, onAction }: { task: OpsTask; onAction: () => void }) {
  async function call(url: string, method: 'POST' | 'DELETE' = 'POST') {
    const res = await fetch(url, { method });
    if (res.ok) onAction();
  }
  return (
    <div className="bg-brand-navy-light/60 border border-brand-navy-light/40 rounded-lg p-3 hover:border-brand-cyan/30 transition">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-white font-medium line-clamp-1" title={task.title}>
          {task.title}
        </p>
        <StatusPill status={task.status} />
      </div>
      {task.description && (
        <p className="text-xs text-gray-400 mt-1 line-clamp-2">
          {task.description.slice(0, 100)}
          {task.description.length > 100 ? '…' : ''}
        </p>
      )}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <span className="text-[10px] text-gray-500 uppercase">
          {task.execution_mode === 'stream' ? 'Interactive' : 'One-shot'}
        </span>
        {task.risk_level && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-300 border border-yellow-500/20">
            {task.risk_level}
          </span>
        )}
        {task.dry_run === 1 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-300 border border-gray-500/30">
            dry-run
          </span>
        )}
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-gray-500">{formatRelativeTime(task.created_at)}</span>
        <div className="flex items-center gap-2">
          {task.status === 'awaiting_approval' && (
            <button
              type="button"
              onClick={() => call(`/api/tasks/${task.id}/approve`)}
              className="text-xs text-amber-300 hover:text-amber-200"
            >Approve</button>
          )}
          {task.status === 'failed' && (
            <button
              type="button"
              onClick={() => call(`/api/tasks/${task.id}/rerun`)}
              className="text-xs text-blue-300 hover:text-blue-200"
            >Rerun</button>
          )}
          <button
            type="button"
            onClick={() => {
              if (confirm('Delete this task?')) call(`/api/tasks?id=${task.id}`, 'DELETE');
            }}
            className="text-xs text-gray-500 hover:text-red-400"
          >Delete</button>
        </div>
      </div>
    </div>
  );
}

export default function TaskBoard({ onRefresh }: Props) {
  const [tasks, setTasks] = useState<OpsTask[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks');
      if (res.ok) setTasks(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useAutoRefresh(load, 10_000);

  const cols: Array<{ title: string; statuses: TaskStatus[]; empty: string }> = [
    { title: 'Pending', statuses: ['pending', 'awaiting_approval'], empty: 'No pending tasks' },
    { title: 'Running', statuses: ['running'], empty: 'No running tasks' },
    { title: 'Done', statuses: ['done', 'failed', 'cancelled'], empty: 'Nothing finished yet' },
  ];

  function handleChange() { load(); onRefresh?.(); }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {cols.map((col) => {
        const inCol = tasks.filter((t) => col.statuses.includes(t.status));
        return (
          <div key={col.title} className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-sm font-medium text-gray-300">{col.title}</h3>
              <span className="text-[10px] text-gray-500">{inCol.length}</span>
            </div>
            {loading ? (
              <>
                <div className="h-16 bg-brand-navy-light/40 rounded-lg animate-pulse" />
                <div className="h-16 bg-brand-navy-light/40 rounded-lg animate-pulse" />
                <div className="h-16 bg-brand-navy-light/40 rounded-lg animate-pulse" />
              </>
            ) : inCol.length === 0 ? (
              <p className="text-xs text-gray-500 px-1 py-4">{col.empty}</p>
            ) : (
              inCol.map((t) => <TaskCard key={t.id} task={t} onAction={handleChange} />)
            )}
          </div>
        );
      })}
    </div>
  );
}
