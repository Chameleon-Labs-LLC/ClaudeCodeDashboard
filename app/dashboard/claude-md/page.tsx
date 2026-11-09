'use client';

import { useEffect, useState } from 'react';
import Markdown from '@/components/ui/markdown';

interface ClaudeMdFile {
  project: string | null;
  path: string;
  content: string;
}

export default function ClaudeMdPage() {
  const [files, setFiles] = useState<ClaudeMdFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ClaudeMdFile | null>(null);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    fetch('/api/claude-md')
      .then(r => r.json())
      .then((data: ClaudeMdFile[]) => {
        setFiles(data);
        if (data.length > 0) setSelected(data[0]);
      })
      .finally(() => setLoading(false));
  }, []);

  function handleSelect(file: ClaudeMdFile) {
    setSelected(file);
    setEditing(false);
    setSaveMessage('');
  }

  function handleEdit() {
    if (!selected) return;
    setEditContent(selected.content);
    setEditing(true);
    setSaveMessage('');
  }

  function handleCancel() {
    setEditing(false);
    setSaveMessage('');
  }

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    setSaveMessage('');
    try {
      const res = await fetch('/api/claude-md', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selected.path, content: editContent }),
      });
      if (res.ok) {
        const updated = { ...selected, content: editContent };
        setSelected(updated);
        setFiles(files.map(f => f.path === selected.path ? updated : f));
        setEditing(false);
        setSaveMessage('Saved successfully.');
      } else {
        setSaveMessage('Failed to save.');
      }
    } catch {
      setSaveMessage('Error saving file.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-gray-400 animate-pulse">Loading...</p>;

  return (
    <div>
      <h2 className="font-heading text-2xl text-brand-cyan mb-6">CLAUDE.md Files</h2>

      {files.length === 0 ? (
        <p className="text-gray-500 text-sm">No CLAUDE.md files found.</p>
      ) : (
        <div className="flex gap-6">
          {/* File list sidebar */}
          <div className="w-64 shrink-0 space-y-1">
            {files.map(file => (
              <button
                key={file.path}
                onClick={() => handleSelect(file)}
                className={`w-full text-left px-3 py-2 text-sm rounded-lg border transition-colors ${
                  selected?.path === file.path
                    ? 'bg-brand-cyan/10 border-brand-cyan/30 text-brand-cyan'
                    : 'border-brand-navy-light/30 text-gray-400 hover:text-white'
                }`}
              >
                <p className="truncate font-medium">
                  {file.project ? file.project : 'Global'}
                </p>
                <p className="text-xs text-gray-500 truncate">{file.path}</p>
              </button>
            ))}
          </div>

          {/* Content area */}
          <div className="flex-1 min-w-0">
            {selected && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-gray-400 text-sm truncate">{selected.path}</p>
                  <div className="flex gap-2 shrink-0">
                    {!editing ? (
                      <button
                        onClick={handleEdit}
                        className="px-3 py-1.5 text-xs rounded-lg border border-brand-navy-light/30 text-gray-400 hover:text-white transition-colors"
                      >
                        Edit
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={handleCancel}
                          className="px-3 py-1.5 text-xs rounded-lg border border-brand-navy-light/30 text-gray-400 hover:text-white transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSave}
                          disabled={saving}
                          className="px-3 py-1.5 text-xs rounded-lg border bg-brand-cyan/10 border-brand-cyan/30 text-brand-cyan transition-colors disabled:opacity-50"
                        >
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {saveMessage && (
                  <p className={`text-xs mb-3 ${saveMessage.includes('success') ? 'text-chameleon-green' : 'text-chameleon-red'}`}>
                    {saveMessage}
                  </p>
                )}

                {editing ? (
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full h-[60vh] px-4 py-3 bg-brand-navy-dark border border-brand-navy-light/30 rounded-lg text-white text-sm font-mono placeholder:text-gray-500 focus:outline-hidden focus:border-brand-cyan/40 resize-none"
                  />
                ) : (
                  <div className="bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-lg p-4 max-h-[70vh] overflow-y-auto">
                    <Markdown content={selected.content} />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
