---
title: Activity
---

Activity is a live, streaming feed of every OpenTelemetry event Claude Code
has emitted and this dashboard has ingested into its local SQLite database.
It connects to `/api/firehose`, a Server-Sent Events endpoint that polls the
`otel_events` table every 2 seconds and pushes any new rows down the wire —
events typically show up here within about 2 seconds of being emitted.

## Content areas

Each row in the feed is one OTEL event, shown with a timestamp, the event
name, and whatever extra fields that event type carries: a tool name and
duration for tool-use events, an estimated cost for events that report one,
and the first 8 characters of the session ID the event belongs to. Newest
events appear at the top of the list; the connection status dot next to the
header turns green ("streaming") when the SSE connection is open and gray
("disconnected") when it isn't.

## Controls

The only control is the filter box in the header — it matches against the
event name only (case-insensitive substring), not tool name or session ID.
Typing a filter doesn't reopen the connection; it just narrows which
already-buffered events are displayed. The feed buffers up to 1000 events
client-side and drops the oldest ones once that limit is exceeded.

## Tips

- If nothing ever appears here, telemetry may not be wired up — check the
  Observability page's OTEL setup status. Activity only shows events that
  have already made it into the local `otel_events` table.
- The connection auto-reconnects on its own (standard `EventSource`
  behavior); a brief "disconnected" flash usually resolves itself. A
  persistent parse error message next to the status dot indicates malformed
  event data rather than a network problem.
- Because the buffer is capped at 1000 events and lives only in the
  browser tab, refreshing the page clears the feed and starts collecting
  again from roughly 10 seconds before the page loaded — it isn't a
  permanent log viewer for old events.
