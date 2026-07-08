---
title: Settings
---

Settings Inspector is a read-mostly view into Claude Code's own
configuration: your `~/.claude/settings.json`, configured MCP servers,
installed plugins, and OTEL telemetry status. Everything is read from
`/api/settings` and `/api/telemetry/status`; the one write path on this page
is the telemetry setup wizard, which can add missing OTEL environment
variables to `settings.json`.

## Content areas (tabs)

- **Settings** — the raw contents of `~/.claude/settings.json`, pretty-printed
  as JSON.
- **MCP** — a card per configured MCP server, showing its command, arguments,
  and environment variables. Environment values longer than 20 characters
  are truncated with `...` so secrets aren't fully exposed on screen.
- **Plugins** — a card per installed plugin with its scope, install date,
  and last-updated date.
- **Telemetry** — OTEL configuration status: each of six expected keys
  (`CLAUDE_CODE_ENABLE_TELEMETRY`, `OTEL_EXPORTER_OTLP_ENDPOINT`,
  `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`,
  `OTEL_LOG_TOOL_DETAILS`) is shown with a checkmark (set to the expected
  value), a warning (set but to something else), or a hollow circle (not
  set), plus ingest statistics — total events received and the last event
  timestamp.

## Controls

- **Tab buttons** — switch between Settings, MCP, Plugins, and Telemetry.
  The Telemetry tab shows a small amber dot on its own button whenever any
  of the six OTEL keys are missing, so you can tell at a glance without
  opening the tab.
- **Apply missing settings** — only shown when at least one OTEL key is
  missing. Runs the setup wizard (`POST /api/telemetry/setup`), which the
  page says never overwrites values you already have — it only fills in
  gaps. On completion it shows the wizard's result message and re-fetches
  telemetry status.

## Tips

- After running the setup wizard (or editing `settings.json` yourself), you
  need to quit and restart Claude Code for the new environment variables to
  take effect — the page states this explicitly under the wizard button.
- If the wizard's fetch fails outright (not just "already configured"), the
  page suggests running `npm run setup:otel` from a terminal as a fallback
  — that's the same setup script the wizard button calls internally.
- The MCP tab only reflects servers listed in `~/.claude`'s own config;
  server *activity* (call counts, latency) lives on the Observability page,
  not here.
