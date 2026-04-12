import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getClaudeHome } from '@/lib/claude-home';
import {
  getTrustedProjectRoots,
  isPathWithin,
  resolveTrustedProjectRoot,
} from '@/lib/claude-project-roots';

// Directories to skip when searching for CLAUDE.md files
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', 'bin', 'obj', 'packages',
  'dist', 'build', '.next', '.nuget', 'TestResults',
]);

/**
 * Recursively find all CLAUDE.md files under a directory, up to maxDepth levels.
 * Any subtree whose canonical path appears in `pruneRoots` is skipped — that is how
 * a parent project root avoids rediscovering CLAUDE.md files inside child project roots.
 */
async function findClaudeMdFiles(
  dir: string,
  maxDepth: number,
  pruneRoots: Set<string>,
): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string, depth: number) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name === 'CLAUDE.md') {
        results.push(path.join(current, entry.name));
        continue;
      }
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;

      const childPath = path.join(current, entry.name);
      let realChild: string;
      try {
        realChild = await fs.realpath(childPath);
      } catch {
        continue;
      }
      if (pruneRoots.has(realChild)) continue;
      await walk(childPath, depth + 1);
    }
  }

  await walk(dir, 0);
  return results;
}

// List all CLAUDE.md files (global + per-project)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const project = searchParams.get('project');

  if (project) {
    if (project.includes('/') || project.includes('\\') || project.includes('\0')) {
      return NextResponse.json({ error: 'Invalid project name' }, { status: 400 });
    }

    const realProjectPath = await resolveTrustedProjectRoot(project);
    if (!realProjectPath) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const claudeMdPath = path.join(realProjectPath, 'CLAUDE.md');
    try {
      const content = await fs.readFile(claudeMdPath, 'utf-8');
      return NextResponse.json({ path: claudeMdPath, content, project });
    } catch {
      return NextResponse.json({ path: claudeMdPath, content: null, project });
    }
  }

  // List all CLAUDE.md files: global + per-project
  const results = new Map<string, { project: string | null; path: string; content: string }>();

  // Global CLAUDE.md
  const globalPath = path.join(getClaudeHome(), 'CLAUDE.md');
  try {
    const content = await fs.readFile(globalPath, 'utf-8');
    results.set(globalPath, { project: null, path: globalPath, content });
  } catch { /* doesn't exist */ }

  // Per-project CLAUDE.md files. Roots are trusted (cwd-derived + canonicalized) and
  // overlapping encoded directories have already been collapsed by getTrustedProjectRoots.
  const roots = await getTrustedProjectRoots();
  const allRootPaths = new Set(roots.map((r) => r.realRoot));

  for (const root of roots) {
    // Prune sibling roots so e.g. /home/agent doesn't rediscover /home/agent/code/Foo's CLAUDE.md
    const pruneRoots = new Set<string>();
    for (const other of allRootPaths) {
      if (other !== root.realRoot && isPathWithin(root.realRoot, other)) {
        pruneRoots.add(other);
      }
    }

    const found = await findClaudeMdFiles(root.realRoot, 3, pruneRoots);
    for (const claudeMdPath of found) {
      if (results.has(claudeMdPath)) continue;
      try {
        const content = await fs.readFile(claudeMdPath, 'utf-8');
        const relPath = path.relative(root.realRoot, claudeMdPath);
        const label =
          relPath === 'CLAUDE.md'
            ? root.encodedName
            : `${root.encodedName} / ${path.dirname(relPath)}`;
        results.set(claudeMdPath, { project: label, path: claudeMdPath, content });
      } catch { /* unreadable */ }
    }
  }

  return NextResponse.json(Array.from(results.values()));
}

export async function PUT(request: Request) {
  const body = await request.json();
  const { path: filePath, content } = body;

  if (!filePath || typeof content !== 'string') {
    return NextResponse.json({ error: 'Missing path or content' }, { status: 400 });
  }

  // Safety: only allow writing to .claude directory
  const claudeHome = getClaudeHome();
  if (!filePath.startsWith(claudeHome)) {
    return NextResponse.json({ error: 'Path must be within Claude home directory' }, { status: 403 });
  }

  try {
    await fs.writeFile(filePath, content, 'utf-8');
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
