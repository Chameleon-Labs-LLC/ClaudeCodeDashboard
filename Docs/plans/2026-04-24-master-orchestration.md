# Observability Extension — Master Orchestration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for execution. Each phase below has its own per-phase plan in this directory.

**Goal:** Extend the existing Next.js ClaudeCodeDashboard with the observability + telemetry + Mission Control feature set described in the build-your-own-dashboard prompt — cross-platform (Windows / macOS / Linux), keeping the current Next.js + TypeScript + Tailwind stack.

**Architecture:** Add SQLite as a derived cache layer over the existing JSONL-on-filesystem reads. Add OTEL HTTP ingest endpoints alongside the existing API routes. Add new dashboard pages for the observability panels and Mission Control surface. The current dashboard pages (sessions, memory, projects, usage, tools, claude-md, tasks, search) stay; new pages are added without disturbing them.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind, `better-sqlite3` (added in Phase 1), Server-Sent Events for real-time, Node `child_process` for the dispatcher. No Python, no FastAPI, no launchd.

---

## Source spec

The reference spec is `G:\Downloads\build-your-own-dashboard-prompt.md` (Mac-specific Python build). Each phase plan in this directory translates the relevant sections to our Next.js + cross-platform context. When a phase plan and the source spec disagree, the phase plan wins (it's the cross-platform translation).

## Phase index

| # | Phase | Plan file | Depends on | Status |
|---|---|---|---|---|
| 1 | Foundation — SQLite + JSONL sync | [2026-04-24-phase-1-foundation.md](2026-04-24-phase-1-foundation.md) | none | ✅ done |
| 2 | OTEL ingest endpoints | [2026-04-24-phase-2-otel-ingest.md](2026-04-24-phase-2-otel-ingest.md) | Phase 1 | ⏳ pending |
| 3 | Observability panels (6 high-value) | [2026-04-24-phase-3-observability-panels.md](2026-04-24-phase-3-observability-panels.md) | Phases 1+2 | ⏳ pending |
| 4 | Live sessions + SSE firehose | [2026-04-24-phase-4-live-realtime.md](2026-04-24-phase-4-live-realtime.md) | Phase 1 | ⏳ pending |
| 5 | Mission Control (dispatcher + scheduler + HITL) | [2026-04-24-phase-5-mission-control.md](2026-04-24-phase-5-mission-control.md) | Phase 1 | ⏳ pending |

**Phase 1 follow-up issues (carry forward into downstream phase planning):**
- `token_usage` double-counts on in-progress session re-sync — `upsertUsage` adds delta but `parseOne` always re-aggregates from the whole file. Phase 4 (live sessions) must address this either by deriving `token_usage` from `sessions` on read, or by tracking a per-session-per-day delta table.
- Tooling: `eslint-config-next@16.2.3` is broken on ESLint 10. `eslint.config.mjs` is a minimal flat config; React/JSX surface is ignored by lint. Re-enable when Next ships a compatible config.

**Critical path:** 1 → 2 → 3. Phases 4 and 5 can run in parallel with 3 once Phase 1 is done.

## Agent team roster

These are the subagent types to spawn during execution. Each phase plan names the specific agents it expects.

| Role | Subagent type | Used in |
|---|---|---|
| **Backend implementer** | `general-purpose` (or specialised SDK agent if available) | Phases 1, 2, 4, 5 |
| **Frontend panel implementer** | `general-purpose` | Phase 3 (×6 in parallel) |
| **Code reviewer** | `feature-dev:code-reviewer` | Between every phase + per-panel in Phase 3 |
| **Architect (re-planning)** | `feature-dev:code-architect` | Before Phases 3, 4, 5 to refresh plans against the post-Phase-1 reality |
| **Code explorer** | `feature-dev:code-explorer` | Spot use, e.g. before touching `lib/claude-data.ts` |

**Parallelism rules:**
- **Within a phase:** if the phase plan marks tasks `[P]`, dispatch them in a single message with multiple `Agent` tool calls.
- **Across phases:** never dispatch Phase N+1 work until Phase N's reviewer signs off.
- **Phase 3 specifically:** the 6 panels are independent — spawn all 6 frontend agents in one message after Phases 1+2 land.

## Hand-off protocol

After each phase:

1. The implementing agent reports back with a summary + list of files changed.
2. **Reviewer agent** (`feature-dev:code-reviewer`) is dispatched immediately on the diff. Must report no high-priority issues.
3. `npx tsc --noEmit` and `npm run lint` must both pass.
4. The phase's stop-conditions (in its plan) are verified manually by the orchestrator.
5. Commit with conventional message: `feat(phase-N): <summary>`.
6. Update this master plan: tick the phase off in the index above.

If the reviewer flags issues: a follow-up agent fixes them in the same phase, re-review, then move on. Do not start the next phase with open issues.

## Risk areas (orchestrator: watch these)

1. **`better-sqlite3` native build on Windows.** First-time install may need `npm config set msvs_version 2022` or the `windows-build-tools` package. Phase 1 plan documents the fallback.
2. **JSONL local-time bucketing.** The source spec uses `DATE(timestamp, 'localtime')` (SQLite). Our Node port uses `Intl.DateTimeFormat` with the host TZ. Phase 1 has a dedicated test for evening-session day boundaries.
3. **OTEL endpoint path conflicts.** Next.js may route `/v1/logs` differently from FastAPI. Phase 2 verifies Claude Code can actually POST to `http://localhost:3000/v1/logs` (not just localhost:8765 — we're on Next's port, not the prompt's).
4. **Dispatcher cross-platform PID handling.** Phase 5 uses PID files on disk + `process.kill(pid, 0)` probing, with a Windows fallback via `tasklist`. The "kill only dispatched children" guarantee is the highest-risk piece.
5. **Plan drift.** The Phase 3/4/5 plans are written in advance against assumptions about Phase 1's output. After Phase 1 lands, the architect agent re-reviews each downstream plan and patches any drift before that phase starts.

## Cross-platform port notes

The source spec is Mac-only. These are the substitutions that apply across phases:

| Source spec | This project |
|---|---|
| Python 3.10+ | TypeScript / Node ≥ 20 |
| FastAPI + uvicorn | Next.js App Router route handlers |
| SQLite (`sqlite3` stdlib) | `better-sqlite3` (sync, fast, prebuilt binaries) |
| `subprocess.Popen` | Node `child_process.spawn` |
| `os.kill(pid, signal.SIGTERM)` | `process.kill(pid, 'SIGTERM')` + `taskkill /pid /T /F` on Win |
| `pkill` / `ps eww` | PID files (no platform `ps` parsing) |
| launchd plist | `npm run daemon` script (manual) — autostart deferred per-user |
| `install.sh` | `npm install` + `npm run setup` (Node script) |
| `~/.claude/projects/` | Already handled cross-platform via `os.homedir()` in `lib/claude-home.ts` |
| `DATE(ts, 'localtime')` SQLite | Bucket in JS via `Intl.DateTimeFormat` before insert |
| Port `8765` | Next dev port (`3000`) — the OTEL setup wizard writes that into Claude Code's settings |

## Out of scope (deferred or skipped)

- **Telegram bridge** — replaced by Discord; Discord coverage already comes from Claude Code's built-in Channels feature, so no in-dashboard Discord notifier is planned. (Webhook can be added later as a 30-line addition to Phase 5.)
- **Vite + TanStack Router** — not adopted. We use Next's file-based routing.
- **Playwright e2e** — not in initial scope. Add post-Phase-3 if useful.
- **`install.sh` / `cc` shim / launchd / systemd** — not in initial scope. `npm run dev` is the only entry point.
- **`Cowork` (`local-agent-mode-sessions`) ingest** — not in initial scope. The schema leaves a `source` column open for it later.
- **HITL Telegram notifications** — replaced per above.
- **All 33 panels** — Phase 3 ships the 6 highest-value ones. Remaining panels can be added later, one PR per panel, against the same data layer.

## Stop conditions for the whole plan

The full plan (Phases 1–5) is "done" when:

1. `npm install && npm run dev` works on a fresh checkout on Windows, macOS, and Linux.
2. After running `npm run setup` and restarting Claude Code, OTEL events appear in the dashboard within 30 seconds.
3. All 6 Phase 3 panels render with real data on `/dashboard/observability`.
4. The MCP drill-down (Phase 3 centerpiece) shows per-server p50/p95/max for any installed MCP server.
5. Live sessions panel (Phase 4) updates within 5 seconds of a tool call in any active session.
6. Queueing a task in `/dashboard/tasks` (Phase 5) spawns a `claude` child, runs to completion, and updates the task row.
7. The emergency stop button kills only dispatcher-launched children; an unrelated `claude` process running in another terminal survives.
8. `npx tsc --noEmit` passes. `npm run lint` passes.

## Execution kickoff

When ready to start:

1. Re-read [2026-04-24-phase-1-foundation.md](2026-04-24-phase-1-foundation.md).
2. Dispatch a **Backend implementer** subagent with that plan and the `superpowers:executing-plans` sub-skill.
3. After it reports back, dispatch a **Reviewer** subagent on the diff.
4. On clean review: commit, then dispatch an **Architect** to refresh the Phase 2 plan against what actually shipped.
5. Repeat for each phase.

Each phase plan in this directory is self-contained — an agent can execute it without reading the others, except for the schema definition in Phase 1, which downstream phases reference.
