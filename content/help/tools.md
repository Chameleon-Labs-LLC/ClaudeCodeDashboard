---
title: Tool Analytics
---

Tool Analytics shows how often each Claude Code tool (Bash, Read, Edit, and
so on) has been invoked, aggregated across every synced session. The
`/api/tools` route queries the `tool_calls` table in the dashboard's local
SQLite database — the same table populated by the background sync in
`lib/sync-sessions.ts` — grouping by tool name to get a call count and a
distinct-session count for each one.

## Content areas

- **Total Tool Calls** — a single headline number: the sum of every tool
  invocation across all tools.
- **Top 20 Tools** — a horizontal bar chart of the twenty most-used tools,
  each bar sized relative to the single most-used tool. Every bar also shows
  the raw call count inside it and the number of distinct sessions that used
  that tool off to the right.
- **All Tools** — below the chart, a card grid listing every tool (not just
  the top 20) with its call count and session count. This section only
  appears when there are more than 20 distinct tools.

## Controls

There are no filters, date ranges, or search on this page — it's a single
all-time aggregate view. To see per-tool timing and error-rate breakdowns
instead of call counts, use the Tool Latency panel on the Observability
page, which is a separate feature backed by `/api/tools/latency`.

## Tips

- "Sessions" for a tool means the number of distinct sessions that used it
  at least once — not the number of calls per session, so a tool called 50
  times in one session still shows `1` there.
- If this page shows "No tool usage data available," it means the
  `tool_calls` table is empty — sessions may not have finished syncing yet,
  or no tool calls have been recorded. This is a sync/data issue, not a
  broken page.
- Call counts here are all-time totals with no date filtering; if you need
  usage broken down by date range or cost, use the Usage & Cost page
  instead.
