'use client';

import { useEffect, useState } from 'react';

interface Props { open: boolean; onClose: () => void; onCreated: () => void }

export default function TaskComposer({ open, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [executionMode, setExecutionMode] = useState<'stream' | 'classic'>('stream');
  const [model, setModel] = useState('');
  const [priority, setPriority] = useState(0);
  const [quadrant, setQuadrant] = useState('');
  const [riskLevel, setRiskLevel] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [assignedSkill, setAssignedSkill] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  function reset() {
    setTitle(''); setDescription('');
    setExecutionMode('stream'); setModel('');
    setPriority(0); setQuadrant(''); setRiskLevel('');
    setRequiresApproval(false); setDryRun(false);
    setAssignedSkill(''); setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true); setError(null);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          execution_mode: executionMode,
          model: model.trim() || undefined,
          priority,
          quadrant: quadrant || undefined,
          risk_level: riskLevel || undefined,
          requires_approval: requiresApproval,
          dry_run: dryRun,
          assigned_skill: assignedSkill.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      reset();
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed');
    } finally { setSubmitting(false); }
  }

  return (
    <div
      className={`fixed inset-0 z-40 pointer-events-none transition-all ${open ? 'pointer-events-auto' : ''}`}
      aria-hidden={!open}
    >
      {open && <div onClick={onClose} className="absolute inset-0 bg-black/40" />}
      <aside
        className={`absolute top-0 right-0 h-full w-[480px] max-w-[96vw] bg-brand-navy-dark border-l border-brand-navy-light/40 shadow-xl transition-transform ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <form onSubmit={onSubmit} className="flex flex-col h-full">
          <header className="p-4 border-b border-brand-navy-light/30 flex items-center justify-between">
            <h3 className="font-heading text-lg text-brand-cyan">New task</h3>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-white text-sm">Close</button>
          </header>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
            <label className="block">
              <span className="text-gray-300">Title</span>
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="mt-1 w-full rounded-md bg-brand-navy-light/40 border border-brand-navy-light/50 px-3 py-2 text-white"
              />
            </label>
            <label className="block">
              <span className="text-gray-300">Description</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="mt-1 w-full rounded-md bg-brand-navy-light/40 border border-brand-navy-light/50 px-3 py-2 text-white"
              />
            </label>
            <div className="flex flex-col gap-2">
              <span className="text-gray-300">Execution mode</span>
              <label className={`p-3 rounded-md border cursor-pointer ${executionMode === 'stream' ? 'border-brand-cyan bg-brand-cyan/10' : 'border-brand-navy-light/50'}`}>
                <input
                  type="radio"
                  name="mode"
                  checked={executionMode === 'stream'}
                  onChange={() => setExecutionMode('stream')}
                  className="mr-2"
                />
                <span className="text-white font-medium">Interactive</span>
                <span className="block text-xs text-gray-400 mt-0.5">Reply mid-run from the dashboard.</span>
              </label>
              <label className={`p-3 rounded-md border cursor-pointer ${executionMode === 'classic' ? 'border-brand-cyan bg-brand-cyan/10' : 'border-brand-navy-light/50'}`}>
                <input
                  type="radio"
                  name="mode"
                  checked={executionMode === 'classic'}
                  onChange={() => setExecutionMode('classic')}
                  className="mr-2"
                />
                <span className="text-white font-medium">One-shot</span>
                <span className="block text-xs text-gray-400 mt-0.5">Fire and forget, no back-and-forth.</span>
              </label>
            </div>
            <label className="block">
              <span className="text-gray-300">Model</span>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Leave blank to use skill default"
                className="mt-1 w-full rounded-md bg-brand-navy-light/40 border border-brand-navy-light/50 px-3 py-2 text-white"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-gray-300">Priority</span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={priority}
                  onChange={(e) => setPriority(parseInt(e.target.value, 10) || 0)}
                  className="mt-1 w-full rounded-md bg-brand-navy-light/40 border border-brand-navy-light/50 px-3 py-2 text-white"
                />
              </label>
              <label className="block">
                <span className="text-gray-300">Quadrant</span>
                <select
                  value={quadrant}
                  onChange={(e) => setQuadrant(e.target.value)}
                  className="mt-1 w-full rounded-md bg-brand-navy-light/40 border border-brand-navy-light/50 px-3 py-2 text-white"
                >
                  <option value="">—</option>
                  <option value="do">Do</option>
                  <option value="schedule">Schedule</option>
                  <option value="delegate">Delegate</option>
                  <option value="archive">Archive</option>
                </select>
              </label>
              <label className="block">
                <span className="text-gray-300">Risk level</span>
                <select
                  value={riskLevel}
                  onChange={(e) => setRiskLevel(e.target.value)}
                  className="mt-1 w-full rounded-md bg-brand-navy-light/40 border border-brand-navy-light/50 px-3 py-2 text-white"
                >
                  <option value="">—</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label className="block">
                <span className="text-gray-300">Assigned skill</span>
                <input
                  value={assignedSkill}
                  onChange={(e) => setAssignedSkill(e.target.value)}
                  placeholder="Optional"
                  className="mt-1 w-full rounded-md bg-brand-navy-light/40 border border-brand-navy-light/50 px-3 py-2 text-white"
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-gray-300">
              <input
                type="checkbox"
                checked={requiresApproval}
                onChange={(e) => setRequiresApproval(e.target.checked)}
              />
              Requires approval before running
            </label>
            <label
              className="flex items-center gap-2 text-gray-300"
              title="Runs claude with --dry-run. No files are changed."
            >
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
              />
              Dry run
            </label>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
          <footer className="p-4 border-t border-brand-navy-light/30 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded-md text-gray-300 hover:text-white border border-brand-navy-light/50"
            >Cancel</button>
            <button
              type="submit"
              disabled={submitting || !title.trim()}
              className="px-3 py-1.5 text-sm rounded-md bg-brand-cyan text-brand-navy-dark font-medium disabled:opacity-50"
            >{submitting ? 'Creating…' : 'Create task'}</button>
          </footer>
        </form>
      </aside>
    </div>
  );
}
