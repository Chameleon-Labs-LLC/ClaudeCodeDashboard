# Phase 3 — Six Observability Panels

**Goal:** Ship the `/dashboard/observability` page with six production-grade data panels backed by the SQLite layer from Phase 1 and the OTEL ingest layer from Phase 2. Zero new npm dependencies — SVG sparklines and CSS bars only.

**Architecture:** Seven new API routes query `better-sqlite3` prepared statements directly. Six client components consume those routes and render pure SVG/CSS visualisations. One new server-component page composes them. One shared `CollapsibleSection` component gates each panel group. The sidebar gains one new nav entry. All routes accept `?range=today|7d|30d` (default `7d`); day-bucketing uses local-time strings already inserted by Phase 1's sync.

**Tech Stack (no additions to `package.json`):** Next.js 16 App Router, TypeScript, Tailwind CSS (`brand-navy-dark`, `brand-cyan`, `chameleon-*` tokens from `tailwind.config.ts`), `lucide-react`, `better-sqlite3` (installed in Phase 1), `useAutoRefresh` hook (already in `hooks/use-auto-refresh.ts`).

**Parallelism contract:**
- Task block A (sequential): all API routes + shared component + sidebar + page scaffold — must land before block B.
- Task block B `[P]`: six panel components, each self-contained. Dispatch all six in one orchestrator message after block A is merged.

**Phase prerequisite check:** Before starting, verify:
```bash
npx tsc --noEmit   # must pass (Phase 1+2 clean)
node -e "require('better-sqlite3')"  # must not throw
```

---

## Existing conventions (discovered from codebase)

| Convention | Source |
|---|---|
| All API routes return `NextResponse.json(...)` | `app/api/stats/route.ts:4` |
| Data layer functions live in `lib/` | `lib/claude-data.ts`, `lib/claude-usage.ts` |
| Client components use `useAutoRefresh` + `useState` | `app/dashboard/page.tsx:11-28` |
| DB accessed via `better-sqlite3` prepared stmts | Phase 1 contract (`lib/db.ts`) |
| Brand tokens: `brand-navy`, `brand-navy-dark`, `brand-navy-light`, `brand-cyan` | `tailwind.config.ts:15-17` |
| Status colors: use `chameleon-red`, `chameleon-amber`, `chameleon-orange`, `chameleon-green` | `tailwind.config.ts:18-26` |
| Sidebar nav items array in `components/layout/sidebar.tsx:6` — append new entry | `sidebar.tsx:6-19` |
| Empty states must be instructional, never blank | CLAUDE.md convention |
| Loading: `animate-pulse` text or skeleton divs, never spinner-only | `app/dashboard/page.tsx:24-28` |

---

## Schema reference (Phase 1 output — do not recreate)

```sql
-- sessions: session_id PK, cwd, model, started_at, ended_at,
--   input_tokens, output_tokens, cache_read_tokens, cache_create_tokens,
--   total_tokens, effective_tokens, cost_usd, duration_ms,
--   error_count, rate_limit_hit, stop_reason, title, synced_at

-- tool_calls: session_id, tool_use_id PK, tool_name, ts,
--   duration_ms (nullable), error (nullable)
--   INDEX on (tool_name, ts)

-- token_usage: date, model, source, input_tokens, output_tokens,
--   cache_read_tokens, cache_create_tokens
--   PRIMARY KEY (date, model, source)

-- otel_events: event_name, session_id, timestamp,
--   tool_name, tool_success, tool_duration_ms, tool_error,
--   error_message, status_code, attempt_count,
--   mcp_server_name, mcp_tool_name,
--   hook_execution_start/complete fields, received_at

-- otel_metrics: metric_name, metric_type, value, session_id, model, timestamp
```

---

## Task block A — API routes, shared component, sidebar, page scaffold

All tasks in this block are **sequential**. Each step is 2-5 minutes.

### A-0: Create `lib/db.ts` accessor (if Phase 1 didn't export a singleton)

- [ ] **Verify** that `lib/db.ts` exports `function getDb(): Database` using `better-sqlite3` in WAL mode. If the function exists, skip this step. If not, create it:

```typescript
// lib/db.ts
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const dbPath = process.env.SQLITE_DB_PATH
    || path.join(os.homedir(), '.claude', 'dashboard.db');
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  return _db;
}
```

Expected output: `npx tsc --noEmit` still passes.

Commit: `feat(phase-3): ensure db singleton in lib/db.ts`

---

### A-1: Shared helper `lib/observability-helpers.ts`

- [ ] Create `D:\Documents\Code\GitHub\ClaudeCodeDashboard\lib\observability-helpers.ts`

This module provides two things every observability API route needs: range-to-date-string conversion (local-time) and a percentile calculator over a sorted numeric array.

```typescript
// lib/observability-helpers.ts

/**
 * Convert a ?range= param to a local-date-string cutoff (YYYY-MM-DD).
 * Uses Intl to get local date — matches Phase 1's bucketing strategy.
 */
export function rangeToLocalDateCutoff(range: string | null): string {
  const now = new Date();
  const localDate = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { // en-CA gives YYYY-MM-DD
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);

  if (range === 'today') {
    return localDate(now);
  }
  if (range === '30d') {
    const d = new Date(now);
    d.setDate(d.getDate() - 29);
    return localDate(d);
  }
  // default: 7d
  const d = new Date(now);
  d.setDate(d.getDate() - 6);
  return localDate(d);
}

/**
 * Compute percentile from a pre-sorted ascending numeric array.
 * Returns null for empty arrays.
 */
export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const idx = Math.ceil((p / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.max(0, Math.min(idx, sortedAsc.length - 1))];
}

/**
 * Parse mcp__<server>__<tool> tool_name into { server, tool } or null.
 */
export function parseMcpToolName(toolName: string): { server: string; tool: string } | null {
  const m = toolName.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
  if (!m) return null;
  return { server: m[1], tool: m[2] };
}
```

- [ ] Run `npx tsc --noEmit`. Fix any type errors.

Commit: `feat(phase-3): add observability-helpers lib`

---

### A-2: API route — `GET /api/mcp`

- [ ] Create `D:\Documents\Code\GitHub\ClaudeCodeDashboard\app\api\mcp\route.ts`

**SQL strategy:** Three source tiers merged client-side:
1. `otel_events` rows where `mcp_server_name IS NOT NULL` (precise OTEL with `OTEL_LOG_TOOL_DETAILS=1`).
2. `tool_calls` rows where `tool_name LIKE 'mcp__%'` (JSONL-parsed, generic).
3. Legacy `tool_calls` rows with pre-generic tool names (same `mcp__` prefix still applies).

```typescript
// app/api/mcp/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { rangeToLocalDateCutoff, percentile } from '@/lib/observability-helpers';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get('range');
  const cutoff = rangeToLocalDateCutoff(range);
  const db = getDb();

  // Source 1: OTEL events with explicit mcp_server_name
  const otelRows = db.prepare(`
    SELECT
      mcp_server_name AS server,
      COUNT(*) AS calls,
      AVG(tool_duration_ms) AS avg_ms,
      SUM(CASE WHEN tool_success = 0 THEN 1 ELSE 0 END) AS errors
    FROM otel_events
    WHERE event_name = 'tool_result'
      AND mcp_server_name IS NOT NULL
      AND DATE(timestamp, 'localtime') >= ?
    GROUP BY mcp_server_name
  `).all(cutoff) as Array<{ server: string; calls: number; avg_ms: number | null; errors: number }>;

  // Source 2: tool_calls rows with mcp__ prefix (for p95 we need raw durations)
  const jsonlRows = db.prepare(`
    SELECT
      tool_name,
      duration_ms
    FROM tool_calls
    WHERE tool_name LIKE 'mcp__%'
      AND DATE(ts, 'localtime') >= ?
    ORDER BY tool_name
  `).all(cutoff) as Array<{ tool_name: string; duration_ms: number | null }>;

  // Group jsonl rows by server
  const jsonlByServer = new Map<string, number[]>();
  for (const row of jsonlRows) {
    const m = row.tool_name.match(/^mcp__([^_]+)__/);
    if (!m) continue;
    const server = m[1];
    if (!jsonlByServer.has(server)) jsonlByServer.set(server, []);
    if (row.duration_ms != null) jsonlByServer.get(server)!.push(row.duration_ms);
  }

  // Merge: OTEL rows take precedence; add any JSONL-only servers
  const merged = new Map<string, { calls: number; durations: number[]; errors: number }>();

  for (const row of otelRows) {
    merged.set(row.server, {
      calls: row.calls,
      durations: [], // we'll fetch per-tool durations in the /tools sub-route
      errors: row.errors,
    });
  }

  for (const [server, durations] of jsonlByServer.entries()) {
    if (!merged.has(server)) {
      merged.set(server, { calls: durations.length, durations, errors: 0 });
    }
  }

  // Fetch per-server raw durations from OTEL for p95 calc
  const otelDurationRows = db.prepare(`
    SELECT mcp_server_name AS server, tool_duration_ms AS ms
    FROM otel_events
    WHERE event_name = 'tool_result'
      AND mcp_server_name IS NOT NULL
      AND tool_duration_ms IS NOT NULL
      AND DATE(timestamp, 'localtime') >= ?
    ORDER BY mcp_server_name, tool_duration_ms
  `).all(cutoff) as Array<{ server: string; ms: number }>;

  const otelDurationsByServer = new Map<string, number[]>();
  for (const r of otelDurationRows) {
    if (!otelDurationsByServer.has(r.server)) otelDurationsByServer.set(r.server, []);
    otelDurationsByServer.get(r.server)!.push(r.ms);
  }

  const servers = Array.from(merged.entries()).map(([server, data]) => {
    const durations = (otelDurationsByServer.get(server) || data.durations).sort((a, b) => a - b);
    const p95ms = percentile(durations, 95);
    const avgMs = durations.length > 0
      ? durations.reduce((s, v) => s + v, 0) / durations.length
      : null;
    return {
      server,
      calls: data.calls,
      errors: data.errors,
      errorRate: data.calls > 0 ? data.errors / data.calls : 0,
      avgMs: avgMs != null ? Math.round(avgMs) : null,
      p95Ms: p95ms != null ? Math.round(p95ms) : null,
    };
  }).sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0));

  return NextResponse.json({ servers, range: range ?? '7d', cutoff });
}
```

- [ ] Manual smoke test: `curl "http://localhost:3000/api/mcp?range=7d"` — expect `{ servers: [...], range: "7d", cutoff: "YYYY-MM-DD" }`. Empty `servers` array is valid when no MCP data exists.

Commit: `feat(phase-3): GET /api/mcp list endpoint`

---

### A-3: API route — `GET /api/mcp/[server]/tools`

- [ ] Create `D:\Documents\Code\GitHub\ClaudeCodeDashboard\app\api\mcp\[server]\tools\route.ts`

```typescript
// app/api/mcp/[server]/tools/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { rangeToLocalDateCutoff, percentile, parseMcpToolName } from '@/lib/observability-helpers';

export async function GET(
  request: Request,
  { params }: { params: { server: string } }
) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get('range');
  const cutoff = rangeToLocalDateCutoff(range);
  const server = decodeURIComponent(params.server);
  const db = getDb();

  // Source 1: OTEL events with mcp_server_name + mcp_tool_name (highest fidelity)
  const otelRows = db.prepare(`
    SELECT
      mcp_tool_name AS tool,
      tool_duration_ms AS ms,
      tool_success,
      tool_error
    FROM otel_events
    WHERE event_name = 'tool_result'
      AND mcp_server_name = ?
      AND DATE(timestamp, 'localtime') >= ?
    ORDER BY mcp_tool_name, tool_duration_ms
  `).all(server, cutoff) as Array<{
    tool: string;
    ms: number | null;
    tool_success: number | null;
    tool_error: string | null;
  }>;

  // Source 2: tool_calls with mcp__<server>__<tool> naming
  const jsonlRows = db.prepare(`
    SELECT
      tool_name,
      duration_ms,
      error
    FROM tool_calls
    WHERE tool_name LIKE ?
      AND DATE(ts, 'localtime') >= ?
    ORDER BY tool_name, duration_ms
  `).all(`mcp__${server}__%`, cutoff) as Array<{
    tool_name: string;
    duration_ms: number | null;
    error: string | null;
  }>;

  // Group all rows by tool name
  interface ToolBucket { durations: number[]; errors: number; calls: number }
  const toolMap = new Map<string, ToolBucket>();

  const ensure = (tool: string) => {
    if (!toolMap.has(tool)) toolMap.set(tool, { durations: [], errors: 0, calls: 0 });
    return toolMap.get(tool)!;
  };

  for (const r of otelRows) {
    if (!r.tool) continue;
    const b = ensure(r.tool);
    b.calls++;
    if (r.ms != null) b.durations.push(r.ms);
    if (r.tool_success === 0 || r.tool_error) b.errors++;
  }

  for (const r of jsonlRows) {
    const parsed = parseMcpToolName(r.tool_name);
    if (!parsed) continue;
    const b = ensure(parsed.tool);
    b.calls++;
    if (r.duration_ms != null) b.durations.push(r.duration_ms);
    if (r.error) b.errors++;
  }

  const tools = Array.from(toolMap.entries()).map(([tool, b]) => {
    const sorted = b.durations.sort((a, c) => a - c);
    return {
      tool,
      calls: b.calls,
      errors: b.errors,
      errorRate: b.calls > 0 ? b.errors / b.calls : 0,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      maxMs: sorted.length > 0 ? sorted[sorted.length - 1] : null,
    };
  }).sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0));

  return NextResponse.json({ server, tools, cutoff });
}
```

- [ ] Smoke test: `curl "http://localhost:3000/api/mcp/filesystem/tools?range=7d"` — expect `{ server: "filesystem", tools: [...] }`.

Commit: `feat(phase-3): GET /api/mcp/[server]/tools endpoint`

---

### A-4: API route — `GET /api/usage/cache`

- [ ] Create `D:\Documents\Code\GitHub\ClaudeCodeDashboard\app\api\usage\cache\route.ts`

```typescript
// app/api/usage/cache/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { rangeToLocalDateCutoff } from '@/lib/observability-helpers';

export interface CacheDay {
  date: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  hitRate: number | null;   // null when billableTokens < 1
  billableTokens: number;
  lowSample: boolean;       // true when billableTokens < 10_000
}

export interface CacheEfficiencyResponse {
  overallHitRate: number | null;
  overallBillableTokens: number;
  lowSample: boolean;
  daily: CacheDay[];
  range: string;
  cutoff: string;
}

const LOW_SAMPLE_THRESHOLD = 10_000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get('range');
  const cutoff = rangeToLocalDateCutoff(range);
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      date,
      SUM(input_tokens)        AS input_tokens,
      SUM(cache_read_tokens)   AS cache_read_tokens,
      SUM(cache_create_tokens) AS cache_create_tokens
    FROM token_usage
    WHERE date >= ?
    GROUP BY date
    ORDER BY date ASC
  `).all(cutoff) as Array<{
    date: string;
    input_tokens: number;
    cache_read_tokens: number;
    cache_create_tokens: number;
  }>;

  let totalInput = 0, totalRead = 0, totalCreate = 0;

  const daily: CacheDay[] = rows.map(r => {
    const inp = r.input_tokens ?? 0;
    const read = r.cache_read_tokens ?? 0;
    const create = r.cache_create_tokens ?? 0;
    const billable = inp + read + create;
    const hitRate = billable > 0 ? read / billable : null;
    totalInput += inp;
    totalRead += read;
    totalCreate += create;
    return {
      date: r.date,
      inputTokens: inp,
      cacheReadTokens: read,
      cacheCreateTokens: create,
      hitRate,
      billableTokens: billable,
      lowSample: billable < LOW_SAMPLE_THRESHOLD,
    };
  });

  const totalBillable = totalInput + totalRead + totalCreate;
  const overallHitRate = totalBillable > 0 ? totalRead / totalBillable : null;

  const response: CacheEfficiencyResponse = {
    overallHitRate,
    overallBillableTokens: totalBillable,
    lowSample: totalBillable < LOW_SAMPLE_THRESHOLD,
    daily,
    range: range ?? '7d',
    cutoff,
  };

  return NextResponse.json(response);
}
```

- [ ] Smoke test: `curl "http://localhost:3000/api/usage/cache?range=7d"` — expect JSON with `overallHitRate`, `daily`, `lowSample`.

Commit: `feat(phase-3): GET /api/usage/cache endpoint`

---

### A-5: API route — `GET /api/sessions/outcomes`

- [ ] Create `D:\Documents\Code\GitHub\ClaudeCodeDashboard\app\api\sessions\outcomes\route.ts`

**Priority order (mutually exclusive):** `errored > rate_limited > truncated > unfinished > ok`. A session is classified by the first matching condition.

```typescript
// app/api/sessions/outcomes/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { rangeToLocalDateCutoff } from '@/lib/observability-helpers';

export interface OutcomeDay {
  date: string;
  errored: number;
  rateLimited: number;
  truncated: number;
  unfinished: number;
  ok: number;
  total: number;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get('range');
  const cutoff = rangeToLocalDateCutoff(range);
  const db = getDb();

  // Phase 1 schema: sessions.error_count, sessions.rate_limit_hit,
  // sessions.stop_reason ('end_turn'|'max_tokens'|null), sessions.ended_at (null = unfinished)
  const rows = db.prepare(`
    SELECT
      DATE(started_at, 'localtime') AS date,
      CASE
        WHEN error_count > 0                          THEN 'errored'
        WHEN rate_limit_hit = 1                       THEN 'rate_limited'
        WHEN stop_reason = 'max_tokens'               THEN 'truncated'
        WHEN ended_at IS NULL                         THEN 'unfinished'
        ELSE                                               'ok'
      END AS outcome
    FROM sessions
    WHERE DATE(started_at, 'localtime') >= ?
    ORDER BY date ASC
  `).all(cutoff) as Array<{ date: string; outcome: string }>;

  const dayMap = new Map<string, OutcomeDay>();
  const ensure = (date: string): OutcomeDay => {
    if (!dayMap.has(date)) {
      dayMap.set(date, { date, errored: 0, rateLimited: 0, truncated: 0, unfinished: 0, ok: 0, total: 0 });
    }
    return dayMap.get(date)!;
  };

  for (const r of rows) {
    const d = ensure(r.date);
    d.total++;
    if (r.outcome === 'errored') d.errored++;
    else if (r.outcome === 'rate_limited') d.rateLimited++;
    else if (r.outcome === 'truncated') d.truncated++;
    else if (r.outcome === 'unfinished') d.unfinished++;
    else d.ok++;
  }

  const daily = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({ daily, range: range ?? '7d', cutoff });
}
```

- [ ] Smoke test: `curl "http://localhost:3000/api/sessions/outcomes?range=7d"` — expect `{ daily: [...], range, cutoff }`. Each day's `errored+rateLimited+truncated+unfinished+ok === total`.

Commit: `feat(phase-3): GET /api/sessions/outcomes endpoint`

---

### A-6: API route — `GET /api/tools/latency`

- [ ] Create `D:\Documents\Code\GitHub\ClaudeCodeDashboard\app\api\tools\latency\route.ts`

Note: this is a **new file**, not a modification of the existing `app/api/tools/route.ts` (which reads JSONL and returns call counts only). The latency route reads from the SQLite `tool_calls` table.

```typescript
// app/api/tools/latency/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { rangeToLocalDateCutoff, percentile } from '@/lib/observability-helpers';

export interface ToolLatencyRow {
  tool: string;
  calls: number;
  errors: number;
  errorRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get('range');
  const cutoff = rangeToLocalDateCutoff(range);
  const db = getDb();

  // Fetch all rows with durations so we can compute percentiles in JS.
  // Filter: only rows where duration_ms is present (pairing succeeded).
  const rows = db.prepare(`
    SELECT
      tool_name,
      duration_ms,
      error
    FROM tool_calls
    WHERE DATE(ts, 'localtime') >= ?
    ORDER BY tool_name, duration_ms ASC
  `).all(cutoff) as Array<{ tool_name: string; duration_ms: number | null; error: string | null }>;

  interface Bucket { durations: number[]; totalCalls: number; errors: number }
  const toolMap = new Map<string, Bucket>();

  for (const r of rows) {
    if (!toolMap.has(r.tool_name)) {
      toolMap.set(r.tool_name, { durations: [], totalCalls: 0, errors: 0 });
    }
    const b = toolMap.get(r.tool_name)!;
    b.totalCalls++;
    if (r.duration_ms != null) b.durations.push(r.duration_ms);
    if (r.error) b.errors++;
  }

  const tools: ToolLatencyRow[] = Array.from(toolMap.entries()).map(([tool, b]) => {
    const sorted = b.durations.sort((a, c) => a - c);
    return {
      tool,
      calls: b.totalCalls,
      errors: b.errors,
      errorRate: b.totalCalls > 0 ? b.errors / b.totalCalls : 0,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      maxMs: sorted.length > 0 ? sorted[sorted.length - 1] : null,
    };
  }).sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0));

  return NextResponse.json({ tools, range: range ?? '7d', cutoff });
}
```

- [ ] Smoke test: `curl "http://localhost:3000/api/tools/latency?range=7d"` — expect `{ tools: [...] }` sorted by `p95Ms` descending.

Commit: `feat(phase-3): GET /api/tools/latency endpoint`

---

### A-7: API route — `GET /api/hooks/activity`

- [ ] Create `D:\Documents\Code\GitHub\ClaudeCodeDashboard\app\api\hooks\activity\route.ts`

**Pairing logic:** For each session, maintain a FIFO queue of `hook_execution_start` timestamps keyed by `(session_id, event_name)`. When a `hook_execution_complete` arrives, pop the earliest start, compute duration (cap at 60,000 ms). Events without a matching start are counted as unpaired fires. Daily aggregation: fires per day + average paired duration per day.

```typescript
// app/api/hooks/activity/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { rangeToLocalDateCutoff } from '@/lib/observability-helpers';

const OUTLIER_CAP_MS = 60_000;

export interface HookDay {
  date: string;
  fires: number;
  pairedCount: number;
  avgDurationMs: number | null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get('range');
  const cutoff = rangeToLocalDateCutoff(range);
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      event_name,
      session_id,
      timestamp,
      DATE(timestamp, 'localtime') AS date
    FROM otel_events
    WHERE event_name IN ('hook_execution_start', 'hook_execution_complete')
      AND DATE(timestamp, 'localtime') >= ?
    ORDER BY timestamp ASC
  `).all(cutoff) as Array<{
    event_name: string;
    session_id: string | null;
    timestamp: string;
    date: string;
  }>;

  // FIFO queue: key = `${session_id}` — queues timestamps of unmatched starts
  const startQueues = new Map<string, number[]>();

  interface DayBucket { fires: number; durations: number[] }
  const dayMap = new Map<string, DayBucket>();
  const ensureDay = (d: string): DayBucket => {
    if (!dayMap.has(d)) dayMap.set(d, { fires: 0, durations: [] });
    return dayMap.get(d)!;
  };

  for (const r of rows) {
    const sid = r.session_id ?? 'unknown';
    const ts = new Date(r.timestamp).getTime();
    const day = ensureDay(r.date);

    if (r.event_name === 'hook_execution_start') {
      if (!startQueues.has(sid)) startQueues.set(sid, []);
      startQueues.get(sid)!.push(ts);
      day.fires++;
    } else if (r.event_name === 'hook_execution_complete') {
      day.fires++;
      const queue = startQueues.get(sid);
      if (queue && queue.length > 0) {
        const startTs = queue.shift()!;
        const dur = Math.min(ts - startTs, OUTLIER_CAP_MS);
        if (dur >= 0) day.durations.push(dur);
      }
    }
  }

  const daily: HookDay[] = Array.from(dayMap.entries())
    .map(([date, b]) => ({
      date,
      fires: b.fires,
      pairedCount: b.durations.length,
      avgDurationMs: b.durations.length > 0
        ? Math.round(b.durations.reduce((s, v) => s + v, 0) / b.durations.length)
        : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalFires = daily.reduce((s, d) => s + d.fires, 0);

  return NextResponse.json({ daily, totalFires, range: range ?? '7d', cutoff });
}
```

- [ ] Smoke test: `curl "http://localhost:3000/api/hooks/activity?range=7d"` — expect `{ daily, totalFires, range, cutoff }`.

Commit: `feat(phase-3): GET /api/hooks/activity endpoint`

---

### A-8: API route — `GET /api/system/pressure`

- [ ] Create `D:\Documents\Code\GitHub\ClaudeCodeDashboard\app\api\system\pressure\route.ts`

```typescript
// app/api/system/pressure/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { rangeToLocalDateCutoff } from '@/lib/observability-helpers';

const DEFAULT_MAX_RETRIES = 10;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get('range');
  const cutoff = rangeToLocalDateCutoff(range);
  const db = getDb();

  // Read CLAUDE_CODE_MAX_RETRIES env with ValueError-equivalent fallback
  let maxRetries = DEFAULT_MAX_RETRIES;
  try {
    const envVal = process.env.CLAUDE_CODE_MAX_RETRIES;
    if (envVal) {
      const parsed = parseInt(envVal, 10);
      if (!isNaN(parsed) && parsed > 0) maxRetries = parsed;
    }
  } catch { /* keep default */ }

  // Retry exhaustion: api_error events where attempt_count >= maxRetries
  const retryExhausted = db.prepare(`
    SELECT COUNT(*) AS n
    FROM otel_events
    WHERE event_name = 'api_error'
      AND attempt_count >= ?
      AND DATE(timestamp, 'localtime') >= ?
  `).get(maxRetries, cutoff) as { n: number };

  // Compaction events
  const compactions = db.prepare(`
    SELECT COUNT(*) AS n
    FROM otel_events
    WHERE event_name = 'compaction'
      AND DATE(timestamp, 'localtime') >= ?
  `).get(cutoff) as { n: number };

  // Recent api_errors (last 10, most recent first)
  const recentErrors = db.prepare(`
    SELECT
      session_id,
      timestamp,
      error_message,
      status_code,
      attempt_count
    FROM otel_events
    WHERE event_name = 'api_error'
      AND DATE(timestamp, 'localtime') >= ?
    ORDER BY timestamp DESC
    LIMIT 10
  `).all(cutoff) as Array<{
    session_id: string | null;
    timestamp: string;
    error_message: string | null;
    status_code: number | null;
    attempt_count: number | null;
  }>;

  return NextResponse.json({
    retryExhaustedCount: retryExhausted.n,
    compactionCount: compactions.n,
    maxRetriesThreshold: maxRetries,
    recentErrors,
    range: range ?? '7d',
    cutoff,
  });
}
```

- [ ] Smoke test: `curl "http://localhost:3000/api/system/pressure?range=7d"` — expect `{ retryExhaustedCount, compactionCount, maxRetriesThreshold, recentErrors }`.

Commit: `feat(phase-3): GET /api/system/pressure endpoint`

---

### A-9: Shared component `CollapsibleSection`

- [ ] Check if `components/ui/collapsible-section.tsx` already exists. If it does, skip. If not, create it:

```typescript
// components/ui/collapsible-section.tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronRight } from 'lucide-react';

interface CollapsibleSectionProps {
  id: string;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const STORAGE_PREFIX = 'cc:section:';

export default function CollapsibleSection({
  id, title, subtitle, defaultOpen = true, children
}: CollapsibleSectionProps) {
  const storageKey = `${STORAGE_PREFIX}${id}`;
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return defaultOpen;
    const stored = localStorage.getItem(storageKey);
    return stored === null ? defaultOpen : stored === 'true';
  });
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(storageKey, String(open));
  }, [open, storageKey]);

  // Height animation via max-height transition
  const contentStyle: React.CSSProperties = {
    overflow: 'hidden',
    maxHeight: open ? '9999px' : '0px',
    transition: 'max-height 220ms ease-out',
  };

  return (
    <section className="mb-6">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`section-content-${id}`}
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full text-left group mb-3"
      >
        <ChevronRight
          size={16}
          className={`text-gray-400 transition-transform duration-220 ${open ? 'rotate-90' : ''}`}
        />
        <span className="font-heading text-lg text-brand-cyan group-hover:text-brand-cyan/80 transition-colors">
          {title}
        </span>
        {subtitle && (
          <span className="text-xs text-gray-500 ml-2 font-mono uppercase tracking-widest">
            {subtitle}
          </span>
        )}
      </button>
      <div
        id={`section-content-${id}`}
        ref={contentRef}
        style={contentStyle}
      >
        {children}
      </div>
    </section>
  );
}
```

Commit: `feat(phase-3): CollapsibleSection shared component`

---

### A-10: Sidebar entry for `/dashboard/observability`

- [ ] Edit `D:\Documents\Code\GitHub\ClaudeCodeDashboard\components\layout\sidebar.tsx`

In the `navItems` array (line 6), add the new entry **after** the `Tool Analytics` entry and before `CLAUDE.md`:

```typescript
{ href: '/dashboard/observability', label: 'Observability', icon: '◎' },
```

The full updated `navItems` array becomes:
```typescript
const navItems = [
  { href: '/dashboard', label: 'Overview', icon: '⊞' },
  { href: '/dashboard/sessions', label: 'Sessions', icon: '◉' },
  { href: '/dashboard/memory', label: 'Memory', icon: '◈' },
  { href: '/dashboard/projects', label: 'Projects', icon: '◆' },
  { href: '/dashboard/history', label: 'History', icon: '◷' },
  { href: '/dashboard/usage', label: 'Usage & Cost', icon: '◐' },
  { href: '/dashboard/tools', label: 'Tool Analytics', icon: '⚙' },
  { href: '/dashboard/observability', label: 'Observability', icon: '◎' }, // NEW
  { href: '/dashboard/claude-md', label: 'CLAUDE.md', icon: '◇' },
  { href: '/dashboard/settings', label: 'Settings', icon: '⚑' },
  { href: '/dashboard/file-history', label: 'File History', icon: '◫' },
  { href: '/dashboard/tasks', label: 'Tasks', icon: '☐' },
  { href: '/dashboard/search', label: 'Search', icon: '⌕' },
];
```

Commit: `feat(phase-3): add Observability nav entry to sidebar`

---

### A-11: TypeScript types for Phase 3

- [ ] Create `D:\Documents\Code\GitHub\ClaudeCodeDashboard\types\observability.ts`

```typescript
// types/observability.ts

export interface McpServer {
  server: string;
  calls: number;
  errors: number;
  errorRate: number;
  avgMs: number | null;
  p95Ms: number | null;
}

export interface McpTool {
  tool: string;
  calls: number;
  errors: number;
  errorRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export interface CacheDay {
  date: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  hitRate: number | null;
  billableTokens: number;
  lowSample: boolean;
}

export interface CacheEfficiencyData {
  overallHitRate: number | null;
  overallBillableTokens: number;
  lowSample: boolean;
  daily: CacheDay[];
  range: string;
  cutoff: string;
}

export interface OutcomeDay {
  date: string;
  errored: number;
  rateLimited: number;
  truncated: number;
  unfinished: number;
  ok: number;
  total: number;
}

export interface ToolLatencyRow {
  tool: string;
  calls: number;
  errors: number;
  errorRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export interface HookDay {
  date: string;
  fires: number;
  pairedCount: number;
  avgDurationMs: number | null;
}

export interface PressureData {
  retryExhaustedCount: number;
  compactionCount: number;
  maxRetriesThreshold: number;
  recentErrors: Array<{
    session_id: string | null;
    timestamp: string;
    error_message: string | null;
    status_code: number | null;
    attempt_count: number | null;
  }>;
  range: string;
  cutoff: string;
}
```

- [ ] Run `npx tsc --noEmit`.

Commit: `feat(phase-3): observability TypeScript types`

---

### A-12: Page scaffold `app/dashboard/observability/page.tsx`

- [ ] Create `D:\Documents\Code\GitHub\ClaudeCodeDashboard\app\dashboard\observability\page.tsx`

This is a **client component** (data fetching happens in each panel). The page just wires the grid layout, the range selector state, and the six panels.

```tsx
// app/dashboard/observability/page.tsx
'use client';

import { useState } from 'react';
import CollapsibleSection from '@/components/ui/collapsible-section';
import McpPanel from '@/components/panels/mcp-panel';
import CacheEfficiencyCard from '@/components/panels/cache-efficiency-card';
import SessionOutcomesCard from '@/components/panels/session-outcomes-card';
import ToolLatencyCard from '@/components/panels/tool-latency-card';
import HookActivityCard from '@/components/panels/hook-activity-card';
import PressurePanel from '@/components/panels/pressure-panel';

type Range = 'today' | '7d' | '30d';

export default function ObservabilityPage() {
  const [range, setRange] = useState<Range>('7d');

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-heading text-2xl text-brand-cyan">Observability</h2>
        <div className="flex items-center gap-1 bg-brand-navy-dark border border-brand-navy-light/30 rounded-lg p-1">
          {(['today', '7d', '30d'] as Range[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 rounded-md text-xs font-mono transition-colors ${
                range === r
                  ? 'bg-brand-cyan/20 text-brand-cyan border border-brand-cyan/30'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* MCP centerpiece — full width, own section */}
      <CollapsibleSection id="obs-mcp" title="MCP Servers" subtitle="drill-down" defaultOpen>
        <McpPanel range={range} />
      </CollapsibleSection>

      {/* 2-col row: Cache + Outcomes */}
      <CollapsibleSection id="obs-cache-outcomes" title="Session Health" defaultOpen>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 [&>*]:h-full auto-rows-fr">
          <CacheEfficiencyCard range={range} />
          <SessionOutcomesCard range={range} />
        </div>
      </CollapsibleSection>

      {/* 2-col row: Tool Latency + Hook Activity */}
      <CollapsibleSection id="obs-latency-hooks" title="Tool & Hook Performance" defaultOpen>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 [&>*]:h-full auto-rows-fr">
          <ToolLatencyCard range={range} />
          <HookActivityCard range={range} />
        </div>
      </CollapsibleSection>

      {/* Full-width: Pressure */}
      <CollapsibleSection id="obs-pressure" title="System Pressure" defaultOpen>
        <PressurePanel range={range} />
      </CollapsibleSection>
    </div>
  );
}
```

- [ ] Verify TypeScript: `npx tsc --noEmit`.
- [ ] Visit `http://localhost:3000/dashboard/observability` — page should render with six loading skeletons (components not yet implemented, but imports should not crash if stubs are in place).

Stub each missing panel as a placeholder during A-block:

```typescript
// components/panels/mcp-panel.tsx (STUB — replaced in block B)
export default function McpPanel({ range }: { range: string }) {
  return <div className="animate-pulse h-32 bg-brand-navy-light rounded-xl" />;
}
```

Create identical stubs for `cache-efficiency-card.tsx`, `session-outcomes-card.tsx`, `tool-latency-card.tsx`, `hook-activity-card.tsx`, `pressure-panel.tsx`.

Commit: `feat(phase-3): observability page scaffold + panel stubs`

---

### A-13: Block A gate — typecheck + lint

- [ ] `npx tsc --noEmit` — zero errors.
- [ ] `npm run lint` — zero errors.
- [ ] `npm run dev` — `/dashboard/observability` loads, six stubs visible, range selector functional.

Commit: `feat(phase-3): block A complete — all API routes + scaffold`

**Hand block B off to orchestrator.** All six panel agents can be dispatched simultaneously.

---

## Task block B — Six panel components `[P]`

Each of the six tasks below is independent. Dispatch all six frontend agents in a single orchestrator message. Each agent replaces one stub with a full implementation. Agents must not touch each other's files.

**Each panel agent receives this shared context:**
- API response types are in `D:\Documents\Code\GitHub\ClaudeCodeDashboard\types\observability.ts`.
- Use `useAutoRefresh` from `hooks/use-auto-refresh.ts` with 60s interval.
- Tailwind tokens: `brand-navy` (#0A0E27), `brand-navy-dark` (#050711), `brand-navy-light` (#1a1e3f), `brand-cyan` (#00D4FF). Status: `chameleon-red` (#F44336), `chameleon-amber` (#FFC107), `chameleon-orange` (#FF9800), `chameleon-green` (#4CAF50).
- Card shell: `bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5`.
- Empty states must be instructional. Never blank, never spinner-only.
- All loading states use `animate-pulse` skeleton divs, not text spinners.
- No new npm packages.

---

### B-1 `[P]`: `components/panels/mcp-panel.tsx` — MCP server drill-down

**The centerpiece. More visual care than other panels.**

- [ ] Replace the stub at `D:\Documents\Code\GitHub\ClaudeCodeDashboard\components\panels\mcp-panel.tsx`:

```tsx
// components/panels/mcp-panel.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, Zap, AlertTriangle, Activity } from 'lucide-react';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import type { McpServer, McpTool } from '@/types/observability';

interface Props { range: string }

function fmtMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms >= 1_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

function SpeedTag({ p95Ms }: { p95Ms: number | null }) {
  if (p95Ms === null) return null;
  if (p95Ms >= 10_000) return (
    <span className="ml-2 text-[10px] font-mono uppercase tracking-widest text-chameleon-red border border-chameleon-red/30 px-1.5 py-0.5 rounded">
      · slow
    </span>
  );
  if (p95Ms < 500) return (
    <span className="ml-2 text-[10px] font-mono uppercase tracking-widest text-chameleon-green border border-chameleon-green/30 px-1.5 py-0.5 rounded">
      · fast
    </span>
  );
  return null;
}

function ToolRow({ tool }: { tool: McpTool }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-4 items-center
                    py-2 px-3 rounded-lg hover:bg-brand-navy/50 transition-colors text-sm">
      <span className="text-gray-200 font-mono truncate" title={tool.tool}>
        {tool.tool}
        <SpeedTag p95Ms={tool.p95Ms} />
      </span>
      <span className="text-gray-500 text-xs text-right tabular-nums">{tool.calls} calls</span>
      <span className="text-gray-400 text-xs text-right tabular-nums">{fmtMs(tool.p50Ms)}</span>
      <span className={`text-xs text-right tabular-nums font-semibold ${
        tool.p95Ms !== null && tool.p95Ms >= 10_000 ? 'text-chameleon-red' : 'text-gray-300'
      }`}>{fmtMs(tool.p95Ms)}</span>
      <span className="text-gray-500 text-xs text-right tabular-nums">{fmtMs(tool.maxMs)}</span>
      <span className={`text-xs text-right tabular-nums ${
        tool.errorRate > 0.1 ? 'text-chameleon-red' : tool.errorRate > 0 ? 'text-chameleon-amber' : 'text-gray-500'
      }`}>{tool.errors > 0 ? `${(tool.errorRate * 100).toFixed(0)}% err` : '—'}</span>
    </div>
  );
}

function ToolTableHeader() {
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-4 items-center
                    py-1 px-3 mb-1 text-[10px] font-mono uppercase tracking-widest text-gray-500">
      <span>Tool</span>
      <span className="text-right">N</span>
      <span className="text-right">p50</span>
      <span className="text-right">p95</span>
      <span className="text-right">max</span>
      <span className="text-right">err</span>
    </div>
  );
}

function ToolsPanel({ server, range }: { server: string; range: string }) {
  const [tools, setTools] = useState<McpTool[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    fetch(`/api/mcp/${encodeURIComponent(server)}/tools?range=${range}`)
      .then(r => r.json())
      .then(d => setTools(d.tools))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [server, range]);

  if (loading) return (
    <div className="mt-3 space-y-1.5 px-3">
      {[1,2,3].map(i => (
        <div key={i} className="h-8 bg-brand-navy/60 rounded animate-pulse" />
      ))}
    </div>
  );

  if (error || !tools) return (
    <p className="mt-3 px-3 text-sm text-chameleon-red">Failed to load tools.</p>
  );

  if (tools.length === 0) return (
    <p className="mt-3 px-3 text-sm text-gray-500">
      No tool call data for <span className="text-gray-300 font-mono">{server}</span> in this range.
    </p>
  );

  return (
    <div className="mt-3 border border-brand-navy-light/30 rounded-lg overflow-hidden">
      <ToolTableHeader />
      <div className="divide-y divide-brand-navy-light/20">
        {tools.map(t => <ToolRow key={t.tool} tool={t} />)}
      </div>
    </div>
  );
}

function ServerRow({ server, range }: { server: McpServer; range: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`border rounded-xl transition-all duration-200 ${
      expanded
        ? 'border-brand-cyan/30 bg-brand-navy-dark shadow-lg shadow-brand-cyan/5'
        : 'border-brand-navy-light/30 bg-brand-navy-light/30 hover:border-brand-cyan/20 hover:bg-brand-navy-light/50'
    }`}>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 p-4 text-left"
      >
        <ChevronRight
          size={16}
          className={`text-gray-400 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />
        {/* Server name */}
        <span className="flex-1 font-mono text-sm text-white font-semibold truncate">
          {server.server}
          <SpeedTag p95Ms={server.p95Ms} />
        </span>
        {/* Stats row */}
        <div className="flex items-center gap-5 text-xs text-gray-400 font-mono shrink-0">
          <span className="flex items-center gap-1">
            <Activity size={11} className="text-brand-cyan/60" />
            {server.calls.toLocaleString()}
          </span>
          <span>
            avg <span className="text-gray-200">{fmtMs(server.avgMs)}</span>
          </span>
          <span>
            p95 <span className={`font-semibold ${
              server.p95Ms !== null && server.p95Ms >= 10_000
                ? 'text-chameleon-red'
                : 'text-gray-200'
            }`}>{fmtMs(server.p95Ms)}</span>
          </span>
          {server.errors > 0 && (
            <span className="flex items-center gap-1 text-chameleon-amber">
              <AlertTriangle size={11} />
              {(server.errorRate * 100).toFixed(0)}%
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-brand-navy-light/20 pt-2">
          <ToolsPanel server={server.server} range={range} />
        </div>
      )}
    </div>
  );
}

export default function McpPanel({ range }: Props) {
  const [data, setData] = useState<{ servers: McpServer[] } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch(`/api/mcp?range=${range}`)
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 60_000);

  if (loading) return (
    <div className="space-y-3">
      {[1,2,3].map(i => (
        <div key={i} className="h-16 rounded-xl bg-brand-navy-light/50 animate-pulse border border-brand-navy-light/30" />
      ))}
    </div>
  );

  if (!data || data.servers.length === 0) return (
    <div className="border border-brand-navy-light/30 rounded-xl p-8 text-center">
      <Zap size={32} className="text-gray-600 mx-auto mb-3" />
      <p className="text-gray-400 text-sm font-medium">No MCP servers detected</p>
      <p className="text-gray-600 text-xs mt-2 max-w-xs mx-auto">
        Install an MCP server and use it in a session to see latency data here.
        Try: <code className="text-chameleon-amber bg-brand-navy-dark px-1 rounded">claude mcp add</code>
      </p>
    </div>
  );

  return (
    <div className="space-y-2">
      {data.servers.map(s => (
        <ServerRow key={s.server} server={s} range={range} />
      ))}
    </div>
  );
}
```

- [ ] Click a server row — tool table animates in.
- [ ] Servers with p95 ≥ 10s show red `· slow` tag; < 500ms show green `· fast`.
- [ ] `npx tsc --noEmit` passes.

Commit: `feat(phase-3): MCP panel component — drill-down with per-tool latency`

---

### B-2 `[P]`: `components/panels/cache-efficiency-card.tsx`

- [ ] Replace the stub at `D:\Documents\Code\GitHub\ClaudeCodeDashboard\components\panels\cache-efficiency-card.tsx`:

```tsx
// components/panels/cache-efficiency-card.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import type { CacheEfficiencyData, CacheDay } from '@/types/observability';

interface Props { range: string }

const TARGET_RATE = 0.70;
const SPARKLINE_H = 40;
const SPARKLINE_W = 200;

function Sparkline({ daily }: { daily: CacheDay[] }) {
  if (daily.length === 0) return null;

  const rates = daily.map(d => d.hitRate ?? 0);
  const max = Math.max(...rates, TARGET_RATE + 0.05, 0.01);

  const points = rates.map((r, i) => {
    const x = (i / Math.max(rates.length - 1, 1)) * SPARKLINE_W;
    const y = SPARKLINE_H - (r / max) * SPARKLINE_H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const targetY = SPARKLINE_H - (TARGET_RATE / max) * SPARKLINE_H;

  return (
    <svg
      viewBox={`0 0 ${SPARKLINE_W} ${SPARKLINE_H}`}
      className="w-full"
      preserveAspectRatio="none"
      style={{ height: SPARKLINE_H }}
      aria-hidden="true"
    >
      {/* Target line */}
      <line
        x1="0" y1={targetY} x2={SPARKLINE_W} y2={targetY}
        stroke="#FFC107" strokeWidth="1" strokeDasharray="3 3" opacity="0.6"
      />
      {/* Sparkline */}
      <polyline
        points={points}
        fill="none"
        stroke="#00D4FF"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Dots */}
      {rates.map((r, i) => {
        const x = (i / Math.max(rates.length - 1, 1)) * SPARKLINE_W;
        const y = SPARKLINE_H - (r / max) * SPARKLINE_H;
        return (
          <circle key={i} cx={x} cy={y} r="2.5" fill="#00D4FF" opacity="0.8" />
        );
      })}
    </svg>
  );
}

export default function CacheEfficiencyCard({ range }: Props) {
  const [data, setData] = useState<CacheEfficiencyData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch(`/api/usage/cache?range=${range}`)
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 60_000);

  if (loading) return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full">
      <div className="h-4 w-32 bg-brand-navy/60 rounded animate-pulse mb-4" />
      <div className="h-12 w-24 bg-brand-navy/60 rounded animate-pulse mb-4" />
      <div className="h-10 bg-brand-navy/60 rounded animate-pulse" />
    </div>
  );

  if (!data) return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full">
      <p className="text-chameleon-red text-sm">Failed to load cache data.</p>
    </div>
  );

  const hitPct = data.overallHitRate != null
    ? `${(data.overallHitRate * 100).toFixed(1)}%`
    : '—';

  const hitColor = data.overallHitRate == null
    ? 'text-gray-400'
    : data.overallHitRate >= TARGET_RATE
      ? 'text-chameleon-green'
      : data.overallHitRate >= 0.4
        ? 'text-chameleon-amber'
        : 'text-chameleon-red';

  const isEmpty = data.daily.length === 0;

  return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs font-mono uppercase tracking-widest text-gray-500 mb-0.5">Cache Efficiency</p>
          <div className="flex items-center gap-2">
            <span className={`text-4xl font-bold tabular-nums ${hitColor}`}>{hitPct}</span>
            {data.lowSample && (
              <span className="text-[10px] font-mono uppercase tracking-widest text-chameleon-amber border border-chameleon-amber/30 px-1.5 py-0.5 rounded">
                low sample
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Target</p>
          <p className="text-sm font-mono text-chameleon-amber">{(TARGET_RATE * 100).toFixed(0)}%</p>
        </div>
      </div>

      {/* Sparkline or empty */}
      <div className="flex-1 min-h-0">
        {isEmpty ? (
          <div className="flex items-center justify-center h-full min-h-[60px]">
            <p className="text-gray-600 text-xs text-center">
              No token usage recorded yet. Run sessions with Claude to see cache hit rates.
            </p>
          </div>
        ) : (
          <>
            <div className="relative">
              <Sparkline daily={data.daily} />
              <div className="absolute -top-3 right-0 flex items-center gap-1">
                <span className="w-3 border-t border-dashed border-chameleon-amber/60" />
                <span className="text-[9px] text-chameleon-amber/60 font-mono">70% target</span>
              </div>
            </div>
            <p className="text-xs text-gray-600 mt-2 font-mono text-right">
              {data.overallBillableTokens.toLocaleString()} billable tokens
            </p>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] Verify sparkline renders with real data; dots appear on each daily data point; amber dashed target line at 70%.
- [ ] Low-sample badge appears when `overallBillableTokens < 10_000`.
- [ ] `npx tsc --noEmit` passes.

Commit: `feat(phase-3): cache efficiency panel with SVG sparkline`

---

### B-3 `[P]`: `components/panels/session-outcomes-card.tsx`

- [ ] Replace the stub at `D:\Documents\Code\GitHub\ClaudeCodeDashboard\components\panels\session-outcomes-card.tsx`:

```tsx
// components/panels/session-outcomes-card.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import type { OutcomeDay } from '@/types/observability';

interface Props { range: string }

const SEGMENTS = [
  { key: 'errored',     label: 'Errored',      color: '#F44336' },
  { key: 'rateLimited', label: 'Rate limited',  color: '#FFC107' },
  { key: 'truncated',   label: 'Truncated',     color: '#FF9800' },
  { key: 'unfinished',  label: 'Unfinished',    color: '#5a5a70' },
  { key: 'ok',          label: 'OK',            color: '#4CAF50' },
] as const;

type SegmentKey = typeof SEGMENTS[number]['key'];

function StackedBar({ day }: { day: OutcomeDay }) {
  if (day.total === 0) return (
    <div className="h-full bg-brand-navy/40 rounded-sm" title={day.date} />
  );

  return (
    <div className="flex flex-col-reverse h-full rounded-sm overflow-hidden" title={
      `${day.date}\n` + SEGMENTS.map(s => `${s.label}: ${day[s.key as SegmentKey]}`).join('\n')
    }>
      {SEGMENTS.map(seg => {
        const count = day[seg.key as SegmentKey];
        if (count === 0) return null;
        const pct = (count / day.total) * 100;
        return (
          <div
            key={seg.key}
            style={{ height: `${pct}%`, backgroundColor: seg.color, minHeight: count > 0 ? '2px' : '0' }}
          />
        );
      })}
    </div>
  );
}

export default function SessionOutcomesCard({ range }: Props) {
  const [daily, setDaily] = useState<OutcomeDay[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch(`/api/sessions/outcomes?range=${range}`)
      .then(r => r.json())
      .then((d: { daily: OutcomeDay[] }) => setDaily(d.daily))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 60_000);

  if (loading) return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full">
      <div className="h-4 w-40 bg-brand-navy/60 rounded animate-pulse mb-4" />
      <div className="h-32 bg-brand-navy/60 rounded animate-pulse" />
    </div>
  );

  if (!daily) return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full">
      <p className="text-chameleon-red text-sm">Failed to load outcomes data.</p>
    </div>
  );

  const BAR_H = 100; // px

  return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full flex flex-col">
      <p className="text-xs font-mono uppercase tracking-widest text-gray-500 mb-4">Session Outcomes</p>

      {daily.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-600 text-xs text-center">
            No sessions in this range. Sessions will appear here after they complete.
          </p>
        </div>
      ) : (
        <>
          {/* Bars */}
          <div className="flex-1 min-h-0 flex items-end gap-1" style={{ height: BAR_H }}>
            {daily.map(day => (
              <div key={day.date} className="flex-1 flex flex-col justify-end" style={{ height: BAR_H }}>
                <StackedBar day={day} />
              </div>
            ))}
          </div>

          {/* X-axis labels — show first, middle, last */}
          <div className="flex justify-between mt-1">
            <span className="text-[9px] font-mono text-gray-600">{daily[0]?.date.slice(5)}</span>
            {daily.length > 2 && (
              <span className="text-[9px] font-mono text-gray-600">
                {daily[Math.floor(daily.length / 2)]?.date.slice(5)}
              </span>
            )}
            <span className="text-[9px] font-mono text-gray-600">{daily[daily.length - 1]?.date.slice(5)}</span>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3">
            {SEGMENTS.map(s => (
              <div key={s.key} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: s.color }} />
                <span className="text-[10px] text-gray-500">{s.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] Verify stacked bars fill full height; segments sum to total per day.
- [ ] Date labels on X-axis show MM-DD format.
- [ ] `npx tsc --noEmit` passes.

Commit: `feat(phase-3): session outcomes stacked bar chart`

---

### B-4 `[P]`: `components/panels/tool-latency-card.tsx`

- [ ] Replace the stub at `D:\Documents\Code\GitHub\ClaudeCodeDashboard\components\panels\tool-latency-card.tsx`:

```tsx
// components/panels/tool-latency-card.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import type { ToolLatencyRow } from '@/types/observability';

interface Props { range: string }

function fmtMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms >= 1_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function P95Cell({ ms }: { ms: number | null }) {
  const slow = ms !== null && ms >= 10_000;
  const fast = ms !== null && ms < 500;
  return (
    <span className={`tabular-nums font-semibold ${
      slow ? 'text-chameleon-red' : fast ? 'text-chameleon-green' : 'text-gray-300'
    }`}>
      {fmtMs(ms)}
    </span>
  );
}

export default function ToolLatencyCard({ range }: Props) {
  const [tools, setTools] = useState<ToolLatencyRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch(`/api/tools/latency?range=${range}`)
      .then(r => r.json())
      .then((d: { tools: ToolLatencyRow[] }) => setTools(d.tools))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 60_000);

  if (loading) return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full">
      <div className="h-4 w-36 bg-brand-navy/60 rounded animate-pulse mb-4" />
      <div className="space-y-2">
        {[1,2,3,4,5].map(i => <div key={i} className="h-8 bg-brand-navy/60 rounded animate-pulse" />)}
      </div>
    </div>
  );

  if (!tools) return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full">
      <p className="text-chameleon-red text-sm">Failed to load latency data.</p>
    </div>
  );

  return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full flex flex-col">
      <p className="text-xs font-mono uppercase tracking-widest text-gray-500 mb-3">Tool Latency</p>

      {tools.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-600 text-xs text-center">
            No tool call duration data yet. Tool latency is recorded from JSONL pairing during session sync.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 items-center
                          py-1 px-2 mb-1 text-[10px] font-mono uppercase tracking-widest text-gray-500 sticky top-0 bg-brand-navy-light">
            <span>Tool</span>
            <span className="text-right">N</span>
            <span className="text-right">p50</span>
            <span className="text-right">p95</span>
            <span className="text-right">max</span>
          </div>
          <div className="space-y-0.5">
            {tools.map(t => (
              <div key={t.tool}
                   className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 items-center
                              py-1.5 px-2 rounded hover:bg-brand-navy/40 transition-colors text-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-gray-200 font-mono truncate" title={t.tool}>{t.tool}</span>
                  {t.errorRate > 0 && (
                    <span className={`shrink-0 text-[9px] font-mono ${
                      t.errorRate > 0.1 ? 'text-chameleon-red' : 'text-chameleon-amber'
                    }`}>
                      {(t.errorRate * 100).toFixed(0)}%err
                    </span>
                  )}
                </div>
                <span className="text-gray-500 tabular-nums text-right">{t.calls}</span>
                <span className="text-gray-400 tabular-nums text-right">{fmtMs(t.p50Ms)}</span>
                <P95Cell ms={t.p95Ms} />
                <span className="text-gray-500 tabular-nums text-right">{fmtMs(t.maxMs)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] Red p95 for tools ≥ 10s; green p95 for tools < 500ms.
- [ ] Error rate annotation appears only when `errors > 0`.
- [ ] Table is scrollable when overflow; header stays sticky.
- [ ] `npx tsc --noEmit` passes.

Commit: `feat(phase-3): tool latency panel with p50/p95/max + error rate`

---

### B-5 `[P]`: `components/panels/hook-activity-card.tsx`

- [ ] Replace the stub at `D:\Documents\Code\GitHub\ClaudeCodeDashboard\components\panels\hook-activity-card.tsx`:

```tsx
// components/panels/hook-activity-card.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Webhook } from 'lucide-react';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import type { HookDay } from '@/types/observability';

interface Props { range: string }

function fmtMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms >= 1_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

function MiniBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max((value / max) * 100, 2) : 0;
  return (
    <div className="w-full h-1.5 bg-brand-navy/60 rounded-full overflow-hidden">
      <div
        className="h-full bg-brand-cyan/60 rounded-full"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function HookActivityCard({ range }: Props) {
  const [data, setData] = useState<{ daily: HookDay[]; totalFires: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch(`/api/hooks/activity?range=${range}`)
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 60_000);

  if (loading) return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full">
      <div className="h-4 w-32 bg-brand-navy/60 rounded animate-pulse mb-4" />
      <div className="space-y-3">
        {[1,2,3].map(i => <div key={i} className="h-10 bg-brand-navy/60 rounded animate-pulse" />)}
      </div>
    </div>
  );

  if (!data) return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full">
      <p className="text-chameleon-red text-sm">Failed to load hook data.</p>
    </div>
  );

  const { daily, totalFires } = data;
  const maxFires = Math.max(...daily.map(d => d.fires), 1);

  return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-mono uppercase tracking-widest text-gray-500">Hook Activity</p>
        {totalFires > 0 && (
          <span className="text-xs font-mono text-gray-400">
            {totalFires.toLocaleString()} fires total
          </span>
        )}
      </div>

      {totalFires === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <Webhook size={28} className="text-gray-600" />
          <p className="text-gray-500 text-sm font-medium">No hook activity</p>
          <p className="text-gray-600 text-xs text-center max-w-xs">
            Hook events appear here when Claude Code runs pre/post-tool hooks.
            Configure hooks in{' '}
            <code className="text-chameleon-amber bg-brand-navy-dark px-1 rounded">
              ~/.claude/settings.json
            </code>
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto space-y-2">
          {daily.filter(d => d.fires > 0).map(d => (
            <div key={d.date} className="flex items-center gap-3">
              <span className="text-[10px] font-mono text-gray-500 w-12 shrink-0">{d.date.slice(5)}</span>
              <div className="flex-1">
                <MiniBar value={d.fires} max={maxFires} />
              </div>
              <span className="text-xs font-mono text-gray-400 w-10 text-right tabular-nums shrink-0">
                {d.fires}
              </span>
              {d.pairedCount > 0 && (
                <span className="text-[10px] font-mono text-gray-600 w-16 text-right shrink-0">
                  {fmtMs(d.avgDurationMs)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] Empty state shows when `totalFires === 0` — includes hook configuration hint.
- [ ] Each day row shows date, mini bar, fire count, avg duration when paired data exists.
- [ ] `npx tsc --noEmit` passes.

Commit: `feat(phase-3): hook activity panel`

---

### B-6 `[P]`: `components/panels/pressure-panel.tsx`

- [ ] Replace the stub at `D:\Documents\Code\GitHub\ClaudeCodeDashboard\components\panels\pressure-panel.tsx`:

```tsx
// components/panels/pressure-panel.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertOctagon, RefreshCw, Zap } from 'lucide-react';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import type { PressureData } from '@/types/observability';

interface Props { range: string }

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function PressurePanel({ range }: Props) {
  const [data, setData] = useState<PressureData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch(`/api/system/pressure?range=${range}`)
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 60_000);

  if (loading) return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5">
      <div className="h-4 w-36 bg-brand-navy/60 rounded animate-pulse mb-4" />
      <div className="grid grid-cols-3 gap-4 mb-4">
        {[1,2,3].map(i => <div key={i} className="h-16 bg-brand-navy/60 rounded-lg animate-pulse" />)}
      </div>
    </div>
  );

  if (!data) return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5">
      <p className="text-chameleon-red text-sm">Failed to load pressure data.</p>
    </div>
  );

  const hasErrors = data.recentErrors.length > 0;
  const hasPressure = data.retryExhaustedCount > 0 || data.compactionCount > 0;

  return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5">
      <p className="text-xs font-mono uppercase tracking-widest text-gray-500 mb-4">System Pressure</p>

      {/* KPI tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        {/* Retry exhaustion */}
        <div className={`rounded-lg p-4 border ${
          data.retryExhaustedCount > 0
            ? 'bg-chameleon-red/5 border-chameleon-red/20'
            : 'bg-brand-navy/40 border-brand-navy-light/20'
        }`}>
          <div className="flex items-center gap-2 mb-1">
            <RefreshCw size={14} className={data.retryExhaustedCount > 0 ? 'text-chameleon-red' : 'text-gray-600'} />
            <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Retry exhausted</span>
          </div>
          <p className={`text-2xl font-bold tabular-nums ${data.retryExhaustedCount > 0 ? 'text-chameleon-red' : 'text-gray-400'}`}>
            {data.retryExhaustedCount}
          </p>
          <p className="text-[10px] text-gray-600 mt-1 font-mono">
            threshold: {data.maxRetriesThreshold} attempts
          </p>
        </div>

        {/* Compaction */}
        <div className={`rounded-lg p-4 border ${
          data.compactionCount > 5
            ? 'bg-chameleon-amber/5 border-chameleon-amber/20'
            : 'bg-brand-navy/40 border-brand-navy-light/20'
        }`}>
          <div className="flex items-center gap-2 mb-1">
            <Zap size={14} className={data.compactionCount > 5 ? 'text-chameleon-amber' : 'text-gray-600'} />
            <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Compactions</span>
          </div>
          <p className={`text-2xl font-bold tabular-nums ${data.compactionCount > 5 ? 'text-chameleon-amber' : 'text-gray-400'}`}>
            {data.compactionCount}
          </p>
          <p className="text-[10px] text-gray-600 mt-1 font-mono">context-length events</p>
        </div>

        {/* API errors */}
        <div className={`rounded-lg p-4 border ${
          hasErrors
            ? 'bg-chameleon-amber/5 border-chameleon-amber/20'
            : 'bg-brand-navy/40 border-brand-navy-light/20'
        }`}>
          <div className="flex items-center gap-2 mb-1">
            <AlertOctagon size={14} className={hasErrors ? 'text-chameleon-amber' : 'text-gray-600'} />
            <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">API errors</span>
          </div>
          <p className={`text-2xl font-bold tabular-nums ${hasErrors ? 'text-chameleon-amber' : 'text-gray-400'}`}>
            {data.recentErrors.length}
          </p>
          <p className="text-[10px] text-gray-600 mt-1 font-mono">last {data.recentErrors.length > 0 ? '10' : '0'} shown</p>
        </div>
      </div>

      {/* Recent errors list */}
      {!hasPressure && !hasErrors ? (
        <div className="text-center py-4">
          <p className="text-chameleon-green text-sm font-medium">All clear</p>
          <p className="text-gray-600 text-xs mt-1">No retry exhaustions, compactions, or API errors in this range.</p>
        </div>
      ) : hasErrors ? (
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-2">Recent API Errors</p>
          <div className="space-y-1.5">
            {data.recentErrors.map((e, i) => (
              <div key={i} className="flex items-start gap-3 py-2 px-3 bg-brand-navy/40 rounded-lg text-xs">
                <span className="text-gray-600 font-mono shrink-0 mt-0.5">{timeAgo(e.timestamp)}</span>
                <span className={`font-mono shrink-0 mt-0.5 ${
                  e.status_code && e.status_code >= 500 ? 'text-chameleon-red' : 'text-chameleon-amber'
                }`}>{e.status_code ?? '—'}</span>
                <span className="text-gray-400 truncate flex-1" title={e.error_message ?? ''}>
                  {e.error_message ?? 'Unknown error'}
                </span>
                {e.attempt_count != null && (
                  <span className="text-gray-600 font-mono shrink-0">×{e.attempt_count}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] Three KPI tiles always render (show 0 when clean, colored when pressure exists).
- [ ] "All clear" message when `retryExhaustedCount === 0 && compactionCount === 0 && recentErrors.length === 0`.
- [ ] Error rows show: time ago, status code (colored red for 5xx, amber for 4xx), message truncated, attempt count.
- [ ] `npx tsc --noEmit` passes.

Commit: `feat(phase-3): pressure panel with retry/compaction/error KPIs`

---

## Block B gate — all six panels

After all six panel agents report back:

- [ ] `npx tsc --noEmit` — zero errors across all new files.
- [ ] `npm run lint` — zero errors.
- [ ] `npm run dev` and visit `http://localhost:3000/dashboard/observability`:
  - [ ] Range selector (today/7d/30d) switches all six panels simultaneously.
  - [ ] MCP panel: click any server row — tool table animates in without page reload.
  - [ ] MCP panel: p95 ≥ 10s shows red `· slow`; p95 < 500ms shows green `· fast`.
  - [ ] Cache panel: sparkline renders; dashed amber line at 70% visible.
  - [ ] Outcomes panel: stacked bars with color-coded segments.
  - [ ] Latency panel: p95 column colored correctly; table scrollable.
  - [ ] Hook panel: empty state shows when no OTEL hook events recorded.
  - [ ] Pressure panel: three KPI tiles; "All clear" when no pressure.
  - [ ] All panels show loading skeletons before data arrives (throttle with DevTools if needed).
  - [ ] All panels show instructional empty states (not blank) when data arrays are empty.
  - [ ] Sidebar highlights "Observability" when on this page.
- [ ] CollapsibleSection chevron rotates; state persists after page refresh (check localStorage key `cc:section:obs-mcp`).

Commit: `feat(phase-3): all six observability panels complete`

---

## Phase 3 stop conditions

Phase 3 is complete when ALL of these pass:

1. `npx tsc --noEmit` exits 0.
2. `npm run lint` exits 0.
3. `/dashboard/observability` renders in `npm run dev` with no console errors.
4. Seven API routes return valid JSON: `/api/mcp`, `/api/mcp/[server]/tools`, `/api/usage/cache`, `/api/sessions/outcomes`, `/api/tools/latency`, `/api/hooks/activity`, `/api/system/pressure`.
5. Each API route returns `{ range, cutoff }` fields alongside its data.
6. Each API route returns empty data structures (not 404/500) when the SQLite tables exist but have no matching rows.
7. MCP drill-down: clicking a server row fetches `/api/mcp/{server}/tools` exactly once per expand; collapsing and re-expanding re-fetches.
8. Cache panel: `overallHitRate` is computed as `cache_read / (input + cache_read + cache_create)`, verified by inspecting real values from `token_usage` table.
9. Session outcomes bars sum to `day.total` for every day — verified by `errored + rateLimited + truncated + unfinished + ok === total` in the API response.
10. CollapsibleSection localStorage keys (`cc:section:obs-mcp`, `cc:section:obs-cache-outcomes`, `cc:section:obs-latency-hooks`, `cc:section:obs-pressure`) persist after page refresh.
11. The Observability nav link in the sidebar is active when on `/dashboard/observability`.

---

## File manifest

**New files to create:**

| File | Description |
|---|---|
| `D:\Documents\Code\GitHub\ClaudeCodeDashboard\lib\observability-helpers.ts` | `rangeToLocalDateCutoff`, `percentile`, `parseMcpToolName` utilities |
| `D:\Documents\Code\GitHub\ClaudeCodeDashboard\types\observability.ts` | TypeScript types for all six panels |
| `D:\Documents\Code\GitHub\ClaudeCodeDashboard\app\api\mcp\route.ts` | `GET /api/mcp` |
| `D:\Documents\Code\GitHub\ClaudeCodeDashboard\app\api\mcp\[server]\tools\route.ts` | `GET /api/mcp/[server]/tools` |
| `D:\Documents\Code\GitHub\ClaudeCodeDashboard\app\api\usage\cache\route.ts` | `GET /api/usage/cache` |
| `D:\Documents\Code\GitHub\ClaudeCodeDashboard\app\api\sessions\outcomes\route.ts` | `GET /api/sessions/outcomes` |
| `D:\Documents\Code\GitHub\ClaudeCodeDashboard\app\api\tools\latency\route.ts` | `GET /api/tools/latency` |
| `D:\Documents\Code\GitHub\ClaudeCodeDashboard\app\api\hooks\activity\route.ts` | `GET /api/hooks/activity` |
| `D:\Documents\Code\GitHub\ClaudeCodeDashboard\app\api\system\pressure\route.ts` | `GET /api/system/pressure` |
| `D:\Documents\Code\GitHub\ClaudeCodeDashboard\components\ui\collapsible-section.tsx` | Shared CollapsibleSection (if not from Phase 1) |
| `D:\Documents\Code\GitHub\ClaudeCodeDashboard\app\dashboard\observability\page.tsx` | Main observability page |
| `D:\Documents\Code\GitHub\ClaudeCodeDashboard\components\panels\mcp-panel.tsx` | MCP drill-down centerpiece |
| `D:\Documents\Code\GitHub\ClaudeCodeDashboard\components\panels\cache-efficiency-card.tsx` | Cache hit rate + sparkline |
| `D:\Documents\Code\GitHub\ClaudeCodeDashboard\components\panels\session-outcomes-card.tsx` | Stacked bar outcomes |
| `D:\Documents\Code\GitHub\ClaudeCodeDashboard\components\panels\tool-latency-card.tsx` | Tool p50/p95/max table |
| `D:\Documents\Code\GitHub\ClaudeCodeDashboard\components\panels\hook-activity-card.tsx` | Hook fires + duration |
| `D:\Documents\Code\GitHub\ClaudeCodeDashboard\components\panels\pressure-panel.tsx` | Retry/compaction/error KPIs |

**Modified files:**

| File | Change |
|---|---|
| `D:\Documents\Code\GitHub\ClaudeCodeDashboard\components\layout\sidebar.tsx` | Add `{ href: '/dashboard/observability', label: 'Observability', icon: '◎' }` to navItems |
| `D:\Documents\Code\GitHub\ClaudeCodeDashboard\lib\db.ts` | Verify/create `getDb()` singleton (may already exist from Phase 1) |

---

## Error handling conventions

- Every API route wraps the entire body in a `try/catch`. On error, return `NextResponse.json({ error: 'Internal error' }, { status: 500 })`.
- Every panel component: fetch errors set an error boolean, which renders a short red error message (not a crash).
- SQLite prepared statements: if a table doesn't exist yet (Phase 1 not run), the `better-sqlite3` call throws — catch it and return empty arrays with `{ error: 'DB not initialized — run Phase 1 sync first' }`.
- `parseMcpToolName` returns `null` for non-MCP tools; callers must guard the null.
- The `percentile` helper returns `null` for empty arrays; all callers that display a value must render `'—'` for null.

---

## Performance notes

- The `tool_calls` latency route fetches all rows in the date range unsorted per-tool, then sorts in JS. For a local dashboard with <100K rows this is fine. If `tool_calls` grows large, add `GROUP BY tool_name` subquery to pre-count — but this defers to a later optimization pass.
- MCP tool fetch (`/api/mcp/[server]/tools`) is triggered only on expand. Results are not cached between range changes — a re-expand after range toggle refetches, which is correct.
- OTEL events table may be empty until Phase 2 is running with `CLAUDE_CODE_ENABLE_TELEMETRY=1`. The hook activity and pressure panels both show instructional empty states in this case.

---

## Suggested commit sequence (block A)

```
feat(phase-3): ensure db singleton in lib/db.ts          [A-0]
feat(phase-3): add observability-helpers lib              [A-1]
feat(phase-3): GET /api/mcp list endpoint                 [A-2]
feat(phase-3): GET /api/mcp/[server]/tools endpoint       [A-3]
feat(phase-3): GET /api/usage/cache endpoint              [A-4]
feat(phase-3): GET /api/sessions/outcomes endpoint        [A-5]
feat(phase-3): GET /api/tools/latency endpoint            [A-6]
feat(phase-3): GET /api/hooks/activity endpoint           [A-7]
feat(phase-3): GET /api/system/pressure endpoint          [A-8]
feat(phase-3): CollapsibleSection shared component        [A-9]
feat(phase-3): add Observability nav entry to sidebar     [A-10]
feat(phase-3): observability TypeScript types             [A-11]
feat(phase-3): observability page scaffold + panel stubs  [A-12]
feat(phase-3): block A complete — all API routes + scaffold [A-13]
```

Block B (parallel, one commit per panel agent):
```
feat(phase-3): MCP panel component — drill-down with per-tool latency  [B-1]
feat(phase-3): cache efficiency panel with SVG sparkline               [B-2]
feat(phase-3): session outcomes stacked bar chart                      [B-3]
feat(phase-3): tool latency panel with p50/p95/max + error rate        [B-4]
feat(phase-3): hook activity panel                                     [B-5]
feat(phase-3): pressure panel with retry/compaction/error KPIs         [B-6]
feat(phase-3): all six observability panels complete                   [gate]
