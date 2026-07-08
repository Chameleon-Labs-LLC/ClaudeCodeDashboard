---
title: Mission Control
---

Mission Control is where you queue, dispatch, and reply to Claude Code
agent tasks — a lightweight ops layer sitting on top of a local task
dispatcher. It reads and writes through `/api/tasks`, `/api/decisions`,
`/api/inbox`, `/api/schedules`, and `/api/system/*`, all backed by local
SQLite tables the dispatcher process also reads from.

## Content areas

- **Pending decisions** — `DECISION:` markers emitted by running
  interactive-mode tasks that need a human's answer before the agent can
  continue. Each shows the prompt and, if you click Answer, a text box that
  posts your reply back to the waiting task.
- **Inbox** — `INBOX:` messages sent by agents running in Interactive mode.
  You can mark a message read or reply; a reply is injected into that
  task's running stdin, so it only works while the task is still active.
- **Task board** — three columns: **Pending** (includes tasks awaiting
  approval), **Running**, and **Done** (done, failed, or cancelled). Each
  card shows the task's title, a status pill, execution mode
  (Interactive/One-shot), risk level and dry-run badges when set, and how
  long ago it was created. Tasks awaiting approval get an **Approve**
  button; failed tasks get a **Rerun** button; every task can be deleted
  (with confirmation).
- **Schedules** — recurring task definitions with a name, cron expression,
  next/last run time, and an enabled toggle. A schedule whose next run time
  is more than 5 minutes in the past while still enabled is flagged with an
  amber "stale" dot.

## Controls

- **+ New task** — opens a side panel to create a task: title, description,
  execution mode (Interactive lets you reply mid-run; One-shot is fire-and-
  forget), an optional model override, priority (0–10), quadrant (Do /
  Schedule / Delegate / Archive), risk level, an optional assigned skill,
  and checkboxes for "Requires approval before running" and "Dry run" (runs
  `claude --dry-run`; no files are changed).
- **+ New schedule** — opens a side panel with an hour/minute/day-of-week
  picker that builds a cron expression, plus a natural-language text box.
- **Emergency stop** — a confirm-then-stop button that kills all
  dispatcher-launched Claude processes and prevents the dispatcher from
  claiming new pending tasks; it becomes a full-width red banner with a
  **Resume dispatcher** button while active. Status polls every 5 seconds.

## Tips

- The natural-language schedule box is a documented stub today — submitting
  text there returns an explanation string but no working cron expression
  (`cron: null`); use the hour/minute/day-of-week picker to actually create
  a schedule.
- The day-of-week picker in the schedule composer lets you multi-select
  days, but the cron expression it builds only uses the *first* selected
  day — if you need a schedule that fires on several different days, create
  one schedule per day for now.
- Inbox replies are injected into a task's live stdin, so they're only
  useful while that task is still running in Interactive mode; replying to
  a message from a task that has already finished won't do anything.
- The Task board polls every 10 seconds and Schedules every 30 seconds, but
  Decisions and Inbox poll every 5 and 10 seconds respectively regardless of
  tab visibility — the code specifically favors low-latency human-in-the-loop
  replies over battery/bandwidth savings for those two panels.
