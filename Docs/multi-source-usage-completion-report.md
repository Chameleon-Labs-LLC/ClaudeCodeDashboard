# Multi-Machine Usage Sources — Completion Report

**Date:** 2026-06-12 10:32
**Spec:** `Docs/plans/2026-06-12-multi-source-usage-design.md`
**Plan:** `Docs/plans/2026-06-12-multi-source-usage-plan.md`

## What shipped

The dashboard can now aggregate Claude Code token/cost usage from **multiple `.claude` folders** — e.g. the Windows one it runs against plus WSL's — in one Usage view. Background: there is no Anthropic API for individual Pro/Max usage (the Admin Usage & Cost API requires an organization admin key), so local JSONL aggregation is the correct mechanism.

### New: Sources tab (`/dashboard/sources`)
- Table of all sources with reachability dot, project count, transcript count, latest activity.
- Add form with server-side validation ("Validate & Add" reports what was found, or why it failed).
- Rename / Enable / Disable / Remove per source. The primary `CLAUDE_HOME` is always included and immutable.
- Hint card: `\\wsl.localhost\<distro>\home\<user>\.claude` (WSL from Windows), `/mnt/c/Users/<user>/.claude` (Windows from WSL).

### Usage page
- **Sources** multi-select filter (only shown when more than one source has data).
- **By Source** breakdown cards (only with 2+ sources).
- Amber banner when a registered source is unreachable (totals exclude it).

### Under the hood
- `lib/usage-sources.ts` — registry persisted at `~/.claude/ccd/sources.json`; validation (exists, has `projects/`, not the primary root, not a duplicate, `~` expansion); per-root stats.
- `lib/usage-engine.ts` — `UsageEntry.source` tag; `loadAllUsageEntries()` merges primary + enabled roots with **global dedup** by `(messageId, requestId)` so a copied/rsync'd folder can never double-count; unreachable roots are skipped and flagged, never a 500.
- `app/api/sources/` — GET/POST and PATCH/DELETE `[id]` routes.
- `app/api/usage` — now multi-root, accepts `sources=` filter; response adds `bySource`, `meta.allSources`, `meta.unreachableSources`.

## How to add your WSL usage
1. Open **Sources** in the sidebar.
2. Label: `WSL Ubuntu`, Path: `\\wsl.localhost\Ubuntu\home\leland\.claude` (dashboard runs on Windows).
3. Click **Validate & Add** — it shows projects/transcripts found.
4. Open **Usage & Cost** — totals now include both machines; use the Sources filter or the By Source cards for the per-machine split.

## Verification
- `npm test` — 88 pass, 0 fail (12 new tests: registry CRUD/validation, source tagging, multi-root merge, cross-root dedup, unreachable skip, report filter/breakdown).
- `npm run test:otel` — 19 pass.
- `npx tsc --noEmit` — clean.
- `npm run build` — production build succeeds, `/dashboard/sources` route present.
- Manual end-to-end (add WSL folder, see merged totals) pending — needs the dev server running on Windows.

## Commits
| Commit | Scope |
|---|---|
| `docs(plans)` ×2 | design spec + implementation plan |
| `feat(usage): add .claude source registry with validation` | lib + tests |
| `feat(usage): tag usage entries with their source root` | engine |
| `feat(usage): multi-root usage loading with cross-root dedup` | engine |
| `feat(usage): per-source report breakdown and filter` | engine |
| `feat(usage): /api/sources CRUD routes` | API |
| `feat(usage): aggregate all registered sources in /api/usage` | API |
| `feat(usage): Sources tab for managing additional .claude roots` | UI |
| `feat(usage): source filter and per-source breakdown on Usage page` | UI |

## Out of scope (future)
- Sessions/history/projects/search multi-root (the registry is reusable for it).
- Snapshot import for machines that can't be mounted as a path.
- OTEL/SQLite `token_usage` multi-source awareness.
