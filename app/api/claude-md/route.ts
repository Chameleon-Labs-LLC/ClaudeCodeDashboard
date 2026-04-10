import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getClaudeHome, getProjectsDir } from '@/lib/claude-home';

/**
 * Decode a Claude Code project directory name back to the real filesystem path.
 * Encoding: drive letter + '--' for ':/' (or ':\'), single '-' for '/' or '\'.
 * Example: 'c--Projects' → 'C:\Projects' on Windows, 'home-user-code' → '/home/user/code' on Unix.
 */
function decodeProjectPath(encoded: string): string {
  // Replace '--' (drive separator) first, then single '-' (path separator)
  const decoded = encoded.replace(/--/, ':/').replace(/-/g, '/');
  return path.resolve(decoded);
}

// Directories to skip when searching for CLAUDE.md files
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', 'bin', 'obj', 'packages',
  'dist', 'build', '.next', '.nuget', 'TestResults',
]);

/**
 * Recursively find all CLAUDE.md files under a directory, up to maxDepth levels.
 */
async function findClaudeMdFiles(dir: string, maxDepth: number): Promise<string[]> {
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
      } else if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        await walk(path.join(current, entry.name), depth + 1);
      }
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
    // Decode the project directory name to the real filesystem path
    const realProjectPath = decodeProjectPath(project);
    const claudeMdPath = path.join(realProjectPath, 'CLAUDE.md');
    try {
      const content = await fs.readFile(claudeMdPath, 'utf-8');
      return NextResponse.json({ path: claudeMdPath, content, project });
    } catch {
      return NextResponse.json({ path: claudeMdPath, content: null, project });
    }
  }

  // List all CLAUDE.md files: global + per-project
  const results: Array<{ project: string | null; path: string; content: string }> = [];

  // Global CLAUDE.md
  const globalPath = path.join(getClaudeHome(), 'CLAUDE.md');
  try {
    const content = await fs.readFile(globalPath, 'utf-8');
    results.push({ project: null, path: globalPath, content });
  } catch { /* doesn't exist */ }

  // Per-project CLAUDE.md files — look in the actual project directories (recursively)
  const projectsDir = getProjectsDir();
  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const realProjectPath = decodeProjectPath(entry.name);
      const found = await findClaudeMdFiles(realProjectPath, 3);
      for (const claudeMdPath of found) {
        try {
          const content = await fs.readFile(claudeMdPath, 'utf-8');
          // Use relative path from project root as label for nested files
          const relPath = path.relative(realProjectPath, claudeMdPath);
          const label = relPath === 'CLAUDE.md' ? entry.name : `${entry.name} / ${path.dirname(relPath)}`;
          results.push({ project: label, path: claudeMdPath, content });
        } catch { /* unreadable */ }
      }
    }
  } catch { /* projects dir doesn't exist */ }

  return NextResponse.json(results);
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
