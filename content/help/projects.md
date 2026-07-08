---
title: Projects
---

The Projects page lists every project Claude Code has session history for,
sourced from the directory names under `~/.claude/projects/` via the
`/api/projects` route. Claude Code encodes each project's real filesystem
path into that directory name; the dashboard decodes it back to a readable
path wherever it's shown.

## Content areas

- **Project list** — one row per project, with its name, a relative
  "time ago" for last activity (when known), its decoded filesystem path in
  monospace, and a session count. Rows also show small badges — **CLAUDE.md**
  and **Memory** — when that project has a `CLAUDE.md` file or a `memory/`
  folder respectively, so you can spot at a glance which projects have
  accumulated project-level context.
- **Project detail** — clicking a project opens a page with two tabs,
  **Sessions** and **Memory**, each labeled with a live count. The Sessions
  tab reuses the same session-row list as the main Sessions page, scoped to
  this project; the Memory tab reuses the same memory cards as the Memory
  page, scoped to this project's `memory/` folder only (global memories are
  excluded here).

## Controls

The detail page's two tab buttons are the only interactive controls beyond
navigation — there's no search or filter on this page. Both tabs fetch their
data in parallel when the page loads (`/api/sessions?project=<name>` and
`/api/memory?project=<name>`), so switching tabs after the initial load is
instant.

## Tips

- The path shown in monospace under each project name is decoded from
  Claude Code's directory-encoding scheme (for example a `-` separator gets
  turned back into `/` or `:\`) — if a project name looks garbled instead of
  a real path, the decoder couldn't make sense of it and is showing the raw
  encoded name as a fallback.
- The Memory tab on a project's detail page only shows that project's own
  memory files, not global memory — go to the main Memory page to see
  everything merged together.
- If a project has zero sessions and zero memory files, both tabs will
  simply say so; the project still appears in the list as long as its
  directory exists under `~/.claude/projects/`.
