import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getClaudeHome } from './claude-home';
import type { LiveSessionRow, LiveSessionState, LiveTimelineEntry } from '../types/live';

const FIVE_MIN_MS = 5 * 60 * 1000;
const TITLE_MAX = 120;

function getProjectsDir(): string {
  return path.join(getClaudeHome(), 'projects');
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === 'object' && 'text' in block && typeof (block as { text: unknown }).text === 'string') {
        return (block as { text: string }).text;
      }
    }
  }
  return '';
}

export async function listLiveSessions(): Promise<LiveSessionRow[]> {
  const projectsDir = getProjectsDir();
  try { await fs.access(projectsDir); } catch { return []; }

  const cutoff = Date.now() - FIVE_MIN_MS;
  const rows: LiveSessionRow[] = [];

  const projects = await fs.readdir(projectsDir, { withFileTypes: true });
  for (const proj of projects) {
    if (!proj.isDirectory()) continue;
    const projDir = path.join(projectsDir, proj.name);
    let files: string[];
    try { files = await fs.readdir(projDir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const fp = path.join(projDir, f);
      let stat;
      try { stat = await fs.stat(fp); } catch { continue; }
      if (stat.mtimeMs < cutoff) continue;

      // cheap read — just enough to extract title + cwd + model + token total
      let text = '';
      try { text = await fs.readFile(fp, 'utf-8'); } catch { continue; }
      const lines = text.split('\n').filter(Boolean);

      let title = '';
      let cwd: string | null = null;
      let model: string | null = null;
      let tokenTotal = 0;

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (!title && obj.type === 'user') {
            title = truncate(extractText(obj.message?.content), TITLE_MAX);
          }
          if (obj.cwd && !cwd) cwd = obj.cwd;
          if (obj.model && !model) model = obj.model;
          const u = obj.message?.usage;
          if (u) tokenTotal += (u.input_tokens ?? 0) + (u.output_tokens ?? 0)
                             + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        } catch { /* skip */ }
      }

      rows.push({
        id: f.replace(/\.jsonl$/, ''),
        projectName: proj.name,
        title: title || '(no user message yet)',
        cwd,
        model,
        startedAt: stat.birthtime.toISOString(),
        lastActiveAt: stat.mtime.toISOString(),
        tokenTotal,
      });
    }
  }

  return rows.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
}

export async function deriveStateFromJsonl(filePath: string, sessionId: string): Promise<LiveSessionState> {
  let text: string;
  try { text = await fs.readFile(filePath, 'utf-8'); }
  catch {
    return {
      sessionId, cwd: null, model: null, title: null,
      status: 'unknown', lastEventAt: null, derivedFrom: 'none',
    };
  }

  const lines = text.split('\n').filter(Boolean);
  let title: string | null = null;
  let cwd: string | null = null;
  let model: string | null = null;
  let lastEventAt: string | null = null;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (!title && obj.type === 'user') title = truncate(extractText(obj.message?.content), TITLE_MAX);
      if (obj.cwd) cwd = obj.cwd;
      if (obj.model) model = obj.model;
      if (obj.timestamp) lastEventAt = obj.timestamp;
    } catch { /* skip */ }
  }

  const now = Date.now();
  const status: LiveSessionState['status'] = lastEventAt
    ? (now - new Date(lastEventAt).getTime() < 60_000 ? 'active' : 'idle')
    : 'unknown';

  return { sessionId, cwd, model, title, status, lastEventAt, derivedFrom: 'jsonl' };
}

/** Read all full lines appended to `filePath` since `fromOffset`. Returns new offset. */
export async function readNewLines(
  filePath: string,
  fromOffset: number,
): Promise<{ lines: string[]; newOffset: number }> {
  let fh;
  try { fh = await fs.open(filePath, 'r'); }
  catch { return { lines: [], newOffset: fromOffset }; }
  try {
    const stat = await fh.stat();
    if (stat.size <= fromOffset) return { lines: [], newOffset: fromOffset };
    const buf = Buffer.alloc(stat.size - fromOffset);
    await fh.read(buf, 0, buf.length, fromOffset);
    const text = buf.toString('utf-8');
    // keep trailing partial line — advance offset only to last newline
    const lastNl = text.lastIndexOf('\n');
    if (lastNl < 0) return { lines: [], newOffset: fromOffset };
    const full = text.slice(0, lastNl);
    const lines = full.split('\n').filter(Boolean);
    return { lines, newOffset: fromOffset + Buffer.byteLength(full, 'utf-8') + 1 /* the \n */ };
  } finally {
    await fh.close();
  }
}

/** Convert a raw JSONL line into a timeline entry (or null if uninteresting). */
export function lineToTimelineEntry(rawLine: string): LiveTimelineEntry | null {
  try {
    const obj = JSON.parse(rawLine);
    const timestamp = obj.timestamp || new Date().toISOString();
    if (obj.type === 'user') {
      return { kind: 'user_message', timestamp, preview: truncate(extractText(obj.message?.content), 240) };
    }
    if (obj.type === 'assistant') {
      // look for tool_use blocks
      const content = obj.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'tool_use') {
            return { kind: 'tool_use', timestamp, toolName: block.name, preview: truncate(JSON.stringify(block.input ?? {}), 240) };
          }
        }
      }
      return { kind: 'assistant_message', timestamp, preview: truncate(extractText(content), 240) };
    }
    if (obj.type === 'tool_result' || obj.toolUseResult) {
      return {
        kind: 'tool_result',
        timestamp,
        toolName: obj.toolUseResult?.toolName,
        preview: truncate(typeof obj.toolUseResult === 'string' ? obj.toolUseResult : JSON.stringify(obj.toolUseResult ?? {}), 240),
      };
    }
    return { kind: 'system', timestamp, preview: truncate(rawLine, 240) };
  } catch { return null; }
}
