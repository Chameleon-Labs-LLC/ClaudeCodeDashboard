# Phase 5 — Mission Control (Dispatcher + Scheduler + HITL)

> **Depends on:** Phase 1 (SQLite schema, `better-sqlite3`, `.tmp/mission-control-queue/` directory convention).
> **Cross-platform risk:** Master plan risk #4. PID files on disk are the ONLY reliable cross-platform substitute for `pkill`/`ps eww`/`proc.environ`. They also prevent false positives against PID-recycled unrelated processes. Every spawn writes `.tmp/mission-control-queue/pids/{pid}` and every exit (including crashes) unlinks it. Emergency stop reads *only* these files.
> **Entry point:** `npm run daemon` — no launchd, no systemd, no Windows Service. Autostart is documented as a per-user setup step.

---

## Architecture overview

```
npm run daemon
      │
      ▼
scripts/daemon.ts          ← Node entry point, 120s loop
      │
      ├─► lib/heartbeat.ts  ← schedule materialiser (BEGIN EXCLUSIVE guard)
      └─► lib/dispatcher.ts ← runOnce() — checks emergency_stop, sweeps PIDs,
                              claims up to MAX_CONCURRENT pending tasks,
                              spawns claude -p children
                                │
                                ├── classic mode → spawn, capture stdout
                                └── stream mode  → spawn with stdio pipes
                                                   read stdout line-by-line
                                                   parse DECISION:/INBOX: markers
                                                   skip triple-backtick fenced blocks
                                                   poll ops_decisions for answers
                                                   inject answers to stdin
                                                   poll queue JSONL for user follow-ups

PID files: .tmp/mission-control-queue/pids/{pid}   ← written on spawn, unlinked on exit

Next.js API routes (called by daemon and by the browser):
  /api/tasks            ← CRUD on ops_tasks (rewrite of existing route)
  /api/tasks/[id]/approve
  /api/tasks/[id]/rerun
  /api/schedules        ← CRUD on ops_schedules
  /api/schedules/parse-nl
  /api/decisions        ← HITL Q&A
  /api/inbox            ← HITL messages
  /api/system/emergency-stop
  /api/system/emergency-resume
  /api/system/state
  /api/dispatcher/trigger

React components at /dashboard/tasks:
  EmergencyStopBanner   ← red header button, confirm dialog
  TaskBoard             ← 3-column kanban (pending/running/done)
  TaskComposer          ← slide-out Sheet, creates ops_tasks rows
  SchedulesCard         ← list + enabled toggle + next-run countdown
  ScheduleComposer      ← slide-out Sheet, creates ops_schedules rows
  DecisionsCard         ← pending HITL decisions, poll 5s
  InboxCard             ← unread agent→user messages, poll 10s
```

## Package additions

Before starting, add to `package.json`:

```json
"better-sqlite3": "^9.6.0",
"@types/better-sqlite3": "^7.6.10"
```

Add `daemon` script and `tsx` dev dependency:

```json
"scripts": {
  "daemon": "tsx scripts/daemon.ts"
},
"devDependencies": {
  "tsx": "^4.7.0"
}
```

`better-sqlite3` native build on Windows requires `npm config set msvs_version 2022` if it fails — see master plan risk #1.

---

## Sub-area A: Dispatcher daemon

### A-1 — Create `.tmp/mission-control-queue/` directory structure

**Files:**
- Add `.tmp/mission-control-queue/` to `.gitignore`
- Create `.tmp/.gitkeep` (empty, committed so the `.tmp/` dir exists in git)

The daemon creates `.tmp/mission-control-queue/pids/` at startup if missing.

**Commit:** `chore: add .tmp scaffold and gitignore for mission-control queue`

---

### A-2 — `lib/db.ts` — shared `better-sqlite3` singleton

**File:** `lib/db.ts`

Responsibilities: open (or create) the SQLite database, enable WAL mode, export `getDb()`. Safe for use in both the Next.js process (API routes) and the daemon process. Path from `CLAUDE_DB_PATH` env var, defaulting to `path.join(process.cwd(), '.tmp', 'dashboard.db')`.

```typescript
import Database from 'better-sqlite3';
import path from 'path';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = process.env.CLAUDE_DB_PATH
      ?? path.join(process.cwd(), '.tmp', 'dashboard.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    ensureSchema(db);
  }
  return db;
}
```

`ensureSchema(db)` runs all CREATE TABLE IF NOT EXISTS statements (see A-21 for the full list). This makes the DB self-initialising — Phase 1 migrations or not, the schema is always present.

**Expected output:** `getDb()` returns the same instance within a process; `PRAGMA journal_mode` returns `wal`.

**Commit:** `feat(db): better-sqlite3 singleton with WAL mode`

---

### A-3 — `lib/task-tracker.ts`

**File:** `lib/task-tracker.ts`

All functions synchronous (better-sqlite3). Exports the full CRUD surface for `ops_tasks`.

**Critical — atomic `claimPending`:**

```typescript
export function claimPending(taskId: number): OpsTask | null {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `UPDATE ops_tasks
       SET status='running', started_at=?
       WHERE id=? AND status='pending'`
    )
    .run(now, taskId);
  if (result.changes === 0) return null; // already claimed by another runner
  return getTask(taskId);
}
```

The `WHERE status='pending'` guard is the atomicity fence. SQLite serialises writes; `changes === 0` is definitive. No explicit transaction needed.

**`failTask` must increment `consecutive_failures`:**

```typescript
export function failTask(id: number, errorMessage: string, durationMs?: number): void {
  getDb()
    .prepare(
      `UPDATE ops_tasks
       SET status='failed',
           error_message=?,
           completed_at=?,
           duration_ms=COALESCE(?,duration_ms),
           consecutive_failures=consecutive_failures+1
       WHERE id=?`
    )
    .run(errorMessage, new Date().toISOString(), durationMs ?? null, id);
}
```

**Full interface:**

```typescript
export interface OpsTask { /* see types/mission-control.ts C-18 */ }

export function createTask(fields: CreateTaskInput): OpsTask;
export function claimPending(taskId: number): OpsTask | null;
export function getTask(id: number): OpsTask | null;
export function updateTask(id: number, fields: Partial<OpsTask>): void;
export function completeTask(id: number, outputSummary: string, durationMs: number, costUsd?: number): void;
export function failTask(id: number, errorMessage: string, durationMs?: number): void;
export function listTasks(filters?: { status?: string; quadrant?: string }): OpsTask[];
export function deleteTask(id: number): void;
```

**Test:** `test/task-tracker.test.ts` — open two `Database` instances to the same file, both call `claimPending(id)` synchronously (better-sqlite3 is sync so they serialize through SQLite), assert exactly one returns non-null.

**Commit:** `feat(task-tracker): atomic claim and CRUD for ops_tasks`

---

### A-4 — `lib/heartbeat.ts` — schedule materialiser

**File:** `lib/heartbeat.ts`

**`parseCronSimple` — full implementation:**

The format is `{minute} {hour} * * {dow}` where `dow` is 0–6, Mon=0, Sun=6 — matching Python `dt.weekday()` and the ScheduleComposer UI. DST-safe because it iterates wall-clock minutes using `Date` arithmetic rather than UTC epoch offsets.

```typescript
export function parseCronSimple(expr: string, from: Date): Date | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minStr, hourStr, , , dowStr] = parts;
  const minute = parseInt(minStr, 10);
  const hour = parseInt(hourStr, 10);
  const targetDow = parseInt(dowStr, 10); // Mon=0..Sun=6

  if (isNaN(minute) || isNaN(hour) || isNaN(targetDow)) return null;
  if (minute < 0 || minute > 59) return null;
  if (hour < 0 || hour > 23) return null;
  if (targetDow < 0 || targetDow > 6) return null;

  // JS getDay(): Sun=0, Mon=1..Sat=6. Convert to Mon=0..Sun=6:
  function jsDayToPython(jsDay: number): number {
    return jsDay === 0 ? 6 : jsDay - 1;
  }

  // Start from the next minute to avoid re-firing the same minute
  const candidate = new Date(from.getTime() + 60_000);
  candidate.setSeconds(0, 0);

  for (let i = 0; i < 10_080; i++) { // scan up to 7 days of minutes
    if (
      candidate.getMinutes() === minute &&
      candidate.getHours() === hour &&
      jsDayToPython(candidate.getDay()) === targetDow
    ) {
      return new Date(candidate); // clone before returning
    }
    candidate.setTime(candidate.getTime() + 60_000);
  }
  return null;
}
```

**`materializeSchedules` — BEGIN EXCLUSIVE guard:**

```typescript
export function materializeSchedules(): number {
  const db = getDb();
  const now = new Date();
  let created = 0;

  // .exclusive() maps to BEGIN EXCLUSIVE — prevents two daemon processes
  // from double-materialising the same schedule window
  db.transaction(() => {
    const schedules = db
      .prepare(
        `SELECT * FROM ops_schedules
         WHERE enabled=1 AND (next_run_at IS NULL OR next_run_at <= ?)`
      )
      .all(now.toISOString()) as OpsSchedule[];

    for (const sched of schedules) {
      createTask({
        title: sched.task_title,
        description: sched.task_description ?? undefined,
        assigned_skill: sched.assigned_skill ?? undefined,
      });
      created++;

      const next = sched.cron_expression
        ? parseCronSimple(sched.cron_expression, now)
        : null;

      db.prepare(
        `UPDATE ops_schedules SET last_run_at=?, next_run_at=? WHERE id=?`
      ).run(now.toISOString(), next?.toISOString() ?? null, sched.id);
    }
  }).exclusive()();

  return created;
}
```

**Tests in `test/heartbeat.test.ts`:**
1. `parseCronSimple('0 9 * * 0', new Date('2026-03-08T09:01:00'))` (Mon=0, so this is Mon 9am, one minute after 9am on a Sunday) — assert result is the next Monday 2026-03-09 at 09:00 local wall-clock time.
2. DST case: `parseCronSimple('0 9 * * 0', new Date('2026-03-08T09:01:00-05:00'))` during US spring-forward — result must be `2026-03-09T09:00` in local time, not `2026-03-09T10:00` UTC-offset-confused.
3. Two calls to `materializeSchedules()` within the same second on the same schedule row — exactly one `ops_tasks` row is created.
4. Schedule with `next_run_at` 1 hour in the future — not materialised.
5. `parseCronSimple` with invalid input (wrong number of parts, NaN values, out-of-range) — returns `null`.

**Commit:** `feat(heartbeat): schedule materialiser with DST-safe cron parser`

---

### A-5 — `lib/skill-router.ts` — stub

**File:** `lib/skill-router.ts`

```typescript
/**
 * Skill router — selects the best matching skill for a task.
 *
 * STUB: always returns null. Haiku integration is a follow-up task.
 *
 * To implement:
 *   1. Add @anthropic-ai/sdk to dependencies.
 *   2. Set ANTHROPIC_API_KEY in .env.
 *   3. Call claude-3-haiku-20240307 with:
 *      "Given task title '<title>' and description '<desc>', which skill
 *       from this list best matches? Reply with exactly the skill name
 *       or 'none': <skills.join(', ')>"
 *   Estimated cost: ~$0.0001 per pick.
 */
export async function pickSkill(
  _title: string,
  _description: string,
  _skills: string[]
): Promise<string | null> {
  return null;
}
```

**Commit:** `feat(skill-router): stub, Haiku integration deferred`

---

### A-6 — `lib/dispatcher.ts` — core dispatcher

**File:** `lib/dispatcher.ts`

This is the most complex module. Implement in sections.

**Constants and PID helpers:**

```typescript
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getDb } from './db';
import { claimPending, completeTask, failTask, updateTask, getTask } from './task-tracker';
import type { OpsTask } from '@/types/mission-control';

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT ?? '3', 10);
const TASK_TIMEOUT_MS = parseInt(process.env.TASK_TIMEOUT_SECONDS ?? '300', 10) * 1000;
const DECISION_POLL_INTERVAL_MS = 2000;
const QUEUE_DIR = path.join(process.cwd(), '.tmp', 'mission-control-queue');
const PID_DIR = path.join(QUEUE_DIR, 'pids');

function markPid(pid: number): void {
  fs.mkdirSync(PID_DIR, { recursive: true });
  fs.writeFileSync(path.join(PID_DIR, String(pid)), String(pid), 'utf-8');
}

function unmarkPid(pid: number): void {
  try { fs.unlinkSync(path.join(PID_DIR, String(pid))); } catch { /* already gone */ }
}
```

**`sweepStalePids`:**

```typescript
function sweepStalePids(): void {
  let files: string[];
  try { files = fs.readdirSync(PID_DIR); } catch { return; }
  for (const f of files) {
    const pid = parseInt(f, 10);
    if (isNaN(pid)) continue;
    try {
      process.kill(pid, 0); // throws if dead (ESRCH on Unix, error on Win)
    } catch {
      try { fs.unlinkSync(path.join(PID_DIR, f)); } catch { /* race: already gone */ }
    }
  }
}
```

**`buildEnv`:**

```typescript
function buildEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:3000',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_LOGS_EXPORTER: 'otlp',
    ATOMICOPS_DISPATCHED: '1',
  };
}
```

**`resolveModel`:**

```typescript
function resolveModel(task: OpsTask): string {
  return task.model
    ?? process.env.MISSION_CONTROL_DEFAULT_MODEL
    ?? 'claude-3-5-sonnet-20241022';
}
```

**Line-buffered stdout reader:**

```typescript
function makeLineReader(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void
): void {
  let buf = '';
  stream.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf-8');
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) onLine(line);
  });
  stream.on('end', () => {
    if (buf.trim()) onLine(buf);
    buf = '';
  });
}
```

**Fenced-block-aware DECISION:/INBOX: parser:**

This is a critical safety gate. Claude legitimately outputs code blocks that may contain the strings `DECISION:` or `INBOX:` as examples. Lines inside a fenced block must never trigger HITL actions.

```typescript
interface FenceState { inFencedBlock: boolean }
interface ParsedMarker { type: 'decision' | 'inbox'; payload: string }

export function parseMarker(line: string, state: FenceState): ParsedMarker | null {
  const trimmed = line.trim();

  // Toggle fenced block on any triple-backtick line (opening or closing)
  if (trimmed.startsWith('```')) {
    state.inFencedBlock = !state.inFencedBlock;
    return null;
  }

  // Inside a fenced block — ignore all content
  if (state.inFencedBlock) return null;

  if (trimmed.startsWith('DECISION:')) {
    return { type: 'decision', payload: trimmed.slice('DECISION:'.length).trim() };
  }
  if (trimmed.startsWith('INBOX:')) {
    return { type: 'inbox', payload: trimmed.slice('INBOX:'.length).trim() };
  }
  return null;
}
```

**`runClassic`:**

```typescript
async function runClassic(task: OpsTask): Promise<void> {
  const prompt = [task.title, task.description].filter(Boolean).join('\n\n');
  const model = resolveModel(task);
  const args = ['-p', prompt, '--model', model, '--output-format', 'json'];
  if (task.dry_run) args.push('--dry-run');

  const proc = spawn('claude', args, {
    env: buildEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const pid = proc.pid!;
  markPid(pid);
  const startMs = Date.now();
  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
  proc.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      failTask(task.id, `Timeout after ${TASK_TIMEOUT_MS}ms`, Date.now() - startMs);
      unmarkPid(pid);
      resolve();
    }, TASK_TIMEOUT_MS);

    proc.on('close', (code) => {
      clearTimeout(timer);
      unmarkPid(pid);
      const durationMs = Date.now() - startMs;
      if (code === 0) {
        completeTask(task.id, stdout.slice(0, 2000), durationMs);
      } else {
        failTask(task.id, stderr.slice(0, 500) || `Exit code ${code}`, durationMs);
      }
      resolve();
    });
  });
}
```

**`runStream`:**

```typescript
async function runStream(task: OpsTask): Promise<void> {
  const prompt = [task.title, task.description].filter(Boolean).join('\n\n');
  const model = resolveModel(task);
  const args = ['-p', prompt, '--model', model, '--output-format', 'stream-json', '--verbose'];
  if (task.dry_run) args.push('--dry-run');

  const proc = spawn('claude', args, {
    env: buildEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const pid = proc.pid!;
  markPid(pid);
  const startMs = Date.now();
  let sessionId: string | null = null;
  let lastQueueOffset = 0;
  const fenceState: FenceState = { inFencedBlock: false };
  let stderr = '';
  let done = false;

  proc.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });

  // Poll user follow-up queue and inject lines into stdin
  const queuePoller = setInterval(() => {
    if (!sessionId) return;
    const queueFile = path.join(QUEUE_DIR, `${sessionId}.jsonl`);
    try {
      const size = fs.statSync(queueFile).size;
      if (size <= lastQueueOffset) return;
      const fd = fs.openSync(queueFile, 'r');
      const buf = Buffer.alloc(size - lastQueueOffset);
      fs.readSync(fd, buf, 0, buf.length, lastQueueOffset);
      fs.closeSync(fd);
      lastQueueOffset = size;
      for (const line of buf.toString('utf-8').split('\n')) {
        if (line.trim()) proc.stdin.write(line + '\n');
      }
    } catch { /* queue file not created yet */ }
  }, 2000);

  function postHttp(urlPath: string, body: object): void {
    const baseUrl = process.env.DASHBOARD_URL ?? 'http://localhost:3000';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { request } = require(baseUrl.startsWith('https') ? 'https' : 'http');
    const raw = JSON.stringify(body);
    const req = request(
      baseUrl + urlPath,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) } },
      (res: any) => {
        let data = '';
        res.on('data', (c: Buffer) => { data += c; });
        res.on('end', () => data);
      }
    );
    req.on('error', () => {});
    req.write(raw);
    req.end();
  }

  function handleDecision(decisionPrompt: string): void {
    const payload = { task_id: task.id, session_id: sessionId, prompt: decisionPrompt };
    const baseUrl = process.env.DASHBOARD_URL ?? 'http://localhost:3000';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { request } = require(baseUrl.startsWith('https') ? 'https' : 'http');
    const raw = JSON.stringify(payload);
    const req = request(
      baseUrl + '/api/decisions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) },
      },
      (res: any) => {
        let data = '';
        res.on('data', (c: Buffer) => { data += c; });
        res.on('end', () => {
          try {
            const { id: decisionId } = JSON.parse(data);
            const deadline = Date.now() + TASK_TIMEOUT_MS;
            const poller = setInterval(() => {
              const row = getDb()
                .prepare(`SELECT answer FROM ops_decisions WHERE id=? AND status='answered'`)
                .get(decisionId) as { answer: string } | undefined;
              if (row) {
                clearInterval(poller);
                if (!done) proc.stdin.write(row.answer + '\n');
              } else if (Date.now() > deadline) {
                clearInterval(poller);
                if (!done) proc.kill('SIGTERM');
              }
            }, DECISION_POLL_INTERVAL_MS);
          } catch { /* malformed response */ }
        });
      }
    );
    req.on('error', () => {});
    req.write(raw);
    req.end();
  }

  function handleInbox(message: string): void {
    postHttp('/api/inbox', {
      task_id: task.id,
      session_id: sessionId,
      direction: 'agent_to_user',
      body: message,
    });
  }

  makeLineReader(proc.stdout, (line) => {
    try {
      const obj = JSON.parse(line);
      // Capture session_id from the init event
      if (obj.type === 'system' && obj.subtype === 'init' && obj.session_id) {
        sessionId = obj.session_id as string;
        updateTask(task.id, { session_id: sessionId });
      }
      // Parse assistant text blocks for HITL markers
      if (obj.type === 'assistant' && Array.isArray(obj.message?.content)) {
        for (const block of obj.message.content as Array<{ type: string; text?: string }>) {
          if (block.type === 'text' && block.text) {
            for (const textLine of block.text.split('\n')) {
              const marker = parseMarker(textLine, fenceState);
              if (marker?.type === 'decision') handleDecision(marker.payload);
              if (marker?.type === 'inbox') handleInbox(marker.payload);
            }
          }
        }
      }
    } catch { /* non-JSON lines are ignored */ }
  });

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      done = true;
      proc.kill('SIGTERM');
      clearInterval(queuePoller);
      failTask(task.id, `Timeout after ${TASK_TIMEOUT_MS}ms`, Date.now() - startMs);
      unmarkPid(pid);
      resolve();
    }, TASK_TIMEOUT_MS);

    proc.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(queuePoller);
      unmarkPid(pid);
      const durationMs = Date.now() - startMs;
      if (code === 0) {
        completeTask(task.id, 'Stream session completed', durationMs);
      } else {
        failTask(task.id, stderr.slice(0, 500) || `Exit code ${code}`, durationMs);
      }
      resolve();
    });
  });
}
```

**`runOnce` — main dispatcher tick:**

```typescript
export async function runOnce(): Promise<void> {
  const stopRow = getDb()
    .prepare(`SELECT value FROM system_state WHERE key='emergency_stop'`)
    .get() as { value: string } | undefined;

  if (stopRow?.value === '1') {
    console.log('[dispatcher] emergency_stop is active — skipping tick');
    return;
  }

  sweepStalePids();

  const pending = getDb()
    .prepare(
      `SELECT * FROM ops_tasks
       WHERE status='pending'
       ORDER BY priority DESC, created_at ASC
       LIMIT ?`
    )
    .all(MAX_CONCURRENT) as OpsTask[];

  const runners: Promise<void>[] = [];

  for (const task of pending) {
    // Requires approval and not yet approved → promote to awaiting_approval
    if (task.requires_approval && !task.approved_at) {
      getDb()
        .prepare(
          `UPDATE ops_tasks SET status='awaiting_approval'
           WHERE id=? AND status='pending'`
        )
        .run(task.id);
      continue;
    }

    const claimed = claimPending(task.id);
    if (!claimed) continue; // another dispatcher instance took it

    const runner = (claimed.execution_mode === 'stream' ? runStream : runClassic)(claimed)
      .catch((err) => failTask(claimed.id, String(err)));
    runners.push(runner);
  }

  await Promise.all(runners);

  // Write activity heartbeat
  getDb()
    .prepare(
      `INSERT INTO activities(event_type, detail, created_at) VALUES('heartbeat',?,?)`
    )
    .run(JSON.stringify({ tasks_dispatched: runners.length }), new Date().toISOString());
}
```

**Tests in `test/dispatcher.test.ts`:**
1. Concurrent claim — open two `Database` instances, both call `claimPending(id)` on the same pending task. Assert exactly one returns non-null.
2. `runOnce()` with `emergency_stop='1'` in DB — assert zero tasks are claimed (verify by checking task status remains `pending`).
3. `sweepStalePids()` — write a file for a dead PID (use `pid=1` which cannot be sent SIGTERM by non-root; probe returns alive. Use PID 99999999 which does not exist.) Assert dead-PID files are removed and live-PID files are kept.

**Commit:** `feat(dispatcher): spawn manager, PID files, classic+stream runners, HITL parsing`

---

### A-7 — `scripts/daemon.ts` — entry point

**File:** `scripts/daemon.ts`

```typescript
import path from 'path';
import fs from 'fs';
import { runOnce } from '../lib/dispatcher';
import { materializeSchedules } from '../lib/heartbeat';

const TICK_MS = parseInt(process.env.DAEMON_INTERVAL_SECONDS ?? '120', 10) * 1000;
const SINGLE_TICK = process.env.DAEMON_SINGLE_TICK === '1';

async function tick(): Promise<void> {
  console.log(`[daemon] tick ${new Date().toISOString()}`);
  try { materializeSchedules(); } catch (e) { console.error('[daemon] heartbeat error:', e); }
  try { await runOnce(); } catch (e) { console.error('[daemon] dispatcher error:', e); }
  console.log('[daemon] tick done');
}

async function main(): Promise<void> {
  // Ensure queue directories exist before first tick
  const pidDir = path.join(process.cwd(), '.tmp', 'mission-control-queue', 'pids');
  fs.mkdirSync(pidDir, { recursive: true });

  console.log(`[daemon] starting — interval=${TICK_MS}ms single=${SINGLE_TICK}`);
  await tick();

  if (SINGLE_TICK) {
    console.log('[daemon] single-tick mode — exiting');
    process.exit(0);
  }

  const interval = setInterval(tick, TICK_MS);

  function shutdown(): void {
    clearInterval(interval);
    console.log('[daemon] shutting down');
    process.exit(0);
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => { console.error('[daemon] fatal:', e); process.exit(1); });
```

`package.json` addition: `"daemon": "tsx scripts/daemon.ts"`

**Expected output:** `npm run daemon` logs `[daemon] starting`, runs one tick, then loops every 120s. Ctrl+C exits cleanly with `[daemon] shutting down`.

**Commit:** `feat(daemon): 120s loop entry point with single-tick mode`

---

## Sub-area B: Emergency stop (cross-platform)

### B-1 — `app/api/system/emergency-stop/route.ts`

**File:** `app/api/system/emergency-stop/route.ts`

**Design rationale (master plan risk #4):** PID files are the sole targeting mechanism. An interactive `claude -p` started in another terminal has no PID file and is completely invisible to this endpoint regardless of platform. The `isClaudeProcess()` check guards against PID recycling (a new unrelated process getting the same PID after the dispatcher child died). On Windows, `SIGTERM` is best-effort — `taskkill /T /F` is the reliable fallback.

```typescript
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const PID_DIR = path.join(process.cwd(), '.tmp', 'mission-control-queue', 'pids');
const IS_WIN32 = process.platform === 'win32';

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function isClaudeProcess(pid: number): boolean {
  try {
    if (IS_WIN32) {
      const out = execSync(
        `tasklist /FI "PID eq ${pid}" /FO CSV /NH`,
        { encoding: 'utf-8', timeout: 5000 }
      ).toLowerCase();
      return out.includes('claude');
    } else {
      const out = execSync(
        `ps -p ${pid} -o command=`,
        { encoding: 'utf-8', timeout: 5000 }
      );
      return out.includes('claude') && out.includes('-p');
    }
  } catch {
    return false; // died between isAlive check and here
  }
}

function killProcess(pid: number): void {
  try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
  if (IS_WIN32) {
    try { execSync(`taskkill /pid ${pid} /T /F`, { timeout: 5000 }); } catch { /* already dead */ }
  }
}

export async function POST() {
  let files: string[] = [];
  try { files = fs.readdirSync(PID_DIR); } catch { /* dir not created yet */ }

  let processesKilled = 0;
  let interactiveSpared = 0;

  for (const f of files) {
    const pid = parseInt(f, 10);
    if (isNaN(pid)) continue;
    const markerPath = path.join(PID_DIR, f);

    if (!isAlive(pid)) {
      try { fs.unlinkSync(markerPath); } catch {}
      continue;
    }

    if (!isClaudeProcess(pid)) {
      // PID recycled to an unrelated process — spare it, clean the stale marker
      try { fs.unlinkSync(markerPath); } catch {}
      interactiveSpared++;
      continue;
    }

    killProcess(pid);
    try { fs.unlinkSync(markerPath); } catch {}
    processesKilled++;
  }

  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO system_state(key,value,updated_at) VALUES('emergency_stop','1',?)
     ON CONFLICT(key) DO UPDATE SET value='1', updated_at=excluded.updated_at`
  ).run(now);

  db.prepare(
    `UPDATE ops_tasks SET status='failed', error_message='Emergency stop triggered',
     completed_at=? WHERE status='running'`
  ).run(now);

  return NextResponse.json({ stopped: true, processes_killed: processesKilled, interactive_spared: interactiveSpared });
}
```

**Tests in `test/emergency-stop.test.ts`:**
1. Spawn `node -e "setInterval(()=>{},9999)"`. Manually write its PID to `PID_DIR`. Call route. Assert process dead within 5s (`process.kill(pid, 0)` throws). Assert `system_state.emergency_stop='1'`. Assert `status='running'` tasks flipped to `failed`.
2. Spawn an unrelated `node` process with NO PID file. Call route. Assert it survives.
3. POST `/api/system/emergency-resume` → `system_state.emergency_stop='0'`.

**Commit:** `feat(emergency-stop): cross-platform PID-file kill + DB flag`

---

### B-2 — `app/api/system/emergency-resume/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST() {
  getDb().prepare(
    `INSERT INTO system_state(key,value,updated_at) VALUES('emergency_stop','0',?)
     ON CONFLICT(key) DO UPDATE SET value='0', updated_at=excluded.updated_at`
  ).run(new Date().toISOString());
  return NextResponse.json({ resumed: true });
}
```

**Commit:** `feat(emergency-resume): clear emergency_stop flag`

---

### B-3 — `app/api/system/state/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  const rows = getDb().prepare(`SELECT key, value FROM system_state`).all() as { key: string; value: string }[];
  const state: Record<string, string> = {};
  for (const row of rows) state[row.key] = row.value;
  return NextResponse.json(state);
}
```

**Commit:** `feat(system-state): GET /api/system/state`

---

## Sub-area C: HITL + API + UI

### C-1 — Rewrite `app/api/tasks/route.ts`

**Existing file:** reads `~/.claude/tasks/` directories. **Replace entirely** with SQLite-backed CRUD. The old filesystem entries in `~/.claude/tasks/` are not deleted — they remain accessible by the Claude CLI. The dashboard simply stops surfacing them.

```typescript
import { NextResponse } from 'next/server';
import { listTasks, createTask, getTask, updateTask, deleteTask } from '@/lib/task-tracker';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') ?? undefined;
  const quadrant = searchParams.get('quadrant') ?? undefined;
  return NextResponse.json(listTasks({ status, quadrant }));
}

export async function POST(request: Request) {
  const body = await request.json();
  const task = createTask({
    title: body.title,
    description: body.description,
    priority: body.priority ?? 0,
    assigned_skill: body.assigned_skill,
    model: body.model,
    execution_mode: body.execution_mode ?? 'stream',
    scheduled_for: body.scheduled_for,
    requires_approval: body.requires_approval ?? false,
    risk_level: body.risk_level,
    dry_run: body.dry_run ?? false,
    quadrant: body.quadrant,
  });
  return NextResponse.json(task, { status: 201 });
}

export async function PATCH(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get('id') ?? '0', 10);
  if (!getTask(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  updateTask(id, await request.json());
  return NextResponse.json(getTask(id));
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get('id') ?? '0', 10);
  if (!getTask(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  deleteTask(id);
  return NextResponse.json({ deleted: id });
}
```

**Commit:** `feat(tasks-api): rewrite to ops_tasks SQLite backend`

---

### C-2 — `app/api/tasks/[id]/approve/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getTask } from '@/lib/task-tracker';

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (task.status !== 'awaiting_approval')
    return NextResponse.json({ error: 'Not awaiting approval' }, { status: 400 });
  getDb().prepare(
    `UPDATE ops_tasks SET status='pending', approved_at=? WHERE id=?`
  ).run(new Date().toISOString(), id);
  return NextResponse.json({ approved: true });
}
```

**Commit:** `feat(tasks-api): approve endpoint`

---

### C-3 — `app/api/tasks/[id]/rerun/route.ts`

Rerun is only valid for `status='failed'`. Return 400 otherwise. Preserve `consecutive_failures` — do not reset it.

```typescript
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getTask } from '@/lib/task-tracker';

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (task.status !== 'failed')
    return NextResponse.json({ error: 'Can only rerun failed tasks' }, { status: 400 });

  getDb().prepare(`
    UPDATE ops_tasks SET
      status='pending',
      error_message=NULL,
      completed_at=NULL,
      started_at=NULL,
      duration_ms=NULL,
      output_summary=NULL,
      session_id=NULL
    WHERE id=?
  `).run(id);
  // consecutive_failures is deliberately preserved

  return NextResponse.json({ rerun: true, task_id: id });
}
```

**Commit:** `feat(tasks-api): rerun endpoint, preserves consecutive_failures`

---

### C-4 — `app/api/dispatcher/trigger/route.ts`

Spawns a detached single-tick daemon so the HTTP request returns immediately.

```typescript
import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export async function POST() {
  const daemonScript = path.join(process.cwd(), 'scripts', 'daemon.ts');
  const child = spawn(
    'npx',
    ['tsx', daemonScript],
    {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, DAEMON_SINGLE_TICK: '1' },
    }
  );
  child.unref();
  return NextResponse.json({ triggered: true, pid: child.pid });
}
```

**Commit:** `feat(dispatcher-trigger): one-shot detached daemon endpoint`

---

### C-5 — `app/api/schedules/route.ts`

Full CRUD. On POST and PATCH with a new `cron_expression`, recompute `next_run_at` using `parseCronSimple`. On PATCH when `cron_expression` changes, clear `next_run_at` for immediate recompute (the materialiser will pick it up on next tick).

Key implementation notes:
- `PATCH` uses `COALESCE(?, col)` pattern to only update supplied fields.
- `parseCronSimple` is imported from `lib/heartbeat.ts` — it runs server-side, not in the browser.
- Return the full schedule row after create/update.

**Commit:** `feat(schedules-api): CRUD for ops_schedules with cron recompute`

---

### C-6 — `app/api/schedules/parse-nl/route.ts`

```typescript
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { text } = await request.json();
  // STUB — Haiku integration deferred. See lib/skill-router.ts for the pattern.
  // To implement: POST to Anthropic API with claude-3-haiku-20240307.
  return NextResponse.json({
    cron: null,
    explanation: `NL→cron parsing not yet implemented (input: "${text ?? ''}")`,
  });
}
```

**Commit:** `feat(schedules-api): parse-nl stub`

---

### C-7 — `app/api/decisions/route.ts` + `app/api/decisions/[id]/answer/route.ts`

`POST /api/decisions` uses `INSERT OR IGNORE` which relies on the partial UNIQUE index `UNIQUE(session_id, prompt) WHERE session_id IS NOT NULL` created in Phase 1. When `session_id` is null (manually created decision), the index does not apply and duplicates are allowed.

```typescript
// POST /api/decisions
export async function POST(request: Request) {
  const body = await request.json();
  const result = getDb().prepare(`
    INSERT OR IGNORE INTO ops_decisions(task_id, session_id, prompt, status, created_at)
    VALUES(?,?,?,'pending',?)
  `).run(body.task_id ?? null, body.session_id ?? null, body.prompt, new Date().toISOString());

  if (result.changes === 0) {
    // Deduplicated — return existing
    const existing = getDb().prepare(
      `SELECT * FROM ops_decisions WHERE session_id=? AND prompt=?`
    ).get(body.session_id, body.prompt);
    return NextResponse.json({ ...existing, created: false });
  }
  const row = getDb().prepare(`SELECT * FROM ops_decisions WHERE rowid=?`)
    .get(result.lastInsertRowid);
  return NextResponse.json({ ...row, created: true }, { status: 201 });
}
```

`POST /api/decisions/[id]/answer` — sets `status='answered'`, writes the answer string, stamps `answered_at`. The dispatcher polls `WHERE id=? AND status='answered'` to detect this and inject the answer into stdin.

**Commit:** `feat(decisions-api): GET/POST decisions, INSERT OR IGNORE dedup, answer endpoint`

---

### C-8 — Inbox API routes

**`app/api/inbox/route.ts`** — GET (filters: `unread=1`, `max_age_days=30`, `direction=agent_to_user` hardcoded) + POST.

**`app/api/inbox/[id]/read/route.ts`** — POST sets `read=1`.

**`app/api/inbox/[id]/reply/route.ts`** — POST writes to `ops_inbox` with `direction='user_to_agent'` AND appends to `.tmp/mission-control-queue/{session_id}.jsonl`. Session ID validated against UUID regex before any filesystem access (path traversal guard):

```typescript
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (original.session_id && !UUID_RE.test(original.session_id)) {
  return NextResponse.json({ error: 'Invalid session_id' }, { status: 400 });
}
```

**Commit:** `feat(inbox-api): GET/POST inbox, read, reply with queue injection`

---

### C-9 — `app/api/sessions/live/[sid]/message/route.ts`

Same UUID validation. Appends the message text as a line to `.tmp/mission-control-queue/{sid}.jsonl`.

```typescript
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request: Request, { params }: { params: { sid: string } }) {
  if (!UUID_RE.test(params.sid))
    return NextResponse.json({ error: 'Invalid session_id format' }, { status: 400 });
  const { message } = await request.json();
  if (!message?.trim())
    return NextResponse.json({ error: 'Empty message' }, { status: 400 });
  const queueFile = path.join(process.cwd(), '.tmp', 'mission-control-queue', `${params.sid}.jsonl`);
  fs.appendFileSync(queueFile, message + '\n', 'utf-8');
  return NextResponse.json({ queued: true });
}
```

**Commit:** `feat(sessions-api): queue follow-up message for stream sessions`

---

### C-10 — `types/mission-control.ts`

**File:** `types/mission-control.ts`

Define all TypeScript interfaces used by both API routes and React components. This avoids duplicating the shape definition.

```typescript
export type TaskStatus = 'pending' | 'awaiting_approval' | 'running' | 'done' | 'failed' | 'cancelled';
export type ExecutionMode = 'classic' | 'stream';
export type QuadrantType = 'do' | 'schedule' | 'delegate' | 'archive';
export type RiskLevel = 'low' | 'medium' | 'high';
export type DecisionStatus = 'pending' | 'answered';
export type InboxDirection = 'agent_to_user' | 'user_to_agent';

export interface OpsTask {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: number;
  assigned_skill: string | null;
  model: string | null;
  execution_mode: ExecutionMode;
  scheduled_for: string | null;
  requires_approval: number; // SQLite 0|1
  risk_level: RiskLevel | null;
  dry_run: number;           // SQLite 0|1
  quadrant: QuadrantType | null;
  approved_at: string | null;
  session_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  cost_usd: number | null;
  output_summary: string | null;
  error_message: string | null;
  consecutive_failures: number;
  created_at: string;
}

export interface OpsSchedule {
  id: number;
  name: string;
  cron_expression: string;
  task_title: string;
  task_description: string | null;
  assigned_skill: string | null;
  enabled: number;
  next_run_at: string | null;
  last_run_at: string | null;
  created_at: string;
}

export interface OpsDecision {
  id: number;
  task_id: number | null;
  session_id: string | null;
  prompt: string;
  answer: string | null;
  status: DecisionStatus;
  created_at: string;
  answered_at: string | null;
}

export interface OpsInboxItem {
  id: number;
  task_id: number | null;
  session_id: string | null;
  direction: InboxDirection;
  body: string;
  read: number;
  created_at: string;
}
```

**Commit:** `feat(types): Mission Control TypeScript interfaces`

---

### C-11 — `lib/format-time.ts`

Extract `formatRelativeTime` from the existing `app/dashboard/tasks/page.tsx` into a shared module. Add `formatFutureTime` for countdown displays in SchedulesCard.

```typescript
export function formatRelativeTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  if (isNaN(diff)) return '—';
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 31) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function formatFutureTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  const diff = new Date(ts).getTime() - Date.now();
  if (isNaN(diff)) return '—';
  if (diff < 0) return 'overdue';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.floor(h / 24)}d`;
}
```

**Commit:** `refactor(format-time): extract shared time formatters`

---

### C-12 — `components/panels/emergency-stop-banner.tsx`

Red header button with two states: (1) normal mode — a compact red-bordered "Emergency stop" button that prompts a confirm dialog inline; (2) emergency active — a full-width red banner with a "Resume dispatcher" button.

On mount, fetches `GET /api/system/state` to check if emergency stop is already active. Shows the active banner if `emergency_stop='1'`.

The confirm dialog is inline (not a modal) — it replaces the button with "Kill all dispatcher-launched claude processes? [Confirm stop] [Cancel]" in the same red panel.

**Commit:** `feat(emergency-stop-banner): red header with inline confirm`

---

### C-13 — `components/panels/task-board.tsx`

Three-column layout. Columns: "Pending" (includes `awaiting_approval`), "Running", "Done" (includes `failed`, `cancelled`).

Each task card displays:
- Title (font-medium, truncated at 1 line)
- Description preview (first 100 chars, text-xs, text-gray-400)
- Status pill (color-coded: pending=blue, awaiting_approval=amber, running=cyan with pulse, done=green, failed=red, cancelled=gray)
- Execution mode badge: stream → "Interactive" / classic → "One-shot"
- Risk level pill if set
- `dry_run` badge if set

Action buttons per card:
- `awaiting_approval` → "Approve" (POST `/api/tasks/{id}/approve`)
- `failed` → "Rerun" (POST `/api/tasks/{id}/rerun`)
- All → "Delete" button (DELETE `/api/tasks?id={id}`, confirmation inline)

Loading state: 3 grey skeleton rectangles per column.
Empty state per column: short descriptive text (e.g., "No running tasks").
Poll: `useAutoRefresh(load, 10_000)` — 10s.

**Interface:**
```typescript
interface Props { onRefresh?: () => void; }
export default function TaskBoard({ onRefresh }: Props): JSX.Element
```

**Commit:** `feat(task-board): 3-column kanban with approve/rerun/delete`

---

### C-14 — `components/panels/task-composer.tsx`

Slide-out Sheet (fixed right panel, `w-[480px]`, translates in/out with CSS transition). Esc closes it (via `useEffect` keydown listener). Form submits on Enter.

Fields (in display order):
1. `title` — text input, `autoFocus`, required
2. `description` — textarea, 4 rows
3. `execution_mode` — two-option toggle. Default: `stream`. Label A: "Interactive — Reply mid-run from the dashboard". Label B: "One-shot — Fire and forget, no back-and-forth".
4. `model` — text input, placeholder "Leave blank to use skill default"
5. `priority` — number input 0–10, default 0
6. `quadrant` — select: Do / Schedule / Delegate / Archive
7. `risk_level` — select: Low / Medium / High
8. `requires_approval` — checkbox
9. `dry_run` — checkbox with tooltip: "Runs claude with --dry-run. No files are changed."
10. `assigned_skill` — text input (free-form; skill picker deferred)

On submit: POST `/api/tasks`, then call `onCreated()` and close. Show inline error on failure.

**Interface:**
```typescript
interface Props { open: boolean; onClose: () => void; onCreated: () => void; }
export default function TaskComposer({ open, onClose, onCreated }: Props): JSX.Element | null
```

**Commit:** `feat(task-composer): slide-out sheet for creating tasks`

---

### C-15 — `components/panels/schedules-card.tsx`

List of schedules. Each row:
- Name
- Cron expression verbatim (e.g., `0 9 * * 0`)
- Next-run countdown using `formatFutureTime`
- Stale indicator: amber dot when `next_run_at < now - 5min AND enabled=1`
- Last-run relative time using `formatRelativeTime`
- Enabled toggle — PATCH `/api/schedules?id={id}` with `{ enabled: !current }`. Optimistic update.
- Delete button with inline confirm

Empty state: "No schedules yet — create one to automate recurring tasks."
Poll: `useAutoRefresh(load, 30_000)`.

**Interface:**
```typescript
interface Props { onRefresh?: () => void; }
export default function SchedulesCard({ onRefresh }: Props): JSX.Element
```

**Commit:** `feat(schedules-card): schedule list with stale detection and toggle`

---

### C-16 — `components/panels/schedule-composer.tsx`

Slide-out Sheet for schedule creation.

**Time and day picker UI:**
- Hour: `<select>` 0–23
- Minute: `<select>` options: 0, 15, 30, 45
- Day-of-week: 7 toggle chips (Mon–Sun) with quick-select buttons: "Every day" (all), "Weekdays" (Mon–Fri = 0–4), "Weekends" (Sat–Sun = 5–6)
- **Day encoding:** Mon=0..Sun=6 to match `parseCronSimple`

**Live cron preview:** Updated on every field change. Example: hour=9, minute=0, dow=[0] → `0 9 * * 0`. Displayed as a `<code>` block below the picker.

**Task details:**
- `name` — text input, required
- `task_title` — text input, required
- `task_description` — textarea
- `assigned_skill` — text input
- `enabled` — toggle, default on

**"Parse from text" button:** calls `POST /api/schedules/parse-nl`. Shows result or "NL parsing not yet implemented (stub)". Button labeled "Parse from text (stub)".

On submit: POST `/api/schedules`, call `onCreated()`, close sheet.

**Commit:** `feat(schedule-composer): day/time/dow picker with live cron preview`

---

### C-17 — `components/panels/decisions-card.tsx`

Lists pending decisions from `GET /api/decisions?status=pending`. Polls every 5s via `setInterval` in `useEffect` (not `useAutoRefresh` — decisions need faster polling that does not pause when the tab is hidden).

Each decision card:
- Prompt text (truncated at 200 chars, expandable)
- Task ID badge (if set)
- `created_at` relative time
- Answer button → opens inline textarea. On submit: POST `/api/decisions/{id}/answer` with `{ answer }`. On success: card disappears from list.

Empty state: "No pending decisions — DECISION: markers from running stream tasks appear here."

**Commit:** `feat(decisions-card): HITL decision list with 5s poll and inline answer`

---

### C-18 — `components/panels/inbox-card.tsx`

Lists unread `agent_to_user` messages from `GET /api/inbox?unread=1&max_age_days=30`. Polls every 10s via `setInterval`.

Each item:
- Body text (word-wrapped, "show more" after 3 lines)
- Session ID badge truncated (8 chars)
- `created_at` relative time
- "Mark read" button → POST `/api/inbox/{id}/read`. Item removed from list.
- "Reply" input (inline, collapses by default, expand on click) → POST `/api/inbox/{id}/reply`. Shows "Sent" for 2s then resets.

Empty state: "No unread messages — agents running in Interactive mode send INBOX: messages here."

**Commit:** `feat(inbox-card): HITL inbox with mark-read and reply`

---

### C-19 — Rewrite `app/dashboard/tasks/page.tsx`

Full rewrite. Composes all the panel components. No `TaskEntry` UUID interface — that was the old filesystem-based model. The new page:
- Renders `EmergencyStopBanner` at top right
- Renders "Mission Control" heading with "+ New Task" button
- Renders HITL row: `DecisionsCard` | `InboxCard` (2-col grid)
- Renders `TaskBoard` (full-width)
- Renders "Schedules" heading with "+ New Schedule" button
- Renders `SchedulesCard`
- `TaskComposer` and `ScheduleComposer` as slide-out overlays

**Commit:** `feat(tasks-page): Mission Control layout with all panels`

---

### C-20 — Navigation update

**File:** `components/layout/sidebar.tsx`

Change the "Tasks" entry:
```typescript
{ href: '/dashboard/tasks', label: 'Mission Control', icon: '⌂' },
```

**Commit:** `feat(nav): rename Tasks to Mission Control`

---

### C-21 — DB schema bootstrap (Phase 1 prerequisite check)

**File:** `lib/db-migrations.ts` (create if not present)

If Phase 1 is complete, this file already exists. If not, create it with the full schema required by Phase 5. Called from `lib/db.ts`'s `ensureSchema()` function.

Minimum tables for Phase 5:

```sql
CREATE TABLE IF NOT EXISTS ops_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 0,
  assigned_skill TEXT,
  model TEXT,
  execution_mode TEXT NOT NULL DEFAULT 'stream',
  scheduled_for TEXT,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  risk_level TEXT,
  dry_run INTEGER NOT NULL DEFAULT 0,
  quadrant TEXT,
  approved_at TEXT,
  session_id TEXT,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  cost_usd REAL,
  output_summary TEXT,
  error_message TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ops_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  task_title TEXT NOT NULL,
  task_description TEXT,
  assigned_skill TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT,
  last_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ops_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  session_id TEXT,
  prompt TEXT NOT NULL,
  answer TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ops_decisions_uniq
  ON ops_decisions(session_id, prompt)
  WHERE session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ops_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  session_id TEXT,
  direction TEXT NOT NULL DEFAULT 'agent_to_user',
  body TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS system_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  detail TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Commit:** `feat(db-migrations): Mission Control schema tables`

---

## Test specifications

### `test/marker-parser.test.ts`

Full test fixture (the parser must handle this exact string):

```
Regular text before.

DECISION: outside fence — must be parsed

` + '```' + `typescript
DECISION: inside fence — MUST NOT be parsed
INBOX: inside fence — MUST NOT be parsed
` + '```' + `

INBOX: outside fence — must be parsed

DECISION: after fence close — must be parsed
```

Assert: `parseMarker` returns 3 parsed markers total (2 DECISION, 1 INBOX). The 2 lines inside the backtick block return `null`. The fence toggles correctly on open and close.

Implementation note: the test must track `fenceState` as a shared mutable object across all calls, exactly as the dispatcher does.

### `test/task-tracker.test.ts`

- `createTask` returns a row with `status='pending'`, `consecutive_failures=0`
- `claimPending` on a `pending` row returns the row with `status='running'`
- Second `claimPending` on the same row returns `null` (already running)
- `failTask` sets `status='failed'`, `consecutive_failures=1`; second `failTask` sets it to `2`
- `completeTask` sets `status='done'`, writes `duration_ms`
- `listTasks({ status: 'failed' })` returns only failed tasks

### `test/heartbeat.test.ts`

- `parseCronSimple('0 9 * * 0', tJust9amSunday)` returns Monday 09:00 (Mon=0 in the Python convention)
- `parseCronSimple('0 9 * * 0', tJust9amMon)` skips to the NEXT Monday, not the same minute
- DST test: `parseCronSimple('0 9 * * 0', tDSTSpringForward)` — result `getHours() === 9`, not 10
- Invalid expr (`'* *'`, `'abc 9 * * 0'`) returns `null`
- `materializeSchedules()` with one overdue schedule: called twice within 1s → exactly 1 `ops_tasks` row (BEGIN EXCLUSIVE guard)

### `test/dispatcher.test.ts`

- `sweepStalePids()` with a file for PID 99999999 → file removed
- `sweepStalePids()` with a file for `process.pid` (current process) → file kept
- `runOnce()` with `emergency_stop='1'` in DB → task count remains unchanged, activity row has `tasks_dispatched: 0`
- Mock claude: use `CLAUDE_BINARY` env var override to point at a test script. Assert classic mode captures stdout and calls `completeTask`.

### `test/emergency-stop.test.ts`

- Spawn `node -e "setInterval(()=>{},9999)"`, write PID file, POST `/api/system/emergency-stop` via route handler. Assert process dead within 5s. Assert DB flag set to `'1'`. Assert running task flipped to failed.
- Unrelated process (no PID file) survives.
- POST `/api/system/emergency-resume` resets flag to `'0'`.

---

## Implementation sequence

### Checkpoint 1: Data layer (est. 1–2h)

- [ ] C-21 — Verify/create DB schema (`lib/db-migrations.ts`)
- [ ] A-2 — `lib/db.ts` singleton
- [ ] C-10 — `types/mission-control.ts`
- [ ] C-11 — `lib/format-time.ts`
- [ ] A-3 — `lib/task-tracker.ts` + `test/task-tracker.test.ts`
- [ ] A-4 — `lib/heartbeat.ts` + `test/heartbeat.test.ts`
- [ ] A-5 — `lib/skill-router.ts` stub
- [ ] `npx tsc --noEmit` passes
- [ ] **Commit:** `feat(phase-5-cp1): data layer`

### Checkpoint 2: Dispatcher (est. 2–3h)

- [ ] A-1 — `.tmp` scaffold + `.gitignore` entry
- [ ] A-6 — `lib/dispatcher.ts` (PID helpers, `sweepStalePids`, `buildEnv`, `parseMarker`, `runClassic`, `runStream`, `runOnce`)
- [ ] A-7 — `scripts/daemon.ts` + `package.json` daemon script + tsx dev dep
- [ ] `test/marker-parser.test.ts` — full fenced-block fixture
- [ ] `test/dispatcher.test.ts` — claim atomicity, emergency stop, sweep
- [ ] Manual smoke test: `npm run daemon` — starts, logs tick, exits cleanly on Ctrl+C
- [ ] `npx tsc --noEmit` passes
- [ ] **Commit:** `feat(phase-5-cp2): dispatcher with HITL parsing`

### Checkpoint 3: API routes (est. 1–2h)

- [ ] B-1 — `app/api/system/emergency-stop/route.ts`
- [ ] B-2 — `app/api/system/emergency-resume/route.ts`
- [ ] B-3 — `app/api/system/state/route.ts`
- [ ] C-1 — Rewrite `app/api/tasks/route.ts`
- [ ] C-2 — `app/api/tasks/[id]/approve/route.ts`
- [ ] C-3 — `app/api/tasks/[id]/rerun/route.ts`
- [ ] C-4 — `app/api/dispatcher/trigger/route.ts`
- [ ] C-5 — `app/api/schedules/route.ts`
- [ ] C-6 — `app/api/schedules/parse-nl/route.ts`
- [ ] C-7 — `app/api/decisions/route.ts` + `[id]/answer/route.ts`
- [ ] C-8 — `app/api/inbox/route.ts` + `[id]/read/route.ts` + `[id]/reply/route.ts`
- [ ] C-9 — `app/api/sessions/live/[sid]/message/route.ts`
- [ ] `test/emergency-stop.test.ts`
- [ ] Manual: `curl -X POST localhost:3000/api/tasks -d '{"title":"smoke"}' -H 'Content-Type: application/json'` returns `{"id": 1, ...}`
- [ ] `npx tsc --noEmit` passes, `npm run lint` passes
- [ ] **Commit:** `feat(phase-5-cp3): all API routes`

### Checkpoint 4: UI components (est. 2–3h)

- [ ] C-12 — `components/panels/emergency-stop-banner.tsx`
- [ ] C-13 — `components/panels/task-board.tsx`
- [ ] C-14 — `components/panels/task-composer.tsx`
- [ ] C-15 — `components/panels/schedules-card.tsx`
- [ ] C-16 — `components/panels/schedule-composer.tsx`
- [ ] C-17 — `components/panels/decisions-card.tsx`
- [ ] C-18 — `components/panels/inbox-card.tsx`
- [ ] C-19 — Rewrite `app/dashboard/tasks/page.tsx`
- [ ] C-20 — Update `components/layout/sidebar.tsx` nav label
- [ ] Manual: open `http://localhost:3000/dashboard/tasks` — all panels visible with empty states, no errors in console
- [ ] `npm run build` succeeds
- [ ] `npx tsc --noEmit` passes
- [ ] **Commit:** `feat(phase-5-cp4): Mission Control UI`

### Checkpoint 5: End-to-end verification (est. 30–60 min)

- [ ] Create a task via TaskComposer (mode=stream, title="Hello from dashboard", description="Print hello world")
- [ ] `npm run daemon` picks it up (or trigger via POST `/api/dispatcher/trigger`)
- [ ] TaskBoard shows the task move to Running then Done with `output_summary`
- [ ] Create a Mon 9am schedule via ScheduleComposer → `next_run_at` appears in SchedulesCard
- [ ] Emergency stop: while task is running, click red button → task moves to `failed`, PID file removed, unrelated `node` process survives
- [ ] Emergency resume → dispatcher accepts new tasks
- [ ] **Commit:** `feat(phase-5): complete Mission Control phase`

---

## File creation/modification summary

| Path | Action |
|---|---|
| `lib/db.ts` | Create |
| `lib/db-migrations.ts` | Create (if Phase 1 did not create it) |
| `lib/task-tracker.ts` | Create |
| `lib/heartbeat.ts` | Create |
| `lib/skill-router.ts` | Create |
| `lib/dispatcher.ts` | Create |
| `lib/format-time.ts` | Create |
| `scripts/daemon.ts` | Create |
| `types/mission-control.ts` | Create |
| `app/api/tasks/route.ts` | **REWRITE** |
| `app/api/tasks/[id]/approve/route.ts` | Create |
| `app/api/tasks/[id]/rerun/route.ts` | Create |
| `app/api/schedules/route.ts` | Create |
| `app/api/schedules/parse-nl/route.ts` | Create |
| `app/api/decisions/route.ts` | Create |
| `app/api/decisions/[id]/answer/route.ts` | Create |
| `app/api/inbox/route.ts` | Create |
| `app/api/inbox/[id]/read/route.ts` | Create |
| `app/api/inbox/[id]/reply/route.ts` | Create |
| `app/api/system/emergency-stop/route.ts` | Create |
| `app/api/system/emergency-resume/route.ts` | Create |
| `app/api/system/state/route.ts` | Create |
| `app/api/dispatcher/trigger/route.ts` | Create |
| `app/api/sessions/live/[sid]/message/route.ts` | Create |
| `app/dashboard/tasks/page.tsx` | **REWRITE** |
| `components/panels/emergency-stop-banner.tsx` | Create |
| `components/panels/task-board.tsx` | Create |
| `components/panels/task-composer.tsx` | Create |
| `components/panels/schedules-card.tsx` | Create |
| `components/panels/schedule-composer.tsx` | Create |
| `components/panels/decisions-card.tsx` | Create |
| `components/panels/inbox-card.tsx` | Create |
| `components/layout/sidebar.tsx` | Modify (label only) |
| `package.json` | Modify (add daemon script, tsx dep) |
| `.gitignore` | Modify (add `.tmp/mission-control-queue/`) |
| `.tmp/.gitkeep` | Create |
| `test/task-tracker.test.ts` | Create |
| `test/heartbeat.test.ts` | Create |
| `test/dispatcher.test.ts` | Create |
| `test/marker-parser.test.ts` | Create |
| `test/emergency-stop.test.ts` | Create |

---

## Deferred items (document for next phase)

1. **Skill router Haiku integration** — `lib/skill-router.ts` and `/api/schedules/parse-nl` both stub. Real implementation requires `@anthropic-ai/sdk` and `ANTHROPIC_API_KEY`.
2. **`GET /api/schedules/[id]/runs`** — requires adding `schedule_id` FK to `ops_tasks` and populating it in `materializeSchedules`.
3. **Live session drawer reply box** — Phase 4's `LiveSessionDetail` drawer needs a reply text box for stream-mode sessions calling `/api/sessions/live/{sid}/message`.
4. **Assigned-skill picker** — TaskComposer and ScheduleComposer use free-text fields. Replace with dropdown from `GET /api/skills` after skills registry lands.
5. **Daemon autostart** — document platform-specific steps (Windows Task Scheduler, macOS launchd user agent, Linux `systemd --user`). No implementation in this phase.
6. **Notification webhook** — `npm run daemon` could optionally POST to a Discord/Slack webhook on `DECISION:` and failed tasks. Straightforward 30-line addition; deferred.

---

*Cross-platform risk #4 addressed: PID files are the sole targeting mechanism — an interactive `claude -p` in another terminal has no PID file and is completely invisible to emergency stop on any platform. The `isClaudeProcess()` guard defends against PID recycling. Windows receives `taskkill /T /F` as a reliable kill alongside the best-effort `SIGTERM`. No `ps eww`, no env scanning, no platform process-listing APIs beyond what Node provides natively.*

---

The plan content above is the complete document for `D:\Documents\Code\GitHub\ClaudeCodeDashboard\Docs\plans\2026-04-24-phase-5-mission-control.md`.

**Summary:** Phase 5 has 3 sub-areas (A: dispatcher daemon, B: emergency stop, C: HITL+UI) with 38 files to create or modify, organized into 5 implementation checkpoints. The critical cross-platform piece (master plan risk #4) is handled by PID files in `.tmp/mission-control-queue/pids/{pid}` as the sole targeting mechanism for emergency stop, with `process.kill(pid, 0)` for liveness probing, `tasklist`/`ps -p` for PID-recycling defense, and `taskkill /T /F` as the Windows kill fallback alongside `SIGTERM`.