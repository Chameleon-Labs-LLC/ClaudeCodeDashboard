---
title: Sessions
---

The Sessions page lists every Claude Code session found under
`~/.claude/projects/`, newest activity first, via the `/api/sessions` route.
Clicking any row opens that session's full transcript at
`/dashboard/sessions/[project]/[id]`, which is fetched on demand from
`/api/sessions/[project]/[id]` rather than loaded up front.

## Content areas

- **Session list** — each row shows the project name, a relative "time
  ago" for the last activity, a one- or two-line summary (when the session
  has one), the message count, and the first 8 characters of the session ID.
- **Session detail** — opening a session shows its full message transcript,
  rendered as markdown. Each message is tagged **user**, **assistant**, or
  **system** with a colored badge, plus a timestamp when the message has one.
  The header repeats the project name, the session ID (truncated), total
  message count, and the session's start time.
- **Long messages** — any message over 500 characters is truncated with a
  "Show more" / "Show less" toggle rather than rendered in full immediately,
  which keeps very long transcripts scrollable.

## Controls

- **Filter box** — a text field above the list filters by project name or
  summary text (case-insensitive substring match on either field). Press `/`
  anywhere on the page to jump focus into it.
- **Export JSON** — opens `/api/export?type=sessions&format=json` in a new
  tab, giving you the full session list as raw JSON.
- **Back to sessions** — the detail page has a link back to the list; it
  does not preserve your previous filter text.

## Tips

- The filter only searches the project name and the session summary — it
  does not search inside message bodies. Use the Search page for full-text
  search across message content.
- If a session has no summary, the filter still matches on project name
  alone, so filtering by a project name always works even for very short or
  brand-new sessions.
- Visiting a session detail URL directly (bookmark, deep link) works the
  same as clicking through — the page fetches by `project` and `id` route
  params independently of the list page's state.
- A missing or deleted session (bad ID, file removed from disk) shows
  "Session not found" instead of a blank page.
