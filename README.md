# ClaudeCodeDashboard

A local web dashboard for [Claude Code](https://claude.com/claude-code) — browse sessions and transcripts, track token usage and cost across machines, inspect tool and MCP analytics, ingest Claude Code's OpenTelemetry stream, and run an autonomous "Mission Control" task queue.

Everything runs on your machine. The dashboard reads directly from `~/.claude/` and keeps derived data in a local SQLite file. There is no cloud backend, no database server, and no authentication layer.

## Quick start

Requirements: Node.js 20+ (better-sqlite3 ships prebuilt binaries for current LTS releases) and a Claude Code installation with data in `~/.claude`.

```bash
npm install
npm run dev        # http://localhost:3000
```

That's it for the core dashboard. Optional extras:

- **Telemetry ingest** (live tool/cost/skill analytics): `npm run setup:otel` — see [Telemetry](#telemetry--opentelemetry-ingest).
- **Mission Control daemon** (autonomous task execution): `npm run daemon` — see [Mission Control](#mission-control).

> **Note:** `npm run dev` binds to `0.0.0.0`, so the dashboard is reachable from your LAN (the startup banner lists the URLs). There is no auth — don't expose it beyond networks you trust.

## Pages

| Page | What it does |
|---|---|
| **Overview** (`/dashboard`) | Top-level stats across projects, sessions, and usage. |
| **Sessions** | Browse every Claude Code session; drill into a full transcript view per session. |
| **Memory** | Browse CLAUDE memory and per-project memory files. |
| **Projects** | Discovered projects with per-project drill-down. |
| **History** | Prompt/command history. |
| **Activity** | Chronological activity feed. |
| **Usage & Cost** | Token and dollar tracking with day/week/month granularity, date-range, project, model, and source filters, and per-token-class toggles (input / output / cache write / cache read). Costs are priced per entry from the live LiteLLM feed (bundled snapshot as fallback) and deduplicated the same way `ccusage` does, so numbers match. |
| **Sources** | Register additional `.claude` roots (other machines, WSL↔Windows, synced backups) so Usage aggregates all of them. Duplicate entries across roots are deduplicated globally. |
| **Tool Analytics** | Per-tool call counts, session coverage, and latency. |
| **Observability** | Telemetry-driven panels: MCP server inventory (with per-tool schema token costs), cache efficiency, session outcomes, tool latency, hook activity, and a rate-limit pressure gauge. |
| **CLAUDE.md** | View and edit CLAUDE.md files across trusted project roots. |
| **Settings Inspector** | Tabs for `settings.json`, MCP servers, plugins, and telemetry health (with a one-click setup button). |
| **File History** | File-change history across sessions. |
| **Mission Control** (`/dashboard/tasks`) | Autonomous task board: compose and approve tasks, cron schedules that materialize tasks, decision prompts surfaced by running tasks, a two-way inbox, and an emergency-stop banner. |
| **Search** | Fuzzy search across sessions, memory, and history. |

## Configuration

Set via `.env.local` or the environment. Everything has a sensible default; most installs need none of these.

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_HOME` | `~/.claude` | Claude Code home directory to read from; also anchors the SQLite location. |
| `PORT` | `3000` | Dashboard port. |
| `CCD_DB_PATH` | `$CLAUDE_HOME/ccd/dashboard.db` | Override the SQLite file path. |
| `CCD_NATIVE_BINDING` | — | Explicit path to a `better_sqlite3.node` binary (see [Windows + WSL](#windows--wsl-shared-checkout)). |
| `TZ` | system | Timezone used for local-day usage bucketing. |

Mission Control / daemon knobs:

| Variable | Default | Purpose |
|---|---|---|
| `MAX_CONCURRENT` | `3` | Max concurrent `claude` child processes the dispatcher runs. |
| `TASK_TIMEOUT_SECONDS` | `300` | Per-task timeout. |
| `CLAUDE_BINARY` | `claude` | CLI binary the dispatcher launches. |
| `MISSION_CONTROL_DEFAULT_MODEL` | model registry `sonnet` | Default model for dispatched tasks. |
| `DASHBOARD_URL` | `http://localhost:3000` | Base URL the daemon calls back to. |
| `DAEMON_INTERVAL_SECONDS` | `120` | Daemon tick interval. |
| `DAEMON_SINGLE_TICK` | — | Set `1` to run one tick and exit (used by the trigger endpoint). |
| `CLAUDE_CODE_MAX_RETRIES` | `10` | Denominator for the rate-limit pressure gauge. |
| `MODEL_REGISTRY_URL` | ChameleonLabs S3 | Source for `npm run models:refresh`. |

## Telemetry — OpenTelemetry ingest

Claude Code can emit OTLP logs and metrics. The dashboard ingests them directly — no collector needed — at `POST /v1/logs` and `POST /v1/metrics`, feeding the Observability page and parts of Usage.

Enable it either from **Settings → Telemetry → Setup**, or:

```bash
npm run setup:otel        # interactive; --yes for non-interactive
```

Both merge these six keys into the `env` block of `~/.claude/settings.json` (existing values are never overwritten; a backup is written first):

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:3000",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_LOG_TOOL_DETAILS": "1"
  }
}
```

Then **fully quit and restart Claude Code** — it reads these only at startup. Verify on Settings → Telemetry, which shows each key's health.

Ingest notes: bodies are capped at 10 MB, and the endpoints always return HTTP 200 (even on parse errors) so Claude Code never re-sends batches.

## Mission Control

An autonomous task queue driven from `/dashboard/tasks`:

- **Tasks** are dispatched as `claude -p …` child processes (streamed or classic), up to `MAX_CONCURRENT` at a time, each with a timeout. Tasks can require approval before running and carry priority/risk/quadrant metadata.
- **Schedules** are cron expressions that materialize tasks on tick.
- **Decisions** let a running task pause and ask you a question; answer from the dashboard.
- **Inbox** is a two-way message channel between you and tasks/sessions.
- **Emergency stop** (`POST /api/system/emergency-stop`) kills all dispatcher-launched children via PID files and blocks new dispatches until resumed.

Run the loop with `npm run daemon` (ticks every `DAEMON_INTERVAL_SECONDS`), or fire a single tick with `POST /api/dispatcher/trigger`.

## Usage & cost tracking

- **Methodology matches [`ccusage`](https://github.com/ryoppippi/ccusage)**: one record per assistant message, duplicates removed by `(message.id, requestId)` (session resumes and sidechain replays copy ~50% of raw lines), each entry priced by its own model across all four token classes, fast-mode multipliers applied.
- **Pricing** comes from the LiteLLM feed at request time (1 h memo, 5 min negative cache when offline) with a bundled snapshot as fallback — refresh it with `npm run pricing:refresh`.
- **Performance**: parsed usage is cached per file in SQLite keyed by `(path, mtime, size)`, so only changed transcripts are ever re-parsed; a startup warm makes the first page load fast. Registered sources are additionally served from whole-source snapshots refreshed in the background (default TTL 15 min) — important when a source lives on a slow filesystem like `\\wsl.localhost`. Details in [Docs/usage-load-performance.md](Docs/usage-load-performance.md).
- **Multi-machine**: register extra `.claude` roots on the Sources page; entries are tagged per source and deduplicated globally, with per-source breakdowns and filters on the Usage page.

## Architecture

```
~/.claude/               (read-only inputs: transcripts, settings, memory, history)
        │
        ├─ lib/claude-data.ts       filesystem data access
        ├─ lib/usage-engine.ts      JSONL usage parsing / dedup / aggregation
        ├─ lib/sync-sessions.ts     background sync loop (120 s) → SQLite
        ├─ app/v1/{logs,metrics}    OTLP ingest → SQLite
        └─ lib/dispatcher.ts        Mission Control task execution
        │
~/.claude/ccd/dashboard.db   (SQLite, WAL — all derived/operational state)
        │
        └─ app/api/*             → app/dashboard/* (client components fetch JSON)
```

Key conventions:

- All filesystem access happens in API routes / lib code — client components only fetch JSON.
- The SQLite schema (19 tables — sessions, token usage, tool calls, OTel events/metrics, Mission Control tables, caches, and more) lives in `lib/db.ts` and is created idempotently on first open.
- Live sessions stream to the browser over SSE (`/api/firehose`, `/api/sessions/live/[id]/stream`).

## API overview

All routes return JSON unless noted. The interesting ones:

| Area | Routes |
|---|---|
| Sessions | `GET /api/sessions`, `GET /api/sessions/[project]/[id]`, live: `GET /api/sessions/live`, SSE `…/[id]/stream`, `POST …/[id]/message` |
| Usage | `GET /api/usage` (`since`, `until`, `granularity`, `projects`, `models`, `sources`), `GET /api/usage/cache` |
| Sources | `GET/POST /api/sources`, `PATCH/DELETE /api/sources/[id]` |
| Analytics | `GET /api/tools`, `GET /api/tools/latency`, `GET /api/mcp`, `GET /api/mcp/[server]/tools`, `GET /api/hooks/activity`, `GET /api/sessions/outcomes` |
| Telemetry | `POST /v1/logs`, `POST /v1/metrics` (OTLP), `GET /api/telemetry/status`, `POST /api/telemetry/setup` |
| Mission Control | `/api/tasks` (+ `approve`, `rerun`), `/api/schedules`, `/api/decisions` (+ `answer`), `/api/inbox` (+ `read`, `reply`), `POST /api/dispatcher/trigger`, `POST /api/system/emergency-stop` / `emergency-resume`, `GET /api/system/pressure` |
| Content | `GET/PUT /api/claude-md`, `GET /api/memory`, `GET /api/history`, `GET /api/search`, `GET /api/export`, `GET /api/settings`, `GET /api/stats` |
| Streaming | `GET /api/firehose` (SSE event firehose) |

## Development

```bash
npm run dev            # dev server (Turbopack)
npm run typecheck      # tsc --noEmit
npm test               # unit tests (node test runner via tsx)
npm run test:otel      # vitest suite
npm run test:integration
npm run lint
npm run build          # production build
```

Utility scripts:

| Script | Purpose |
|---|---|
| `npm run setup:otel` | Telemetry settings wizard (see above). |
| `npm run daemon` | Mission Control dispatcher loop. |
| `npm run pricing:refresh` | Refresh the bundled LiteLLM pricing snapshot. |
| `npm run models:refresh` | Refresh the bundled model-registry snapshot. |
| `scripts/provision-linux-sqlite.sh` | Provision the WSL better-sqlite3 binary (see below). |

### Windows + WSL shared checkout

This repo supports being run from **both PowerShell and WSL on the same checkout** (e.g. under `/mnt/d`). That setup has sharp edges, all handled but worth knowing:

- **Build caches are per-platform** (`distDir: .next-win32` / `.next-linux`): Turbopack constant-folds `process.platform` into compiled chunks, so one platform's cache is poison for the other. Never share or copy `.next-*` dirs across platforms.
- **`node_modules` belongs to whichever platform ran `npm install`** (typically Windows). For WSL, run `bash scripts/provision-linux-sqlite.sh` once to side-load a Linux `better-sqlite3` binary into `.native/` — `lib/db.ts` tries binding candidates at runtime until one loads, so each platform picks its working binary automatically. Re-run the script after Node ABI or better-sqlite3 upgrades.
- **Line endings are pinned by `.gitattributes`** (LF for text) so Windows tooling can't churn the tree.
- Registering the WSL root as a usage source on the Windows side works, but lives behind the source-snapshot cache because `\\wsl.localhost` filesystem metadata is ~1000× slower than native.

Single-platform checkouts need none of this — a fresh clone + `npm install` + `npm run dev` just works.

### Troubleshooting

- **`better-sqlite3` install fails on Windows** (no prebuilt for your Node version): `npm config set msvs_version 2022` then `npm rebuild better-sqlite3 --build-from-source` (requires VS Build Tools).
- **`ERR_DLOPEN_FAILED` / "invalid ELF header" / "not a valid Win32 application"**: you're loading the other platform's binary — delete `.next-*`, and on WSL run `scripts/provision-linux-sqlite.sh`.
- **WSL tests fail with an esbuild platform error**: Windows `npm install` prunes `@esbuild/linux-x64`. Install it somewhere outside the repo and point `ESBUILD_BINARY_PATH` at its `bin/esbuild`.
- **Usage page empty**: the dashboard reads `$CLAUDE_HOME/projects` — check `CLAUDE_HOME` and that Claude Code has written transcripts there.
- **Telemetry panels empty**: run the setup (above), restart Claude Code fully, and check Settings → Telemetry.

## Further reading (`Docs/`)

- [Claude-Code-Field-Guide.md](Docs/Claude-Code-Field-Guide.md) — field guide to Claude Code itself
- [usage-load-performance.md](Docs/usage-load-performance.md) — the usage caching architecture and cross-platform fixes
- [usage-accuracy-rollout-2026-06-10.md](Docs/usage-accuracy-rollout-2026-06-10.md) — how cost numbers reached ccusage parity
- [multi-source-usage-completion-report.md](Docs/multi-source-usage-completion-report.md) — multi-machine usage aggregation
- [model-registry-install.md](Docs/model-registry-install.md) — model-ID resolution via the registry
- [Docs/plans/](Docs/plans/) — the phased build plans (foundation → OTel ingest → observability → live/realtime → Mission Control)

## Tech stack

Next.js 16 (App Router, Turbopack) · React 18 · TypeScript · Tailwind CSS · better-sqlite3 (WAL) · Fuse.js · react-markdown · lucide-react. Local-only: no auth, no deployment target.
