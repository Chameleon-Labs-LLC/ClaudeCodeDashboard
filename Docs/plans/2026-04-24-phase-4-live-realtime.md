# Phase 4 — Live Sessions + SSE Firehose

**Goal:** Make the ClaudeCodeDashboard feel alive. Two user-visible capabilities ship in this phase:

1. A **Live Sessions** panel on the main dashboard that lists every session whose JSONL file was modified in the last 5 minutes, with a right-side slide-out drawer rendering a live tool-call timeline for the selected session.
2. A **Telemetry Firehose** on a new `/dashboard/activity` page that streams every newly-ingested OTEL event as it lands in SQLite, with a client-side filter by `event.name`.

Both surfaces are backed by Server-Sent Events. The plan lands three SSE endpoints (`/api/sessions/live/[id]/stream`, `/api/firehose`), two REST endpoints (`/api/sessions/live`, `/api/sessions/live/[id]/state`), one shared client hook (`useSSE`), three React panels, and one new page. Integration-tested end-to-end against the running dev server.

**Depends on:** Phase 1 (SQLite + `lib/db.ts` + `otel_events` + `live_session_state` tables). Phase 2 (OTEL events flowing in). Phase 3 is **not** a dependency — Phase 4 and 3 run in parallel per the master plan.

**Architecture Decision:** SSE over WebSockets. SSE is one-way server→client, auto-reconnects in the browser, requires zero extra dependencies, and plays nicely with Next.js App Router route handlers using the Web Streams API. Every SSE handler is pinned to `export const runtime = 'nodejs'` because it needs `fs`, `fs.watch`, and `better-sqlite3` — none of which run on the Edge runtime. Connection lifecycle is tied to `request.signal` (an `AbortSignal`) so watchers and intervals stop as soon as the browser closes the `EventSource`.

**Cross-platform decision:** `fs.watch` is documented as unreliable on Windows for anything beyond simple file watches (recursive is broken, rename/delete semantics differ). Rather than ship two subtly-different code paths, the per-session JSONL stream uses **tail-via-polling on Win32** and `fs.watch` on macOS/Linux. Both code paths share a common "read new bytes since last offset, parse new lines, push events" core so the test coverage transfers.

---

## Patterns & Conventions Observed

- API routes today are thin: import from `lib/`, return `NextResponse.json(...)`. Pattern lives in `app/api/sessions/route.ts` (8 lines, line 1–9).
- All filesystem access is already funnelled through `lib/claude-data.ts` — Phase 4 does not bypass it; it adds a sibling `lib/live-sessions.ts` for the realtime-specific helpers.
- `hooks/use-auto-refresh.ts` (already in the project at `D:\Documents\Code\GitHub\ClaudeCodeDashboard\hooks\use-auto-refresh.ts`) pauses when the tab is hidden via `document.visibilitychange`. Phase 4 reuses it for the 5-second refresh on `LiveSessionsCard` — **do not re-invent a setInterval here.**
- Brand tokens: `brand-cyan`, `brand-navy`, `brand-navy-light`, `brand-navy-dark`, `chameleon-*`. See `tailwind.config.ts`.
- Commit convention: `feat(phase-4): ...`.
- Testing: `vitest` is already wired in from Phase 2 (`__tests__/` + `vitest.config.ts`). Integration tests connect to the dev server on `http://localhost:3000`.
- TypeScript strict mode is on. Every new file must satisfy `npx tsc --noEmit`.

---

## SSE In App Router — The Gotchas (read before coding)

Three things break SSE in Next.js App Router if you get them wrong:

1. **Edge vs Node runtime.** Default runtime for route handlers is inferred — in production it may fall back to edge if the handler looks "light". Force Node: `export const runtime = 'nodejs';` at the top of every SSE handler file. The edge runtime has no `fs`, no `node:fs`, no `better-sqlite3`.
2. **Dynamic rendering.** Next will try to cache GET responses. Force dynamic: `export const dynamic = 'force-dynamic';`. Without this, the first request is cached and subsequent clients get a closed stream.
3. **Buffering / compression.** A reverse proxy (nginx) or Next's own response compression can buffer SSE so events arrive in clumps. Set `'Cache-Control': 'no-cache, no-transform'` and `'X-Accel-Buffering': 'no'` on the response. In dev, Next does not compress — fine — but these headers are still correct for production / Cloudflare tunnels.

The reference handler skeleton every SSE endpoint in this phase follows:

```typescript
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // 1. send initial comment so the browser connects
      controller.enqueue(encoder.encode(': connected\n\n'));

      // 2. set up the data source (fs.watch, interval, etc.)
      //    every event: controller.enqueue(encoder.encode(`data: ${json}\n\n`))

      // 3. heartbeat every 15s to keep proxies from closing the connection
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(': ping\n\n')); }
        catch { clearInterval(heartbeat); }
      }, 15_000);

      // 4. clean up on client disconnect
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        // teardown watchers / intervals here
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
```

Every SSE handler below instantiates this skeleton verbatim then plugs its data source into slot (2).

---

## Files to Create or Modify

| File | Action | Notes |
|------|--------|-------|
| `lib/live-sessions.ts` | CREATE | Pure helpers — list live sessions by mtime window, derive state from last JSONL line, tail-read new lines since byte offset. |
| `lib/sse.ts` | CREATE | Shared SSE helpers — `sseEncode(obj)`, `makeSseResponse(stream)`. |
| `app/api/sessions/live/route.ts` | CREATE | GET — returns sessions with mtime in last 5 min. |
| `app/api/sessions/live/[id]/state/route.ts` | CREATE | GET — returns current state (row from `live_session_state` if present, else derived from last JSONL line). |
| `app/api/sessions/live/[id]/stream/route.ts` | CREATE | SSE — pushes each new JSONL line as events. |
| `app/api/firehose/route.ts` | CREATE | SSE — polls SQLite every 2s for new `otel_events` rows and pushes them. |
| `hooks/use-sse.ts` | CREATE | Reusable `useSSE(url, opts)` client hook with reconnect + abort handling. |
| `components/panels/live-sessions-card.tsx` | CREATE | Main panel, 5s refresh via `useAutoRefresh`, click row → opens drawer. |
| `components/panels/live-session-detail-sheet.tsx` | CREATE | Right-side slide-out, subscribes to `/api/sessions/live/{id}/stream`. |
| `components/panels/firehose-feed.tsx` | CREATE | Scrolling event list with `event.name` filter input, subscribes to `/api/firehose`. |
| `app/dashboard/activity/page.tsx` | CREATE | New page — hosts `firehose-feed`. |
| `app/dashboard/page.tsx` | MODIFY | Insert `<LiveSessionsCard />` near the top. |
| `components/layout/*` sidebar nav | MODIFY | Add "Activity" nav entry linking to `/dashboard/activity`. |
| `types/live.ts` | CREATE | TypeScript interfaces for live-session rows and firehose events. |
| `__tests__/live-sessions.test.ts` | CREATE | Unit tests for `lib/live-sessions.ts`. |
| `__tests__/sse-firehose.integration.test.ts` | CREATE | Integration test — inserts OTEL row, asserts it arrives over SSE. |
| `__tests__/sse-session-stream.integration.test.ts` | CREATE | Integration test — appends JSONL line, asserts it arrives over SSE. |

---

## Data Flow

```
Browser /dashboard page
  └─ LiveSessionsCard (refresh every 5s via useAutoRefresh)
       └─ GET /api/sessions/live   →  reads ~/.claude/projects/*/*.jsonl mtimes
                                      returns rows where mtime > now - 5min
  └─ click row → opens LiveSessionDetailSheet (right drawer)
       └─ GET /api/sessions/live/{id}/state  (one-shot, initial render)
       └─ useSSE("/api/sessions/live/{id}/stream") (ongoing, appends to timeline)
            └─ server handler:
                 ├─ win32:  setInterval 1000ms — read bytes from lastOffset, push new lines
                 └─ darwin/linux: fs.watch(jsonlPath) → on 'change' event, read new bytes

Browser /dashboard/activity page
  └─ FirehoseFeed
       └─ useSSE("/api/firehose")
            └─ server handler:
                 └─ setInterval 2000ms — SELECT * FROM otel_events
                                         WHERE received_at > :lastCursor
                                         ORDER BY received_at ASC
                                         push each row as an SSE event
```

Every SSE route on `request.signal.abort`:
- clears its interval / closes its `fs.watch` handle
- closes the `ReadableStream` controller
- logs `[sse] connection closed` to stderr (dev visibility)

---

## Schema Assumed from Phase 1

`lib/db.ts` exports `getDb(): Database`. Relevant tables:

`otel_events`:
```
received_at TEXT (ISO-8601, column used for firehose cursor)
event_name, session_id, timestamp, model, tool_name, tool_duration_ms,
tool_success, cost_usd, input_tokens, output_tokens, ...
```

`live_session_state` (populated by Phase 5's Claude Code hook when installed; may be empty):
```
session_id TEXT PRIMARY KEY, cwd TEXT, model TEXT, title TEXT,
status TEXT, updated_at TEXT
```

Phase 4 must tolerate `live_session_state` being empty — when it is, `/api/sessions/live/[id]/state` falls back to deriving state from the last line of the session's JSONL file.

---

## Build Sequence

### Phase 4.0 — Prerequisites

- [ ] **4.0.1** Verify Phases 1 + 2 are complete. Run:
  ```
  npx tsc --noEmit
  npm run lint
  npm run test -- --run
  ```
  Expected: zero errors, zero lint warnings, vitest reports green on all existing tests.

- [ ] **4.0.2** Confirm `hooks/use-auto-refresh.ts` exists. If it does, Phase 4 reuses it verbatim. If any sibling earlier in the phase queue deleted it, restore it — do **not** re-invent the visibility-aware interval logic in `live-sessions-card.tsx`.
  ```
  node -e "require('fs').accessSync('hooks/use-auto-refresh.ts'); console.log('ok')"
  ```
  Expected output: `ok`.

- [ ] **4.0.3** Create `types/live.ts` — the shared types for every file in this phase. Full content:
  ```typescript
  // Row returned by GET /api/sessions/live
  export interface LiveSessionRow {
    id: string;
    projectName: string;
    title: string;          // last user message, truncated to 120 chars
    cwd: string | null;
    model: string | null;
    startedAt: string;      // ISO-8601
    lastActiveAt: string;   // ISO-8601 (the JSONL mtime)
    tokenTotal: number;     // summed input+output+cache across messages
  }

  // One-shot row returned by GET /api/sessions/live/:id/state
  export interface LiveSessionState {
    sessionId: string;
    cwd: string | null;
    model: string | null;
    title: string | null;
    status: 'active' | 'idle' | 'unknown';
    lastEventAt: string | null;
    derivedFrom: 'live_session_state' | 'jsonl' | 'none';
  }

  // A single tool-call timeline entry streamed over SSE
  export interface LiveTimelineEntry {
    kind: 'tool_use' | 'tool_result' | 'user_message' | 'assistant_message' | 'system';
    timestamp: string;
    toolName?: string;
    preview?: string;        // truncated to 240 chars
    durationMs?: number;
    success?: boolean;
  }

  // Envelope pushed over /api/firehose
  export interface FirehoseEvent {
    eventName: string;
    sessionId: string | null;
    model: string | null;
    timestamp: string;
    receivedAt: string;
    toolName: string | null;
    durationMs: number | null;
    costUsd: number | null;
  }
  ```
  Verify:
  ```
  npx tsc --noEmit
  ```
  Expected: zero errors. Commit:
  ```
  git add types/live.ts
  git commit -m "feat(phase-4): add live session + firehose type contracts"
  ```

---

### Phase 4.1 — `lib/live-sessions.ts` (TDD)

Pure helpers. No HTTP, no SSE, no React. Unit-testable.

- [ ] **4.1.1** Create `__tests__/live-sessions.test.ts` **first** — it must fail. Covers: filtering by 5-minute mtime window, extracting title from first user message, tail-reading new bytes from a file given a prior offset, tolerating an empty JSONL file.
  ```typescript
  import { describe, it, expect, beforeEach, afterEach } from 'vitest';
  import { promises as fs } from 'node:fs';
  import path from 'node:path';
  import os from 'node:os';
  import {
    listLiveSessions,
    deriveStateFromJsonl,
    readNewLines,
  } from '../lib/live-sessions';

  let tmpHome: string;
  let projectsDir: string;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ccd-live-'));
    projectsDir = path.join(tmpHome, 'projects');
    await fs.mkdir(projectsDir, { recursive: true });
    process.env.CLAUDE_HOME = tmpHome;
  });

  afterEach(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true });
    delete process.env.CLAUDE_HOME;
  });

  async function writeSession(project: string, id: string, lines: object[], mtimeMs?: number) {
    const dir = path.join(projectsDir, project);
    await fs.mkdir(dir, { recursive: true });
    const fp = path.join(dir, `${id}.jsonl`);
    await fs.writeFile(fp, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    if (mtimeMs !== undefined) {
      const t = new Date(mtimeMs);
      await fs.utimes(fp, t, t);
    }
    return fp;
  }

  describe('listLiveSessions', () => {
    it('returns sessions modified in the last 5 minutes', async () => {
      const now = Date.now();
      await writeSession('my-proj', 'sess-fresh', [
        { type: 'user', message: { content: 'hello world' }, timestamp: new Date(now).toISOString() }
      ], now - 60_000);
      await writeSession('my-proj', 'sess-stale', [
        { type: 'user', message: { content: 'old' }, timestamp: new Date(now - 10 * 60_000).toISOString() }
      ], now - 10 * 60_000);

      const rows = await listLiveSessions();
      expect(rows.map(r => r.id)).toEqual(['sess-fresh']);
      expect(rows[0].title).toContain('hello');
    });

    it('truncates title to 120 chars', async () => {
      const long = 'x'.repeat(500);
      await writeSession('p', 's1', [
        { type: 'user', message: { content: long } }
      ], Date.now());
      const rows = await listLiveSessions();
      expect(rows[0].title.length).toBeLessThanOrEqual(120);
    });

    it('returns empty array when projects dir missing', async () => {
      await fs.rm(projectsDir, { recursive: true });
      const rows = await listLiveSessions();
      expect(rows).toEqual([]);
    });
  });

  describe('deriveStateFromJsonl', () => {
    it('extracts cwd + model + title from the last meaningful line', async () => {
      const fp = await writeSession('p', 's1', [
        { type: 'user', message: { content: 'first thing' }, cwd: '/tmp/x', model: 'claude-opus-4-5' },
        { type: 'assistant', message: { content: 'reply' }, cwd: '/tmp/x', model: 'claude-opus-4-5' },
      ]);
      const state = await deriveStateFromJsonl(fp, 's1');
      expect(state.cwd).toBe('/tmp/x');
      expect(state.model).toBe('claude-opus-4-5');
      expect(state.title).toContain('first thing');
      expect(state.derivedFrom).toBe('jsonl');
    });

    it('returns none state for a missing file', async () => {
      const state = await deriveStateFromJsonl(path.join(projectsDir, 'nope.jsonl'), 'nope');
      expect(state.derivedFrom).toBe('none');
      expect(state.status).toBe('unknown');
    });
  });

  describe('readNewLines', () => {
    it('returns all lines on first read with offset 0', async () => {
      const fp = await writeSession('p', 's1', [
        { type: 'user', message: { content: 'a' } },
        { type: 'user', message: { content: 'b' } },
      ]);
      const { lines, newOffset } = await readNewLines(fp, 0);
      expect(lines.length).toBe(2);
      expect(newOffset).toBeGreaterThan(0);
    });

    it('returns only new lines on subsequent reads', async () => {
      const fp = await writeSession('p', 's1', [
        { type: 'user', message: { content: 'a' } },
      ]);
      const { newOffset } = await readNewLines(fp, 0);
      await fs.appendFile(fp, JSON.stringify({ type: 'user', message: { content: 'b' } }) + '\n');
      const { lines } = await readNewLines(fp, newOffset);
      expect(lines.length).toBe(1);
      expect(JSON.parse(lines[0]).message.content).toBe('b');
    });

    it('tolerates a trailing partial line', async () => {
      const fp = await writeSession('p', 's1', []);
      await fs.writeFile(fp, '{"type":"user","message":{"content":"partial no newline"');
      const { lines } = await readNewLines(fp, 0);
      expect(lines).toEqual([]); // partial line held back
    });
  });
  ```
  Run:
  ```
  npm run test -- --run __tests__/live-sessions.test.ts
  ```
  Expected: all tests **fail** with "Cannot find module '../lib/live-sessions'". Good.

- [ ] **4.1.2** Create `lib/live-sessions.ts`. Full content:
  ```typescript
  import { promises as fs } from 'node:fs';
  import path from 'node:path';
  import { getClaudeHome } from '@/lib/claude-data';
  import type { LiveSessionRow, LiveSessionState, LiveTimelineEntry } from '@/types/live';

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
        if (block && typeof block === 'object' && 'text' in block && typeof block.text === 'string') {
          return block.text;
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
  ```
  Run:
  ```
  npm run test -- --run __tests__/live-sessions.test.ts
  npx tsc --noEmit
  ```
  Expected: all tests green, zero TS errors. Commit:
  ```
  git add lib/live-sessions.ts __tests__/live-sessions.test.ts
  git commit -m "feat(phase-4): live-session helpers with TDD coverage"
  ```

---

### Phase 4.2 — Shared SSE helpers + `/api/sessions/live`

- [ ] **4.2.1** Create `lib/sse.ts`. Tiny shared helpers so SSE logic isn't copy-pasted.
  ```typescript
  const encoder = new TextEncoder();

  export function sseEncode(data: unknown, eventName?: string): Uint8Array {
    const lines: string[] = [];
    if (eventName) lines.push(`event: ${eventName}`);
    lines.push(`data: ${JSON.stringify(data)}`);
    lines.push('', '');
    return encoder.encode(lines.join('\n'));
  }

  export function sseComment(text: string): Uint8Array {
    return encoder.encode(`: ${text}\n\n`);
  }

  export const SSE_HEADERS: HeadersInit = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
  ```
  ```
  npx tsc --noEmit
  ```

- [ ] **4.2.2** Create `app/api/sessions/live/route.ts`. Plain REST — no SSE. Five lines of real logic.
  ```typescript
  import { NextResponse } from 'next/server';
  import { listLiveSessions } from '@/lib/live-sessions';

  export const runtime = 'nodejs';
  export const dynamic = 'force-dynamic';

  export async function GET() {
    const sessions = await listLiveSessions();
    return NextResponse.json(sessions);
  }
  ```
  Test manually:
  ```
  npm run dev &
  sleep 3
  curl -s http://localhost:3000/api/sessions/live
  ```
  Expected: `[]` if no sessions are active in the last 5 min, or a JSON array of `LiveSessionRow`. Commit:
  ```
  git add lib/sse.ts app/api/sessions/live/route.ts
  git commit -m "feat(phase-4): GET /api/sessions/live (5-min mtime window)"
  ```

---

### Phase 4.3 — `/api/sessions/live/[id]/state`

- [ ] **4.3.1** Create `app/api/sessions/live/[id]/state/route.ts`.
  ```typescript
  import { NextResponse } from 'next/server';
  import path from 'node:path';
  import { promises as fs } from 'node:fs';
  import { getClaudeHome } from '@/lib/claude-data';
  import { getDb } from '@/lib/db';
  import { deriveStateFromJsonl } from '@/lib/live-sessions';
  import type { LiveSessionState } from '@/types/live';

  export const runtime = 'nodejs';
  export const dynamic = 'force-dynamic';

  const UUID_RE = /^[A-Za-z0-9_-]{1,128}$/; // session IDs are UUID-ish, defensively restrict

  export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });

    // 1. try live_session_state (Phase 5 hook writes this)
    try {
      const row = getDb().prepare(
        `SELECT session_id, cwd, model, title, status, updated_at
         FROM live_session_state WHERE session_id = ?`
      ).get(id) as {
        session_id: string; cwd: string | null; model: string | null;
        title: string | null; status: string | null; updated_at: string | null;
      } | undefined;

      if (row) {
        const state: LiveSessionState = {
          sessionId: row.session_id,
          cwd: row.cwd,
          model: row.model,
          title: row.title,
          status: (row.status as LiveSessionState['status']) ?? 'unknown',
          lastEventAt: row.updated_at,
          derivedFrom: 'live_session_state',
        };
        return NextResponse.json(state);
      }
    } catch { /* table may be empty or missing in dev — fall through */ }

    // 2. fall back to scanning JSONL
    const projectsDir = path.join(getClaudeHome(), 'projects');
    const projects = await fs.readdir(projectsDir, { withFileTypes: true }).catch(() => []);
    for (const p of projects) {
      if (!p.isDirectory()) continue;
      const candidate = path.join(projectsDir, p.name, `${id}.jsonl`);
      try { await fs.access(candidate); }
      catch { continue; }
      const state = await deriveStateFromJsonl(candidate, id);
      return NextResponse.json(state);
    }

    return NextResponse.json({
      sessionId: id, cwd: null, model: null, title: null,
      status: 'unknown', lastEventAt: null, derivedFrom: 'none',
    } satisfies LiveSessionState);
  }
  ```
  Verify:
  ```
  npx tsc --noEmit
  curl -s http://localhost:3000/api/sessions/live/nonexistent-id/state
  ```
  Expected: JSON with `derivedFrom: 'none'`. Commit:
  ```
  git add app/api/sessions/live/\[id\]/state/route.ts
  git commit -m "feat(phase-4): GET /api/sessions/live/:id/state with hook + JSONL fallback"
  ```

---

### Phase 4.4 — `/api/sessions/live/[id]/stream` (SSE, cross-platform)

- [ ] **4.4.1** Create `app/api/sessions/live/[id]/stream/route.ts`. This is the spicy one. Branches on `os.platform() === 'win32'`.
  ```typescript
  import path from 'node:path';
  import os from 'node:os';
  import { promises as fs, watch as fsWatch, type FSWatcher } from 'node:fs';
  import { getClaudeHome } from '@/lib/claude-data';
  import { readNewLines, lineToTimelineEntry } from '@/lib/live-sessions';
  import { sseEncode, sseComment, SSE_HEADERS } from '@/lib/sse';

  export const runtime = 'nodejs';
  export const dynamic = 'force-dynamic';

  const UUID_RE = /^[A-Za-z0-9_-]{1,128}$/;

  async function findJsonlPath(id: string): Promise<string | null> {
    const projectsDir = path.join(getClaudeHome(), 'projects');
    const projects = await fs.readdir(projectsDir, { withFileTypes: true }).catch(() => []);
    for (const p of projects) {
      if (!p.isDirectory()) continue;
      const candidate = path.join(projectsDir, p.name, `${id}.jsonl`);
      try { await fs.access(candidate); return candidate; } catch { continue; }
    }
    return null;
  }

  export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return new Response('bad id', { status: 400 });

    const jsonlPath = await findJsonlPath(id);
    if (!jsonlPath) return new Response('not found', { status: 404 });

    const initialStat = await fs.stat(jsonlPath);
    let offset = 0; // start from the top so reconnects get the whole timeline

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(sseComment('connected'));

        let closed = false;
        const safeEnqueue = (chunk: Uint8Array) => {
          if (closed) return;
          try { controller.enqueue(chunk); } catch { closed = true; }
        };

        const pushNewLines = async () => {
          const { lines, newOffset } = await readNewLines(jsonlPath, offset);
          offset = newOffset;
          for (const line of lines) {
            const entry = lineToTimelineEntry(line);
            if (entry) safeEnqueue(sseEncode(entry, 'timeline'));
          }
        };

        // 1. initial backfill — everything on disk already
        await pushNewLines();

        // 2. live source: win32 → polling, everything else → fs.watch
        let watcher: FSWatcher | undefined;
        let pollTimer: ReturnType<typeof setInterval> | undefined;

        if (os.platform() === 'win32') {
          pollTimer = setInterval(() => { void pushNewLines(); }, 1000);
        } else {
          try {
            watcher = fsWatch(jsonlPath, { persistent: false }, (eventType) => {
              if (eventType === 'change' || eventType === 'rename') void pushNewLines();
            });
            watcher.on('error', () => { /* ignore — teardown via abort */ });
          } catch {
            // some exotic filesystems don't support fs.watch — fall back to polling
            pollTimer = setInterval(() => { void pushNewLines(); }, 1000);
          }
        }

        // 3. heartbeat — keep proxies from closing idle connections
        const heartbeat = setInterval(() => safeEnqueue(sseComment('ping')), 15_000);

        // 4. teardown on client disconnect
        const cleanup = () => {
          closed = true;
          clearInterval(heartbeat);
          if (pollTimer) clearInterval(pollTimer);
          if (watcher) { try { watcher.close(); } catch { /* ignore */ } }
          try { controller.close(); } catch { /* already closed */ }
        };

        if (request.signal.aborted) { cleanup(); return; }
        request.signal.addEventListener('abort', cleanup);

        // use initialStat to hint at mtime drift — purely informational
        void initialStat;
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  }
  ```
  Verify compile:
  ```
  npx tsc --noEmit
  ```
  Manual smoke test:
  ```
  # terminal 1
  npm run dev
  # terminal 2 — pick a real session id from ~/.claude/projects
  curl -N http://localhost:3000/api/sessions/live/<real-session-id>/stream
  ```
  Expected: `: connected` comment, then `event: timeline` frames on each JSONL append. `Ctrl-C` terminates the curl; server log should show the stream closing. Commit:
  ```
  git add app/api/sessions/live/\[id\]/stream/route.ts
  git commit -m "feat(phase-4): SSE /api/sessions/live/:id/stream with win32 poll fallback"
  ```

---

### Phase 4.5 — `/api/firehose` SSE

- [ ] **4.5.1** Create `app/api/firehose/route.ts`. Polls SQLite every 2 s for rows newer than the last cursor.
  ```typescript
  import { getDb } from '@/lib/db';
  import { sseEncode, sseComment, SSE_HEADERS } from '@/lib/sse';
  import type { FirehoseEvent } from '@/types/live';

  export const runtime = 'nodejs';
  export const dynamic = 'force-dynamic';

  export async function GET(request: Request) {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(sseComment('connected'));

        let closed = false;
        const safeEnqueue = (chunk: Uint8Array) => {
          if (closed) return;
          try { controller.enqueue(chunk); } catch { closed = true; }
        };

        // cursor starts at "now minus 10s" so first tick may backfill a tiny bit
        let cursor = new Date(Date.now() - 10_000).toISOString();

        const stmt = getDb().prepare(
          `SELECT event_name, session_id, model, timestamp, received_at,
                  tool_name, tool_duration_ms, cost_usd
           FROM otel_events
           WHERE received_at > ?
           ORDER BY received_at ASC
           LIMIT 500`
        );

        const tick = () => {
          try {
            const rows = stmt.all(cursor) as Array<{
              event_name: string; session_id: string | null; model: string | null;
              timestamp: string; received_at: string;
              tool_name: string | null; tool_duration_ms: number | null; cost_usd: number | null;
            }>;
            for (const r of rows) {
              const evt: FirehoseEvent = {
                eventName: r.event_name,
                sessionId: r.session_id,
                model: r.model,
                timestamp: r.timestamp,
                receivedAt: r.received_at,
                toolName: r.tool_name,
                durationMs: r.tool_duration_ms,
                costUsd: r.cost_usd,
              };
              safeEnqueue(sseEncode(evt, 'otel'));
              cursor = r.received_at;
            }
          } catch (err) {
            // db may briefly be locked during WAL checkpoint — just skip this tick
            safeEnqueue(sseComment(`error ${(err as Error).message}`));
          }
        };

        const pollTimer = setInterval(tick, 2000);
        const heartbeat = setInterval(() => safeEnqueue(sseComment('ping')), 15_000);
        tick(); // immediate first tick

        const cleanup = () => {
          closed = true;
          clearInterval(pollTimer);
          clearInterval(heartbeat);
          try { controller.close(); } catch { /* already closed */ }
        };

        if (request.signal.aborted) { cleanup(); return; }
        request.signal.addEventListener('abort', cleanup);
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  }
  ```
  Smoke test:
  ```
  curl -N http://localhost:3000/api/firehose
  ```
  Expected: `: connected`, then `: ping` every 15 s, and `event: otel` frames whenever new OTEL rows arrive. Commit:
  ```
  git add app/api/firehose/route.ts
  git commit -m "feat(phase-4): SSE /api/firehose polling otel_events every 2s"
  ```

---

### Phase 4.6 — `useSSE` client hook

- [ ] **4.6.1** Create `hooks/use-sse.ts`. Full content:
  ```typescript
  'use client';

  import { useEffect, useRef, useState } from 'react';

  export interface UseSSEOptions<T> {
    /** Event name to subscribe to. Defaults to 'message'. */
    eventName?: string;
    /** Max events kept in the buffer. Older ones are dropped. */
    bufferLimit?: number;
    /** Called for each event in addition to buffering (for side effects). */
    onEvent?: (parsed: T) => void;
    /** Enable/disable the subscription dynamically. Default true. */
    enabled?: boolean;
  }

  export interface UseSSEResult<T> {
    events: T[];
    connected: boolean;
    lastError: string | null;
  }

  /**
   * Subscribes to a Server-Sent Events endpoint. Auto-reconnects by browser default.
   * Buffers parsed events in state; clears them on URL change.
   */
  export function useSSE<T = unknown>(
    url: string | null,
    opts: UseSSEOptions<T> = {},
  ): UseSSEResult<T> {
    const { eventName = 'message', bufferLimit = 500, onEvent, enabled = true } = opts;
    const [events, setEvents] = useState<T[]>([]);
    const [connected, setConnected] = useState(false);
    const [lastError, setLastError] = useState<string | null>(null);
    const onEventRef = useRef(onEvent);
    useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

    useEffect(() => {
      if (!enabled || !url) return;
      setEvents([]);
      setConnected(false);
      setLastError(null);

      const es = new EventSource(url);

      const handler = (ev: MessageEvent) => {
        try {
          const parsed: T = JSON.parse(ev.data);
          setEvents(prev => {
            const next = [...prev, parsed];
            return next.length > bufferLimit ? next.slice(next.length - bufferLimit) : next;
          });
          onEventRef.current?.(parsed);
        } catch (err) {
          setLastError(`parse error: ${(err as Error).message}`);
        }
      };

      es.addEventListener('open', () => { setConnected(true); setLastError(null); });
      es.addEventListener('error', () => {
        setConnected(false);
        setLastError('connection error');
        // EventSource auto-reconnects — no manual retry needed
      });
      es.addEventListener(eventName, handler as EventListener);
      if (eventName !== 'message') {
        // also listen on default 'message' for servers that don't set event names
        es.addEventListener('message', handler as EventListener);
      }

      return () => {
        es.removeEventListener(eventName, handler as EventListener);
        es.removeEventListener('message', handler as EventListener);
        es.close();
      };
    }, [url, eventName, bufferLimit, enabled]);

    return { events, connected, lastError };
  }
  ```
  Verify:
  ```
  npx tsc --noEmit
  ```
  Commit:
  ```
  git add hooks/use-sse.ts
  git commit -m "feat(phase-4): useSSE hook — buffered EventSource subscriber"
  ```

---

### Phase 4.7 — `LiveSessionsCard` panel

- [ ] **4.7.1** Create `components/panels/live-sessions-card.tsx`. Uses the existing `useAutoRefresh` (5-second interval, pauses when tab hidden).
  ```typescript
  'use client';

  import { useCallback, useEffect, useState } from 'react';
  import { Activity, Clock } from 'lucide-react';
  import { useAutoRefresh } from '@/hooks/use-auto-refresh';
  import type { LiveSessionRow } from '@/types/live';
  import { LiveSessionDetailSheet } from './live-session-detail-sheet';

  function timeAgo(iso: string): string {
    const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  }

  export function LiveSessionsCard() {
    const [rows, setRows] = useState<LiveSessionRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<LiveSessionRow | null>(null);

    const load = useCallback(async () => {
      try {
        const res = await fetch('/api/sessions/live', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        setRows(await res.json());
      } catch { /* transient — keep prior rows */ }
      finally { setLoading(false); }
    }, []);

    useEffect(() => { void load(); }, [load]);
    useAutoRefresh(load, 5000);

    return (
      <>
        <section className="rounded-lg border border-brand-navy-light bg-brand-navy p-4">
          <header className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-brand-cyan">
              <Activity size={16} /> Live Sessions
              <span className="text-xs font-normal text-zinc-400">
                (last 5 min · {rows.length})
              </span>
            </h2>
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">auto · 5s</span>
          </header>

          {loading && <p className="text-xs text-zinc-500">Loading…</p>}
          {!loading && rows.length === 0 && (
            <p className="text-xs text-zinc-500">No sessions active in the last 5 minutes.</p>
          )}

          <ul className="space-y-1">
            {rows.map(r => (
              <li key={r.id}>
                <button
                  onClick={() => setSelected(r)}
                  className="flex w-full items-center justify-between rounded border border-transparent bg-brand-navy-dark/40 px-3 py-2 text-left text-xs transition hover:border-brand-cyan/40 hover:bg-brand-navy-dark"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-zinc-100">{r.title}</span>
                    <span className="truncate text-[10px] text-zinc-500">
                      {r.projectName} · {r.model ?? 'unknown model'} · {r.tokenTotal.toLocaleString()} tok
                    </span>
                  </span>
                  <span className="ml-3 flex shrink-0 items-center gap-1 text-[10px] text-zinc-400">
                    <Clock size={10} /> {timeAgo(r.lastActiveAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <LiveSessionDetailSheet row={selected} onClose={() => setSelected(null)} />
      </>
    );
  }
  ```
  Commit:
  ```
  git add components/panels/live-sessions-card.tsx
  git commit -m "feat(phase-4): LiveSessionsCard with 5s auto-refresh"
  ```

---

### Phase 4.8 — `LiveSessionDetailSheet` drawer

- [ ] **4.8.1** Create `components/panels/live-session-detail-sheet.tsx`. Right-side slide-out, 460 px wide, subscribes via `useSSE`.
  ```typescript
  'use client';

  import { useEffect, useState } from 'react';
  import { X, Wrench, User, Bot, FileText } from 'lucide-react';
  import { useSSE } from '@/hooks/use-sse';
  import type { LiveSessionRow, LiveSessionState, LiveTimelineEntry } from '@/types/live';

  interface Props {
    row: LiveSessionRow | null;
    onClose: () => void;
  }

  const ICONS: Record<LiveTimelineEntry['kind'], typeof User> = {
    user_message: User,
    assistant_message: Bot,
    tool_use: Wrench,
    tool_result: FileText,
    system: FileText,
  };

  export function LiveSessionDetailSheet({ row, onClose }: Props) {
    const [state, setState] = useState<LiveSessionState | null>(null);

    useEffect(() => {
      if (!row) { setState(null); return; }
      let cancelled = false;
      fetch(`/api/sessions/live/${row.id}/state`, { cache: 'no-store' })
        .then(r => r.json())
        .then(j => { if (!cancelled) setState(j); })
        .catch(() => { /* fall back to null state */ });
      return () => { cancelled = true; };
    }, [row]);

    const { events, connected, lastError } = useSSE<LiveTimelineEntry>(
      row ? `/api/sessions/live/${row.id}/stream` : null,
      { eventName: 'timeline', bufferLimit: 500 },
    );

    if (!row) return null;

    return (
      <>
        <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
        <aside
          className="fixed right-0 top-0 z-50 flex h-full w-[460px] flex-col border-l border-brand-navy-light bg-brand-navy shadow-xl"
          role="dialog"
          aria-label="Live session detail"
        >
          <header className="flex items-center justify-between border-b border-brand-navy-light p-4">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-brand-cyan">{row.title}</h3>
              <p className="mt-1 truncate text-[10px] text-zinc-500">
                {row.projectName} · {state?.cwd ?? row.cwd ?? ''} · {state?.model ?? row.model ?? 'unknown'}
              </p>
            </div>
            <button onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-brand-navy-dark hover:text-zinc-100">
              <X size={16} />
            </button>
          </header>

          <div className="flex items-center gap-2 border-b border-brand-navy-light px-4 py-2 text-[10px]">
            <span className={`inline-block h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-zinc-500'}`} />
            <span className="text-zinc-400">{connected ? 'streaming' : 'disconnected'}</span>
            {lastError && <span className="ml-2 text-amber-400">· {lastError}</span>}
            <span className="ml-auto text-zinc-500">{events.length} events</span>
          </div>

          <ol className="flex-1 overflow-y-auto p-4 text-xs">
            {events.length === 0 && <li className="text-zinc-500">Waiting for activity…</li>}
            {events.map((e, i) => {
              const Icon = ICONS[e.kind];
              return (
                <li key={i} className="mb-3 flex gap-2 border-l border-brand-navy-light pl-3">
                  <Icon size={12} className="mt-0.5 shrink-0 text-brand-cyan" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-zinc-200">
                        {e.toolName ?? e.kind.replace('_', ' ')}
                      </span>
                      <span className="shrink-0 text-[10px] text-zinc-500">
                        {new Date(e.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    {e.preview && (
                      <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-zinc-400">
                        {e.preview}
                      </pre>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </aside>
      </>
    );
  }
  ```
  Commit:
  ```
  git add components/panels/live-session-detail-sheet.tsx
  git commit -m "feat(phase-4): LiveSessionDetailSheet drawer with SSE timeline"
  ```

---

### Phase 4.9 — Firehose feed panel

- [ ] **4.9.1** Create `components/panels/firehose-feed.tsx`.
  ```typescript
  'use client';

  import { useMemo, useState } from 'react';
  import { Zap } from 'lucide-react';
  import { useSSE } from '@/hooks/use-sse';
  import type { FirehoseEvent } from '@/types/live';

  export function FirehoseFeed() {
    const [filter, setFilter] = useState('');
    const { events, connected, lastError } = useSSE<FirehoseEvent>('/api/firehose', {
      eventName: 'otel',
      bufferLimit: 1000,
    });

    const filtered = useMemo(() => {
      if (!filter.trim()) return events;
      const q = filter.trim().toLowerCase();
      return events.filter(e => e.eventName.toLowerCase().includes(q));
    }, [events, filter]);

    const shown = [...filtered].reverse(); // newest on top

    return (
      <section className="rounded-lg border border-brand-navy-light bg-brand-navy p-4">
        <header className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-brand-cyan">
            <Zap size={16} /> Telemetry Firehose
          </h2>
          <span className={`inline-block h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-zinc-500'}`} />
          <span className="text-[10px] text-zinc-400">{connected ? 'streaming' : 'disconnected'}</span>
          {lastError && <span className="text-[10px] text-amber-400">{lastError}</span>}
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="filter event.name…"
            className="ml-auto w-48 rounded border border-brand-navy-light bg-brand-navy-dark px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-brand-cyan focus:outline-none"
          />
        </header>

        <div className="max-h-[60vh] overflow-y-auto rounded border border-brand-navy-light bg-brand-navy-dark/40 font-mono text-[11px]">
          {shown.length === 0 && (
            <p className="p-3 text-zinc-500">
              {events.length === 0 ? 'Waiting for events…' : 'No events match filter.'}
            </p>
          )}
          <ul className="divide-y divide-brand-navy-light">
            {shown.map((e, i) => (
              <li key={`${e.receivedAt}-${i}`} className="px-3 py-1.5">
                <span className="text-zinc-500">{new Date(e.receivedAt).toLocaleTimeString()}</span>{' '}
                <span className="text-brand-cyan">{e.eventName}</span>
                {e.toolName && <span className="text-zinc-300"> · {e.toolName}</span>}
                {e.durationMs !== null && e.durationMs !== undefined && (
                  <span className="text-zinc-400"> · {e.durationMs.toFixed(0)}ms</span>
                )}
                {e.costUsd !== null && e.costUsd !== undefined && (
                  <span className="text-zinc-400"> · ${e.costUsd.toFixed(4)}</span>
                )}
                {e.sessionId && (
                  <span className="text-zinc-600"> · {e.sessionId.slice(0, 8)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }
  ```
  Commit:
  ```
  git add components/panels/firehose-feed.tsx
  git commit -m "feat(phase-4): FirehoseFeed panel with event.name filter"
  ```

---

### Phase 4.10 — New `/dashboard/activity` page + nav entry

- [ ] **4.10.1** Create `app/dashboard/activity/page.tsx`.
  ```typescript
  import { FirehoseFeed } from '@/components/panels/firehose-feed';

  export const metadata = { title: 'Activity — ClaudeCodeDashboard' };

  export default function ActivityPage() {
    return (
      <main className="space-y-4 p-6">
        <header>
          <h1 className="text-lg font-semibold text-brand-cyan">Activity</h1>
          <p className="mt-1 text-xs text-zinc-400">
            Live telemetry firehose. Every OTEL event ingested into SQLite lands here within ~2s.
          </p>
        </header>
        <FirehoseFeed />
      </main>
    );
  }
  ```

- [ ] **4.10.2** Add an "Activity" nav entry. Find the sidebar in `components/layout/`. Edit the nav items array to include:
  ```
  { href: '/dashboard/activity', label: 'Activity', icon: Zap }
  ```
  Import `Zap` from `lucide-react`. (If the sidebar is not data-driven, add a new `<NavLink>` following the existing pattern.)

- [ ] **4.10.3** Wire `LiveSessionsCard` into `app/dashboard/page.tsx` — insert near the top of the main grid, above the existing Sessions list. Pattern:
  ```typescript
  import { LiveSessionsCard } from '@/components/panels/live-sessions-card';
  // …inside the JSX:
  <LiveSessionsCard />
  ```
  Smoke test the dev server manually:
  ```
  npm run dev
  # open http://localhost:3000/dashboard — expect a Live Sessions card
  # open http://localhost:3000/dashboard/activity — expect the firehose feed
  ```
  Commit:
  ```
  git add app/dashboard/activity/page.tsx app/dashboard/page.tsx components/layout/
  git commit -m "feat(phase-4): wire activity page + live-sessions card into dashboard"
  ```

---

### Phase 4.11 — Integration test: firehose delivers a DB insert

This is the one non-trivial test. Start the dev server, connect via `EventSource` (polyfilled via `undici`), insert a fixture row, assert arrival ≤ 3 s.

- [ ] **4.11.1** Add `eventsource` polyfill as a dev dep (Node 20 has no global `EventSource`):
  ```
  npm install --save-dev eventsource@^2.0.2 @types/eventsource@^1.1.15
  ```

- [ ] **4.11.2** Create `__tests__/sse-firehose.integration.test.ts`. Assumes the dev server is running on `localhost:3000` — the orchestrator documents this in the phase intro (spawn dev server manually before `npm run test`).
  ```typescript
  import { describe, it, expect, beforeAll, afterAll } from 'vitest';
  import EventSource from 'eventsource';
  import { getDb } from '../lib/db';
  import type { FirehoseEvent } from '../types/live';

  const DEV_URL = process.env.DEV_URL ?? 'http://localhost:3000';

  async function ping(): Promise<boolean> {
    try {
      const r = await fetch(`${DEV_URL}/api/firehose`, { method: 'HEAD' });
      return r.ok || r.status === 200 || r.status === 405;
    } catch { return false; }
  }

  describe('SSE firehose integration', () => {
    beforeAll(async () => {
      if (!(await ping())) {
        throw new Error(`dev server not reachable at ${DEV_URL} — run \`npm run dev\` first`);
      }
    });

    it('delivers a newly-inserted otel_events row within 3 seconds', async () => {
      const marker = `test-event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const received: FirehoseEvent[] = [];

      const es = new EventSource(`${DEV_URL}/api/firehose`);
      const done = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout: no matching firehose event in 3s')), 3000);
        es.addEventListener('otel', (ev: MessageEvent) => {
          const parsed: FirehoseEvent = JSON.parse(ev.data);
          received.push(parsed);
          if (parsed.eventName === marker) {
            clearTimeout(timer);
            resolve();
          }
        });
        es.addEventListener('error', () => { /* auto-reconnects — ignore transient errors */ });
      });

      // give the SSE its first tick to set cursor
      await new Promise(r => setTimeout(r, 250));

      // insert fixture row — matches otel_events schema from Phase 1
      const now = new Date().toISOString();
      getDb().prepare(
        `INSERT INTO otel_events (event_name, session_id, timestamp, received_at)
         VALUES (?, ?, ?, ?)`
      ).run(marker, 'integration-test-session', now, now);

      try { await done; }
      finally { es.close(); }

      const match = received.find(e => e.eventName === marker);
      expect(match).toBeTruthy();
      expect(match?.sessionId).toBe('integration-test-session');
    }, 10_000);

    afterAll(() => {
      // clean up fixture rows
      getDb().prepare(`DELETE FROM otel_events WHERE event_name LIKE 'test-event-%'`).run();
    });
  });
  ```
  Run:
  ```
  # terminal 1:
  npm run dev
  # terminal 2:
  npm run test -- --run __tests__/sse-firehose.integration.test.ts
  ```
  Expected: 1 passed. If it flakes with timeout, increase the `setTimeout(r, 250)` warm-up to 500 ms — the first SSE tick may not have fired yet. Commit:
  ```
  git add __tests__/sse-firehose.integration.test.ts package.json package-lock.json
  git commit -m "test(phase-4): integration test for firehose SSE end-to-end"
  ```

---

### Phase 4.12 — Integration test: session stream delivers a JSONL append

- [ ] **4.12.1** Create `__tests__/sse-session-stream.integration.test.ts`. Uses a temporary `CLAUDE_HOME` by pointing at a freshly-written session directory inside whatever `CLAUDE_HOME` the dev server was started with (documented prerequisite: run the dev server with `CLAUDE_HOME` pointing at a scratch dir).
  ```typescript
  import { describe, it, expect, beforeAll } from 'vitest';
  import EventSource from 'eventsource';
  import { promises as fs } from 'node:fs';
  import path from 'node:path';
  import type { LiveTimelineEntry } from '../types/live';

  const DEV_URL = process.env.DEV_URL ?? 'http://localhost:3000';
  const CLAUDE_HOME = process.env.CLAUDE_HOME;

  describe('SSE per-session stream integration', () => {
    beforeAll(() => {
      if (!CLAUDE_HOME) throw new Error('set CLAUDE_HOME to a scratch dir and start dev server with it');
    });

    it('delivers a newly-appended JSONL line as a timeline event within 3 seconds', async () => {
      const projectsDir = path.join(CLAUDE_HOME!, 'projects', 'integration-proj');
      await fs.mkdir(projectsDir, { recursive: true });
      const sessionId = `integration-${Date.now()}`;
      const fp = path.join(projectsDir, `${sessionId}.jsonl`);
      await fs.writeFile(fp, JSON.stringify({ type: 'user', message: { content: 'hi' }, timestamp: new Date().toISOString() }) + '\n');

      const entries: LiveTimelineEntry[] = [];
      const es = new EventSource(`${DEV_URL}/api/sessions/live/${sessionId}/stream`);
      const done = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout: no appended line arrived in 3s')), 3000);
        es.addEventListener('timeline', (ev: MessageEvent) => {
          const parsed: LiveTimelineEntry = JSON.parse(ev.data);
          entries.push(parsed);
          if (parsed.preview?.includes('appended-marker')) {
            clearTimeout(timer);
            resolve();
          }
        });
      });

      // wait for initial backfill to land + watcher/poll to arm
      await new Promise(r => setTimeout(r, 1200));

      await fs.appendFile(fp, JSON.stringify({
        type: 'user',
        message: { content: 'appended-marker payload' },
        timestamp: new Date().toISOString(),
      }) + '\n');

      try { await done; }
      finally { es.close(); await fs.rm(fp, { force: true }); }

      expect(entries.some(e => e.preview?.includes('appended-marker'))).toBe(true);
    }, 10_000);
  });
  ```
  Run:
  ```
  # terminal 1 (example — substitute your real path):
  CLAUDE_HOME=/tmp/ccd-scratch npm run dev
  # terminal 2:
  CLAUDE_HOME=/tmp/ccd-scratch npm run test -- --run __tests__/sse-session-stream.integration.test.ts
  ```
  Expected: 1 passed on both macOS/Linux (fs.watch path) **and** Windows (polling path). On Windows set `CLAUDE_HOME` in PowerShell via `$env:CLAUDE_HOME = "C:\Temp\ccd-scratch"` before each terminal. Commit:
  ```
  git add __tests__/sse-session-stream.integration.test.ts
  git commit -m "test(phase-4): integration test for per-session SSE on both platforms"
  ```

---

### Phase 4.13 — Final gates

- [ ] **4.13.1** Full typecheck + lint + tests:
  ```
  npx tsc --noEmit
  npm run lint
  npm run test -- --run
  ```
  Expected: zero TS errors, zero lint warnings, all unit tests green. (Integration tests may be skipped in this run if dev server isn't up — they have a `beforeAll` guard and will throw a clear message.)

- [ ] **4.13.2** Manual browser sanity sweep:
  - Open `http://localhost:3000/dashboard` — `Live Sessions` card renders, counts update every 5 s.
  - Click a live session row — drawer slides in from right, shows "streaming" green dot, events populate as the session makes tool calls.
  - Close the drawer — in DevTools → Network, confirm the SSE request transitions to "(canceled)" (proves `AbortSignal` cleanup fired).
  - Open `http://localhost:3000/dashboard/activity` — Firehose panel shows "streaming" green dot; type in the filter box and confirm events filter client-side.
  - In DevTools → Network, stop the dev server: SSE rows turn red with `error`, then auto-reconnect when dev server restarts. No manual refresh needed.

- [ ] **4.13.3** Cross-platform smoke (if possible in this session):
  - On Windows: `$env:CLAUDE_HOME = "C:\Temp\ccd-scratch"; npm run dev`, append a line to a JSONL in that dir, confirm it arrives over `curl -N`. Poll path exercised.
  - On macOS/Linux: same, but `fs.watch` path exercised.
  - Both must work — the only difference should be a ~500 ms-to-1 s latency delta (Win polls every 1 s).

- [ ] **4.13.4** Final commit + phase tag:
  ```
  git status
  git log --oneline -n 20
  # tag the phase so the orchestration master plan can tick it off
  git commit --allow-empty -m "feat(phase-4): live sessions + SSE firehose landed"
  ```

---

## Stop conditions for the reviewer

The reviewer agent (`feature-dev:code-reviewer`) must confirm:

1. Every SSE handler file begins with both `export const runtime = 'nodejs';` AND `export const dynamic = 'force-dynamic';`.
2. Every SSE handler attaches an `abort` listener to `request.signal` that clears intervals, closes watchers, and closes the controller.
3. `lib/live-sessions.ts` has no direct HTTP or SSE imports — it's pure.
4. The session-stream handler branches on `os.platform() === 'win32'` and uses polling on Windows.
5. The firehose cursor advances monotonically (`cursor = r.received_at`) — no risk of event duplication on reconnect.
6. The `useSSE` hook's `useEffect` cleanup calls `es.close()` — otherwise navigation between pages leaks sockets.
7. `hooks/use-auto-refresh.ts` was **reused** (not re-implemented) in `LiveSessionsCard`.
8. Both integration tests pass on the reviewer's platform. Neither connects via fetch — they use the `eventsource` polyfill.
9. `npx tsc --noEmit` and `npm run lint` are clean.
10. No new dependencies beyond `eventsource` + `@types/eventsource` as dev deps.

When all ten hold, Phase 4 is done. Update the master orchestration plan's phase index to tick Phase 4 complete, then either stand down or hand off to the Phase 5 orchestrator (Phase 5 depends on Phase 1 only, so it may already be running in parallel).
