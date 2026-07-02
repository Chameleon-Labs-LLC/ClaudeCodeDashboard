# Usage page load performance — persistent parse cache

**Date:** 2026-07-02

## Problem

`/api/usage` re-parsed every `~/.claude/projects` JSONL transcript (470 MB,
~2,100 files, ~56k usage entries) on the first request after every server
start — measured at **~61–64 seconds**. The existing per-file mtime cache in
`lib/usage-engine.ts` was module-scoped memory, so it died on every restart
and on every dev-mode hot reload.

## Changes

1. **SQLite tier for the per-file parse cache** (`lib/usage-engine.ts`,
   `usage_file_cache` table in `lib/db.ts`). Lookup order per file:
   memory → SQLite (validated by mtime + size) → parse and write back to both.
   Old transcripts never change, so after a one-time backfill a cold start
   re-parses only files touched since the last run. Opt-in via the `db`
   handle (`loadUsageEntries(dir, source, db)` / `loadAllUsageEntries({ db })`)
   so tests and callers without SQLite keep the old behavior.
2. **Startup warm** (`lib/usage-warm.ts`, called from `instrumentation.ts`):
   warms the cache and prefetches LiteLLM pricing right after boot. Lives in
   its own module because Node APIs inline in `instrumentation.ts` trip
   Turbopack's Edge-runtime static analysis.
3. **Spread-push overflow fix**: `all.push(...entries)` throws `RangeError`
   past ~125k elements — and the per-file call sat inside a try/catch, so a
   huge file would be *silently dropped*. Replaced with a loop (`appendAll`).
   Regression test with 130k entries.
4. **`serverExternalPackages: ['better-sqlite3']`** (`next.config.js`):
   Turbopack was bundling better-sqlite3, which broke its native-addon
   loading under WSL dev (`ERR_DLOPEN_FAILED` / "invalid ELF header") — this
   was also the pre-existing cause of `[sync] boot run failed` and 500s from
   `/api/usage/cache` in WSL dev.
5. **Route hardening** (`app/api/usage/route.ts`): pricing fetch starts
   before the file scan; a SQLite failure degrades to memory-only caching
   instead of a 500.
6. **Filter debounce** (`app/dashboard/usage/page.tsx`): rapid checkbox
   toggles coalesce into one request after 250 ms; initial load is immediate.

## Measured results (WSL dev, real data)

| Scenario | Before | After |
|---|---|---|
| First `/api/usage` after server start | ~64 s | ~3 s (dev compile) / 1 s warm |
| Startup cache warm (fresh process) | n/a (61 s equivalent) | 26,541 entries in 109 ms |
| `/api/usage/cache` in WSL dev | HTTP 500 | HTTP 200, 0.4 s |
| 4 rapid filter toggles | 4 requests | 1 request |

Accuracy: totals from the cached path match the pure-parse ground truth
(only positive drift from usage generated between the two measurements;
buckets and session counts identical). Cache content spot-validated against
fresh parses of the 5 largest files.

## Cross-platform follow-up (same day)

The first round worked in WSL but broke `npm run dev` from PowerShell
(`ERR_DLOPEN_FAILED` loading `.native/linux-x64/better_sqlite3.node` on
Windows). Root causes and fixes:

1. **Turbopack constant-folds `process.platform` into compiled chunks**
   (verified: the chunk contained `if ("TURBOPACK compile-time falsy", 0)`
   where db.ts checks the platform). Since this checkout is shared between
   Windows and WSL, a `.next` cache written by one platform is poison for the
   other. Fix: per-platform build dirs — `distDir: '.next-' + process.platform`
   in `next.config.js` (which runs unbundled, so its check is real). This also
   protects `IS_WIN32` in `app/api/system/emergency-stop/route.ts`.
2. **`lib/db.ts` no longer branches on `process.platform` for correctness.**
   `_bindingCandidates()` enumerates the default loader plus every
   `.native/<platform>-<arch>/better_sqlite3.node`, and `openDb` tries them
   until one dlopens (platform only influences trial *order*). A wrong-platform
   chunk now self-heals instead of crashing.
3. **Per-source snapshots** (`usage_source_snapshot` table): the Windows
   install aggregates the WSL root over `\\wsl.localhost`, where a 9P metadata
   sweep of ~2,100 transcripts costs ~45 s *per request* (readdir ~32 s +
   stats ~15 s) even with every file content-cached. Requests now serve the
   source's snapshot with zero remote filesystem access; a background pass
   (`setImmediate`) re-sweeps when the snapshot is older than
   `sourceTtlMs` (default 15 min).
4. **Pricing failures are negative-cached for 5 min** — an offline host
   previously paid the 5 s LiteLLM fetch timeout on every request because only
   success was memoized.

Measured on Windows (PowerShell, WSL root registered as a source):
boot warm 53 s once (first ever, background) → 52 ms on later boots;
`/api/usage` 47 s → **1.7–2.1 s**.

## Notes

- `usage_file_cache` rows for deleted files are not pruned (bounded, harmless;
  a `DELETE ... WHERE path NOT IN (seen)` sweep can be added later if needed).
- The full-parse cost is CPU-bound JSON parsing; the SQLite tier stores only
  the extracted entries (~23 MB), which deserializes in ~100 ms.
- Tests: `tests/lib/usage-engine.test.ts` gained three tests (spread limit,
  SQLite persistence across restart, `db` forwarding in `loadAllUsageEntries`).
