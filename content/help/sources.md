---
title: Sources
---

Sources lets you add extra `.claude` folders — for example a WSL distro's
home directory, a mounted Windows drive, or another machine's synced
`.claude` folder — so their sessions are aggregated into the Usage & Cost
page alongside your primary `.claude` folder. The primary folder detected by
`CLAUDE_HOME` (or the default `~/.claude/`) is always included and can't be
removed. Data is loaded and mutated through `/api/sources` and
`/api/sources/[id]`.

## Content areas

The source table lists every configured source with a green or red dot for
reachability, its label (struck through when disabled), whether it's the
implicit primary source, its filesystem path, project and transcript counts,
and a "latest activity" timestamp. The primary source's row has no
rename/enable/remove buttons since it can't be edited — only added sources
get those controls.

## Controls

- **Add a `.claude` folder** — enter a label and a path, then
  **Validate & Add**. The button is disabled until both fields have text,
  and shows "Validating…" while the request is in flight. On success it
  reports the new source's project/transcript counts and latest activity
  inline; on failure it shows the server's error message instead.
- **Rename** — prompts for a new label and PATCHes it in; only shown for
  non-primary sources.
- **Enable / Disable** — toggles whether a source's data is included in
  Usage & Cost without deleting its configuration.
- **Remove** — asks for confirmation ("Usage from it will disappear from
  the dashboard") before DELETE-ing the source.
- A **Common locations** panel at the bottom gives example paths for
  reaching WSL from Windows and Windows from WSL.

## Tips

- A source with a red dot is unreachable right now (path not mounted, drive
  disconnected, etc.) — its past stats stay visible, but it won't contribute
  fresh data to Usage & Cost until reachable again.
- Disabling a source is non-destructive — it stays configured and can be
  re-enabled later; removing it deletes the configuration entirely.
- Duplicate `.claude` folders (e.g. the same drive mounted at two different
  paths) are deduplicated automatically, per the on-page hint, so adding a
  source you're unsure about won't double-count usage.
