import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import { getClaudeHome, getProjectsDir } from './claude-home';
import { decodeClaudeProjectPath } from './claude-project-path';
import type {
  Session,
  SessionDetail,
  SessionMessage,
  MemoryEntry,
  MemoryIndex,
  MemoryIndexEntry,
  Project,
  DashboardStats,
} from '@/types/claude';

/** Check if a path exists */
async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Safely read a text file */
async function readText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/** List all project directories within ~/.claude/projects/ */
export async function listProjects(): Promise<Project[]> {
  const projectsDir = getProjectsDir();
  if (!(await exists(projectsDir))) return [];

  const entries = await fs.readdir(projectsDir, { withFileTypes: true });
  const projects: Project[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const projDir = path.join(projectsDir, entry.name);
    const memoryDir = path.join(projDir, 'memory');

    let decodedPath: string;
    try {
      decodedPath = decodeClaudeProjectPath(entry.name);
    } catch {
      continue;
    }

    let sessionCount = 0;
    let lastActive: string | undefined;

    // Count session files (JSONL files in the project dir)
    try {
      const files = await fs.readdir(projDir);
      for (const f of files) {
        if (f.endsWith('.jsonl')) {
          sessionCount++;
          const stat = await fs.stat(path.join(projDir, f));
          const mtime = stat.mtime.toISOString();
          if (!lastActive || mtime > lastActive) lastActive = mtime;
        }
      }
    } catch { /* ignore */ }

    projects.push({
      path: decodedPath,
      name: entry.name,
      hasClaudeMd: await exists(path.join(projDir, 'CLAUDE.md')),
      hasMemory: await exists(memoryDir),
      sessionCount,
      lastActive,
    });
  }

  return projects.sort((a, b) => (b.lastActive || '').localeCompare(a.lastActive || ''));
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** Extract text content from a Claude Code message content field.
 *  Content can be a string, or an array of blocks like [{type:"text",text:"..."}] */
function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block: { type?: string }) => block.type === 'text')
      .map((block: { text?: string }) => block.text || '')
      .join('\n');
  }
  return '';
}

/** Parse a JSONL session file into messages.
 *  Claude Code JSONL format: each line is a JSON object with `type` field:
 *  - type:"user"      → message.content is string or array of {type,text} blocks
 *  - type:"assistant"  → message.content is array of blocks (text, thinking, tool_use, tool_result)
 *  - type:"system"     → system/meta entries (bridge_status, file-history-snapshot, etc.)
 */
function parseSessionMessages(content: string): SessionMessage[] {
  const messages: SessionMessage[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);

      if (obj.type === 'user' && obj.message) {
        const text = extractTextContent(obj.message.content);
        if (text) {
          messages.push({
            role: 'user',
            content: text,
            timestamp: obj.timestamp,
          });
        }
      } else if (obj.type === 'assistant' && obj.message) {
        const text = extractTextContent(obj.message.content);
        if (text) {
          messages.push({
            role: 'assistant',
            content: text,
            timestamp: obj.timestamp,
          });
        }
      } else if (obj.type === 'system' && !obj.subtype) {
        // Skip meta entries like bridge_status, file-history-snapshot
        const text = typeof obj.content === 'string' ? obj.content : '';
        if (text) {
          messages.push({
            role: 'system',
            content: text,
            timestamp: obj.timestamp,
          });
        }
      }
    } catch { /* skip malformed lines */ }
  }
  return messages;
}

/** List sessions for a given project (or all projects) */
export async function listSessions(projectName?: string): Promise<Session[]> {
  const projectsDir = getProjectsDir();
  if (!(await exists(projectsDir))) return [];

  const sessions: Session[] = [];
  const projectDirs = projectName
    ? [path.join(projectsDir, projectName)]
    : (await fs.readdir(projectsDir, { withFileTypes: true }))
        .filter((d: { isDirectory(): boolean }) => d.isDirectory())
        .map((d: { name: string }) => path.join(projectsDir, d.name));

  for (const projDir of projectDirs) {
    const projName = path.basename(projDir);
    try {
      const files = await fs.readdir(projDir);
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        const filePath = path.join(projDir, f);
        const stat = await fs.stat(filePath);
        const content = await readText(filePath);
        const messages = content ? parseSessionMessages(content) : [];

        // Extract first user message as summary
        const firstUserMsg = messages.find(m => m.role === 'user');
        const summary = firstUserMsg?.content?.slice(0, 200);

        sessions.push({
          id: f.replace('.jsonl', ''),
          projectPath: projName,
          projectName: projName,
          startedAt: stat.birthtime.toISOString(),
          lastActiveAt: stat.mtime.toISOString(),
          messageCount: messages.length,
          summary,
        });
      }
    } catch { /* skip unreadable project dirs */ }
  }

  return sessions.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
}

/** Get detailed session data including all messages */
export async function getSessionDetail(projectName: string, sessionId: string): Promise<SessionDetail | null> {
  const filePath = path.join(getProjectsDir(), projectName, `${sessionId}.jsonl`);
  const content = await readText(filePath);
  if (!content) return null;

  const stat = await fs.stat(filePath);
  const messages = parseSessionMessages(content);
  const firstUserMsg = messages.find(m => m.role === 'user');

  return {
    id: sessionId,
    projectPath: projectName,
    projectName,
    startedAt: stat.birthtime.toISOString(),
    lastActiveAt: stat.mtime.toISOString(),
    messageCount: messages.length,
    summary: firstUserMsg?.content?.slice(0, 200),
    messages,
  };
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

/** Parse the MEMORY.md index file */
export async function getMemoryIndex(projectName?: string): Promise<MemoryIndex> {
  const memoryMdPath = projectName
    ? path.join(getProjectsDir(), projectName, 'memory', 'MEMORY.md')
    : path.join(getClaudeHome(), 'memory', 'MEMORY.md');

  const raw = await readText(memoryMdPath) || '';
  const entries: MemoryIndexEntry[] = [];

  for (const line of raw.split('\n')) {
    // Parse lines like: - [Title](file.md) — description
    const match = line.match(/^-\s*\[(.+?)\]\((.+?)\)\s*[—-]\s*(.+)/);
    if (match) {
      entries.push({
        title: match[1],
        file: match[2],
        description: match[3].trim(),
      });
    }
  }

  return { entries, raw };
}

/** Read memory files from a single directory */
async function readMemoryDir(memoryDir: string, projectLabel?: string): Promise<MemoryEntry[]> {
  if (!(await exists(memoryDir))) return [];

  const files = await fs.readdir(memoryDir);
  const memories: MemoryEntry[] = [];

  for (const f of files) {
    if (!f.endsWith('.md') || f === 'MEMORY.md') continue;
    const filePath = path.join(memoryDir, f);
    const raw = await readText(filePath);
    if (!raw) continue;

    const label = projectLabel ? `[${projectLabel}] ` : '';
    try {
      const { data, content } = matter(raw);
      memories.push({
        fileName: f,
        name: `${label}${data.name || f.replace('.md', '')}`,
        description: data.description || '',
        type: data.type || 'reference',
        content: content.trim(),
        filePath,
      });
    } catch {
      memories.push({
        fileName: f,
        name: `${label}${f.replace('.md', '')}`,
        description: '',
        type: 'reference',
        content: raw,
        filePath,
      });
    }
  }

  return memories;
}

/** List all memory files — for a specific project, or all projects + global */
export async function listMemories(projectName?: string): Promise<MemoryEntry[]> {
  if (projectName) {
    return readMemoryDir(path.join(getProjectsDir(), projectName, 'memory'));
  }

  // Scan global memory + all per-project memory dirs
  const globalDir = path.join(getClaudeHome(), 'memory');
  const memories = await readMemoryDir(globalDir, 'global');

  const projectsDir = getProjectsDir();
  if (await exists(projectsDir)) {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projMemDir = path.join(projectsDir, entry.name, 'memory');
      const projMemories = await readMemoryDir(projMemDir, entry.name);
      memories.push(...projMemories);
    }
  }

  return memories;
}

// ---------------------------------------------------------------------------
// Dashboard Stats
// ---------------------------------------------------------------------------

export async function getDashboardStats(): Promise<DashboardStats> {
  const [projects, sessions, memories] = await Promise.all([
    listProjects(),
    listSessions(),
    listMemories(),
  ]);

  return {
    totalSessions: sessions.length,
    totalProjects: projects.length,
    totalMemories: memories.length,
    recentSessions: sessions.slice(0, 10),
    recentProjects: projects.slice(0, 10),
  };
}
