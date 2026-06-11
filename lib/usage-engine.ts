/**
 * Usage aggregation engine for ~/.claude/projects JSONL transcripts.
 *
 * Methodology matches ccusage (the reference implementation):
 *  - one usage record per assistant-message *entry*, not per session
 *  - duplicates removed by (message.id, requestId); session resumes and
 *    sidechain replays copy entries across files (measured ~50% of raw lines)
 *  - each entry priced by its own model across all four token classes
 *  - bucketing by each entry's own timestamp in local time
 */
import fs from 'node:fs';
import path from 'node:path';
import { getProjectsDir } from './claude-home';
import { type TokenCounts } from './litellm-pricing';

export interface UsageEntry extends TokenCounts {
  messageId?: string;
  requestId?: string;
  isSidechain: boolean;
  isFast: boolean;
  timestampMs: number;
  /** undefined for "<synthetic>" placeholder entries */
  model?: string;
  sessionId: string;
  projectName: string;
}

export interface LoadResult {
  entries: UsageEntry[];
  /** entry count before deduplication */
  rawEntryCount: number;
}

const USAGE_MARKER = '"usage":{';

export function parseUsageFile(
  content: string,
  sessionId: string,
  projectName: string,
): UsageEntry[] {
  const out: UsageEntry[] = [];
  for (const line of content.split('\n')) {
    if (!line.includes(USAGE_MARKER)) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = obj?.message as
      | { role?: string; id?: unknown; model?: unknown; usage?: Record<string, unknown> }
      | undefined;
    if (msg?.role !== 'assistant' || !msg?.usage) continue;
    const timestampMs = Date.parse(String(obj.timestamp ?? ''));
    if (Number.isNaN(timestampMs)) continue;
    // ccusage parity: empty-string identity fields mark malformed entries
    if (obj.requestId === '' || obj.sessionId === '' || msg.id === '' || msg.model === '') continue;
    const u = msg.usage;
    const model =
      typeof msg.model === 'string' && msg.model !== '<synthetic>' ? msg.model : undefined;
    out.push({
      messageId: typeof msg.id === 'string' ? msg.id : undefined,
      requestId: typeof obj.requestId === 'string' ? obj.requestId : undefined,
      isSidechain: obj.isSidechain === true,
      isFast: u.speed === 'fast',
      timestampMs,
      model,
      sessionId,
      projectName,
      inputTokens: Number(u.input_tokens) || 0,
      outputTokens: Number(u.output_tokens) || 0,
      cacheCreationTokens: Number(u.cache_creation_input_tokens) || 0,
      cacheReadTokens: Number(u.cache_read_input_tokens) || 0,
    });
  }
  return out;
}

function tokenTotal(e: UsageEntry): number {
  return e.inputTokens + e.outputTokens + e.cacheCreationTokens + e.cacheReadTokens;
}

/** Prefer parent (non-sidechain) entries, then the larger token total — ccusage parity. */
function shouldReplace(candidate: UsageEntry, existing: UsageEntry): boolean {
  if (candidate.isSidechain !== existing.isSidechain) return existing.isSidechain;
  return tokenTotal(candidate) > tokenTotal(existing);
}

export function dedupeEntries(entries: UsageEntry[]): UsageEntry[] {
  const kept: UsageEntry[] = [];
  const byMessageId = new Map<string, number[]>();
  for (const entry of entries) {
    if (!entry.messageId) {
      kept.push(entry);
      continue;
    }
    let indexes = byMessageId.get(entry.messageId);
    if (!indexes) {
      indexes = [];
      byMessageId.set(entry.messageId, indexes);
    }
    // duplicate when the requestId matches, or when either side is a sidechain
    // replay of the same message under a new requestId
    const dupIndex = indexes.find(
      (i) => kept[i].requestId === entry.requestId || entry.isSidechain || kept[i].isSidechain,
    );
    if (dupIndex !== undefined) {
      if (shouldReplace(entry, kept[dupIndex])) kept[dupIndex] = entry;
      continue;
    }
    indexes.push(kept.length);
    kept.push(entry);
  }
  return kept;
}

interface FileCacheEntry {
  mtimeMs: number;
  size: number;
  entries: UsageEntry[];
}

const fileCache = new Map<string, FileCacheEntry>();

export function clearUsageFileCache(): void {
  fileCache.clear();
}

function sessionIdFromPath(filePath: string, projectDir: string): string {
  // projects/<project>/<session>.jsonl            -> <session>
  // projects/<project>/<session>/**/<file>.jsonl  -> <session>
  const rel = path.relative(projectDir, filePath);
  const [head] = rel.split(path.sep);
  return head.endsWith('.jsonl') ? head.slice(0, -'.jsonl'.length) : head;
}

export function loadUsageEntries(projectsDir: string = getProjectsDir()): LoadResult {
  const all: UsageEntry[] = [];
  let projectDirs: fs.Dirent[];
  try {
    projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch (err) {
    console.error('usage-engine: cannot read projects dir', projectsDir, err);
    return { entries: [], rawEntryCount: 0 };
  }
  for (const dirent of projectDirs) {
    if (!dirent.isDirectory()) continue;
    const projectDir = path.join(projectsDir, dirent.name);
    let files: string[];
    try {
      files = fs
        .readdirSync(projectDir, { recursive: true, encoding: 'utf-8' })
        .filter((f) => f.endsWith('.jsonl'));
    } catch (err) {
      console.error('usage-engine: cannot read project dir', projectDir, err);
      continue;
    }
    for (const rel of files) {
      const filePath = path.join(projectDir, rel);
      try {
        const stat = fs.statSync(filePath);
        const cached = fileCache.get(filePath);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
          all.push(...cached.entries);
          continue;
        }
        const sessionId = sessionIdFromPath(filePath, projectDir);
        const entries = parseUsageFile(
          fs.readFileSync(filePath, 'utf-8'),
          sessionId,
          dirent.name,
        );
        fileCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, entries });
        all.push(...entries);
      } catch (err) {
        console.error('usage-engine: failed to read', filePath, err);
      }
    }
  }
  const entries = dedupeEntries(all);
  return { entries, rawEntryCount: all.length };
}
