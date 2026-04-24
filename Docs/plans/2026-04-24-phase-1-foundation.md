# Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a SQLite derived-cache layer (WAL, `better-sqlite3`) with a cross-platform JSONL sync port of `scripts/sync_sessions.py`, so Phases 2–5 can run analytical queries without re-scanning `~/.claude/projects/` on every request.

**Architecture:** The existing filesystem reads in `lib/claude-data.ts` / `lib/claude-usage.ts` stay as source-of-truth. A new `lib/db.ts` creates every table named in the source spec's "Database schema" section (so Phase 5 never needs a migration), but only `sessions`, `tool_calls`, and `token_usage` get populated here. `lib/sync-sessions.ts` walks `~/.claude/projects/*/*.jsonl`, pairs `tool_use`/`tool_result` by id (10-min cap on orphans), day-buckets tokens in **local time** via `Intl.DateTimeFormat('en-CA', …)`, and upserts into SQLite. An HMR-safe module-level singleton (`Symbol.for('ccd.syncStarted')`) runs sync on boot and every 120 s with `setInterval().unref()`. A `POST /api/sync` route triggers it manually.

**Tech Stack:**
- Next.js 16 App Router, TypeScript (existing)
- `better-sqlite3` (new runtime dep — sync API, WAL mode, prebuilt Win/Mac/Linux binaries)
- `tsx` (new dev dep — runs `.ts` files via Node's built-in `node:test` runner: `npx tsx --test tests/**/*.test.ts`)
- No Jest, no Vitest, no Python.

---

## File structure

- **Create** `lib/db.ts` — opens the SQLite file at `~/.claude/ccd/dashboard.db` (override via `CCD_DB_PATH`), sets WAL, runs the full schema (all tables from the source spec, `CREATE TABLE IF NOT EXISTS`), exports `getDb()` singleton + `_migrateAddColumn(db, table, col, type)` helper.
- **Create** `lib/local-day.ts` — `localDay(isoOrMs, tz?)` → `YYYY-MM-DD` via `Intl.DateTimeFormat('en-CA', { timeZone, year, month, day })`. Exported separately so the day-boundary test stays tiny.
- **Create** `lib/sync-sessions.ts` — scans `getProjectsDir()`, parses JSONL line-by-line, pairs tool_use/tool_result, caps orphans at 10 min, aggregates token usage per `(localDay, model, source='ide')`, upserts `sessions` + `tool_calls` + `token_usage`. Skips re-parse when `mtime <= synced_at` unless `ended_at IS NULL`. Exports `syncSessions()` (one-shot) and `startSyncLoop()` (HMR-safe, 120 s interval, unref'd).
- **Create** `app/api/sync/route.ts` — `POST` calls `syncSessions()`, returns `{ ok, stats }`.
- **Modify** `app/layout.tsx` (or create `instrumentation.ts` per Next.js convention) — kick off `startSyncLoop()` at server boot.
- **Create** `tests/lib/local-day.test.ts` — evening-session UTC-midnight boundary probe.
- **Create** `tests/lib/db.test.ts` — schema/WAL/migrate-add-column.
- **Create** `tests/lib/sync-sessions.test.ts` — fixture JSONL with paired tool_use/result, orphaned tool_use, and a `result` event.
- **Create** `tests/fixtures/session-evening.jsonl` — evening timestamps near midnight UTC.
- **Create** `tests/fixtures/session-paired.jsonl` — tool_use→tool_result pair + orphan + result event.
- **Modify** `package.json` — add `better-sqlite3`, `@types/better-sqlite3`, `tsx`; add `"test"` script.
- **Modify** `.gitignore` — ignore `.ccd-test-*/` (test temp dirs) and `dashboard.db*`.
- **Modify** `README.md` **only if** the Windows native-build note isn't already there — add a short "Troubleshooting: `better-sqlite3` native build" section.

---

## Tasks

### Task 1: Add dependencies + test runner wiring

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing test**

Create `tests/smoke.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

test('better-sqlite3 loads and opens in-memory db', () => {
  const db = new Database(':memory:');
  const row = db.prepare('SELECT 1 AS n').get() as { n: number };
  assert.equal(row.n, 1);
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/smoke.test.ts`
Expected: FAIL with `Cannot find package 'better-sqlite3'` (module not installed) or `Cannot find package 'tsx'` if tsx itself is missing — install that first.

- [ ] **Step 3: Write minimal implementation**

Install deps + add script:

```bash
npm install better-sqlite3@^11
npm install -D @types/better-sqlite3@^7 tsx@^4
```

Patch `package.json` scripts:

```json
{
  "scripts": {
    "dev": "next dev -H 0.0.0.0",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "tsx --test tests/**/*.test.ts"
  }
}
```

Append to `.gitignore`:

```
# Phase 1 — SQLite cache + test scratch
.ccd-test-*/
dashboard.db
dashboard.db-*
```

**Windows native-build fallback** — if `npm install better-sqlite3` errors with MSBuild/node-gyp, the engineer runs:

```powershell
npm config set msvs_version 2022
npm install --global windows-build-tools  # only if VS Build Tools absent
npm rebuild better-sqlite3 --build-from-source
```

Document this in `README.md` under a new "Troubleshooting — `better-sqlite3` on Windows" heading if not already present.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/smoke.test.ts`
Expected: PASS — `tests 1`, `pass 1`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore tests/smoke.test.ts README.md
git commit -m "feat(phase-1): add better-sqlite3 + tsx test runner"
```

---

### Task 2: Local-time day bucketing helper

**Files:**
- Create: `lib/local-day.ts`
- Test: `tests/lib/local-day.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/local-day.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDay } from '../../lib/local-day';

test('localDay returns YYYY-MM-DD in the supplied timezone', () => {
  // 2026-04-24T23:30:00-04:00 → America/New_York → 2026-04-24
  assert.equal(localDay('2026-04-25T03:30:00.000Z', 'America/New_York'), '2026-04-24');
});

test('localDay handles evening sessions that cross UTC midnight', () => {
  // 2026-04-24T21:00:00-07:00 local = 2026-04-25T04:00:00Z
  // Local-time bucket must be 2026-04-24, NOT 2026-04-25
  assert.equal(localDay('2026-04-25T04:00:00.000Z', 'America/Los_Angeles'), '2026-04-24');
});

test('localDay accepts epoch millis', () => {
  // 2026-04-24T12:00:00Z → UTC → 2026-04-24
  const ms = Date.UTC(2026, 3, 24, 12, 0, 0);
  assert.equal(localDay(ms, 'UTC'), '2026-04-24');
});

test('localDay falls back to system tz when none supplied', () => {
  const out = localDay('2026-04-24T12:00:00.000Z');
  assert.match(out, /^\d{4}-\d{2}-\d{2}$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/lib/local-day.test.ts`
Expected: FAIL with `Cannot find module '../../lib/local-day'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/local-day.ts`:

```ts
/** Bucket an ISO string or epoch-ms value into a YYYY-MM-DD day key
 *  using local-time (or an explicit IANA timezone). Mirrors the source
 *  spec's `DATE(timestamp, 'localtime')` so evening sessions don't leak
 *  into tomorrow's bucket.
 */
export function localDay(value: string | number | Date, tz?: string): string {
  const d = value instanceof Date ? value : new Date(value);
  const timeZone = tz ?? process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA already yields YYYY-MM-DD, but we normalise defensively
  return fmt.format(d).slice(0, 10);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/lib/local-day.test.ts`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/local-day.ts tests/lib/local-day.test.ts
git commit -m "feat(phase-1): add localDay helper for evening-session bucketing"
```

---

### Task 3: SQLite schema + `lib/db.ts` with every table the spec names

**Files:**
- Create: `lib/db.ts`
- Test: `tests/lib/db.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, _migrateAddColumn } from '../../lib/db';

const EXPECTED_TABLES = [
  'sessions', 'token_usage', 'tool_calls',
  'otel_events', 'otel_metrics',
  'ops_tasks', 'ops_schedules', 'ops_decisions', 'ops_inbox',
  'activities', 'live_session_state',
  'mcp_stats', 'mcp_schemas',
  'skills', 'system_state', 'notification_log',
];

test('openDb creates every spec table + enables WAL', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '.ccd-test-'));
  const dbPath = path.join(dir, 'test.db');
  const db = openDb(dbPath);

  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  const have = new Set(names.map(r => r.name));
  for (const t of EXPECTED_TABLES) {
    assert.ok(have.has(t), `missing table ${t}`);
  }

  const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
  assert.equal(mode.journal_mode.toLowerCase(), 'wal');

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('openDb is idempotent (runs twice without error)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '.ccd-test-'));
  const dbPath = path.join(dir, 'test.db');
  openDb(dbPath).close();
  openDb(dbPath).close(); // second call — no "table already exists" error
  fs.rmSync(dir, { recursive: true, force: true });
});

test('_migrateAddColumn adds missing column and is a no-op when present', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '.ccd-test-'));
  const db = openDb(path.join(dir, 'm.db'));
  _migrateAddColumn(db, 'sessions', 'new_col', 'TEXT');
  _migrateAddColumn(db, 'sessions', 'new_col', 'TEXT'); // must not throw
  const cols = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
  assert.ok(cols.some(c => c.name === 'new_col'));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/lib/db.test.ts`
Expected: FAIL with `Cannot find module '../../lib/db'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/db.ts`:

```ts
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { getClaudeHome } from './claude-home';

export type DB = Database.Database;

let _singleton: DB | null = null;

/** Resolve the SQLite file path. Override via env for tests / custom installs. */
export function getDbPath(): string {
  if (process.env.CCD_DB_PATH) return process.env.CCD_DB_PATH;
  const dir = path.join(getClaudeHome(), 'ccd');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'dashboard.db');
}

/** Full schema — every table named in the source spec's "Database schema"
 *  section. Phases 1–5 all map into this; no downstream migration needed.
 *  Phase 1 only POPULATES `sessions`, `tool_calls`, `token_usage`.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'ide',       -- 'ide' | 'cowork'
  cwd TEXT,
  git_branch TEXT,
  model TEXT,
  started_at TEXT,
  ended_at TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_create_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  effective_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  duration_ms INTEGER,
  error_count INTEGER DEFAULT 0,
  rate_limit_hit INTEGER DEFAULT 0,
  stop_reason TEXT,
  title TEXT,
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS token_usage (
  date TEXT NOT NULL,
  model TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'ide',
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_create_tokens INTEGER DEFAULT 0,
  PRIMARY KEY (date, model, source)
);

CREATE TABLE IF NOT EXISTS tool_calls (
  session_id TEXT NOT NULL,
  tool_use_id TEXT NOT NULL,
  tool_name TEXT,
  ts TEXT,
  duration_ms INTEGER,
  error TEXT,
  PRIMARY KEY (session_id, tool_use_id)
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_name_ts ON tool_calls(tool_name, ts);

CREATE TABLE IF NOT EXISTS otel_events (
  event_name TEXT,
  session_id TEXT,
  prompt_id TEXT,
  timestamp TEXT,
  model TEXT,
  tool_name TEXT,
  tool_success INTEGER,
  tool_duration_ms INTEGER,
  tool_error TEXT,
  cost_usd REAL,
  api_duration_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_create_tokens INTEGER,
  speed TEXT,
  error_message TEXT,
  status_code INTEGER,
  attempt_count INTEGER,
  skill_name TEXT,
  skill_source TEXT,
  prompt_length INTEGER,
  decision TEXT,
  decision_source TEXT,
  request_id TEXT,
  tool_result_size_bytes INTEGER,
  mcp_server_scope TEXT,
  plugin_name TEXT,
  plugin_version TEXT,
  marketplace_name TEXT,
  install_trigger TEXT,
  mcp_server_name TEXT,
  mcp_tool_name TEXT,
  received_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_otel_events_ts ON otel_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_otel_events_name_ts ON otel_events(event_name, timestamp);

CREATE TABLE IF NOT EXISTS otel_metrics (
  metric_name TEXT,
  metric_type TEXT,                         -- 'counter' | 'gauge'
  value REAL,
  session_id TEXT,
  model TEXT,
  timestamp TEXT
);
CREATE INDEX IF NOT EXISTS idx_otel_metrics_name_ts ON otel_metrics(metric_name, timestamp);

CREATE TABLE IF NOT EXISTS ops_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,                     -- pending|awaiting_approval|running|done|failed|cancelled
  priority INTEGER DEFAULT 0,
  assigned_skill TEXT,
  model TEXT,
  execution_mode TEXT,                      -- 'classic' | 'stream'
  scheduled_for TEXT,
  requires_approval INTEGER DEFAULT 0,
  risk_level TEXT,
  dry_run INTEGER DEFAULT 0,
  quadrant TEXT,                            -- do|schedule|delegate|archive
  approved_at TEXT,
  session_id TEXT,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  cost_usd REAL,
  output_summary TEXT,
  error_message TEXT,
  consecutive_failures INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ops_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  task_title TEXT,
  task_description TEXT,
  assigned_skill TEXT,
  enabled INTEGER DEFAULT 1,
  next_run_at TEXT,
  last_run_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ops_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  session_id TEXT,
  prompt TEXT NOT NULL,
  answer TEXT,
  status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'answered'
  created_at TEXT DEFAULT (datetime('now')),
  answered_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ops_decisions_session_prompt
  ON ops_decisions(session_id, prompt)
  WHERE session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ops_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  session_id TEXT,
  direction TEXT NOT NULL,                  -- 'agent_to_user' | 'user_to_agent'
  body TEXT,
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  detail TEXT,
  metadata TEXT,                            -- JSON
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activities_type_ts ON activities(event_type, created_at);

CREATE TABLE IF NOT EXISTS live_session_state (
  session_id TEXT PRIMARY KEY,
  state TEXT,
  current_tool TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS mcp_stats (
  server TEXT PRIMARY KEY,
  tools INTEGER,
  total_tokens INTEGER,
  error TEXT,
  measured_at TEXT
);

CREATE TABLE IF NOT EXISTS mcp_schemas (
  server TEXT NOT NULL,
  tool TEXT NOT NULL,
  schema_json TEXT,
  tokens INTEGER,
  collected_at TEXT,
  PRIMARY KEY (server, tool)
);

CREATE TABLE IF NOT EXISTS skills (
  name TEXT PRIMARY KEY,
  environment TEXT,                         -- ide:project|ide:global|cowork:plugin|cowork:scheduled
  description TEXT,
  path TEXT,
  autonomy_level TEXT,                      -- auto|review|manual
  user_invocable INTEGER DEFAULT 0,
  script_count INTEGER DEFAULT 0,
  last_modified TEXT
);

CREATE TABLE IF NOT EXISTS system_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  event_key TEXT NOT NULL,
  sent_at TEXT,
  chat_id TEXT,
  telegram_message_id TEXT,
  snoozed_until TEXT,
  UNIQUE(event_type, event_key, chat_id)
);
`;

export function openDb(dbPath?: string): DB {
  const p = dbPath ?? getDbPath();
  const db = new Database(p);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

/** Process-wide singleton (production use). Tests should call `openDb(path)` directly. */
export function getDb(): DB {
  if (!_singleton) _singleton = openDb();
  return _singleton;
}

/** Idempotent "ADD COLUMN IF NOT EXISTS" helper.
 *  SQLite doesn't support IF NOT EXISTS on ADD COLUMN; we check pragma first.
 */
export function _migrateAddColumn(db: DB, table: string, col: string, type: string): void {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (info.some(c => c.name === col)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/lib/db.test.ts`
Expected: PASS — 3 tests pass. Every expected table is present, WAL is on, migration helper is idempotent.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts tests/lib/db.test.ts
git commit -m "feat(phase-1): add SQLite schema with full spec tables + WAL"
```

---

### Task 4: JSONL fixtures for sync tests

**Files:**
- Create: `tests/fixtures/session-paired.jsonl`
- Create: `tests/fixtures/session-evening.jsonl`

- [ ] **Step 1: Write the failing test**

Create `tests/fixtures.test.ts` (a throwaway sanity check — we'll delete it at the end of this task):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('fixture JSONLs exist and parse line-by-line', () => {
  for (const name of ['session-paired.jsonl', 'session-evening.jsonl']) {
    const p = path.join(__dirname, 'fixtures', name);
    const raw = fs.readFileSync(p, 'utf8');
    for (const line of raw.split('\n').filter(Boolean)) {
      JSON.parse(line); // must not throw
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/fixtures.test.ts`
Expected: FAIL with `ENOENT … session-paired.jsonl`.

- [ ] **Step 3: Write minimal implementation**

Create `tests/fixtures/session-paired.jsonl` (one JSON object per line — do not pretty-print):

```jsonl
{"type":"user","sessionId":"sess-paired-1","cwd":"/tmp/demo","gitBranch":"main","timestamp":"2026-04-24T10:00:00.000Z","message":{"role":"user","content":"hi"}}
{"type":"assistant","sessionId":"sess-paired-1","timestamp":"2026-04-24T10:00:01.000Z","message":{"role":"assistant","model":"claude-sonnet-4-7","content":[{"type":"text","text":"hello"},{"type":"tool_use","id":"toolu_01","name":"Read","input":{"path":"/a"}}],"usage":{"input_tokens":100,"output_tokens":20,"cache_read_input_tokens":5,"cache_creation_input_tokens":0}}}
{"type":"user","sessionId":"sess-paired-1","timestamp":"2026-04-24T10:00:03.500Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_01","content":"ok"}]}}
{"type":"assistant","sessionId":"sess-paired-1","timestamp":"2026-04-24T10:00:04.000Z","message":{"role":"assistant","model":"claude-sonnet-4-7","content":[{"type":"tool_use","id":"toolu_02_orphan","name":"Bash","input":{"command":"sleep 1000"}}],"usage":{"input_tokens":50,"output_tokens":10,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}
{"type":"result","sessionId":"sess-paired-1","timestamp":"2026-04-24T10:00:10.000Z","total_cost_usd":0.0123,"duration_ms":10000,"is_error":false,"stop_reason":"end_turn"}
```

Create `tests/fixtures/session-evening.jsonl` (evening session — 21:30 America/Los_Angeles = 04:30 UTC next day):

```jsonl
{"type":"user","sessionId":"sess-evening-1","cwd":"/tmp/demo","gitBranch":"main","timestamp":"2026-04-25T04:30:00.000Z","message":{"role":"user","content":"late night"}}
{"type":"assistant","sessionId":"sess-evening-1","timestamp":"2026-04-25T04:30:05.000Z","message":{"role":"assistant","model":"claude-sonnet-4-7","content":[{"type":"text","text":"ack"}],"usage":{"input_tokens":200,"output_tokens":40,"cache_read_input_tokens":10,"cache_creation_input_tokens":0}}}
{"type":"result","sessionId":"sess-evening-1","timestamp":"2026-04-25T04:30:10.000Z","total_cost_usd":0.003,"duration_ms":10000,"is_error":false,"stop_reason":"end_turn"}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/fixtures.test.ts`
Expected: PASS — each line in each fixture parses.

Then delete `tests/fixtures.test.ts` (sanity-check only):

```bash
rm tests/fixtures.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/session-paired.jsonl tests/fixtures/session-evening.jsonl
git commit -m "test(phase-1): add JSONL fixtures for sync tests"
```

---

### Task 5: `syncSessions()` — parse, pair tools, upsert

**Files:**
- Create: `lib/sync-sessions.ts`
- Test: `tests/lib/sync-sessions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/sync-sessions.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../lib/db';
import { syncSessions } from '../../lib/sync-sessions';

function scratchHome(): { home: string; projectsDir: string; cleanup: () => void } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), '.ccd-test-'));
  const projectsDir = path.join(home, 'projects', '-tmp-demo');
  fs.mkdirSync(projectsDir, { recursive: true });
  return {
    home,
    projectsDir,
    cleanup: () => fs.rmSync(home, { recursive: true, force: true }),
  };
}

test('syncSessions pairs tool_use/tool_result, caps orphans, upserts totals', () => {
  const { home, projectsDir, cleanup } = scratchHome();
  process.env.CLAUDE_HOME = home;
  const dbPath = path.join(home, 'test.db');

  fs.copyFileSync(
    path.join(__dirname, '..', 'fixtures', 'session-paired.jsonl'),
    path.join(projectsDir, 'sess-paired-1.jsonl')
  );

  const db = openDb(dbPath);
  const stats = syncSessions({ db });
  assert.equal(stats.sessionsSynced, 1);

  const sess = db.prepare("SELECT * FROM sessions WHERE session_id='sess-paired-1'").get() as any;
  assert.ok(sess, 'session row missing');
  assert.equal(sess.model, 'claude-sonnet-4-7');
  assert.equal(sess.input_tokens, 150);     // 100 + 50
  assert.equal(sess.output_tokens, 30);     // 20 + 10
  assert.equal(sess.cache_read_tokens, 5);
  assert.equal(sess.stop_reason, 'end_turn');
  assert.equal(sess.cwd, '/tmp/demo');
  assert.equal(sess.git_branch, 'main');
  assert.ok(sess.cost_usd > 0);

  const tools = db.prepare("SELECT * FROM tool_calls WHERE session_id='sess-paired-1' ORDER BY tool_use_id").all() as any[];
  assert.equal(tools.length, 2);
  const paired = tools.find(t => t.tool_use_id === 'toolu_01')!;
  assert.equal(paired.tool_name, 'Read');
  assert.equal(paired.duration_ms, 2500);   // 10:00:03.500 − 10:00:01.000
  const orphan = tools.find(t => t.tool_use_id === 'toolu_02_orphan')!;
  assert.equal(orphan.duration_ms, null, 'orphan must have null duration');

  db.close();
  delete process.env.CLAUDE_HOME;
  cleanup();
});

test('syncSessions skips files when mtime <= synced_at and session ended', () => {
  const { home, projectsDir, cleanup } = scratchHome();
  process.env.CLAUDE_HOME = home;
  const db = openDb(path.join(home, 'test.db'));

  fs.copyFileSync(
    path.join(__dirname, '..', 'fixtures', 'session-paired.jsonl'),
    path.join(projectsDir, 'sess-paired-1.jsonl')
  );

  const first = syncSessions({ db });
  assert.equal(first.sessionsSynced, 1);

  const second = syncSessions({ db });
  assert.equal(second.sessionsSkipped, 1, 'second pass should skip unchanged file');
  assert.equal(second.sessionsSynced, 0);

  db.close();
  delete process.env.CLAUDE_HOME;
  cleanup();
});

test('syncSessions buckets evening-session tokens into local day (not UTC)', () => {
  const { home, projectsDir, cleanup } = scratchHome();
  process.env.CLAUDE_HOME = home;
  process.env.TZ = 'America/Los_Angeles';
  const db = openDb(path.join(home, 'test.db'));

  fs.copyFileSync(
    path.join(__dirname, '..', 'fixtures', 'session-evening.jsonl'),
    path.join(projectsDir, 'sess-evening-1.jsonl')
  );

  syncSessions({ db });

  const rows = db.prepare('SELECT * FROM token_usage').all() as any[];
  assert.equal(rows.length, 1);
  // UTC date is 2026-04-25, but local (Los_Angeles) date is 2026-04-24
  assert.equal(rows[0].date, '2026-04-24');
  assert.equal(rows[0].input_tokens, 200);
  assert.equal(rows[0].cache_read_tokens, 10);

  db.close();
  delete process.env.CLAUDE_HOME;
  delete process.env.TZ;
  cleanup();
});

test('syncSessions no-ops when ~/.claude/projects does not exist (fresh install)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), '.ccd-test-'));
  process.env.CLAUDE_HOME = home; // no projects/ dir inside
  const db = openDb(path.join(home, 'test.db'));

  const stats = syncSessions({ db });
  assert.equal(stats.sessionsSynced, 0);
  assert.equal(stats.sessionsSkipped, 0);

  db.close();
  delete process.env.CLAUDE_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/lib/sync-sessions.test.ts`
Expected: FAIL with `Cannot find module '../../lib/sync-sessions'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/sync-sessions.ts`:

```ts
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

function bucketKey(day: string, model: string) { return `${day}\u0001${model}`; }

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
      const [day, model] = key.split('\u0001');
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/lib/sync-sessions.test.ts`
Expected: PASS — all 4 tests green. Pairing/orphans/skip/local-day/fresh-install cases all covered.

- [ ] **Step 5: Commit**

```bash
git add lib/sync-sessions.ts tests/lib/sync-sessions.test.ts
git commit -m "feat(phase-1): port JSONL sync — tool pairing + local-day buckets"
```

---

### Task 6: Manual trigger route — `POST /api/sync`

**Files:**
- Create: `app/api/sync/route.ts`
- Test: `tests/api/sync-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/api/sync-route.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('POST /api/sync route module exposes POST and returns stats', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), '.ccd-test-'));
  const projectsDir = path.join(home, 'projects', '-tmp-demo');
  fs.mkdirSync(projectsDir, { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '..', 'fixtures', 'session-paired.jsonl'),
    path.join(projectsDir, 'sess-paired-1.jsonl')
  );
  process.env.CLAUDE_HOME = home;
  process.env.CCD_DB_PATH = path.join(home, 'dashboard.db');

  const mod = await import('../../app/api/sync/route');
  assert.equal(typeof mod.POST, 'function');

  const res = await mod.POST();
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.stats.sessionsSynced, 1);
  assert.equal(res.status, 200);

  delete process.env.CLAUDE_HOME;
  delete process.env.CCD_DB_PATH;
  fs.rmSync(home, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/api/sync-route.test.ts`
Expected: FAIL with `Cannot find module '../../app/api/sync/route'`.

- [ ] **Step 3: Write minimal implementation**

Create `app/api/sync/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { syncSessions } from '@/lib/sync-sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const stats = syncSessions();
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/api/sync-route.test.ts`
Expected: PASS — route returns `{ ok: true, stats: { sessionsSynced: 1, … } }`.

Also confirm it compiles under Next's type system:

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/sync/route.ts tests/api/sync-route.test.ts
git commit -m "feat(phase-1): add POST /api/sync manual trigger"
```

---

### Task 7: HMR-safe boot-time + 120 s interval sync loop

**Files:**
- Create: `instrumentation.ts` (Next.js 16 boot hook at project root)
- Modify: `lib/sync-sessions.ts` (append `startSyncLoop`)
- Test: `tests/lib/sync-loop.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/sync-loop.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('startSyncLoop is idempotent across repeated invocations (HMR-safe)', async () => {
  // Import twice — simulates Next.js HMR re-running instrumentation.ts
  const { startSyncLoop, _syncLoopStarted } = await import('../../lib/sync-sessions');
  const a = startSyncLoop({ intervalMs: 60_000, runNow: false });
  const b = startSyncLoop({ intervalMs: 60_000, runNow: false });
  assert.equal(a, b, 'second call must return the same timer handle');
  assert.ok(_syncLoopStarted(), 'sentinel should be set');
});

test('startSyncLoop uses setInterval().unref() so it does not block process exit', async () => {
  const { startSyncLoop } = await import('../../lib/sync-sessions');
  const handle = startSyncLoop({ intervalMs: 60_000, runNow: false });
  // Node timers expose `hasRef()` — false after unref()
  assert.equal(typeof (handle as any).hasRef, 'function');
  assert.equal((handle as any).hasRef(), false, 'timer must be unref\\'d');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/lib/sync-loop.test.ts`
Expected: FAIL with `startSyncLoop is not a function` (not yet exported).

- [ ] **Step 3: Write minimal implementation**

Append to `lib/sync-sessions.ts`:

```ts
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
```

Create `instrumentation.ts` at project root (Next.js 16's official boot hook):

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startSyncLoop } = await import('./lib/sync-sessions');
  startSyncLoop(); // runNow: true, interval: 120s
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/lib/sync-loop.test.ts`
Expected: PASS — both tests green.

Then confirm Next.js picks up the instrumentation file:

Run: `npm run dev` in a second terminal, then `curl -X POST http://localhost:3000/api/sync`
Expected: `{"ok":true,"stats":{...}}` — and the dev console shows no `[sync]` errors.

- [ ] **Step 5: Commit**

```bash
git add instrumentation.ts lib/sync-sessions.ts tests/lib/sync-loop.test.ts
git commit -m "feat(phase-1): HMR-safe boot-time sync loop (120s, unref'd)"
```

---

### Task 8: Full-suite verification + typecheck + lint

**Files:** none (verification only)

- [ ] **Step 1: Write the failing test**

N/A — aggregation step. No new test file. The failing signal is the full suite not yet run together.

- [ ] **Step 2: Run test to verify it fails**

Not applicable — just confirm the current state:

Run: `npm test`
Expected: all Phase 1 tests pass. If any fail, fix them before proceeding.

- [ ] **Step 3: Write minimal implementation**

No code changes. If `npm test` turned up anything broken, fix the offending task and re-run.

- [ ] **Step 4: Run test to verify it passes**

Run these three in order; all must succeed:

```bash
npm test
npx tsc --noEmit
npm run lint
```

Expected:
- `npm test` — every test file under `tests/` passes, `pass >= 14`, `fail 0`.
- `npx tsc --noEmit` — no diagnostics.
- `npm run lint` — no errors.

Also do a manual end-to-end smoke on a real `~/.claude/`:

```bash
npm run dev
# in another shell
curl -X POST http://localhost:3000/api/sync
sqlite3 ~/.claude/ccd/dashboard.db "SELECT COUNT(*) FROM sessions; SELECT COUNT(*) FROM tool_calls; SELECT COUNT(*) FROM token_usage;"
```

Expected: three non-zero counts (assuming the machine has any existing sessions).

- [ ] **Step 5: Commit**

Only if anything changed during fixup:

```bash
git commit -am "chore(phase-1): final verification pass"
```

Otherwise skip.

---

## Stop conditions

Phase 1 is complete when **all** of the below hold:

- [ ] `npm test` runs the full Phase 1 suite with zero failures and at least 14 tests passing.
- [ ] `npx tsc --noEmit` passes with no diagnostics.
- [ ] `npm run lint` passes.
- [ ] `better-sqlite3` is present in `dependencies` (not `devDependencies`) and resolves on Windows, macOS, and Linux.
- [ ] `lib/db.ts` creates every table named in the source spec's "Database schema" section — verified by the `EXPECTED_TABLES` list in `tests/lib/db.test.ts`.
- [ ] `PRAGMA journal_mode` reports `wal` on the opened DB.
- [ ] `_migrateAddColumn()` is idempotent (test proves it).
- [ ] `lib/sync-sessions.ts`:
  - pairs `tool_use` / `tool_result` by id;
  - caps orphaned durations at 10 min (stored as `NULL` in `tool_calls.duration_ms`);
  - day-buckets token usage via `localDay()`, verified by the evening-session test placing tokens in `2026-04-24` under `TZ=America/Los_Angeles` (not `2026-04-25` UTC);
  - skips files whose `mtime <= synced_at` when the session already has a non-null `ended_at`;
  - no-ops cleanly when `~/.claude/projects/` is missing (fresh install).
- [ ] `POST /api/sync` returns `{ ok: true, stats: { sessionsSynced, sessionsSkipped, toolCalls, errors } }` and completes in under 5 s on a 50-session machine.
- [ ] `instrumentation.ts` kicks off `startSyncLoop()` at boot. The sentinel `Symbol.for('ccd.syncStarted')` survives Next.js HMR re-runs — the test proves repeated invocations return the same timer handle.
- [ ] The sync interval timer was created with `.unref()` — `handle.hasRef()` is `false`.
- [ ] After one manual run on the developer's machine, `sqlite3 ~/.claude/ccd/dashboard.db "SELECT COUNT(*) FROM sessions;"` returns a count > 0.
- [ ] OTEL tables (`otel_events`, `otel_metrics`), Mission Control tables (`ops_tasks`, `ops_schedules`, `ops_decisions`, `ops_inbox`), `activities`, `live_session_state`, `mcp_stats`, `mcp_schemas`, `skills`, `system_state`, `notification_log` all exist and are **empty** — Phase 1 intentionally does not populate them.
- [ ] README has a "Troubleshooting — `better-sqlite3` on Windows" section with the `msvs_version 2022` / `npm rebuild … --build-from-source` fallback.
- [ ] At least 8 commits landed on the branch, one per task, all prefixed `feat(phase-1):` / `test(phase-1):` / `chore(phase-1):`.
