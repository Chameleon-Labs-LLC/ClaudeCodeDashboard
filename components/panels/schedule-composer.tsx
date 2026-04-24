'use client';

import { useEffect, useMemo, useState } from 'react';

interface Props { open: boolean; onClose: () => void; onCreated: () => void }

const DOW_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function ScheduleComposer({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [dow, setDow] = useState<number[]>([0]); // Mon=0..Sun=6
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [assignedSkill, setAssignedSkill] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nlText, setNlText] = useState('');
  const [nlResult, setNlResult] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const cronPreview = useMemo(() => {
    if (dow.length === 0) return null;
    // Only support a single dow for materialiser (matches parseCronSimple API).
    // If user selects multiple, we emit the first for now; documented stub.
    return `${minute} ${hour} * * ${dow[0]}`;
  }, [minute, hour, dow]);

  function toggleDow(d: number) {
    setDow((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort());
  }

  async function parseNl() {
    if (!nlText.trim()) return;
    try {
      const res = await fetch('/api/schedules/parse-nl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: nlText.trim() }),
      });
      const data = await res.json();
      setNlResult(data?.explanation ?? 'NL parsing not yet implemented (stub)');
    } catch {
      setNlResult('Failed to contact server');
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !taskTitle.trim() || !cronPreview) return;
    setSubmitting(true); setError(null);
    try {
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          cron_expression: cronPreview,
          task_title: taskTitle.trim(),
          task_description: taskDescription.trim() || undefined,
          assigned_skill: assignedSkill.trim() || undefined,
          enabled,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onCreated();
      onClose();
      setName(''); setTaskTitle(''); setTaskDescription(''); setAssignedSkill(''); setDow([0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed');
    } finally { setSubmitting(false); }
  }

  return (
    <div className={`fixed inset-0 z-40 pointer-events-none ${open ? 'pointer-events-auto' : ''}`}>
      {open && <div onClick={onClose} className="absolute inset-0 bg-black/40" />}
      <aside className={`absolute top-0 right-0 h-full w-[520px] max-w-[96vw] bg-brand-navy-dark border-l border-brand-navy-light/40 shadow-xl transition-transform ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <form onSubmit={onSubmit} className="flex flex-col h-full">
          <header className="p-4 border-b border-brand-navy-light/30 flex items-center justify-between">
            <h3 className="font-heading text-lg text-brand-cyan">New schedule</h3>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-white text-sm">Close</button>
          </header>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
            <label className="block">
              <span className="text-gray-300">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                className="mt-1 w-full rounded-md bg-brand-navy-light/40 border border-brand-navy-light/50 px-3 py-2 text-white"
              />
            </label>
            <div>
              <span className="text-gray-300">Time</span>
              <div className="flex items-center gap-2 mt-1">
                <select
                  value={hour}
                  onChange={(e) => setHour(parseInt(e.target.value, 10))}
                  className="rounded-md bg-brand-navy-light/40 border border-brand-navy-light/50 px-2 py-2 text-white"
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
                  ))}
                </select>
                <span className="text-gray-400">:</span>
                <select
                  value={minute}
                  onChange={(e) => setMinute(parseInt(e.target.value, 10))}
                  className="rounded-md bg-brand-navy-light/40 border border-brand-navy-light/50 px-2 py-2 text-white"
                >
                  {[0, 15, 30, 45].map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
                </select>
              </div>
            </div>
            <div>
              <span className="text-gray-300">Days</span>
              <div className="flex gap-1 flex-wrap mt-1">
                {DOW_NAMES.map((label, idx) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleDow(idx)}
                    className={`px-2.5 py-1 rounded-md text-xs border ${dow.includes(idx) ? 'bg-brand-cyan/20 border-brand-cyan/40 text-brand-cyan' : 'border-brand-navy-light/50 text-gray-400'}`}
                  >{label}</button>
                ))}
              </div>
              <div className="flex gap-2 mt-2 text-xs">
                <button type="button" onClick={() => setDow([0, 1, 2, 3, 4, 5, 6])} className="text-gray-400 hover:text-white">Every day</button>
                <button type="button" onClick={() => setDow([0, 1, 2, 3, 4])} className="text-gray-400 hover:text-white">Weekdays</button>
                <button type="button" onClick={() => setDow([5, 6])} className="text-gray-400 hover:text-white">Weekends</button>
              </div>
            </div>
            <div>
              <span className="text-gray-300">Cron preview</span>
              <code className="block mt-1 bg-brand-navy/60 px-2 py-1 rounded text-[11px] text-gray-300">
                {cronPreview ?? '(select at least one day)'}
              </code>
              {dow.length > 1 && (
                <p className="text-[10px] text-amber-400 mt-1">
                  Note: scheduler materialiser takes the first selected day. Multi-day support deferred.
                </p>
              )}
            </div>
            <label className="block">
              <span className="text-gray-300">Task title</span>
              <input
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                required
                className="mt-1 w-full rounded-md bg-brand-navy-light/40 border border-brand-navy-light/50 px-3 py-2 text-white"
              />
            </label>
            <label className="block">
              <span className="text-gray-300">Task description</span>
              <textarea
                value={taskDescription}
                onChange={(e) => setTaskDescription(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md bg-brand-navy-light/40 border border-brand-navy-light/50 px-3 py-2 text-white"
              />
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
            <label className="flex items-center gap-2 text-gray-300">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Enabled
            </label>
            <div className="pt-2 border-t border-brand-navy-light/30">
              <span className="text-gray-300">Parse from text (stub)</span>
              <div className="flex gap-2 mt-1">
                <input
                  value={nlText}
                  onChange={(e) => setNlText(e.target.value)}
                  placeholder="e.g. every Monday at 9am"
                  className="flex-1 rounded-md bg-brand-navy-light/40 border border-brand-navy-light/50 px-3 py-2 text-white"
                />
                <button
                  type="button"
                  onClick={parseNl}
                  className="px-3 py-1.5 text-xs rounded-md border border-brand-navy-light/50 text-gray-300 hover:text-white"
                >Parse</button>
              </div>
              {nlResult && <p className="text-[11px] text-gray-500 mt-1">{nlResult}</p>}
            </div>
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
              disabled={submitting || !name.trim() || !taskTitle.trim() || !cronPreview}
              className="px-3 py-1.5 text-sm rounded-md bg-brand-cyan text-brand-navy-dark font-medium disabled:opacity-50"
            >{submitting ? 'Creating…' : 'Create schedule'}</button>
          </footer>
        </form>
      </aside>
    </div>
  );
}
