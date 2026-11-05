# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-07-08

### Added
- feat(help): ? button, keyboard shortcut, and sidebar hint
- feat(help): topic pages with markdown rendering, TOC anchors, prev/next pager
- feat(help): help-mode chrome â€” amber sidebar, return banner, layout
- feat(help): author help topics for all 15 dashboard pages
- feat(help): markdown topic loader with frontmatter and section anchors
- feat(help): extract shared nav-items module with pathnameâ†’topic mapper
- feat(dispatcher): resolve default task model via the model registry
- feat(usage): source filter and per-source breakdown on Usage page
- feat(usage): Sources tab for managing additional .claude roots
- feat(usage): aggregate all registered sources in /api/usage
- feat(usage): /api/sources CRUD routes
- feat(usage): per-source report breakdown and filter
- feat(usage): multi-root usage loading with cross-root dedup
- feat(usage): tag usage entries with their source root
- feat(usage): add .claude source registry with validation
- feat(usage): display controls â€” range, granularity, filters, metric toggles, drill-down
- feat(usage): query-param-driven usage report endpoint
- feat(usage): filterable usage report aggregation (day/week/month, per-model pricing)
- feat(usage): per-entry JSONL parser with ccusage-parity dedup
- feat(usage): add LiteLLM-backed pricing module with bundled fallback
- feat(phase-3): B-3 session outcomes panel
- feat(phase-3): B-6 system pressure panel
- feat(phase-3): B-4 tool latency panel
- feat(phase-3): B-5 hook activity panel
- feat(phase-3): B-1 MCP server drill-down panel
- feat(phase-3): B-2 cache efficiency panel

### Fixed
- fix(help): share typing-target guard so shortcuts ignore <select> too
- fix(help): pin the help banner by making the layout wrapper viewport-height
- fix(help): heading anchor ids keep text from nested inline elements
- fix(usage): keep background source refresh from blocking the request
- fix(models): commit the model-registry client that dispatcher now imports
- fix(db): harden native-binding lookup against untrusted cwd
- fix(db): side-load Linux better-sqlite3 binary so WSL and Windows share one checkout
- fix(usage): surface refetch failures instead of silently showing stale data
- fix(sync): price sessions per model-day via shared LiteLLM pricing
- fix(tools): query SQLite tool_calls instead of legacy filesystem walk

### Changed
- test(help): guard anchor-id parity and nav invariants; a11y labels + button types
- docs: register help system in CLAUDE.md architecture map
- docs(plans): add implementation plan for help system
- docs(plans): add design for context-sensitive help system
- docs: rewrite README as full project documentation
- chore: refresh package-lock from Windows npm install
- chore: normalize line endings to LF via .gitattributes
- perf(usage): persistent parse cache, source snapshots, cross-platform fixes
- docs: multi-source usage completion report
- docs(plans): implementation plan for multi-machine usage sources
- docs(plans): add design spec for multi-machine .claude usage sources
- docs: usage accuracy rollout completion report
- chore(usage): remove legacy session-level usage aggregator
- perf(usage): memoize localDay formatter, dedupe unpriced-model warnings
- docs(plans): add plan for usage accuracy + display controls
- chore(models): refresh Claude model IDs to current aliases
- docs(plans): mark Phases 3, 4, 5 complete
- Merge pull request #3 from Chameleon-Labs-LLC/feature/help-system
- Add app icons and dashboard update post
- Rename live message param and adjust UI key
- Add Claude Code field guide

## [0.4.2] - 2026-04-24

### Changed
- Merge branch 'phase-4-live-realtime': live sessions + SSE firehose

## [0.4.1] - 2026-04-24

### Changed
- chore(eslint): scope _-prefix unused-arg rule to phase-5 lib files
- Merge branch 'master' into phase-4-live-realtime

## [0.4.0] - 2026-04-24

### Added
- feat(nav): rename Tasks to Mission Control
- feat(phase-5-cp4): Mission Control UI

### Changed
- Merge branch 'master' into phase-4-live-realtime

## [0.3.0] - 2026-04-24

### Added
- feat(phase-4): live sessions + SSE firehose landed
- feat(phase-5-cp3): Mission Control API routes
- feat(phase-4): wire activity page + live-sessions card into dashboard
- feat(dispatcher): spawn manager, PID files, classic+stream runners, HITL parsing
- feat(phase-4): FirehoseFeed panel with event.name filter
- feat(phase-4): LiveSessionDetailSheet drawer with SSE timeline
- feat(phase-4): LiveSessionsCard with 5s auto-refresh
- feat(phase-4): useSSE hook â€” buffered EventSource subscriber
- feat(phase-4): SSE /api/firehose polling otel_events every 2s
- feat(heartbeat): schedule materialiser with DST-safe cron parser
- feat(phase-4): SSE /api/sessions/live/:id/stream with win32 poll fallback
- feat(phase-4): GET /api/sessions/live/:id/state with hook + JSONL fallback
- feat(phase-5-cp1): data layer â€” types, formatters, task-tracker
- feat(phase-4): GET /api/sessions/live (5-min mtime window)
- feat(phase-4): live-session helpers with TDD coverage
- feat(phase-3): block A complete â€” all API routes + scaffold
- feat(phase-4): add live session + firehose type contracts
- feat(phase-3): observability page scaffold + panel stubs
- feat(phase-3): observability TypeScript types
- feat(phase-3): add Observability nav entry to sidebar
- feat(phase-3): CollapsibleSection shared component
- feat(phase-3): GET /api/system/pressure endpoint
- feat(phase-3): GET /api/hooks/activity endpoint
- feat(phase-3): GET /api/tools/latency endpoint
- feat(phase-3): GET /api/sessions/outcomes endpoint
- feat(phase-3): GET /api/usage/cache endpoint
- feat(phase-3): GET /api/mcp/[server]/tools endpoint
- feat(phase-3): GET /api/mcp list endpoint
- feat(phase-3): add observability-helpers lib
- feat(phase-2): add integration tests for /v1/logs and /v1/metrics ingest
- feat(phase-2): add Telemetry tab to Settings page with status card and wizard trigger
- feat(phase-2): add scripts/setup-otel.ts Node CLI wizard
- feat(phase-2): add GET /api/telemetry/status endpoint
- feat(phase-2): add POST /v1/logs and /v1/metrics ingest route handlers
- feat(phase-2): add otel-parse module with full unit test coverage
- feat(phase-1): HMR-safe boot-time sync loop (120s, unref'd)
- feat(phase-1): add POST /api/sync manual trigger
- feat(phase-1): port JSONL sync â€” tool pairing + local-day buckets
- feat(phase-1): add SQLite schema with full spec tables + WAL
- feat(phase-1): add localDay helper for evening-session bucketing
- feat(phase-1): add better-sqlite3 + tsx test runner
- feat(dev): bind dev server to all interfaces and log reachable URLs

### Fixed
- fix(heartbeat): use transaction.exclusive() call form
- fix(phase-4): correct token_usage to not double-count in-progress re-sync
- fix(phase-2): cap /v1/logs and /v1/metrics body size at 10 MB
- fix(phase-2): correct speed column to string (categorical OTEL attribute)
- fix(phase-2): unignore app/v1/logs/ (matched 'logs/' rule) and add missing route handler
- fix(claude-md): derive project roots from session cwd, prune nested roots
- fix: dedupe CLAUDE.md discovery and harden project path decoding

### Changed
- test(phase-4): integration tests for firehose + per-session SSE
- test(emergency-stop): verify only dispatcher PIDs are killed
- chore: add .tmp scaffold and gitignore for mission-control queue
- docs(plans): refresh phase-5 plan against phase-1+2 reality
- docs(plans): refresh phase-4 plan against phase-1+2 reality
- docs(plans): refresh phase-3 plan against phase-1+2 reality
- docs(plans): mark Phase 2 complete
- docs(plans): refresh phase-2 plan against phase-1 reality
- docs(plans): mark Phase 1 complete + log follow-up issues
- chore(phase-1): final verification pass â€” ESLint 10 flat config
- test(phase-1): add JSONL fixtures for sync tests
- docs(plans): add observability extension plans (master + 5 phases)
- chore(deps): upgrade next to 16.2.3 to fix high-severity vulnerabilities
- Merge branch 'master' into phase-4-live-realtime

## [0.2.0] - 2026-04-10

### Added
- feat: full-featured dashboard with drill-down, markdown, and analytics

### Changed
- Merge pull request #1 from jasonthecuber/fix/usage-stats-and-claudemd-discovery
- Fix usage stats and CLAUDE.md discovery on Windows

## [0.1.0] - 2026-04-01

### Changed
- chore: initialize ClaudeCodeDashboard project
