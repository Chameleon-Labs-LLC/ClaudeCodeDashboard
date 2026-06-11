# Usage Accuracy & Display Controls — Completion Report

**Date:** 2026-06-10 23:12
**Plan:** [Docs/plans/2026-06-10-usage-accuracy-and-controls.md](plans/2026-06-10-usage-accuracy-and-controls.md)
**Commits:** `9cc3220..91d3d31` (9 commits on master, plus plan commit `f2e874f`)

## Problem

`/dashboard/usage` reported **$4,305.52** total cost; the reference tool `ccusage claude` reported **$1,901.62** on the same data. Five compounding bugs in the old `lib/claude-usage.ts`:

1. **No deduplication** — 51.5% of assistant usage entries in `~/.claude/projects` are duplicates (same `message.id` + `requestId`, copied across files by session resume and sidechain replay). All token counts ~2× inflated.
2. **Stale hardcoded rates** — opus billed at $15/$75 per MTok (Opus 4.7/4.8 are $5/$25); `claude-fable-5` fell through to sonnet rates ($3/$15; real $10/$50).
3. **Cache tokens mispriced** — cache reads (94% of token volume) priced at $0; cache writes at 1× input instead of 1.25×.
4. **Whole-session pricing by first model seen** — 559/984 sessions start with a haiku message, so entire opus/fable sessions were billed at haiku rates.
5. **Day bucketing** — whole session attributed to its start date in UTC (phantom "tomorrow" buckets).

The same stale rate table existed in `lib/sync-sessions.ts`, feeding wrong `cost_usd` into SQLite.

## Result

**Parity gate: 0.02% deviation from ccusage** on both cost and tokens, measured on live data (engine $1,978.38 vs ccusage $1,978.86, run ~40s apart while sessions were actively writing).

## What shipped

| Commit | Change |
|---|---|
| `9cc3220` | `lib/litellm-pricing.ts` — LiteLLM-backed pricing (same feed ccusage uses): per-token rates for all four token classes, >200k tiering, fast-mode multipliers, live fetch → memo → bundled fallback ladder (`lib/litellm-pricing.fallback.json`, refresh with `npm run pricing:refresh`) |
| `af16bca` | `lib/usage-engine.ts` — per-entry JSONL parser with ccusage-parity dedup (tests are faithful ports of ccusage's own dedup unit tests), mtime-keyed per-file cache |
| `ad98097` | `buildUsageReport` — filterable aggregation: day/week/month buckets in local time, per-model pricing, per-session rollups with per-model breakdowns |
| `e109e9b` | Perf: memoized `Intl.DateTimeFormat` in `lib/local-day.ts` (~64× on 17k calls), once-per-model unpriced warnings |
| `380cd68` | `/api/usage` — query params: `since`, `until`, `granularity`, `projects`, `models` |
| `7a331de` | `lib/sync-sessions.ts` — derived `cost_usd` now priced per model-day bucket via the shared pricing module; invisible `` bucket separator made explicit |
| `c3ad867` | New `/dashboard/usage` page: date presets + range pickers, granularity, project/model multi-selects, cost↔tokens metric toggle, token-class checkboxes driving a stacked chart, click-a-bucket drill-down, expandable per-session model breakdowns |
| `68aea31` | Removed legacy `lib/claude-usage.ts`; added stale-cache pricing test |
| `91d3d31` | Refetch-failure badge (no more silent stale data) |

## Verification

- 23 unit tests pass (`tests/lib/litellm-pricing.test.ts`, `tests/lib/usage-engine.test.ts`, `tests/lib/local-day.test.ts`); `npx tsc --noEmit` clean; `npm run build` clean
- Live smoke test: `next start` + `/api/usage?granularity=month&since=2026-05-01` returned correct month buckets; page verified rendering via Playwright (controls, chart, 1,011 session rows, dedup meta line)
- Each task passed implementer self-review → spec-compliance review → code-quality review; final whole-branch review: **Ready**
- `ccusage` comparisons used pinned `ccusage@20.0.6` (12 days old per the 7-day supply-chain rule)

## ⚠ Action needed (Windows side)

Run **`npm test` from PowerShell** once: the `better-sqlite3` native module is Windows-compiled, so the sync-sessions/db test suites could not run in WSL. Everything type-checks and the sync-sessions diff was reviewed line-by-line, but the sqlite runtime path needs the Windows-side confirmation.

Also note: `node_modules/@esbuild/` now contains **both** `win32-x64` and `linux-x64` (installed `--no-save`, same pinned version 0.27.7) so tsx/vitest work from both environments. A plain `npm install`/`npm ci` may prune the linux one again; re-add with `npm install --no-save --force @esbuild/linux-x64@0.27.7 @esbuild/win32-x64@0.27.7` if WSL test runs break.

## Known follow-ups (documented in plan, out of scope)

- SQLite rollups still count per-session-file (no cross-file dedup) and first-model attribution in `session_token_usage` — rate fix only; dedup redesign is a separate effort
- `claude-sonnet-4-7` has no LiteLLM pricing key (ccusage sees the same feed → also $0); zero entries in real history are affected, so no action taken
- URL-param persistence for page controls; sessions-table virtualization (1,000+ DOM rows); ChameleonLabs pricing-feed cross-check
- ccusage default `ccusage daily` aggregates ALL agents (Codex etc.) — compare the dashboard against `ccusage claude daily` only
