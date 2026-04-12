import fs from 'fs/promises';
import path from 'path';
import { getProjectsDir } from './claude-home';
import { decodeClaudeProjectPath } from './claude-project-path';

/**
 * A canonical, trusted Claude Code project root.
 *
 * `realRoot` is the result of `fs.realpath` on a directory that we have positively
 * confirmed exists, so it is safe to hand to recursive filesystem walks. `encodedName`
 * is the original `~/.claude/projects/<dir>` entry the root was discovered through and
 * is what API consumers use as a stable identifier in URLs.
 */
export interface TrustedProjectRoot {
  encodedName: string;
  realRoot: string;
}

/**
 * Read the first non-empty `cwd` field out of a Claude Code session JSONL file.
 *
 * Claude writes the working directory onto every user/assistant message line, so the
 * first line that has one is authoritative. We deliberately ignore the encoded folder
 * name as a source of truth — that is the whole point of this module.
 */
async function readCwdFromSessionFile(filePath: string): Promise<string | null> {
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (typeof obj?.cwd === 'string' && obj.cwd.length > 0) {
        return obj.cwd;
      }
    } catch {
      // skip malformed lines
    }
  }
  return null;
}

/** Read the first session-derived `cwd` for a single Claude project directory. */
async function readCwdFromProjectDir(projectDir: string): Promise<string | null> {
  let entries;
  try {
    entries = await fs.readdir(projectDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const cwd = await readCwdFromSessionFile(path.join(projectDir, entry.name));
    if (cwd) return cwd;
  }
  return null;
}

/**
 * Resolve a candidate filesystem path into a canonical, validated project root.
 *
 * Returns null when the path does not exist, is not a directory, or cannot be realpath'd.
 * Symlink targets are accepted (realpath collapses them) but the *result* must still be a
 * real directory — we never hand a dangling symlink back to the caller.
 */
async function canonicalizeRoot(candidate: string): Promise<string | null> {
  if (!path.isAbsolute(candidate)) return null;
  try {
    const real = await fs.realpath(candidate);
    const stat = await fs.stat(real);
    if (!stat.isDirectory()) return null;
    return real;
  } catch {
    return null;
  }
}

/**
 * Enumerate the trusted project roots tracked by Claude Code.
 *
 * For each `~/.claude/projects/<dir>` entry we prefer the `cwd` recorded inside its
 * session JSONL files and only fall back to decoding the directory name when no session
 * data is available. Both candidates are canonicalized via `realpath` and deduped by the
 * resulting real path so overlapping encoded roots collapse into a single entry.
 */
export async function getTrustedProjectRoots(): Promise<TrustedProjectRoot[]> {
  const projectsDir = getProjectsDir();
  let entries;
  try {
    entries = await fs.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const byRealRoot = new Map<string, TrustedProjectRoot>();

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;

    const projectDir = path.join(projectsDir, entry.name);
    const cwd = await readCwdFromProjectDir(projectDir);

    let realRoot: string | null = null;
    if (cwd) {
      realRoot = await canonicalizeRoot(cwd);
    }
    if (!realRoot) {
      try {
        realRoot = await canonicalizeRoot(decodeClaudeProjectPath(entry.name));
      } catch {
        realRoot = null;
      }
    }
    if (!realRoot) continue;

    if (!byRealRoot.has(realRoot)) {
      byRealRoot.set(realRoot, { encodedName: entry.name, realRoot });
    }
  }

  return Array.from(byRealRoot.values());
}

/**
 * Resolve a single encoded project name to its trusted real root, or null if the
 * encoded name does not correspond to a known project. This is the safe lookup for API
 * routes that accept `?project=<encoded>` query params — it never trusts the encoded
 * name as a path on its own.
 */
export async function resolveTrustedProjectRoot(encodedName: string): Promise<string | null> {
  const roots = await getTrustedProjectRoots();
  const match = roots.find((r) => r.encodedName === encodedName);
  return match ? match.realRoot : null;
}

/**
 * Return true when `child` is the same as `parent` or lives strictly underneath it.
 * Used by callers that walk one root and want to prune subtrees that are themselves
 * separate trusted roots.
 */
export function isPathWithin(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
