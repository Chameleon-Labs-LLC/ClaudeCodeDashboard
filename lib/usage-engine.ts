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
import type { DB } from './db';
import {
  PRIMARY_SOURCE_LABEL,
  getSourcesPath,
  loadSources,
  resolveSourceRoot,
} from './usage-sources';
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
  /** which .claude root this entry came from (source label) */
  source: string;
}

export interface LoadResult {
  entries: UsageEntry[];
  /** entry count before deduplication */
  rawEntryCount: number;
  /** labels of enabled sources whose projects dir could not be read */
  unreachableSources: string[];
}

const USAGE_MARKER = '"usage":{';

export function parseUsageFile(
  content: string,
  sessionId: string,
  projectName: string,
  source: string = PRIMARY_SOURCE_LABEL,
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
      source,
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

/** push(...items) overflows the call stack past ~125k elements; loop instead. */
function appendAll<T>(target: T[], items: T[]): void {
  for (const item of items) target.push(item);
}

/** SQLite tier of the file cache: survives server restarts and dev-mode module
 *  reloads, which wipe the in-memory Map. All failures degrade to a re-parse. */
function sqliteCacheGet(db: DB, filePath: string, mtimeMs: number, size: number): UsageEntry[] | undefined {
  try {
    const row = db
      .prepare('SELECT mtime_ms, size, entries_json FROM usage_file_cache WHERE path = ?')
      .get(filePath) as { mtime_ms: number; size: number; entries_json: string } | undefined;
    if (!row || row.mtime_ms !== mtimeMs || row.size !== size) return undefined;
    return JSON.parse(row.entries_json) as UsageEntry[];
  } catch (err) {
    console.error('usage-engine: sqlite cache read failed for', filePath, err);
    return undefined;
  }
}

function sqliteCachePut(
  db: DB,
  rows: Array<{ path: string; mtimeMs: number; size: number; entries: UsageEntry[] }>,
): void {
  if (!rows.length) return;
  try {
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO usage_file_cache (path, mtime_ms, size, entries_json) VALUES (?, ?, ?, ?)',
    );
    db.transaction(() => {
      for (const r of rows) stmt.run(r.path, r.mtimeMs, r.size, JSON.stringify(r.entries));
    })();
  } catch (err) {
    console.error('usage-engine: sqlite cache write failed', err);
  }
}

function sessionIdFromPath(filePath: string, projectDir: string): string {
  // projects/<project>/<session>.jsonl            -> <session>
  // projects/<project>/<session>/**/<file>.jsonl  -> <session>
  const rel = path.relative(projectDir, filePath);
  const [head] = rel.split(path.sep);
  return head.endsWith('.jsonl') ? head.slice(0, -'.jsonl'.length) : head;
}

export function loadUsageEntries(
  projectsDir: string = getProjectsDir(),
  source: string = PRIMARY_SOURCE_LABEL,
  db?: DB | null,
): LoadResult {
  const all: UsageEntry[] = [];
  const pendingWrites: Array<{ path: string; mtimeMs: number; size: number; entries: UsageEntry[] }> = [];
  let projectDirs: fs.Dirent[];
  try {
    projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch (err) {
    console.error('usage-engine: cannot read projects dir', projectsDir, err);
    return { entries: [], rawEntryCount: 0, unreachableSources: [] };
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
          appendAll(all, cached.entries);
          continue;
        }
        if (db) {
          const persisted = sqliteCacheGet(db, filePath, stat.mtimeMs, stat.size);
          if (persisted) {
            fileCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, entries: persisted });
            appendAll(all, persisted);
            continue;
          }
        }
        const sessionId = sessionIdFromPath(filePath, projectDir);
        const entries = parseUsageFile(
          fs.readFileSync(filePath, 'utf-8'),
          sessionId,
          dirent.name,
          source,
        );
        fileCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, entries });
        if (db) pendingWrites.push({ path: filePath, mtimeMs: stat.mtimeMs, size: stat.size, entries });
        appendAll(all, entries);
      } catch (err) {
        console.error('usage-engine: failed to read', filePath, err);
      }
    }
  }
  if (db) sqliteCachePut(db, pendingWrites);
  const entries = dedupeEntries(all);
  return { entries, rawEntryCount: all.length, unreachableSources: [] };
}

export interface LoadAllOptions {
  /** test override; defaults to the primary CLAUDE_HOME projects dir */
  primaryProjectsDir?: string;
  /** test override; defaults to ~/.claude/ccd/sources.json */
  sourcesFile?: string;
  /** persistent parse cache; omit/null for in-memory caching only */
  db?: DB | null;
  /** snapshot age that triggers a background source re-sweep (default 15 min) */
  sourceTtlMs?: number;
}

const DEFAULT_SOURCE_TTL_MS = 15 * 60 * 1000;

interface SourceSnapshot {
  sweptAtMs: number;
  rawEntryCount: number;
  entries: UsageEntry[];
}

function readSourceSnapshot(db: DB, label: string): SourceSnapshot | undefined {
  try {
    const row = db
      .prepare('SELECT swept_at_ms, raw_entry_count, entries_json FROM usage_source_snapshot WHERE label = ?')
      .get(label) as { swept_at_ms: number; raw_entry_count: number; entries_json: string } | undefined;
    if (!row) return undefined;
    return {
      sweptAtMs: row.swept_at_ms,
      rawEntryCount: row.raw_entry_count,
      entries: JSON.parse(row.entries_json) as UsageEntry[],
    };
  } catch (err) {
    console.error('usage-engine: source snapshot read failed for', label, err);
    return undefined;
  }
}

function writeSourceSnapshot(db: DB, label: string, result: { entries: UsageEntry[]; rawEntryCount: number }): void {
  try {
    db.prepare(
      'INSERT OR REPLACE INTO usage_source_snapshot (label, swept_at_ms, raw_entry_count, entries_json) VALUES (?, ?, ?, ?)',
    ).run(label, Date.now(), result.rawEntryCount, JSON.stringify(result.entries));
  } catch (err) {
    console.error('usage-engine: source snapshot write failed for', label, err);
  }
}

/** Sweep a source's projects dir; undefined when the root is unreachable. */
function sweepSource(
  source: { label: string },
  projectsDir: string,
  db?: DB | null,
): LoadResult | undefined {
  try {
    if (!fs.statSync(projectsDir).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  return loadUsageEntries(projectsDir, source.label, db);
}

const refreshingSources = new Set<string>();

/** Load usage entries from the primary root plus every enabled registered source. */
export function loadAllUsageEntries(opts: LoadAllOptions = {}): LoadResult {
  const all: UsageEntry[] = [];
  let rawEntryCount = 0;
  const unreachableSources: string[] = [];
  const ttlMs = opts.sourceTtlMs ?? DEFAULT_SOURCE_TTL_MS;

  const primary = loadUsageEntries(
    opts.primaryProjectsDir ?? getProjectsDir(),
    PRIMARY_SOURCE_LABEL,
    opts.db,
  );
  appendAll(all, primary.entries);
  rawEntryCount += primary.rawEntryCount;

  for (const source of loadSources(opts.sourcesFile ?? getSourcesPath())) {
    if (!source.enabled) continue;
    const projectsDir = path.join(resolveSourceRoot(source), 'projects');

    // Sources can sit on slow filesystems (\\wsl.localhost 9P: ~45s per
    // metadata sweep), so requests never sweep them directly: serve the
    // snapshot and refresh it in the background once it exceeds the TTL.
    const snapshot = opts.db ? readSourceSnapshot(opts.db, source.label) : undefined;
    if (snapshot) {
      appendAll(all, snapshot.entries);
      rawEntryCount += snapshot.rawEntryCount;
      if (Date.now() - snapshot.sweptAtMs > ttlMs && !refreshingSources.has(source.label)) {
        refreshingSources.add(source.label);
        const db = opts.db;
        setImmediate(() => {
          try {
            const fresh = sweepSource(source, projectsDir, db);
            if (fresh) writeSourceSnapshot(db!, source.label, fresh);
          } finally {
            refreshingSources.delete(source.label);
          }
        });
      }
      continue;
    }

    const result = sweepSource(source, projectsDir, opts.db);
    if (!result) {
      unreachableSources.push(source.label);
      continue;
    }
    if (opts.db) writeSourceSnapshot(opts.db, source.label, result);
    appendAll(all, result.entries);
    rawEntryCount += result.rawEntryCount;
  }

  // global dedup: a copied/rsynced root must not double-count
  return { entries: dedupeEntries(all), rawEntryCount, unreachableSources };
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
  /** source labels; matches UsageEntry.source */
  sources?: string[];
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
  bySource: Record<string, TokenBreakdown>;
  sessions: SessionUsage[];
  meta: {
    granularity: Granularity;
    rawEntryCount: number;
    dedupedEntryCount: number;
    /** distinct values across ALL entries (pre-filter) so the UI can render filter options */
    allModels: string[];
    allProjects: string[];
    allSources: string[];
    unreachableSources: string[];
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
  const allSources = new Set<string>();
  const totals = emptyBreakdown();
  const buckets = new Map<string, UsageBucket>();
  const byModel: Record<string, TokenBreakdown> = {};
  const byProject: Record<string, TokenBreakdown> = {};
  const bySource: Record<string, TokenBreakdown> = {};
  const sessions = new Map<string, SessionUsage>();

  for (const e of load.entries) {
    const displayModel = e.model ? (e.isFast ? `${e.model}-fast` : e.model) : 'unknown';
    const day = localDay(e.timestampMs);
    allModels.add(displayModel);
    allProjects.add(e.projectName);
    allSources.add(e.source);
    if (opts.since && day < opts.since) continue;
    if (opts.until && day > opts.until) continue;
    if (opts.projects?.length && !opts.projects.includes(e.projectName)) continue;
    if (opts.models?.length && !opts.models.includes(displayModel)) continue;
    if (opts.sources?.length && !opts.sources.includes(e.source)) continue;

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
    addTo((bySource[e.source] ??= emptyBreakdown()), e, cost);

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
    bySource,
    sessions: [...sessions.values()].sort((a, b) =>
      b.lastActivityAt.localeCompare(a.lastActivityAt),
    ),
    meta: {
      granularity,
      rawEntryCount: load.rawEntryCount,
      dedupedEntryCount: load.entries.length,
      allModels: [...allModels].sort(),
      allProjects: [...allProjects].sort(),
      allSources: [...allSources].sort(),
      unreachableSources: load.unreachableSources,
      pricingSource: pricing.source,
    },
  };
}
