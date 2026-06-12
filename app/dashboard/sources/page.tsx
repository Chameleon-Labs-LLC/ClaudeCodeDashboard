'use client';

import { useCallback, useEffect, useState } from 'react';

interface SourceStats {
  projectCount: number;
  transcriptCount: number;
  latestActivity: string | null;
}

interface SourceView {
  id: string;
  label: string;
  path: string;
  enabled: boolean;
  implicit: boolean;
  reachable: boolean;
  stats: SourceStats;
}

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // add form
  const [label, setLabel] = useState('');
  const [path, setPath] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [added, setAdded] = useState<SourceView | null>(null);

  const refresh = useCallback(() => {
    fetch('/api/sources')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setSources(data.sources);
        setError(null);
      })
      .catch((err) => setError(String(err)));
  }, []);

  useEffect(refresh, [refresh]);

  async function addSource() {
    setAdding(true);
    setAddError(null);
    setAdded(null);
    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, path }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setAdded(data.source);
      setLabel('');
      setPath('');
      refresh();
    } catch (err) {
      setAddError(String(err));
    } finally {
      setAdding(false);
    }
  }

  async function rename(s: SourceView) {
    const next = prompt('New label:', s.label)?.trim();
    if (!next || next === s.label) return;
    await fetch(`/api/sources/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: next }),
    });
    refresh();
  }

  async function toggle(s: SourceView) {
    await fetch(`/api/sources/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !s.enabled }),
    });
    refresh();
  }

  async function remove(s: SourceView) {
    if (!confirm(`Remove source "${s.label}"? Usage from it will disappear from the dashboard.`)) return;
    await fetch(`/api/sources/${s.id}`, { method: 'DELETE' });
    refresh();
  }

  return (
    <div className="p-8 max-w-5xl">
      <h2 className="font-heading text-2xl text-brand-cyan mb-2">Data Sources</h2>
      <p className="text-gray-400 text-sm mb-6">
        Additional <code className="text-brand-cyan">.claude</code> folders aggregated into Usage &amp; Cost.
        The primary folder is always included.
      </p>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      {/* Source table */}
      <div className="bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-xl overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 text-xs border-b border-brand-navy-light/30">
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Path</th>
              <th className="px-4 py-3 text-right">Projects</th>
              <th className="px-4 py-3 text-right">Transcripts</th>
              <th className="px-4 py-3">Latest activity</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {(sources ?? []).map((s) => (
              <tr key={s.id} className="border-b border-brand-navy-light/20 last:border-0">
                <td className="px-4 py-3">
                  <span
                    className={`inline-block w-2 h-2 rounded-full mr-2 ${
                      s.reachable ? 'bg-chameleon-green' : 'bg-red-500'
                    }`}
                    title={s.reachable ? 'reachable' : 'unreachable'}
                  />
                  <span className={s.enabled ? 'text-white' : 'text-gray-500 line-through'}>
                    {s.label}
                  </span>
                  {s.implicit && <span className="ml-2 text-xs text-gray-500">(primary)</span>}
                </td>
                <td className="px-4 py-3 text-gray-400 font-mono text-xs break-all">{s.path}</td>
                <td className="px-4 py-3 text-right text-gray-300">{s.stats.projectCount}</td>
                <td className="px-4 py-3 text-right text-gray-300">{s.stats.transcriptCount}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {s.stats.latestActivity ? new Date(s.stats.latestActivity).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {!s.implicit && (
                    <>
                      <button
                        onClick={() => rename(s)}
                        className="text-xs text-gray-400 hover:text-brand-cyan mr-3"
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => toggle(s)}
                        className="text-xs text-gray-400 hover:text-brand-cyan mr-3"
                      >
                        {s.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={() => remove(s)}
                        className="text-xs text-gray-400 hover:text-red-400"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {sources === null && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add form */}
      <div className="bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-xl p-5 mb-6">
        <h3 className="text-white font-semibold mb-3">Add a .claude folder</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-xs text-gray-400">
            Label
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="WSL Ubuntu"
              className="block mt-1 bg-brand-navy-light border border-brand-navy-light/50 rounded-lg px-3 py-2 text-sm text-gray-200 w-44"
            />
          </label>
          <label className="text-xs text-gray-400 flex-1 min-w-72">
            Path to the .claude folder
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="\\wsl.localhost\Ubuntu\home\leland\.claude"
              className="block mt-1 w-full bg-brand-navy-light border border-brand-navy-light/50 rounded-lg px-3 py-2 text-sm text-gray-200 font-mono"
            />
          </label>
          <button
            onClick={addSource}
            disabled={adding || !label.trim() || !path.trim()}
            className="px-4 py-2 rounded-lg text-sm bg-brand-cyan/20 border border-brand-cyan/50 text-brand-cyan hover:bg-brand-cyan/30 disabled:opacity-40"
          >
            {adding ? 'Validating…' : 'Validate & Add'}
          </button>
        </div>
        {addError && <p className="text-red-400 text-sm mt-3">{addError}</p>}
        {added && (
          <p className="text-chameleon-green text-sm mt-3">
            Added “{added.label}”: {added.stats.projectCount} projects, {added.stats.transcriptCount}{' '}
            transcripts
            {added.stats.latestActivity &&
              `, latest ${new Date(added.stats.latestActivity).toLocaleString()}`}
            .
          </p>
        )}
      </div>

      {/* Hints */}
      <div className="bg-brand-navy-light/30 border border-brand-navy-light/30 rounded-xl p-5 text-sm text-gray-400 space-y-2">
        <h3 className="text-white font-semibold">Common locations</h3>
        <p>
          <span className="text-gray-300">WSL from Windows:</span>{' '}
          <code className="text-brand-cyan">\\wsl.localhost\&lt;distro&gt;\home\&lt;user&gt;\.claude</code>
        </p>
        <p>
          <span className="text-gray-300">Windows from WSL:</span>{' '}
          <code className="text-brand-cyan">/mnt/c/Users/&lt;user&gt;/.claude</code>
        </p>
        <p>
          Other machines work too as long as the folder is mounted/reachable as a path (network drive,
          SSHFS, synced copy — duplicates are deduplicated automatically).
        </p>
      </div>
    </div>
  );
}
