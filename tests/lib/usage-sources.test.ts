import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadSources,
  saveSources,
  slugId,
  collectStats,
  validateSourcePath,
  type UsageSource,
} from '../../lib/usage-sources';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ccd-sources-'));
}

/** Make a fake .claude root with a projects dir and one transcript. */
function fakeRoot(dir: string): string {
  const proj = path.join(dir, 'projects', 'proj-a');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'sess-1.jsonl'), '{}\n');
  return dir;
}

test('loadSources: missing file -> empty list', () => {
  const file = path.join(tmp(), 'sources.json');
  assert.deepEqual(loadSources(file), []);
});

test('loadSources: malformed file -> empty list', () => {
  const file = path.join(tmp(), 'sources.json');
  fs.writeFileSync(file, 'not json');
  assert.deepEqual(loadSources(file), []);
});

test('saveSources/loadSources round-trip', () => {
  const file = path.join(tmp(), 'nested', 'sources.json');
  const sources: UsageSource[] = [
    { id: 'wsl', label: 'WSL Ubuntu', path: '/some/root', enabled: true },
  ];
  saveSources(sources, file);
  assert.deepEqual(loadSources(file), sources);
});

test('slugId: slugs the label and de-dupes against existing ids', () => {
  assert.equal(slugId('WSL Ubuntu', []), 'wsl-ubuntu');
  const existing = [{ id: 'wsl-ubuntu', label: '', path: '', enabled: true }];
  assert.equal(slugId('WSL Ubuntu', existing), 'wsl-ubuntu-2');
  assert.equal(slugId('!!!', []), 'source');
});

test('collectStats: counts projects, transcripts, latest mtime', () => {
  const root = fakeRoot(tmp());
  const stats = collectStats(root);
  assert.equal(stats.projectCount, 1);
  assert.equal(stats.transcriptCount, 1);
  assert.ok(stats.latestActivity); // ISO string
});

test('validateSourcePath: ok for a real root', () => {
  const root = fakeRoot(tmp());
  const res = validateSourcePath(root, [], '/nonexistent-primary');
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.stats.projectCount, 1);
});

test('validateSourcePath: rejects missing dir', () => {
  const res = validateSourcePath(path.join(tmp(), 'nope'), [], '/x');
  assert.deepEqual(res, { ok: false, reason: 'path does not exist or is not a directory' });
});

test('validateSourcePath: rejects dir without projects/', () => {
  const res = validateSourcePath(tmp(), [], '/x');
  assert.deepEqual(res, { ok: false, reason: 'no projects/ directory found — is this a .claude folder?' });
});

test('validateSourcePath: rejects the primary CLAUDE_HOME', () => {
  const root = fakeRoot(tmp());
  const res = validateSourcePath(root, [], root);
  assert.deepEqual(res, { ok: false, reason: 'this is the primary .claude folder (already included)' });
});

test('validateSourcePath: rejects an already-registered path', () => {
  const root = fakeRoot(tmp());
  const existing = [{ id: 'a', label: 'A', path: root, enabled: true }];
  const res = validateSourcePath(root, existing, '/x');
  assert.deepEqual(res, { ok: false, reason: 'this folder is already registered' });
});

test('validateSourcePath: expands ~ to the home dir', () => {
  // "~" exists after expansion; it may or may not contain projects/, so assert
  // only that expansion happened (the failure must not be "does not exist").
  const res = validateSourcePath('~', [], '/x');
  if (!res.ok) assert.notEqual(res.reason, 'path does not exist or is not a directory');
});
