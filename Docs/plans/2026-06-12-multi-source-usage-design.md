# Multi-Machine `.claude` Data Sources — Design Spec

**Date:** 2026-06-12
**Status:** Approved (design reviewed in session)
**Scope:** Usage page only this pass; registry designed for later adoption by sessions/history/search.

## Problem

The dashboard reads exactly one `.claude` root (`CLAUDE_HOME` or `~/.claude`). Leland runs the dev server from Windows PowerShell, so WSL's `~/.claude` — and any other machine's reachable `.claude` folder — is invisible. Goal: evaluate **total token use across multiple machines** in one Usage view.

There is no Anthropic API alternative for individuals: the Admin Usage & Cost API and Claude Code Analytics API require an organization admin key (Team/Enterprise/API orgs). Pro/Max subscription usage is not exposed via API, so local JSONL aggregation is the correct mechanism.

## Decision Summary

- **Approach:** Source registry + live multi-root reads (no copying, no snapshot import).
- **Reachability assumption:** every registered root is a filesystem path readable by the dashboard process (e.g. `\\wsl.localhost\Ubuntu\home\leland\.claude`, network drives).
- **UI placement:** new sidebar tab **Sources** (`/dashboard/sources`); Usage page gains a source filter + per-source breakdown.

## Architecture

### 1. Config & storage — `lib/usage-sources.ts`

File: `~/.claude/ccd/sources.json` (same dashboard-owned dir as `dashboard.db`).

```json
{
  "sources": [
    { "id": "wsl", "label": "WSL Ubuntu", "path": "\\\\wsl.localhost\\Ubuntu\\home\\leland\\.claude", "enabled": true }
  ]
}
```

- The primary `CLAUDE_HOME` is **never** stored in this file. It is always the implicit source `local` (label "This machine"), always enabled, cannot be removed or disabled.
- `lib/usage-sources.ts` owns: load (malformed/missing file → empty list + console warning), save, add/update/remove, id generation (slug of label, de-duped), and validation.
- **Validation rules** (server-side only): path exists, is a directory, contains a `projects/` subdirectory; reject a path that resolves (after `path.resolve`) to the primary `CLAUDE_HOME` or an already-registered source. Validation result includes discovery stats: project-dir count, `.jsonl` transcript count, newest transcript mtime.

### 2. API — `app/api/sources/route.ts` (+ `app/api/sources/[id]/route.ts`)

- `GET /api/sources` — all sources including implicit `local`, each with live stats: `reachable`, `projectCount`, `transcriptCount`, `latestActivity`.
- `POST /api/sources` — body `{ label, path }`; runs validation; on success persists and returns the new source with stats; on failure returns 400 with a human-readable reason (not found / no `projects/` / duplicate).
- `PATCH /api/sources/[id]` — relabel, enable/disable.
- `DELETE /api/sources/[id]` — remove (404 for `local` or unknown id).
- All filesystem access stays in API routes per project convention (never client-side).

### 3. Engine — `lib/usage-engine.ts`

- `UsageEntry` gains `source: string` (the source label; `"This machine"` for the primary root).
- New `loadAllUsageEntries(): LoadResult` — iterates the primary root plus every enabled registered source, calls the existing per-root loader with that root's `projects/` dir, tags entries with the source label.
- **Dedup stays global** across roots by `(messageId, requestId)` — a copied/rsync'd folder cannot double-count.
- **Unreachable root** (WSL stopped, drive unmounted): skipped, never throws; `LoadResult` gains `unreachableSources: string[]` surfaced through the report so the UI can flag stale totals.
- `buildUsageReport` gains a `sources` filter (same pattern as `projects`/`models`) and per-source totals (`totalsBySource`) in the report payload.
- `GET /api/usage` accepts `sources=` (comma list) and passes it through; response includes `totalsBySource` and `unreachableSources`.

### 4. UI

**Sources page** — `app/dashboard/sources/page.tsx`, sidebar entry **Sources** in `components/layout/sidebar.tsx` (icon: `HardDrive`).
- Table: label, path, status dot (reachable/unreachable), projects, transcripts, latest activity; enable/disable toggle; remove button; inline relabel.
- Add form: label + path inputs → **Validate** button calls `POST` (which validates before saving) and shows what was found ("14 projects, 312 transcripts, latest 2026-06-11") or the failure reason.
- Hint card with common path patterns: `\\wsl.localhost\<distro>\home\<user>\.claude`, mapped network drives, `CLAUDE_HOME` note.
- Brand: existing ChameleonLabs dark theme components/patterns.

**Usage page** — `app/dashboard/usage/`:
- Source filter dropdown beside the existing project/model filters.
- Per-source breakdown (totals row or stacked series, matching the page's existing breakdown idiom).
- Warning banner when `unreachableSources` is non-empty: "Totals exclude N unreachable source(s)".

## Error handling

| Failure | Behavior |
|---|---|
| `sources.json` missing/malformed | Treated as empty; console warning |
| Registered root unreachable at read time | Skipped; flagged in report + UI banner |
| Add-path invalid | 400 with specific reason; nothing persisted |
| Duplicate path (incl. primary root) | 400 "already registered" |

## Testing

- `__tests__/usage-sources.test.ts` — CRUD round-trip, id slugging, malformed file, validation matrix (missing dir, no `projects/`, duplicate, primary-root rejection).
- `__tests__/usage-engine` additions — multi-root load tags sources correctly; cross-root dedup by `(messageId, requestId)`; unreachable root skipped and reported; `sources` filter and `totalsBySource` in report.
- Existing usage tests must pass unchanged (single-root behavior is the degenerate case).

## Out of scope (this pass)

- Sessions / history / projects / search multi-root (registry API is reusable for it later).
- Snapshot import/upload for non-mounted remote machines.
- OTEL/SQLite (`token_usage` table) multi-source awareness.
