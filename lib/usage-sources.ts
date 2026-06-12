/**
 * Registry of additional .claude roots ("sources") aggregated into usage.
 * Persisted at ~/.claude/ccd/sources.json. The primary CLAUDE_HOME is NEVER
 * stored here — it is always the implicit source "local" / "This machine".
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getClaudeHome } from './claude-home';

export interface UsageSource {
  id: string;
  label: string;
  path: string;
  enabled: boolean;
}

export interface SourceStats {
  projectCount: number;
  transcriptCount: number;
  /** ISO timestamp of the newest transcript, or null when none found */
  latestActivity: string | null;
}

export type SourceValidation =
  | { ok: true; stats: SourceStats }
  | { ok: false; reason: string };

export const PRIMARY_SOURCE_ID = 'local';
export const PRIMARY_SOURCE_LABEL = 'This machine';

export function getSourcesPath(): string {
  return path.join(getClaudeHome(), 'ccd', 'sources.json');
}

export function loadSources(filePath: string = getSourcesPath()): UsageSource[] {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { sources?: unknown };
    if (!Array.isArray(raw.sources)) return [];
    return raw.sources.filter(
      (s): s is UsageSource =>
        !!s &&
        typeof (s as UsageSource).id === 'string' &&
        typeof (s as UsageSource).label === 'string' &&
        typeof (s as UsageSource).path === 'string' &&
        typeof (s as UsageSource).enabled === 'boolean',
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('usage-sources: could not read', filePath, err);
    }
    return [];
  }
}

export function saveSources(sources: UsageSource[], filePath: string = getSourcesPath()): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ sources }, null, 2));
}

export function slugId(label: string, existing: UsageSource[]): string {
  const base =
    label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'source';
  const taken = new Set(existing.map((s) => s.id));
  if (!taken.has(base) && base !== PRIMARY_SOURCE_ID) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function expandTilde(p: string): string {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

export function collectStats(root: string): SourceStats {
  const projectsDir = path.join(root, 'projects');
  let projectCount = 0;
  let transcriptCount = 0;
  let latestMtime = 0;
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return { projectCount: 0, transcriptCount: 0, latestActivity: null };
  }
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    projectCount++;
    const projectDir = path.join(projectsDir, d.name);
    let files: string[];
    try {
      files = fs
        .readdirSync(projectDir, { recursive: true, encoding: 'utf-8' })
        .filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    transcriptCount += files.length;
    for (const rel of files) {
      try {
        const m = fs.statSync(path.join(projectDir, rel)).mtimeMs;
        if (m > latestMtime) latestMtime = m;
      } catch {
        /* file vanished mid-scan */
      }
    }
  }
  return {
    projectCount,
    transcriptCount,
    latestActivity: latestMtime ? new Date(latestMtime).toISOString() : null,
  };
}

export function validateSourcePath(
  candidate: string,
  existing: UsageSource[],
  primaryHome: string = getClaudeHome(),
): SourceValidation {
  const resolved = path.resolve(expandTilde(candidate.trim()));
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { ok: false, reason: 'path does not exist or is not a directory' };
  }
  if (!stat.isDirectory()) {
    return { ok: false, reason: 'path does not exist or is not a directory' };
  }
  if (resolved === path.resolve(primaryHome)) {
    return { ok: false, reason: 'this is the primary .claude folder (already included)' };
  }
  if (existing.some((s) => path.resolve(expandTilde(s.path)) === resolved)) {
    return { ok: false, reason: 'this folder is already registered' };
  }
  let hasProjects = false;
  try {
    hasProjects = fs.statSync(path.join(resolved, 'projects')).isDirectory();
  } catch {
    /* fallthrough */
  }
  if (!hasProjects) {
    return { ok: false, reason: 'no projects/ directory found — is this a .claude folder?' };
  }
  return { ok: true, stats: collectStats(resolved) };
}

/** Resolve a source's root to an absolute path (with ~ expansion). */
export function resolveSourceRoot(source: UsageSource): string {
  return path.resolve(expandTilde(source.path));
}
