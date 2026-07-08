---
title: Memory
---

The Memory page lists every memory file Claude Code has written to disk —
both the global memory directory under `~/.claude/memory/` and each
project's own `memory/` folder under `~/.claude/projects/<project>/`. It
reads them through the `/api/memory` route, which parses each file's YAML
frontmatter (`name`, `description`, `type`) with gray-matter and skips the
`MEMORY.md` index file itself, since that's just a table of contents rather
than a memory entry.

## Content areas

Each memory renders as a card showing its name (project memories are
prefixed with `[project-name]` so you can tell them apart from global ones),
an optional one-line description, and a color-coded type badge. Entries
without a `type` in their frontmatter default to **reference**. Clicking a
card toggles it open — collapsed cards show roughly the first 200 characters
of content with a fade-out and an "Expand" hint; long entries also show the
underlying markdown filename at the bottom of the card.

## Controls

- **Search box** — filters across the memory's name, description, and full
  content (case-insensitive substring match on all three). Press `/` to
  focus it from anywhere on the page.
- **Type filter buttons** — `all`, `user`, `feedback`, `project`,
  `reference`. These match the literal `type:` value from each file's
  frontmatter, so a memory with no `type:` field (defaulting to reference)
  only shows up under `all` or `reference`.
- **Export Markdown** — opens `/api/export?type=memory&format=markdown` in a
  new tab to download the current memory set as a single markdown file.

## Tips

- Search and the type filter combine: picking `feedback` and typing a search
  term narrows to feedback-type memories that also match the text.
- A card only shows the "Expand"/"Collapse" affordance when its content is
  over ~200 characters — short memories always render in full since there's
  nothing to truncate.
- Because global and per-project memories are merged into one list, sorting
  by name won't group them by project — use the search box with a project
  name if you want to isolate one project's memories quickly.
