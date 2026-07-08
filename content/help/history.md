---
title: History
---

The History page shows your raw prompt history — every line you've typed
into Claude Code, across all projects — read straight from
`~/.claude/history.jsonl` via the `/api/history` route. Each line in that
file is a JSON record with the prompt text, a timestamp, and the project
path it was typed in; the page loads up to 500 of the most recent entries,
newest first.

## Content areas

Each entry shows the prompt text in full, the project it was typed in
(derived from the last path segment of the recorded project path), and a
relative timestamp — "just now," minutes/hours/days ago, falling back to a
plain date once an entry is more than 30 days old. A summary line at the
bottom reports how many entries are currently shown out of the total loaded.

## Controls

- **Search box** — filters entries by substring match against the prompt
  text itself (case-insensitive). Press `/` to focus it.
- **Project dropdown** — narrows the list to one project at a time; its
  options are built from the distinct project names actually present in the
  loaded entries, sorted alphabetically, plus an "All Projects" default.
- Search and the project filter combine, same as elsewhere in the
  dashboard — you can pick a project and then search within it.

## Tips

- This is a list of what *you typed*, not a session transcript — it has no
  assistant responses, just your prompts. Use Sessions or Search if you need
  full conversation content.
- The page only ever loads the most recent 500 lines from
  `history.jsonl`, so very old prompts beyond that window won't appear here
  even if `history.jsonl` still contains them on disk.
- Lines in `history.jsonl` missing a `display`, `timestamp`, or `project`
  field are silently skipped rather than shown as broken rows, so the count
  you see may be slightly lower than the file's raw line count.
- If `~/.claude/history.jsonl` doesn't exist yet, the page just shows "No
  history entries found" rather than an error.
