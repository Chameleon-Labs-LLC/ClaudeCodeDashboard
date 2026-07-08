---
title: Observability
---

Observability is the deep-dive telemetry view: MCP server health, cache
efficiency, session outcomes, tool and hook latency, and system pressure
(retries, compactions, API errors). Every panel reads from OTEL data synced
into the dashboard's local SQLite database (the `otel_events` and
`tool_calls` tables, plus session sync data), scoped to a shared time range
you pick at the top of the page.

## Content areas

- **MCP Servers** — one row per detected MCP server, with call count,
  average and p95 latency, and an error badge when any calls failed.
  Expanding a server's row loads its per-tool breakdown (`/api/mcp/<server>/tools`)
  showing calls, p50/p95/max latency, and error rate per tool. A server or
  tool tagged `slow` has a p95 at or above 10 seconds; `fast` means under
  500ms. If no MCP servers are detected, the panel suggests
  `claude mcp add`.
- **Session Health** — two side-by-side cards: **Cache Efficiency** (a
  sparkline of daily cache-hit rate against a 70% target line, plus total
  billable tokens; a "low sample" badge appears when there isn't much data)
  and **Session Outcomes** (a stacked daily bar chart of Errored,
  Rate limited, Truncated, Unfinished, and OK sessions).
- **Tool & Hook Performance** — **Tool Latency** lists every tool with
  call count and p50/p95/max duration (paired from JSONL data during session
  sync), and **Hook Activity** shows a daily bar of hook fire counts with
  average duration, sourced from pre/post-tool hooks configured in
  `~/.claude/settings.json`.
- **System Pressure** — three KPI tiles (Retry exhausted, Compactions, API
  errors) plus a list of the most recent API errors with status code,
  message, and retry attempt count when available. All three tiles turn
  green/neutral and the panel shows "All clear" when nothing has fired in
  the selected range.

## Controls

- **Range switcher** — `today`, `7d`, or `30d`, shared across every panel on
  the page; changing it reloads all of them at once.
- **Collapsible sections** — each section (MCP Servers, Session Health,
  Tool & Hook Performance, System Pressure) can be collapsed by clicking its
  header; the open/closed state is remembered per-section in the browser's
  local storage, so your layout persists across visits.
- Every panel also auto-refreshes on its own timer (every 60 seconds)
  independent of manual range changes.

## Tips

- A "Failed to load" message on any panel is panel-specific — it means that
  one API route errored, not that the whole page is broken; other panels
  keep working normally.
- Session Outcomes and Cache Efficiency will show an empty/placeholder state
  until there's synced session data for the selected range — this is
  expected on a fresh install or a very narrow ("today") range with no
  activity yet.
- Tool Latency data only exists for tool calls where JSONL pairing
  succeeded during session sync — a tool call without a matching duration
  won't show a p50/p95/max, even if it appears in Tool Analytics' call
  counts.
