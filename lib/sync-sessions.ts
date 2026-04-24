import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './db';
import { getDb } from './db';
import { getProjectsDir } from './claude-home';
import { localDay } from './local-day';

const TOOL_CAP_MS = 10 * 60 * 1000; // 10 min — per source spec

// Claude pricing per 1M tokens (coarse — matches lib/claude-usage.ts)
const RATES: Record<string, { input: number; output: number }> = {
  opus: { input: 15, output: 75 },
  sonnet: { input: 3, output: 15 },
  haiku: { input: 0.25, output: 1.25 },
};
function rateFor(model: string) {
  const m = model.toLowerCase();
  if (m.includes('opus')) return RATES.opus;
  if (m.includes('haiku')) return RATES.haiku;
  return RATES.sonnet;
}

export interface SyncStats {
  sessionsSynced: number;
  sessionsSkipped: number;
  toolCalls: number;
  errors: number;
}

export interface SyncOpts {
  db?: DB;
  projectsDir?: string;
}

interface Accum {
  sessionId: string;
  cwd?: string;
  gitBranch?: string;
  model?: string;
  startedAt?: string;
  endedAt?: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  errorCount: number;
  rateLimitHit: number;
  stopReason?: string;
  costUsd: number;
  pendingTools: Map<string, { name: string; ts: string }>;
  toolRows: { tool_use_id: string; tool_name: string; ts: string; duration_ms: number | null; error: string | null }[];
  dayModelBuckets: Map<string, { input: number; output: number; cacheRead: number; cacheCreate: number }>;
}

function bucketKey(day: string, model: string) { return `${day}${model}`; }

function parseOne(raw: string, sessionIdFromFile: string): Accum {
  const acc: Accum = {
    sessionId: sessionIdFromFile,
    input: 0, output: 0, cacheRead: 0, cacheCreate: 0,
    errorCount: 0, rateLimitHit: 0, costUsd: 0,
    pendingTools: new Map(),
    toolRows: [],
    dayModelBuckets: new Map(),
  };

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }

    if (obj.sessionId && !acc.sessionId) acc.sessionId = obj.sessionId;
    if (obj.cwd && !acc.cwd) acc.cwd = obj.cwd;
    if (obj.gitBranch && !acc.gitBranch) acc.gitBranch = obj.gitBranch;

    const ts: string | undefined = obj.timestamp;
    if (ts && !acc.startedAt) acc.startedAt = ts;
    if (ts) acc.endedAt = ts;

    // `result` event — session end signal
    if (obj.type === 'result') {
      if (typeof obj.total_cost_usd === 'number') acc.costUsd = obj.total_cost_usd;
      if (obj.is_error) acc.errorCount++;
      if (obj.stop_reason) acc.stopReason = obj.stop_reason;
      continue;
    }

    const msg = obj.message;
    if (!msg) continue;

    if (msg.model && !acc.model) acc.model = msg.model;

    // Assistant — usage + tool_use blocks
    if (obj.type === 'assistant' && msg.usage) {
      const u = msg.usage;
      const inp = u.input_tokens || 0;
      const out = u.output_tokens || 0;
      const cr = u.cache_read_input_tokens || 0;
      const cc = u.cache_creation_input_tokens || 0;
      acc.input += inp; acc.output += out;
      acc.cacheRead += cr; acc.cacheCreate += cc;

      if (ts && acc.model) {
        const day = localDay(ts);
        const key = bucketKey(day, acc.model);
        const b = acc.dayModelBuckets.get(key) ?? { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
        b.input += inp; b.output += out; b.cacheRead += cr; b.cacheCreate += cc;
        acc.dayModelBuckets.set(key, b);
      }
    }

    // Walk content blocks for tool_use / tool_result
    const content = msg.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'tool_use' && block.id && ts) {
          acc.pendingTools.set(block.id, { name: block.name ?? 'unknown', ts });
        } else if (block?.type === 'tool_result' && block.tool_use_id) {
          const pending = acc.pendingTools.get(block.tool_use_id);
          if (pending && ts) {
            const dur = Date.parse(ts) - Date.parse(pending.ts);
            const capped = (dur < 0 || dur > TOOL_CAP_MS) ? null : dur;
            acc.toolRows.push({
              tool_use_id: block.tool_use_id,
              tool_name: pending.name,
              ts: pending.ts,
              duration_ms: capped,
              error: block.is_error ? String(block.content ?? '') : null,
            });
            acc.pendingTools.delete(block.tool_use_id);
          }
        }
      }
    }
  }

  // Orphans → rows with null duration
  for (const [id, p] of acc.pendingTools) {
    acc.toolRows.push({ tool_use_id: id, tool_name: p.name, ts: p.ts, duration_ms: null, error: null });
  }

  return acc;
}

/** One-shot sync over ~/.claude/projects/<proj>/<session>.jsonl */
export function syncSessions(opts: SyncOpts = {}): SyncStats {
  const db = opts.db ?? getDb();
  const projectsDir = opts.projectsDir ?? getProjectsDir();
  const stats: SyncStats = { sessionsSynced: 0, sessionsSkipped: 0, toolCalls: 0, errors: 0 };

  if (!fs.existsSync(projectsDir)) return stats;

  const upsertSession = db.prepare(`
    INSERT INTO sessions (
      session_id, source, cwd, git_branch, model, started_at, ended_at,
      input_tokens, output_tokens, cache_read_tokens, cache_create_tokens,
      total_tokens, effective_tokens, cost_usd, duration_ms,
      error_count, rate_limit_hit, stop_reason, title, synced_at
    ) VALUES (
      @session_id, 'ide', @cwd, @git_branch, @model, @started_at, @ended_at,
      @input_tokens, @output_tokens, @cache_read_tokens, @cache_create_tokens,
      @total_tokens, @effective_tokens, @cost_usd, @duration_ms,
      @error_count, @rate_limit_hit, @stop_reason, @title, @synced_at
    )
    ON CONFLICT(session_id) DO UPDATE SET
      cwd = excluded.cwd, git_branch = excluded.git_branch, model = excluded.model,
      started_at = excluded.started_at, ended_at = excluded.ended_at,
      input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
      cache_read_tokens = excluded.cache_read_tokens, cache_create_tokens = excluded.cache_create_tokens,
      total_tokens = excluded.total_tokens, effective_tokens = excluded.effective_tokens,
      cost_usd = excluded.cost_usd, duration_ms = excluded.duration_ms,
      error_count = excluded.error_count, rate_limit_hit = excluded.rate_limit_hit,
      stop_reason = excluded.stop_reason, title = excluded.title, synced_at = excluded.synced_at
  `);

  const deleteTools = db.prepare('DELETE FROM tool_calls WHERE session_id = ?');
  const insertTool = db.prepare(`
    INSERT OR REPLACE INTO tool_calls (session_id, tool_use_id, tool_name, ts, duration_ms, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const upsertUsage = db.prepare(`
    INSERT INTO token_usage (date, model, source, input_tokens, output_tokens, cache_read_tokens, cache_create_tokens)
    VALUES (?, ?, 'ide', ?, ?, ?, ?)
    ON CONFLICT(date, model, source) DO UPDATE SET
      input_tokens = token_usage.input_tokens + excluded.input_tokens,
      output_tokens = token_usage.output_tokens + excluded.output_tokens,
      cache_read_tokens = token_usage.cache_read_tokens + excluded.cache_read_tokens,
      cache_create_tokens = token_usage.cache_create_tokens + excluded.cache_create_tokens
  `);

  const getSyncedAt = db.prepare('SELECT synced_at, ended_at FROM sessions WHERE session_id = ?');

  const projDirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter(d => d.isDirectory());

  const runOne = db.transaction((fileAbs: string, sessionId: string) => {
    const raw = fs.readFileSync(fileAbs, 'utf8');
    const acc = parseOne(raw, sessionId);

    const totalTokens = acc.input + acc.output + acc.cacheRead + acc.cacheCreate;
    const effectiveTokens = acc.input + acc.output + acc.cacheCreate; // cache_read treated as free
    const r = acc.model ? rateFor(acc.model) : RATES.sonnet;
    const derivedCost = (acc.input + acc.cacheCreate) / 1e6 * r.input + (acc.output / 1e6) * r.output;
    const cost = acc.costUsd > 0 ? acc.costUsd : derivedCost;

    const startedMs = acc.startedAt ? Date.parse(acc.startedAt) : NaN;
    const endedMs = acc.endedAt ? Date.parse(acc.endedAt) : NaN;
    const durMs = Number.isFinite(startedMs) && Number.isFinite(endedMs) ? Math.max(0, endedMs - startedMs) : null;

    upsertSession.run({
      session_id: acc.sessionId,
      cwd: acc.cwd ?? null,
      git_branch: acc.gitBranch ?? null,
      model: acc.model ?? null,
      started_at: acc.startedAt ?? null,
      ended_at: acc.stopReason ? (acc.endedAt ?? null) : null, // only set when session actually ended
      input_tokens: acc.input,
      output_tokens: acc.output,
      cache_read_tokens: acc.cacheRead,
      cache_create_tokens: acc.cacheCreate,
      total_tokens: totalTokens,
      effective_tokens: effectiveTokens,
      cost_usd: cost,
      duration_ms: durMs,
      error_count: acc.errorCount,
      rate_limit_hit: acc.rateLimitHit,
      stop_reason: acc.stopReason ?? null,
      title: null,
      synced_at: new Date().toISOString(),
    });

    deleteTools.run(acc.sessionId);
    for (const t of acc.toolRows) {
      insertTool.run(acc.sessionId, t.tool_use_id, t.tool_name, t.ts, t.duration_ms, t.error);
      stats.toolCalls++;
    }

    for (const [key, b] of acc.dayModelBuckets) {
      const [day, model] = key.split('');
      upsertUsage.run(day, model, b.input, b.output, b.cacheRead, b.cacheCreate);
    }
  });

  for (const d of projDirs) {
    const projDir = path.join(projectsDir, d.name);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(projDir, { withFileTypes: true });
    } catch { continue; }

    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      const fileAbs = path.join(projDir, e.name);
      const sessionId = e.name.replace(/\.jsonl$/, '');

      let mtimeIso: string;
      try { mtimeIso = fs.statSync(fileAbs).mtime.toISOString(); }
      catch { stats.errors++; continue; }

      const prev = getSyncedAt.get(sessionId) as { synced_at: string | null; ended_at: string | null } | undefined;
      const canSkip = prev?.synced_at && prev.ended_at && mtimeIso <= prev.synced_at;
      if (canSkip) { stats.sessionsSkipped++; continue; }

      try {
        runOne(fileAbs, sessionId);
        stats.sessionsSynced++;
      } catch (err) {
        stats.errors++;
        // eslint-disable-next-line no-console
        console.error('[sync] failed', fileAbs, err);
      }
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Boot loop — HMR-safe, unref'd, runs at boot + every 120 s.
// ---------------------------------------------------------------------------

const LOOP_SYM = Symbol.for('ccd.syncStarted');

interface LoopState { handle: NodeJS.Timeout; startedAt: number; }

function getLoopState(): LoopState | undefined {
  return (globalThis as any)[LOOP_SYM];
}

function setLoopState(s: LoopState) {
  (globalThis as any)[LOOP_SYM] = s;
}

export function _syncLoopStarted(): boolean {
  return !!getLoopState();
}

export interface StartSyncLoopOpts {
  intervalMs?: number;
  runNow?: boolean;
}

export function startSyncLoop(opts: StartSyncLoopOpts = {}): NodeJS.Timeout {
  const existing = getLoopState();
  if (existing) return existing.handle;

  const intervalMs = opts.intervalMs ?? 120_000;
  const runNow = opts.runNow ?? true;

  if (runNow) {
    try { syncSessions(); } catch (err) { console.error('[sync] boot run failed', err); }
  }

  const handle = setInterval(() => {
    try { syncSessions(); } catch (err) { console.error('[sync] tick failed', err); }
  }, intervalMs);
  handle.unref(); // don't block process exit

  setLoopState({ handle, startedAt: Date.now() });
  return handle;
}
