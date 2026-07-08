---
title: File History
---

File History is a read-only summary of Claude Code's own file-backup system:
every time Claude Code edits a file mid-session, it can save a versioned
backup under `~/.claude/file-history/<session-id>/`, named like
`<file-hash>@v1`, `<file-hash>@v2`, and so on. This page reads that directory
via the `/api/file-history` route and reports one row per session that has
backups on disk.

## Content areas

Each row is one session, identified by its (truncated) session ID, with the
time since it was last modified, how many distinct files have backups
(counted by unique hash prefix before the `@`), and the total number of
versions across all of those files. A header line above the list reports the
total session count. Sessions are sorted newest-first by the backup
directory's modification time.

## Controls

This page has no filters, search, or sort controls — it's a single
at-a-glance list. Rows aren't clickable; there is no drill-down into
individual file versions from this page.

## Tips

- "Files" here counts distinct file *hashes*, not the files' real paths —
  Claude Code names backups by content hash, so this page can't show you the
  original filename, only how many distinct files and how many total saved
  versions a session accumulated.
- A file whose backup name doesn't match the `hash@vN` pattern is still
  counted (as one file, one version) rather than skipped, so the counts
  reflect everything on disk even for unusual naming.
- If `~/.claude/file-history/` doesn't exist yet (no session has triggered a
  file backup), the page just shows "No file history sessions found" — that
  is normal on a fresh install, not an error.
- A session that fails to read (permission issue, corrupted directory) is
  silently skipped rather than shown as broken, so the total count you see
  may be slightly lower than the number of subdirectories actually on disk.
