---
title: Search
---

Search is a single box that looks across sessions, memory entries, and
projects at once, via `/api/search?q=...`. It reads the same underlying
data as the Sessions, Memory, and Projects pages (through `listSessions`,
`listMemories`, and `listProjects`), so results always reflect what's
currently on disk under `~/.claude/`.

## Content areas

Each result is a clickable card labeled with its type (**session**,
**memory**, or **project**, color-coded), a title, a one- or two-line
snippet, and a timestamp when one is available. Clicking a result navigates
straight to that session's transcript, the Memory page, or that project's
detail page. Results are capped at 50 and sorted with exact-position title
matches ranked above partial content matches.

## Controls

- **Search box** — type a query and press Enter or click **Search**. Press
  `/` anywhere on the page to jump focus into the box. The search only runs
  when you submit; there's no live-as-you-type search.
- There are no type filters or advanced query syntax — one query searches
  all three sources at once.

## Tips

- Matching is a plain case-insensitive substring match against each
  record's text, not fuzzy matching — a typo or partial word that doesn't
  appear verbatim won't match. Sessions match against project name plus
  summary, memory entries match against name, description, and full
  content, and projects match against name and path.
- Because a memory or session match can be found deep in its content while
  the card only shows the description/summary, a result's snippet
  sometimes won't visibly contain your search term — the match is still
  real, just not in the visible excerpt.
- All three sources are searched independently and merged, so a broad term
  (like a project name) can return session, memory, and project results
  all at once, sorted together by relevance score rather than grouped by
  type.
