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
import { calculateCost, fastMultiplier, findPricing, type PricingResult, type TokenCounts } from './litellm-pricing';
import { localDay } from './local-day';

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

export type Granularity = 'day' | 'week' | 'month';

export interface UsageReportOptions {
  /** YYYY-MM-DD inclusive, local time */
  since?: string;
  /** YYYY-MM-DD inclusive, local time */
  until?: string;
  granularity?: Granularity;
  /** exact project dir names */
  projects?: string[];
  /** display-model ids; "unknown" matches entries without a model */
  models?: string[];
}

export interface TokenBreakdown extends TokenCounts {
  totalTokens: number;
  cost: number;
}

export interface UsageBucket extends TokenBreakdown {
  /** YYYY-MM-DD (day), week-start YYYY-MM-DD (week), or YYYY-MM (month) */
  period: string;
  byModel: Record<string, TokenBreakdown>;
}

export interface SessionUsage extends TokenBreakdown {
  sessionId: string;
  projectName: string;
  models: string[];
  messageCount: number;
  startedAt: string;
  lastActivityAt: string;
  byModel: Record<string, TokenBreakdown>;
}

export interface UsageReport {
  totals: TokenBreakdown;
  buckets: UsageBucket[];
  byModel: Record<string, TokenBreakdown>;
  byProject: Record<string, TokenBreakdown>;
  sessions: SessionUsage[];
  meta: {
    granularity: Granularity;
    rawEntryCount: number;
    dedupedEntryCount: number;
    /** distinct values across ALL entries (pre-filter) so the UI can render filter options */
    allModels: string[];
    allProjects: string[];
    pricingSource: 'live' | 'fallback';
  };
}

export function weekStart(dayKey: string): string {
  // ISO week, Monday start. Computed in UTC from the day key to avoid DST edges.
  const d = new Date(`${dayKey}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function periodKey(dayKey: string, granularity: Granularity): string {
  if (granularity === 'month') return dayKey.slice(0, 7);
  if (granularity === 'week') return weekStart(dayKey);
  return dayKey;
}

function emptyBreakdown(): TokenBreakdown {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    cost: 0,
  };
}

function addTo(target: TokenBreakdown, e: UsageEntry, cost: number): void {
  target.inputTokens += e.inputTokens;
  target.outputTokens += e.outputTokens;
  target.cacheCreationTokens += e.cacheCreationTokens;
  target.cacheReadTokens += e.cacheReadTokens;
  target.totalTokens += tokenTotal(e);
  target.cost += cost;
}

export function buildUsageReport(
  load: LoadResult,
  pricing: PricingResult,
  opts: UsageReportOptions = {},
): UsageReport {
  const granularity = opts.granularity ?? 'day';
  const warnedModels = new Set<string>();
  const allModels = new Set<string>();
  const allProjects = new Set<string>();
  const totals = emptyBreakdown();
  const buckets = new Map<string, UsageBucket>();
  const byModel: Record<string, TokenBreakdown> = {};
  const byProject: Record<string, TokenBreakdown> = {};
  const sessions = new Map<string, SessionUsage>();

  for (const e of load.entries) {
    const displayModel = e.model ? (e.isFast ? `${e.model}-fast` : e.model) : 'unknown';
    const day = localDay(e.timestampMs);
    allModels.add(displayModel);
    allProjects.add(e.projectName);
    if (opts.since && day < opts.since) continue;
    if (opts.until && day > opts.until) continue;
    if (opts.projects?.length && !opts.projects.includes(e.projectName)) continue;
    if (opts.models?.length && !opts.models.includes(displayModel)) continue;

    const p = e.model ? findPricing(pricing.map, e.model) : undefined;
    if (e.model && !p && !warnedModels.has(e.model)) {
      warnedModels.add(e.model);
      console.error(`usage-engine: no pricing for model ${e.model}; costing 0`);
    }
    const cost = p ? calculateCost(p, e, e.isFast ? fastMultiplier(e.model!) : 1) : 0;

    addTo(totals, e, cost);

    const pk = periodKey(day, granularity);
    let bucket = buckets.get(pk);
    if (!bucket) {
      bucket = { period: pk, ...emptyBreakdown(), byModel: {} };
      buckets.set(pk, bucket);
    }
    addTo(bucket, e, cost);
    addTo((bucket.byModel[displayModel] ??= emptyBreakdown()), e, cost);

    addTo((byModel[displayModel] ??= emptyBreakdown()), e, cost);
    addTo((byProject[e.projectName] ??= emptyBreakdown()), e, cost);

    const sk = `${e.projectName}/${e.sessionId}`;
    const iso = new Date(e.timestampMs).toISOString();
    let sess = sessions.get(sk);
    if (!sess) {
      sess = {
        sessionId: e.sessionId,
        projectName: e.projectName,
        models: [],
        messageCount: 0,
        startedAt: iso,
        lastActivityAt: iso,
        ...emptyBreakdown(),
        byModel: {},
      };
      sessions.set(sk, sess);
    }
    addTo(sess, e, cost);
    addTo((sess.byModel[displayModel] ??= emptyBreakdown()), e, cost);
    sess.messageCount += 1;
    if (iso < sess.startedAt) sess.startedAt = iso;
    if (iso > sess.lastActivityAt) sess.lastActivityAt = iso;
    if (!sess.models.includes(displayModel)) sess.models.push(displayModel);
  }

  return {
    totals,
    buckets: [...buckets.values()].sort((a, b) => a.period.localeCompare(b.period)),
    byModel,
    byProject,
    sessions: [...sessions.values()].sort((a, b) =>
      b.lastActivityAt.localeCompare(a.lastActivityAt),
    ),
    meta: {
      granularity,
      rawEntryCount: load.rawEntryCount,
      dedupedEntryCount: load.entries.length,
      allModels: [...allModels].sort(),
      allProjects: [...allProjects].sort(),
      pricingSource: pricing.source,
    },
  };
}
