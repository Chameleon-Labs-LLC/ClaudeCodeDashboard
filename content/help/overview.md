---
title: Overview
---

The Overview page is the dashboard's landing screen. It gives you a live
snapshot of what Claude Code has been doing on this machine: sessions
currently in progress, headline counts, and the most recent sessions across
every project. Everything on this page is read directly from `~/.claude/` —
there is no database — via the `/api/stats` and `/api/sessions/live` routes,
and the page polls both on a timer so the numbers stay current without a
manual refresh.

## Content areas

- **Live Sessions** — a card at the top listing sessions with activity in the
  last 5 minutes, each showing its title, project, model, and running token
  total. Clicking a row opens a detail sheet with more information about that
  session. This list is empty whenever nothing has been active in the last
  5 minutes, which is expected and not an error.
- **Stat cards** — three totals: Total Sessions, Projects, and Memory
  Entries, aggregated across everything found under `~/.claude/projects/`.
- **Recent Sessions** — the ten most recently modified sessions, in the same
  row format used elsewhere in the dashboard (project, title, timestamps).
  If no sessions exist yet, the page says so explicitly rather than showing
  an empty list.

## Refresh behavior

The headline stats (session/project/memory counts, recent sessions list)
refresh automatically every 30 seconds. The Live Sessions card refreshes on
its own, faster cadence — every 5 seconds — since "active in the last 5
minutes" is a moving window that goes stale quickly. Both refreshes happen
in the background without a visible loading spinner after the first load, so
the page won't flicker while you're reading it.

## Tips

- The Live Sessions card explicitly labels itself "auto · 5s" in its header —
  that badge is telling you the polling interval, not a stale-data warning.
- Because "recent sessions" and "live sessions" are two different queries
  (recent = last 10 by modification time, live = active in the last 5
  minutes), a session can appear in one list and not the other. A session
  you just finished working in may still show as "live" for a few minutes
  after you stop typing.
- If the whole page shows "Failed to load dashboard data," the underlying
  `/api/stats` call failed — check that `~/.claude/` is readable and that
  `CLAUDE_HOME` (if set) points somewhere valid.
