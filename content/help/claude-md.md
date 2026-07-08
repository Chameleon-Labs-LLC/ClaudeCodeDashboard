---
title: CLAUDE.md
---

This page finds and lets you view (and edit) every `CLAUDE.md` file Claude
Code knows about: the global one at `~/.claude/CLAUDE.md`, plus per-project
ones. Per-project files are discovered by reading each project's real
working directory out of its session `.jsonl` files (the `cwd` field Claude
Code writes on every message) and then walking that directory tree, up to 3
levels deep, skipping directories like `node_modules`, `.git`, and build
output. All of this happens through the `/api/claude-md` route.

## Content areas

- **File list sidebar** — one entry per discovered `CLAUDE.md`, labeled
  "Global" for `~/.claude/CLAUDE.md` or with the owning project's name (and
  subdirectory, if the file isn't at the project root) for everything else.
  The first file found is selected automatically when the page loads.
- **Content viewer** — the selected file's full path and rendered markdown
  content. Switching files in the sidebar resets any unsaved edit and
  discards the "Saved successfully" message.

## Controls

- **Edit / Cancel / Save** — Edit swaps the rendered view for a plain
  textarea holding the raw markdown; Cancel discards changes and reverts to
  the rendered view; Save PUTs the new content back to `/api/claude-md` and
  shows a success or failure message inline. The Save button disables itself
  while the request is in flight.

## Tips

- **Editing only actually works for the global file.** The save endpoint
  refuses to write anywhere outside `~/.claude/` (`Path must be within
  Claude home directory`), but every per-project `CLAUDE.md` this page
  discovers lives in that project's real repository path, not under
  `~/.claude/`. In practice, clicking Save on a project's `CLAUDE.md` will
  show "Failed to save." — use your editor/IDE for project-level files, and
  treat this page as read-only for anything other than the global file.
- Project roots are resolved from the `cwd` recorded in session JSONL
  files, not from the encoded directory name under
  `~/.claude/projects/` — so a project with no synced sessions yet won't
  have a discoverable working directory, and its `CLAUDE.md` won't appear
  here even if the file exists on disk.
- If a project's real root turns out to be a parent of another project's
  root, the parent's file search skips that child's subtree entirely, so
  you won't see duplicate or nested-project `CLAUDE.md` entries.
