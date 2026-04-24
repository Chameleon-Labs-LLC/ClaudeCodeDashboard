# Phase 2 — OTEL Ingest Endpoints + Setup Wizard

**Goal:** Make the ClaudeCodeDashboard a real OpenTelemetry receiver. When Claude Code is configured with `CLAUDE_CODE_ENABLE_TELEMETRY=1` and OTLP endpoint vars pointing at `http://localhost:3000`, it POSTs OTLP/HTTP-JSON payloads here. This phase parses those payloads and inserts rows into the SQLite tables created in Phase 1, wires up the setup wizard as a runnable Node CLI script, and adds a Telemetry card to the Settings page so users can see the current status without leaving the browser.

**Depends on:** Phase 1 (SQLite schema + `lib/db.ts` must already exist with `otel_events` and `otel_metrics` tables).

**Architecture Decision:** Pure Next.js App Router route handlers at `/v1/logs` and `/v1/metrics`. No separate process, no proxy. Claude Code's OTLP exporter targets `http://localhost:3000` directly. A pure parser module (`lib/otel-parse.ts`) is tested independently of HTTP; the route handlers are thin shells that call it. The setup wizard is a standalone Node/TypeScript script executed via `tsx` (added as a dev dependency) — it never imports Next.js internals so it can run in any terminal context, including before `npm run dev` is started.

**Tech Stack additions this phase:**
- `tsx` (dev dep) — run TypeScript scripts without a build step
- `@types/better-sqlite3` already present from Phase 1

---

## Patterns & Conventions Observed

- API routes: thin — import from `lib/`, call `NextResponse.json()`. Pattern is in `app/api/sessions/route.ts` (3 lines).
- Data layer: all filesystem/DB access goes through `lib/`. Never in client components, never in the route handler body directly.
- Error handling in routes: no try/catch at the route level today — but OTEL ingest MUST be fault-tolerant so we introduce per-row try/catch inside `lib/otel-parse.ts`.
- Settings access: `lib/claude-settings.ts` uses `fs/promises` + `getClaudeHome()`. The `env` block inside `~/.claude/settings.json` is the correct location for OTEL keys (Claude Code reads them as process environment overrides).
- TypeScript strict mode is on (`tsconfig.json` line 9). All new code must satisfy it.
- Tailwind tokens in use: `brand-cyan`, `brand-navy`, `brand-navy-light`, `brand-navy-dark`, `chameleon-*`. See `tailwind.config.ts`.
- Scripts pattern: no existing `scripts/` directory yet — create it. The `tsx` runner is used as `npx tsx scripts/setup-otel.ts`.
- Commit convention: `feat(phase-2): ...` per master orchestration plan.

---

## OTLP/HTTP-JSON Payload Reference

### Logs (`POST /v1/logs`)

```json
{
  "resourceLogs": [
    {
      "resource": {
        "attributes": [
          { "key": "service.name", "value": { "stringValue": "claude-code" } },
          { "key": "service.version", "value": { "stringValue": "1.x.x" } }
        ]
      },
      "scopeLogs": [
        {
          "scope": { "name": "claude-code-telemetry", "version": "1.0.0" },
          "logRecords": [
            {
              "timeUnixNano": "1714000000000000000",
              "observedTimeUnixNano": "1714000000000000000",
              "severityNumber": 9,
              "severityText": "Info",
              "body": { "stringValue": "tool_result" },
              "attributes": [
                { "key": "event.name",        "value": { "stringValue": "tool_result" } },
                { "key": "session.id",        "value": { "stringValue": "abc123-def456" } },
                { "key": "prompt.id",         "value": { "stringValue": "prompt-789" } },
                { "key": "model",             "value": { "stringValue": "claude-opus-4-5" } },
                { "key": "tool.name",         "value": { "stringValue": "mcp_tool" } },
                { "key": "tool.success",      "value": { "boolValue": true } },
                { "key": "tool.duration_ms",  "value": { "doubleValue": 342.5 } },
                { "key": "tool_parameters",   "value": { "stringValue": "{\"mcp_server_name\":\"filesystem\",\"mcp_tool_name\":\"read_file\"}" } }
              ]
            },
            {
              "timeUnixNano": "1714000001000000000",
              "observedTimeUnixNano": "1714000001000000000",
              "severityNumber": 9,
              "severityText": "Info",
              "body": { "stringValue": "api_request" },
              "attributes": [
                { "key": "event.name",        "value": { "stringValue": "api_request" } },
                { "key": "session.id",        "value": { "stringValue": "abc123-def456" } },
                { "key": "model",             "value": { "stringValue": "claude-opus-4-5" } },
                { "key": "cost_usd",          "value": { "doubleValue": 0.00423 } },
                { "key": "api.duration_ms",   "value": { "doubleValue": 1872.0 } },
                { "key": "input_tokens",      "value": { "intValue": "4200" } },
                { "key": "output_tokens",     "value": { "intValue": "512" } },
                { "key": "cache_read_tokens", "value": { "intValue": "18000" } },
                { "key": "cache_create_tokens","value": { "intValue": "0" } }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

**Attribute value extraction rules:**
- `stringValue` → string
- `intValue` → string that parses to integer (OTLP JSON encodes int64 as string to avoid JS precision loss)
- `doubleValue` → number
- `boolValue` → boolean
- All other shapes → ignore

### Metrics (`POST /v1/metrics`)

```json
{
  "resourceMetrics": [
    {
      "resource": {
        "attributes": [
          { "key": "service.name", "value": { "stringValue": "claude-code" } }
        ]
      },
      "scopeMetrics": [
        {
          "scope": { "name": "claude-code-telemetry", "version": "1.0.0" },
          "metrics": [
            {
              "name": "claude_code.commit.count",
              "description": "Number of git commits",
              "unit": "1",
              "sum": {
                "aggregationTemporality": 1,
                "isMonotonic": true,
                "dataPoints": [
                  {
                    "startTimeUnixNano": "1714000000000000000",
                    "timeUnixNano": "1714000060000000000",
                    "asInt": "3",
                    "attributes": [
                      { "key": "session.id", "value": { "stringValue": "abc123-def456" } },
                      { "key": "model",      "value": { "stringValue": "claude-opus-4-5" } }
                    ]
                  }
                ]
              }
            },
            {
              "name": "claude_code.lines_of_code.count",
              "description": "Lines of code added or removed",
              "unit": "1",
              "gauge": {
                "dataPoints": [
                  {
                    "timeUnixNano": "1714000060000000000",
                    "asDouble": 142.0,
                    "attributes": [
                      { "key": "session.id", "value": { "stringValue": "abc123-def456" } }
                    ]
                  }
                ]
              }
            }
          ]
        }
      ]
    }
  ]
}
```

**Metric type detection:** if `metric.sum` exists → `"counter"`. If `metric.gauge` exists → `"gauge"`. Extract `dataPoints` from whichever branch is present. Value is `dp.asDouble ?? Number(dp.asInt) ?? 0`.

---

## Schema Assumed from Phase 1

`lib/db.ts` exports `getDb(): Database` returning a `better-sqlite3` `Database` instance opened in WAL mode.

`otel_events` columns:
```
event_name, session_id, prompt_id, timestamp, model, tool_name, tool_success,
tool_duration_ms, tool_error, cost_usd, api_duration_ms, input_tokens,
output_tokens, cache_read_tokens, cache_create_tokens, speed, error_message,
status_code, attempt_count, skill_name, skill_source, prompt_length, decision,
decision_source, request_id, tool_result_size_bytes, mcp_server_scope,
plugin_name, plugin_version, marketplace_name, install_trigger,
mcp_server_name, mcp_tool_name, received_at
```

`otel_metrics` columns:
```
metric_name, metric_type, value, session_id, model, timestamp
```

If Phase 1 ships a slightly different schema, the implementer must reconcile with the actual `CREATE TABLE` statement in `lib/db.ts` before running any INSERT.

---

## Files to Create or Modify

| File | Action | Notes |
|------|--------|-------|
| `lib/otel-parse.ts` | CREATE | Pure parser — no HTTP, no DB. Unit-testable. |
| `app/api/v1/logs/route.ts` | CREATE | POST handler. Calls parser, inserts, always 200. |
| `app/api/v1/metrics/route.ts` | CREATE | POST handler. Calls parser, inserts, always 200. |
| `app/api/telemetry/status/route.ts` | CREATE | GET — returns which OTEL env keys are set + last event timestamp. |
| `scripts/setup-otel.ts` | CREATE | Node CLI wizard. |
| `app/dashboard/settings/page.tsx` | MODIFY | Add Telemetry tab with status card + wizard trigger. |
| `package.json` | MODIFY | Add `tsx` dev dep + `setup:otel` script. |
| `types/otel.ts` | CREATE | TypeScript interfaces for OTLP shapes and parsed rows. |
| `__tests__/otel-parse.test.ts` | CREATE | Unit tests for the parser. |
| `__tests__/otel-ingest.integration.test.ts` | CREATE | Integration test: POST to live dev server, assert DB rows. |

---

## Data Flow

```
Claude Code process
  ↓  POST /v1/logs  (OTLP/HTTP-JSON, Content-Type: application/json)
app/api/v1/logs/route.ts
  ↓  parseOtelLogs(body) → OtelEventRow[]
lib/otel-parse.ts
  ↓  per-row try/catch, drops malformed rows, logs to stderr
app/api/v1/logs/route.ts
  ↓  getDb().prepare(INSERT INTO otel_events ...).run(row)
lib/db.ts (better-sqlite3, WAL mode)
  ↓  200 OK {"accepted": N, "dropped": M}

Claude Code process
  ↓  POST /v1/metrics (OTLP/HTTP-JSON)
app/api/v1/metrics/route.ts
  ↓  parseOtelMetrics(body) → OtelMetricRow[]
lib/otel-parse.ts
  ↓  per-row try/catch
app/api/v1/metrics/route.ts
  ↓  getDb().prepare(INSERT INTO otel_metrics ...).run(row)
lib/db.ts
  ↓  200 OK {"accepted": N, "dropped": M}

Browser (Settings page) → GET /api/telemetry/status
  ↓  reads ~/.claude/settings.json env block
  ↓  queries SELECT MAX(received_at) FROM otel_events
  ↓  200 OK { keys: {...}, lastEventAt: "..." | null }

Terminal: npm run setup:otel
  ↓  scripts/setup-otel.ts
  ↓  reads ~/.claude/settings.json
  ↓  backs up to settings.json.bak.<YYYYMMDD-HHMMSS>
  ↓  merges missing keys only
  ↓  writes back — NEVER overwrites existing values
  ↓  prints restart reminder
```

---

## Build Sequence

### Phase 2.0 — Prerequisites

- [ ] **2.0.1** Verify Phase 1 is complete: `lib/db.ts` exports `getDb()`, `npx tsc --noEmit` passes, `npm run lint` passes.
  ```
  npx tsc --noEmit
  npm run lint
  ```
  Expected: zero errors, zero warnings.

- [ ] **2.0.2** Add the `setup:otel` npm script. <!-- Phase 1 actual: tsx ^4.21.0 is already in devDependencies — do NOT re-install it -->

  Edit `package.json` `scripts` only — add:
  ```json
  "setup:otel": "tsx scripts/setup-otel.ts"
  ```
  Then:
  ```
  npm install
  ```
  Expected: no-op for tsx (already present); `node_modules/.bin/tsx` exists.

- [ ] **2.0.3** Create `types/otel.ts` with all TypeScript interfaces for OTLP shapes and parsed rows. This is the contract every other file in this phase depends on.

  Full content of `types/otel.ts`:
  ```typescript
  // ─── Raw OTLP/HTTP-JSON shapes (incoming payloads) ───────────────────────────

  export interface OtlpAttributeValue {
    stringValue?: string;
    intValue?: string;      // int64 encoded as string in JSON
    doubleValue?: number;
    boolValue?: boolean;
  }

  export interface OtlpAttribute {
    key: string;
    value: OtlpAttributeValue;
  }

  export interface OtlpResource {
    attributes?: OtlpAttribute[];
  }

  export interface OtlpScope {
    name?: string;
    version?: string;
  }

  // ─── Logs ────────────────────────────────────────────────────────────────────

  export interface OtlpLogRecord {
    timeUnixNano?: string;
    observedTimeUnixNano?: string;
    severityNumber?: number;
    severityText?: string;
    body?: OtlpAttributeValue;
    attributes?: OtlpAttribute[];
  }

  export interface OtlpScopeLogs {
    scope?: OtlpScope;
    logRecords?: OtlpLogRecord[];
  }

  export interface OtlpResourceLogs {
    resource?: OtlpResource;
    scopeLogs?: OtlpScopeLogs[];
  }

  export interface OtlpLogsPayload {
    resourceLogs?: OtlpResourceLogs[];
  }

  // ─── Metrics ─────────────────────────────────────────────────────────────────

  export interface OtlpDataPoint {
    startTimeUnixNano?: string;
    timeUnixNano?: string;
    asDouble?: number;
    asInt?: string;         // int64 as string
    attributes?: OtlpAttribute[];
  }

  export interface OtlpMetricData {
    dataPoints?: OtlpDataPoint[];
  }

  export interface OtlpMetric {
    name: string;
    description?: string;
    unit?: string;
    sum?: OtlpMetricData;
    gauge?: OtlpMetricData;
    histogram?: OtlpMetricData;
  }

  export interface OtlpScopeMetrics {
    scope?: OtlpScope;
    metrics?: OtlpMetric[];
  }

  export interface OtlpResourceMetrics {
    resource?: OtlpResource;
    scopeMetrics?: OtlpScopeMetrics[];
  }

  export interface OtlpMetricsPayload {
    resourceMetrics?: OtlpResourceMetrics[];
  }

  // ─── Parsed row shapes (ready for SQLite INSERT) ─────────────────────────────

  export interface OtelEventRow {
    event_name: string;
    session_id: string | null;
    prompt_id: string | null;
    timestamp: string;          // ISO-8601
    model: string | null;
    tool_name: string | null;
    tool_success: number | null; // 1/0/null
    tool_duration_ms: number | null;
    tool_error: string | null;
    cost_usd: number | null;
    api_duration_ms: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_tokens: number | null;
    cache_create_tokens: number | null;
    speed: number | null;
    error_message: string | null;
    status_code: number | null;
    attempt_count: number | null;
    skill_name: string | null;
    skill_source: string | null;
    prompt_length: number | null;
    decision: string | null;
    decision_source: string | null;
    request_id: string | null;
    tool_result_size_bytes: number | null;
    mcp_server_scope: string | null;
    plugin_name: string | null;
    plugin_version: string | null;
    marketplace_name: string | null;
    install_trigger: string | null;
    mcp_server_name: string | null;
    mcp_tool_name: string | null;
    received_at: string;        // ISO-8601, set at ingest time
  }

  export interface OtelMetricRow {
    metric_name: string;
    metric_type: 'counter' | 'gauge';
    value: number;
    session_id: string | null;
    model: string | null;
    timestamp: string;          // ISO-8601
  }

  // ─── API response shapes ──────────────────────────────────────────────────────

  export interface IngestResponse {
    accepted: number;
    dropped: number;
  }

  export interface TelemetryStatusKey {
    present: boolean;
    value: string | null;
  }

  export interface TelemetryStatus {
    keys: {
      CLAUDE_CODE_ENABLE_TELEMETRY: TelemetryStatusKey;
      OTEL_EXPORTER_OTLP_ENDPOINT: TelemetryStatusKey;
      OTEL_EXPORTER_OTLP_PROTOCOL: TelemetryStatusKey;
      OTEL_METRICS_EXPORTER: TelemetryStatusKey;
      OTEL_LOGS_EXPORTER: TelemetryStatusKey;
      OTEL_LOG_TOOL_DETAILS: TelemetryStatusKey;
    };
    lastEventAt: string | null;
    totalEvents: number;
  }
  ```

  ```
  npx tsc --noEmit
  ```
  Expected: zero errors.

---

### Phase 2.1 — Parser Module (TDD)

Write the tests first. The parser has no I/O so it can be unit-tested with plain Node.

- [ ] **2.1.1** Install vitest alongside Phase 1's existing `tsx --test` runner. <!-- Phase 1 actual: "test" script is "tsx --test tests/**/*.test.ts" — DO NOT replace it. Add vitest under separate script names. -->
  ```
  npm install --save-dev vitest @vitest/coverage-v8
  ```
  Add to `package.json` `scripts` (do **NOT** touch the existing `"test"` key — Phase 1's 14 tests must keep running):
  ```json
  "test:otel": "vitest run",
  "test:watch": "vitest"
  ```
  Add `vitest.config.ts` at the project root:
  ```typescript
  import { defineConfig } from 'vitest/config';

  export default defineConfig({
    test: {
      environment: 'node',
      include: ['__tests__/**/*.test.ts'],
    },
  });
  ```
  Note: Phase 1 tests live in `tests/` and run via `npm test` (tsx --test). Phase 2 unit tests live in `__tests__/` and run via `npm run test:otel` (vitest). Directories are intentionally separate to avoid runner conflicts.

- [ ] **2.1.2** Create `__tests__/otel-parse.test.ts` — write ALL tests before any implementation code. Run them and confirm they fail with "cannot find module".

  Full content:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { parseOtelLogs, parseOtelMetrics } from '../lib/otel-parse';
  import type { OtlpLogsPayload, OtlpMetricsPayload } from '../types/otel';

  // ─── Fixture: minimal valid log payload ──────────────────────────────────────
  const LOG_FIXTURE_TOOL_RESULT: OtlpLogsPayload = {
    resourceLogs: [{
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'claude-code' } }
        ]
      },
      scopeLogs: [{
        scope: { name: 'claude-code-telemetry', version: '1.0.0' },
        logRecords: [{
          timeUnixNano: '1714000000000000000',
          body: { stringValue: 'tool_result' },
          attributes: [
            { key: 'event.name',       value: { stringValue: 'tool_result' } },
            { key: 'session.id',       value: { stringValue: 'sess-abc' } },
            { key: 'prompt.id',        value: { stringValue: 'prompt-1' } },
            { key: 'model',            value: { stringValue: 'claude-opus-4-5' } },
            { key: 'tool.name',        value: { stringValue: 'Bash' } },
            { key: 'tool.success',     value: { boolValue: true } },
            { key: 'tool.duration_ms', value: { doubleValue: 123.4 } },
          ]
        }]
      }]
    }]
  };

  // ─── Fixture: mcp_tool with tool_parameters JSON attr ────────────────────────
  const LOG_FIXTURE_MCP_TOOL: OtlpLogsPayload = {
    resourceLogs: [{
      scopeLogs: [{
        logRecords: [{
          timeUnixNano: '1714000001000000000',
          attributes: [
            { key: 'event.name',      value: { stringValue: 'tool_result' } },
            { key: 'tool.name',       value: { stringValue: 'mcp_tool' } },
            { key: 'tool_parameters', value: { stringValue: '{"mcp_server_name":"filesystem","mcp_tool_name":"read_file"}' } },
            { key: 'tool.success',    value: { boolValue: false } },
            { key: 'tool.error',      value: { stringValue: 'Permission denied' } },
          ]
        }]
      }]
    }]
  };

  // ─── Fixture: mcp_tool with legacy mcp__server__tool fallback ────────────────
  const LOG_FIXTURE_MCP_LEGACY: OtlpLogsPayload = {
    resourceLogs: [{
      scopeLogs: [{
        logRecords: [{
          timeUnixNano: '1714000002000000000',
          attributes: [
            { key: 'event.name', value: { stringValue: 'tool_result' } },
            { key: 'tool.name',  value: { stringValue: 'mcp__github__create_pr' } },
          ]
        }]
      }]
    }]
  };

  // ─── Fixture: api_request with token counts ───────────────────────────────────
  const LOG_FIXTURE_API_REQUEST: OtlpLogsPayload = {
    resourceLogs: [{
      scopeLogs: [{
        logRecords: [{
          timeUnixNano: '1714000003000000000',
          attributes: [
            { key: 'event.name',          value: { stringValue: 'api_request' } },
            { key: 'session.id',          value: { stringValue: 'sess-abc' } },
            { key: 'model',               value: { stringValue: 'claude-opus-4-5' } },
            { key: 'cost_usd',            value: { doubleValue: 0.00423 } },
            { key: 'api.duration_ms',     value: { doubleValue: 1872.0 } },
            { key: 'input_tokens',        value: { intValue: '4200' } },
            { key: 'output_tokens',       value: { intValue: '512' } },
            { key: 'cache_read_tokens',   value: { intValue: '18000' } },
            { key: 'cache_create_tokens', value: { intValue: '0' } },
          ]
        }]
      }]
    }]
  };

  // ─── Fixture: malformed record mixed in with valid one ───────────────────────
  const LOG_FIXTURE_MIXED: OtlpLogsPayload = {
    resourceLogs: [{
      scopeLogs: [{
        logRecords: [
          // valid
          {
            timeUnixNano: '1714000004000000000',
            attributes: [
              { key: 'event.name', value: { stringValue: 'api_error' } },
              { key: 'session.id', value: { stringValue: 'sess-abc' } },
            ]
          },
          // malformed: event.name missing — should be dropped
          {
            timeUnixNano: '1714000005000000000',
            attributes: []
          }
        ]
      }]
    }]
  };

  // ─── Fixture: empty payload ───────────────────────────────────────────────────
  const LOG_FIXTURE_EMPTY: OtlpLogsPayload = {};

  // ─── Fixture: metrics — sum (counter) ────────────────────────────────────────
  const METRICS_FIXTURE_COUNTER: OtlpMetricsPayload = {
    resourceMetrics: [{
      scopeMetrics: [{
        metrics: [{
          name: 'claude_code.commit.count',
          sum: {
            dataPoints: [{
              timeUnixNano: '1714000060000000000',
              asInt: '3',
              attributes: [
                { key: 'session.id', value: { stringValue: 'sess-abc' } },
                { key: 'model',      value: { stringValue: 'claude-opus-4-5' } },
              ]
            }]
          }
        }]
      }]
    }]
  };

  // ─── Fixture: metrics — gauge ─────────────────────────────────────────────────
  const METRICS_FIXTURE_GAUGE: OtlpMetricsPayload = {
    resourceMetrics: [{
      scopeMetrics: [{
        metrics: [{
          name: 'claude_code.lines_of_code.count',
          gauge: {
            dataPoints: [{
              timeUnixNano: '1714000060000000000',
              asDouble: 142.0,
              attributes: []
            }]
          }
        }]
      }]
    }]
  };

  // ─── Tests: logs ─────────────────────────────────────────────────────────────

  describe('parseOtelLogs', () => {
    it('parses a basic tool_result record', () => {
      const result = parseOtelLogs(LOG_FIXTURE_TOOL_RESULT);
      expect(result.rows).toHaveLength(1);
      const row = result.rows[0];
      expect(row.event_name).toBe('tool_result');
      expect(row.session_id).toBe('sess-abc');
      expect(row.prompt_id).toBe('prompt-1');
      expect(row.model).toBe('claude-opus-4-5');
      expect(row.tool_name).toBe('Bash');
      expect(row.tool_success).toBe(1);
      expect(row.tool_duration_ms).toBeCloseTo(123.4);
      expect(row.mcp_server_name).toBeNull();
      expect(row.mcp_tool_name).toBeNull();
      expect(result.dropped).toBe(0);
    });

    it('converts timeUnixNano to ISO-8601 timestamp', () => {
      const result = parseOtelLogs(LOG_FIXTURE_TOOL_RESULT);
      const row = result.rows[0];
      // 1714000000000000000 ns = 1714000000000 ms = 2024-04-25T...
      const parsed = new Date(row.timestamp);
      expect(parsed.getTime()).toBe(1714000000000);
    });

    it('extracts mcp_server_name and mcp_tool_name from tool_parameters JSON', () => {
      const result = parseOtelLogs(LOG_FIXTURE_MCP_TOOL);
      expect(result.rows).toHaveLength(1);
      const row = result.rows[0];
      expect(row.tool_name).toBe('mcp_tool');
      expect(row.mcp_server_name).toBe('filesystem');
      expect(row.mcp_tool_name).toBe('read_file');
      expect(row.tool_success).toBe(0);
      expect(row.tool_error).toBe('Permission denied');
    });

    it('falls back to parsing mcp__<server>__<tool> from tool.name when tool_parameters absent', () => {
      const result = parseOtelLogs(LOG_FIXTURE_MCP_LEGACY);
      expect(result.rows).toHaveLength(1);
      const row = result.rows[0];
      expect(row.mcp_server_name).toBe('github');
      expect(row.mcp_tool_name).toBe('create_pr');
    });

    it('parses api_request fields including intValue token counts', () => {
      const result = parseOtelLogs(LOG_FIXTURE_API_REQUEST);
      expect(result.rows).toHaveLength(1);
      const row = result.rows[0];
      expect(row.event_name).toBe('api_request');
      expect(row.cost_usd).toBeCloseTo(0.00423);
      expect(row.api_duration_ms).toBeCloseTo(1872);
      expect(row.input_tokens).toBe(4200);
      expect(row.output_tokens).toBe(512);
      expect(row.cache_read_tokens).toBe(18000);
      expect(row.cache_create_tokens).toBe(0);
    });

    it('drops malformed records (missing event.name) and counts them', () => {
      const result = parseOtelLogs(LOG_FIXTURE_MIXED);
      expect(result.rows).toHaveLength(1);
      expect(result.dropped).toBe(1);
      expect(result.rows[0].event_name).toBe('api_error');
    });

    it('returns empty rows for empty payload without throwing', () => {
      const result = parseOtelLogs(LOG_FIXTURE_EMPTY);
      expect(result.rows).toHaveLength(0);
      expect(result.dropped).toBe(0);
    });

    it('sets received_at to a recent ISO timestamp', () => {
      const before = new Date().toISOString();
      const result = parseOtelLogs(LOG_FIXTURE_TOOL_RESULT);
      const after = new Date().toISOString();
      const receivedAt = result.rows[0].received_at;
      expect(receivedAt >= before).toBe(true);
      expect(receivedAt <= after).toBe(true);
    });
  });

  // ─── Tests: metrics ───────────────────────────────────────────────────────────

  describe('parseOtelMetrics', () => {
    it('parses a sum metric as counter type', () => {
      const result = parseOtelMetrics(METRICS_FIXTURE_COUNTER);
      expect(result.rows).toHaveLength(1);
      const row = result.rows[0];
      expect(row.metric_name).toBe('claude_code.commit.count');
      expect(row.metric_type).toBe('counter');
      expect(row.value).toBe(3);
      expect(row.session_id).toBe('sess-abc');
      expect(row.model).toBe('claude-opus-4-5');
    });

    it('parses a gauge metric as gauge type', () => {
      const result = parseOtelMetrics(METRICS_FIXTURE_GAUGE);
      expect(result.rows).toHaveLength(1);
      const row = result.rows[0];
      expect(row.metric_name).toBe('claude_code.lines_of_code.count');
      expect(row.metric_type).toBe('gauge');
      expect(row.value).toBeCloseTo(142.0);
    });

    it('returns empty rows for empty payload without throwing', () => {
      const result = parseOtelMetrics({});
      expect(result.rows).toHaveLength(0);
      expect(result.dropped).toBe(0);
    });
  });
  ```

  Run tests (expect failures — module not found):
  ```
  npm test
  ```
  Expected output: `Cannot find module '../lib/otel-parse'` — this is correct. Tests are red; proceed.

- [ ] **2.1.3** Create `lib/otel-parse.ts` — the full parser implementation.

  Full content:
  ```typescript
  import type {
    OtlpLogsPayload,
    OtlpMetricsPayload,
    OtlpAttribute,
    OtlpLogRecord,
    OtelEventRow,
    OtelMetricRow,
  } from '@/types/otel';

  // ─── Attribute extraction helpers ────────────────────────────────────────────

  /** Build a key→raw-value map from an OtlpAttribute array. */
  function attrMap(attributes: OtlpAttribute[] | undefined): Map<string, unknown> {
    const m = new Map<string, unknown>();
    if (!attributes) return m;
    for (const a of attributes) {
      const v = a.value;
      if (v.stringValue !== undefined) m.set(a.key, v.stringValue);
      else if (v.intValue !== undefined) m.set(a.key, parseInt(v.intValue, 10));
      else if (v.doubleValue !== undefined) m.set(a.key, v.doubleValue);
      else if (v.boolValue !== undefined) m.set(a.key, v.boolValue);
      // unknown value types silently ignored
    }
    return m;
  }

  function getString(m: Map<string, unknown>, key: string): string | null {
    const v = m.get(key);
    return typeof v === 'string' ? v : null;
  }

  function getNumber(m: Map<string, unknown>, key: string): number | null {
    const v = m.get(key);
    if (typeof v === 'number' && isFinite(v)) return v;
    return null;
  }

  function getBool(m: Map<string, unknown>, key: string): number | null {
    const v = m.get(key);
    if (typeof v === 'boolean') return v ? 1 : 0;
    return null;
  }

  /** Convert OTLP nanosecond string timestamp to ISO-8601. */
  function nanoToIso(nanoStr: string | undefined): string {
    if (!nanoStr) return new Date().toISOString();
    // BigInt division to avoid float precision loss, then convert to ms for Date
    const ms = Number(BigInt(nanoStr) / BigInt(1_000_000));
    return new Date(ms).toISOString();
  }

  // ─── MCP tool name extraction ─────────────────────────────────────────────────

  /**
   * For event.name='tool_result' with tool.name='mcp_tool':
   *   1. Try to parse tool_parameters JSON attr for mcp_server_name + mcp_tool_name.
   *   2. Fall back to parsing mcp__<server>__<tool> pattern from tool.name itself.
   */
  function extractMcpNames(
    toolName: string | null,
    attrs: Map<string, unknown>
  ): { mcp_server_name: string | null; mcp_tool_name: string | null } {
    const none = { mcp_server_name: null, mcp_tool_name: null };

    if (!toolName) return none;

    // Path 1: mcp_tool with tool_parameters JSON
    if (toolName === 'mcp_tool') {
      const paramsStr = getString(attrs, 'tool_parameters');
      if (paramsStr) {
        try {
          const params = JSON.parse(paramsStr) as Record<string, unknown>;
          const server = typeof params['mcp_server_name'] === 'string' ? params['mcp_server_name'] : null;
          const tool   = typeof params['mcp_tool_name']   === 'string' ? params['mcp_tool_name']   : null;
          if (server || tool) return { mcp_server_name: server, mcp_tool_name: tool };
        } catch {
          // malformed JSON — fall through to legacy path
        }
      }
    }

    // Path 2: legacy mcp__<server>__<tool> encoding
    // Format: mcp__<server_name>__<tool_name>
    // The tool name part may itself contain underscores so split on first two __ sequences
    const legacyMatch = /^mcp__([^_][^_]*)__(.+)$/.exec(toolName);
    if (legacyMatch) {
      return {
        mcp_server_name: legacyMatch[1],
        mcp_tool_name: legacyMatch[2],
      };
    }

    return none;
  }

  // ─── Log record parser ────────────────────────────────────────────────────────

  export interface ParseLogsResult {
    rows: OtelEventRow[];
    dropped: number;
  }

  function parseLogRecord(record: OtlpLogRecord, receivedAt: string): OtelEventRow {
    const attrs = attrMap(record.attributes);

    const eventName = getString(attrs, 'event.name');
    if (!eventName) throw new Error('missing event.name attribute');

    const timestamp = nanoToIso(record.timeUnixNano ?? record.observedTimeUnixNano);
    const toolName  = getString(attrs, 'tool.name');

    const { mcp_server_name, mcp_tool_name } = extractMcpNames(toolName, attrs);

    return {
      event_name:            eventName,
      session_id:            getString(attrs, 'session.id'),
      prompt_id:             getString(attrs, 'prompt.id'),
      timestamp,
      model:                 getString(attrs, 'model'),
      tool_name:             toolName,
      tool_success:          getBool(attrs, 'tool.success'),
      tool_duration_ms:      getNumber(attrs, 'tool.duration_ms'),
      tool_error:            getString(attrs, 'tool.error'),
      cost_usd:              getNumber(attrs, 'cost_usd'),
      api_duration_ms:       getNumber(attrs, 'api.duration_ms'),
      input_tokens:          getNumber(attrs, 'input_tokens'),
      output_tokens:         getNumber(attrs, 'output_tokens'),
      cache_read_tokens:     getNumber(attrs, 'cache_read_tokens'),
      cache_create_tokens:   getNumber(attrs, 'cache_create_tokens'),
      speed:                 getNumber(attrs, 'speed'),
      error_message:         getString(attrs, 'error.message') ?? getString(attrs, 'error_message'),
      status_code:           getNumber(attrs, 'status_code'),
      attempt_count:         getNumber(attrs, 'attempt_count'),
      skill_name:            getString(attrs, 'skill.name'),
      skill_source:          getString(attrs, 'skill.source'),
      prompt_length:         getNumber(attrs, 'prompt_length'),
      decision:              getString(attrs, 'decision'),
      decision_source:       getString(attrs, 'decision_source'),
      request_id:            getString(attrs, 'request.id') ?? getString(attrs, 'request_id'),
      tool_result_size_bytes:getNumber(attrs, 'tool_result_size_bytes'),
      mcp_server_scope:      getString(attrs, 'mcp_server_scope'),
      plugin_name:           getString(attrs, 'plugin.name'),
      plugin_version:        getString(attrs, 'plugin.version'),
      marketplace_name:      getString(attrs, 'marketplace.name'),
      install_trigger:       getString(attrs, 'install_trigger'),
      mcp_server_name,
      mcp_tool_name,
      received_at:           receivedAt,
    };
  }

  export function parseOtelLogs(payload: OtlpLogsPayload): ParseLogsResult {
    const rows: OtelEventRow[] = [];
    let dropped = 0;
    const receivedAt = new Date().toISOString();

    for (const rl of payload.resourceLogs ?? []) {
      for (const sl of rl.scopeLogs ?? []) {
        for (const record of sl.logRecords ?? []) {
          try {
            rows.push(parseLogRecord(record, receivedAt));
          } catch (err) {
            dropped++;
            console.error('[otel-parse] dropped log record:', err instanceof Error ? err.message : err);
          }
        }
      }
    }

    return { rows, dropped };
  }

  // ─── Metrics parser ───────────────────────────────────────────────────────────

  export interface ParseMetricsResult {
    rows: OtelMetricRow[];
    dropped: number;
  }

  export function parseOtelMetrics(payload: OtlpMetricsPayload): ParseMetricsResult {
    const rows: OtelMetricRow[] = [];
    let dropped = 0;

    for (const rm of payload.resourceMetrics ?? []) {
      for (const sm of rm.scopeMetrics ?? []) {
        for (const metric of sm.metrics ?? []) {
          const metricType: 'counter' | 'gauge' = metric.sum ? 'counter' : 'gauge';
          const dataPoints = (metric.sum ?? metric.gauge)?.dataPoints ?? [];

          for (const dp of dataPoints) {
            try {
              const metricName = metric.name;
              if (!metricName) throw new Error('missing metric name');

              const value =
                dp.asDouble !== undefined ? dp.asDouble :
                dp.asInt    !== undefined ? parseInt(dp.asInt, 10) :
                0;

              if (!isFinite(value)) throw new Error(`non-finite value for metric ${metricName}`);

              const dpAttrs = attrMap(dp.attributes);
              const timestamp = nanoToIso(dp.timeUnixNano);

              rows.push({
                metric_name: metricName,
                metric_type: metricType,
                value,
                session_id:  getString(dpAttrs, 'session.id'),
                model:       getString(dpAttrs, 'model'),
                timestamp,
              });
            } catch (err) {
              dropped++;
              console.error('[otel-parse] dropped metric dataPoint:', err instanceof Error ? err.message : err);
            }
          }
        }
      }
    }

    return { rows, dropped };
  }
  ```

- [ ] **2.1.4** Run the unit tests. They must all pass green. <!-- Phase 1 actual: use the new `test:otel` script — `npm test` runs Phase 1's tsx suite. -->
  ```
  npm run test:otel
  ```
  Expected:
  ```
  ✓ __tests__/otel-parse.test.ts (9)
    ✓ parseOtelLogs > parses a basic tool_result record
    ✓ parseOtelLogs > converts timeUnixNano to ISO-8601 timestamp
    ✓ parseOtelLogs > extracts mcp_server_name and mcp_tool_name from tool_parameters JSON
    ✓ parseOtelLogs > falls back to parsing mcp__<server>__<tool> from tool.name when tool_parameters absent
    ✓ parseOtelLogs > parses api_request fields including intValue token counts
    ✓ parseOtelLogs > drops malformed records (missing event.name) and counts them
    ✓ parseOtelLogs > returns empty rows for empty payload without throwing
    ✓ parseOtelLogs > sets received_at to a recent ISO timestamp
    ✓ parseOtelMetrics > parses a sum metric as counter type
    ✓ parseOtelMetrics > parses a gauge metric as gauge type
    ✓ parseOtelMetrics > returns empty rows for empty payload without throwing

  Test Files  1 passed (1)
  Tests       11 passed (11)
  ```

  Fix any failures before proceeding.

- [ ] **2.1.5** Typecheck:
  ```
  npx tsc --noEmit
  ```
  Expected: zero errors. Fix any before proceeding.

- [ ] **2.1.6** Commit:
  ```
  git add types/otel.ts lib/otel-parse.ts __tests__/otel-parse.test.ts vitest.config.ts package.json package-lock.json
  git commit -m "feat(phase-2): add otel-parse module with full unit test coverage"
  ```

---

### Phase 2.2 — Ingest Route Handlers

- [ ] **2.2.1** Create directory `app/api/v1/logs/` and `app/api/v1/metrics/`. Next.js App Router supports any directory depth under `app/api/`; the `/v1/` segment is just a path — no special configuration needed.

- [ ] **2.2.2** Create `app/api/v1/logs/route.ts`:

  ```typescript
  import { NextResponse } from 'next/server';
  import { parseOtelLogs } from '@/lib/otel-parse';
  import { getDb } from '@/lib/db';
  import type { OtlpLogsPayload, IngestResponse } from '@/types/otel';

  const INSERT_OTEL_EVENT = `
    INSERT INTO otel_events (
      event_name, session_id, prompt_id, timestamp, model,
      tool_name, tool_success, tool_duration_ms, tool_error,
      cost_usd, api_duration_ms, input_tokens, output_tokens,
      cache_read_tokens, cache_create_tokens, speed, error_message,
      status_code, attempt_count, skill_name, skill_source,
      prompt_length, decision, decision_source, request_id,
      tool_result_size_bytes, mcp_server_scope, plugin_name,
      plugin_version, marketplace_name, install_trigger,
      mcp_server_name, mcp_tool_name, received_at
    ) VALUES (
      @event_name, @session_id, @prompt_id, @timestamp, @model,
      @tool_name, @tool_success, @tool_duration_ms, @tool_error,
      @cost_usd, @api_duration_ms, @input_tokens, @output_tokens,
      @cache_read_tokens, @cache_create_tokens, @speed, @error_message,
      @status_code, @attempt_count, @skill_name, @skill_source,
      @prompt_length, @decision, @decision_source, @request_id,
      @tool_result_size_bytes, @mcp_server_scope, @plugin_name,
      @plugin_version, @marketplace_name, @install_trigger,
      @mcp_server_name, @mcp_tool_name, @received_at
    )
  `;

  export async function POST(request: Request): Promise<NextResponse<IngestResponse>> {
    let body: OtlpLogsPayload;
    try {
      body = (await request.json()) as OtlpLogsPayload;
    } catch {
      // Return 200 even on unparseable JSON — do not allow HTTP errors to
      // cause Claude Code to retry the batch (it does not retry on 200).
      console.error('[/v1/logs] Failed to parse request body as JSON');
      return NextResponse.json({ accepted: 0, dropped: 1 });
    }

    const { rows, dropped: parseDropped } = parseOtelLogs(body);

    const db = getDb();
    const stmt = db.prepare(INSERT_OTEL_EVENT);
    let accepted = 0;
    let insertDropped = 0;

    for (const row of rows) {
      try {
        stmt.run(row);
        accepted++;
      } catch (err) {
        insertDropped++;
        console.error('[/v1/logs] Failed to insert otel_event row:', err instanceof Error ? err.message : err);
      }
    }

    return NextResponse.json({ accepted, dropped: parseDropped + insertDropped });
  }

  // Explicitly reject non-POST methods with 405 so curl mistakes are obvious
  export async function GET(): Promise<NextResponse> {
    return new NextResponse('Method Not Allowed', { status: 405 });
  }
  ```

  **Critical:** The response is always HTTP 200. Even if the entire batch is malformed, we return `{ accepted: 0, dropped: N }` with status 200. Never throw from this handler.

- [ ] **2.2.3** Create `app/api/v1/metrics/route.ts`:

  ```typescript
  import { NextResponse } from 'next/server';
  import { parseOtelMetrics } from '@/lib/otel-parse';
  import { getDb } from '@/lib/db';
  import type { OtlpMetricsPayload, IngestResponse } from '@/types/otel';

  const INSERT_OTEL_METRIC = `
    INSERT INTO otel_metrics (
      metric_name, metric_type, value, session_id, model, timestamp
    ) VALUES (
      @metric_name, @metric_type, @value, @session_id, @model, @timestamp
    )
  `;

  export async function POST(request: Request): Promise<NextResponse<IngestResponse>> {
    let body: OtlpMetricsPayload;
    try {
      body = (await request.json()) as OtlpMetricsPayload;
    } catch {
      console.error('[/v1/metrics] Failed to parse request body as JSON');
      return NextResponse.json({ accepted: 0, dropped: 1 });
    }

    const { rows, dropped: parseDropped } = parseOtelMetrics(body);

    const db = getDb();
    const stmt = db.prepare(INSERT_OTEL_METRIC);
    let accepted = 0;
    let insertDropped = 0;

    for (const row of rows) {
      try {
        stmt.run(row);
        accepted++;
      } catch (err) {
        insertDropped++;
        console.error('[/v1/metrics] Failed to insert otel_metric row:', err instanceof Error ? err.message : err);
      }
    }

    return NextResponse.json({ accepted, dropped: parseDropped + insertDropped });
  }

  export async function GET(): Promise<NextResponse> {
    return new NextResponse('Method Not Allowed', { status: 405 });
  }
  ```

- [ ] **2.2.4** Verify TypeScript compiles cleanly:
  ```
  npx tsc --noEmit
  ```
  Expected: zero errors.

- [ ] **2.2.5** Manual smoke test — start the dev server in one terminal, then POST from another:

  Terminal 1:
  ```
  npm run dev
  ```
  Wait for "Ready on http://0.0.0.0:3000".

  Terminal 2 (PowerShell on Windows, bash on macOS/Linux):
  ```bash
  curl -s -X POST http://localhost:3000/v1/logs \
    -H "Content-Type: application/json" \
    -d '{
      "resourceLogs": [{
        "scopeLogs": [{
          "logRecords": [{
            "timeUnixNano": "1714000000000000000",
            "attributes": [
              {"key": "event.name", "value": {"stringValue": "api_request"}},
              {"key": "session.id", "value": {"stringValue": "smoke-test-001"}},
              {"key": "model",      "value": {"stringValue": "claude-opus-4-5"}},
              {"key": "cost_usd",   "value": {"doubleValue": 0.001}}
            ]
          }]
        }]
      }]
    }'
  ```
  Expected response: `{"accepted":1,"dropped":0}`

  ```bash
  curl -s -X POST http://localhost:3000/v1/metrics \
    -H "Content-Type: application/json" \
    -d '{
      "resourceMetrics": [{
        "scopeMetrics": [{
          "metrics": [{
            "name": "claude_code.commit.count",
            "sum": {
              "dataPoints": [{
                "timeUnixNano": "1714000060000000000",
                "asInt": "2",
                "attributes": [
                  {"key": "session.id", "value": {"stringValue": "smoke-test-001"}}
                ]
              }]
            }
          }]
        }]
      }]
    }'
  ```
  Expected response: `{"accepted":1,"dropped":0}`

  Confirm the rows landed in SQLite. Open the DB with any SQLite viewer or:
  ```bash
  # Phase 1 actual: DB is at ~/.claude/ccd/dashboard.db (getClaudeHome()/ccd/dashboard.db).
  # Override with CCD_DB_PATH env var when testing.
  sqlite3 ~/.claude/ccd/dashboard.db "SELECT event_name, session_id, cost_usd FROM otel_events LIMIT 5;"
  sqlite3 ~/.claude/ccd/dashboard.db "SELECT metric_name, metric_type, value FROM otel_metrics LIMIT 5;"
  ```
  Expected: one row each with the values from the curl commands above.

- [ ] **2.2.6** Commit:
  ```
  git add app/api/v1/
  git commit -m "feat(phase-2): add POST /v1/logs and /v1/metrics ingest route handlers"
  ```

---

### Phase 2.3 — Telemetry Status API

- [ ] **2.3.1** Create `app/api/telemetry/status/route.ts`:

  ```typescript
  import { NextResponse } from 'next/server';
  import fs from 'fs/promises';
  import path from 'path';
  import { getClaudeHome } from '@/lib/claude-home';
  import { getDb } from '@/lib/db';
  import type { TelemetryStatus } from '@/types/otel';

  const REQUIRED_KEYS = [
    'CLAUDE_CODE_ENABLE_TELEMETRY',
    'OTEL_EXPORTER_OTLP_ENDPOINT',
    'OTEL_EXPORTER_OTLP_PROTOCOL',
    'OTEL_METRICS_EXPORTER',
    'OTEL_LOGS_EXPORTER',
    'OTEL_LOG_TOOL_DETAILS',
  ] as const;

  type RequiredKey = (typeof REQUIRED_KEYS)[number];

  export async function GET(): Promise<NextResponse<TelemetryStatus>> {
    // Read ~/.claude/settings.json env block
    const settingsPath = path.join(getClaudeHome(), 'settings.json');
    let envBlock: Record<string, string> = {};
    try {
      const raw = await fs.readFile(settingsPath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed['env'] && typeof parsed['env'] === 'object' && !Array.isArray(parsed['env'])) {
        envBlock = parsed['env'] as Record<string, string>;
      }
    } catch {
      // settings.json absent or unreadable — all keys missing
    }

    const keys = {} as TelemetryStatus['keys'];
    for (const k of REQUIRED_KEYS) {
      const val = envBlock[k];
      keys[k as RequiredKey] = {
        present: val !== undefined,
        value: val ?? null,
      };
    }

    // Query last event timestamp and total count
    let lastEventAt: string | null = null;
    let totalEvents = 0;
    try {
      const db = getDb();
      const row = db.prepare<[], { last_at: string | null; cnt: number }>(
        `SELECT MAX(received_at) AS last_at, COUNT(*) AS cnt FROM otel_events`
      ).get();
      if (row) {
        lastEventAt = row.last_at;
        totalEvents = row.cnt;
      }
    } catch {
      // DB not yet initialized — return zeros
    }

    return NextResponse.json({ keys, lastEventAt, totalEvents });
  }
  ```

  Note on the `db.prepare` generic: `better-sqlite3`'s TypeScript types accept `prepare<BindParameters, Result>()`. If Phase 1's `@types/better-sqlite3` version uses a different generic signature, adjust to match.

- [ ] **2.3.2** Verify the endpoint works:
  ```bash
  curl -s http://localhost:3000/api/telemetry/status | npx -y prettier --parser json
  ```
  Expected shape:
  ```json
  {
    "keys": {
      "CLAUDE_CODE_ENABLE_TELEMETRY": { "present": false, "value": null },
      "OTEL_EXPORTER_OTLP_ENDPOINT": { "present": false, "value": null },
      "OTEL_EXPORTER_OTLP_PROTOCOL": { "present": false, "value": null },
      "OTEL_METRICS_EXPORTER": { "present": false, "value": null },
      "OTEL_LOGS_EXPORTER": { "present": false, "value": null },
      "OTEL_LOG_TOOL_DETAILS": { "present": false, "value": null }
    },
    "lastEventAt": "2024-04-25T...",
    "totalEvents": 1
  }
  ```
  (`lastEventAt` and `totalEvents` will reflect the smoke-test row from 2.2.5.)

- [ ] **2.3.3** Typecheck + commit:
  ```
  npx tsc --noEmit
  git add app/api/telemetry/
  git commit -m "feat(phase-2): add GET /api/telemetry/status endpoint"
  ```

---

### Phase 2.4 — Setup Wizard Script

- [ ] **2.4.1** Create `scripts/` directory. Create `scripts/setup-otel.ts`:

  Full content — this is the complete source, not a sketch:

  ```typescript
  #!/usr/bin/env tsx
  /**
   * scripts/setup-otel.ts
   *
   * Interactive Node CLI wizard that configures ~/.claude/settings.json with
   * the required OTEL environment variables so Claude Code sends telemetry to
   * the local dashboard (http://localhost:3000).
   *
   * Rules:
   *   - NEVER overwrites existing user values.
   *   - Always backs up settings.json before writing.
   *   - Merges only missing keys.
   *   - Works on Windows, macOS, and Linux.
   *   - No Next.js imports — runs before the dev server starts.
   *
   * Usage:
   *   npm run setup:otel
   *   npm run setup:otel -- --yes     (non-interactive, accept all)
   */

  import fs from 'fs';
  import path from 'path';
  import os from 'os';
  import readline from 'readline';

  // ─── Configuration ────────────────────────────────────────────────────────────

  const REQUIRED_ENV: Record<string, string> = {
    CLAUDE_CODE_ENABLE_TELEMETRY:   '1',
    OTEL_EXPORTER_OTLP_ENDPOINT:    'http://localhost:3000',
    OTEL_EXPORTER_OTLP_PROTOCOL:    'http/json',
    OTEL_METRICS_EXPORTER:          'otlp',
    OTEL_LOGS_EXPORTER:             'otlp',
    OTEL_LOG_TOOL_DETAILS:          '1',
  };

  // ─── Paths ────────────────────────────────────────────────────────────────────

  function getClaudeHome(): string {
    return process.env['CLAUDE_HOME'] ?? path.join(os.homedir(), '.claude');
  }

  function getSettingsPath(): string {
    return path.join(getClaudeHome(), 'settings.json');
  }

  // ─── File I/O ─────────────────────────────────────────────────────────────────

  function readSettings(settingsPath: string): Record<string, unknown> {
    if (!fs.existsSync(settingsPath)) {
      console.log(`  settings.json not found — will create it at:\n  ${settingsPath}`);
      return {};
    }
    try {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
    } catch (err) {
      console.error(`  ERROR: Could not parse settings.json: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  function backupSettings(settingsPath: string): string {
    const ts = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '-')
      .slice(0, 19); // YYYY-MM-DD-HH-MM-SS
    // Reformat to YYYYMMDD-HHMMSS by removing dashes from date part
    const compact = ts.replace(/-/g, '').replace(/(\d{8})(\d{6})/, '$1-$2');
    const backupPath = `${settingsPath}.bak.${compact}`;
    fs.copyFileSync(settingsPath, backupPath);
    return backupPath;
  }

  function ensureClaudeHomeDir(settingsPath: string): void {
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`  Created directory: ${dir}`);
    }
  }

  // ─── Prompt helper ────────────────────────────────────────────────────────────

  function prompt(question: string): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  // ─── Main ─────────────────────────────────────────────────────────────────────

  async function main(): Promise<void> {
    const autoYes = process.argv.includes('--yes') || process.argv.includes('-y');

    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║   Claude Code Dashboard — OTEL Setup Wizard          ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');

    const settingsPath = getSettingsPath();
    console.log(`Settings file: ${settingsPath}\n`);

    const settings = readSettings(settingsPath);

    // Ensure env block exists as an object
    if (!settings['env'] || typeof settings['env'] !== 'object' || Array.isArray(settings['env'])) {
      settings['env'] = {};
    }
    const envBlock = settings['env'] as Record<string, string>;

    // Diff: find missing keys
    const missing: [string, string][] = [];
    const present: [string, string][] = [];

    for (const [key, desiredValue] of Object.entries(REQUIRED_ENV)) {
      if (envBlock[key] !== undefined) {
        present.push([key, envBlock[key]]);
      } else {
        missing.push([key, desiredValue]);
      }
    }

    // Report current state
    if (present.length > 0) {
      console.log('Already configured (will NOT be changed):');
      for (const [k, v] of present) {
        console.log(`  ✓  ${k}=${v}`);
      }
      console.log();
    }

    if (missing.length === 0) {
      console.log('All OTEL keys are already present. Nothing to do.\n');
      console.log('Reminder: quit and restart Claude Code to pick up any recent changes.\n');
      process.exit(0);
    }

    console.log('Keys to add:');
    for (const [k, v] of missing) {
      console.log(`  +  ${k}=${v}`);
    }
    console.log();

    // Confirm
    if (!autoYes) {
      const answer = await prompt('Apply these changes? [Y/n] ');
      if (answer.toLowerCase() === 'n') {
        console.log('\nAborted. No changes made.\n');
        process.exit(0);
      }
    }

    // Backup (only if the file already exists)
    if (fs.existsSync(settingsPath)) {
      const backupPath = backupSettings(settingsPath);
      console.log(`\nBacked up to: ${backupPath}`);
    } else {
      ensureClaudeHomeDir(settingsPath);
    }

    // Merge missing keys — NEVER touch existing values
    for (const [key, value] of missing) {
      envBlock[key] = value;
    }

    // Write back
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    console.log(`Written: ${settingsPath}`);

    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║  DONE — Next step:                                   ║');
    console.log('║                                                      ║');
    console.log('║  Quit Claude Code completely and restart it.         ║');
    console.log('║  (It reads env vars only at startup.)                ║');
    console.log('║                                                      ║');
    console.log('║  Then open http://localhost:3000/dashboard/settings  ║');
    console.log('║  → Telemetry tab to confirm events are flowing.      ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');
  }

  main().catch((err: unknown) => {
    console.error('Unexpected error:', err);
    process.exit(1);
  });
  ```

- [ ] **2.4.2** Verify the script runs without errors in dry-run mode (does not read actual settings if absent):
  ```
  npm run setup:otel -- --yes
  ```
  On a machine where `~/.claude/settings.json` does not have OTEL keys, expected output:
  ```
  ╔══════════════════════════════════════════════════════╗
  ║   Claude Code Dashboard — OTEL Setup Wizard          ║
  ╚══════════════════════════════════════════════════════╝

  Settings file: C:\Users\<user>\.claude\settings.json  (or ~/...)

  Keys to add:
    +  CLAUDE_CODE_ENABLE_TELEMETRY=1
    +  OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:3000
    +  OTEL_EXPORTER_OTLP_PROTOCOL=http/json
    +  OTEL_METRICS_EXPORTER=otlp
    +  OTEL_LOGS_EXPORTER=otlp
    +  OTEL_LOG_TOOL_DETAILS=1

  Backed up to: C:\Users\<user>\.claude\settings.json.bak.20260424-143000
  Written: C:\Users\<user>\.claude\settings.json

  ╔══════════════════════════════════════════════════════╗
  ║  DONE — Next step: ...
  ```

- [ ] **2.4.3** Verify idempotency. Run a second time immediately:
  ```
  npm run setup:otel -- --yes
  ```
  Expected output: `All OTEL keys are already present. Nothing to do.`
  NO backup is created on second run (backup only if file exists AND changes are made — the current implementation backs up whenever the file exists and changes are pending; confirm no backup is written when there is nothing to change).

  Check the implementation: backup is called before writing, which only happens when `missing.length > 0`. The early exit `process.exit(0)` when `missing.length === 0` means no backup is ever created unnecessarily. Confirm this is the case.

- [ ] **2.4.4** Test the "never overwrite existing" guarantee. Manually edit `~/.claude/settings.json` to add `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:9999` (user's custom value), then run the wizard. Confirm it reports that key as "Already configured" with value `http://localhost:9999` and does NOT change it to `http://localhost:3000`.

- [ ] **2.4.5** Typecheck the script (tsx handles it at runtime, but also check statically):
  ```
  npx tsc --noEmit
  ```
  Note: `scripts/setup-otel.ts` is included by `tsconfig.json` because the `include` glob is `**/*.ts`. If strict mode flags any issues (e.g., around `readline`), fix them. Common fix: ensure `@types/node` is present (it already is per `package.json`).

- [ ] **2.4.6** Commit:
  ```
  git add scripts/setup-otel.ts package.json
  git commit -m "feat(phase-2): add scripts/setup-otel.ts Node CLI wizard"
  ```

---

### Phase 2.5 — Settings Page Telemetry Tab

- [ ] **2.5.1** Modify `app/dashboard/settings/page.tsx` to add a "Telemetry" tab. The page is already a client component with a tab switcher. Add `'telemetry'` to the `Tab` union, add the button, and add the tab panel.

  Changes to `app/dashboard/settings/page.tsx`:

  1. Add `TelemetryStatus` import from `@/types/otel`.
  2. Add `'telemetry'` to the `Tab` type.
  3. Add state for telemetry status.
  4. Fetch `/api/telemetry/status` on mount alongside the existing `/api/settings` fetch.
  5. Add the tab button.
  6. Add the Telemetry tab panel.

  The full modified file (changes highlighted in comments — replace the entire file):

  ```typescript
  'use client';

  import { useEffect, useState, useCallback } from 'react';
  import type { TelemetryStatus } from '@/types/otel';

  interface ClaudeSettings {
    settings: Record<string, unknown>;
    mcp: Record<string, unknown>;
    plugins: Array<{
      name: string;
      scope: string;
      installPath: string;
      installedAt: string;
      lastUpdated: string;
    }>;
  }

  type Tab = 'settings' | 'mcp' | 'plugins' | 'telemetry';

  const OTEL_KEY_LABELS: Record<string, string> = {
    CLAUDE_CODE_ENABLE_TELEMETRY:  'Enable telemetry',
    OTEL_EXPORTER_OTLP_ENDPOINT:   'OTLP endpoint',
    OTEL_EXPORTER_OTLP_PROTOCOL:   'OTLP protocol',
    OTEL_METRICS_EXPORTER:         'Metrics exporter',
    OTEL_LOGS_EXPORTER:            'Logs exporter',
    OTEL_LOG_TOOL_DETAILS:         'Log tool details',
  };

  const OTEL_DESIRED: Record<string, string> = {
    CLAUDE_CODE_ENABLE_TELEMETRY:  '1',
    OTEL_EXPORTER_OTLP_ENDPOINT:   'http://localhost:3000',
    OTEL_EXPORTER_OTLP_PROTOCOL:   'http/json',
    OTEL_METRICS_EXPORTER:         'otlp',
    OTEL_LOGS_EXPORTER:            'otlp',
    OTEL_LOG_TOOL_DETAILS:         '1',
  };

  export default function SettingsPage() {
    const [data, setData] = useState<ClaudeSettings | null>(null);
    const [telemetry, setTelemetry] = useState<TelemetryStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<Tab>('settings');
    const [wizardRunning, setWizardRunning] = useState(false);
    const [wizardResult, setWizardResult] = useState<string | null>(null);

    const loadAll = useCallback(() => {
      Promise.all([
        fetch('/api/settings').then(r => r.json() as Promise<ClaudeSettings>),
        fetch('/api/telemetry/status').then(r => r.json() as Promise<TelemetryStatus>),
      ])
        .then(([settings, tel]) => {
          setData(settings);
          setTelemetry(tel);
        })
        .finally(() => setLoading(false));
    }, []);

    useEffect(() => { loadAll(); }, [loadAll]);

    const runWizard = useCallback(async () => {
      setWizardRunning(true);
      setWizardResult(null);
      try {
        const res = await fetch('/api/telemetry/setup', { method: 'POST' });
        const json = await res.json() as { message: string };
        setWizardResult(json.message ?? 'Done');
        // Refresh status after wizard
        const tel = await fetch('/api/telemetry/status').then(r => r.json() as Promise<TelemetryStatus>);
        setTelemetry(tel);
      } catch {
        setWizardResult('Error contacting setup endpoint. Run `npm run setup:otel` from the terminal instead.');
      } finally {
        setWizardRunning(false);
      }
    }, []);

    if (loading) return <p className="text-gray-400 animate-pulse">Loading...</p>;
    if (!data) return <p className="text-gray-500 text-sm">Failed to load settings.</p>;

    const tabs: Tab[] = ['settings', 'mcp', 'plugins', 'telemetry'];

    // Compute overall telemetry health
    const allPresent = telemetry
      ? Object.values(telemetry.keys).every(k => k.present)
      : false;
    const missingCount = telemetry
      ? Object.values(telemetry.keys).filter(k => !k.present).length
      : 6;

    return (
      <div>
        <h2 className="font-heading text-2xl text-brand-cyan mb-6">Settings Inspector</h2>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 flex-wrap">
          {tabs.map(tab => {
            const showBadge = tab === 'telemetry' && !allPresent && missingCount > 0;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`relative px-4 py-2 text-sm rounded-lg border transition-colors capitalize ${
                  activeTab === tab
                    ? 'bg-brand-cyan/10 border-brand-cyan/30 text-brand-cyan'
                    : 'border-brand-navy-light/30 text-gray-400 hover:text-white'
                }`}
              >
                {tab}
                {showBadge && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-chameleon-amber" />
                )}
              </button>
            );
          })}
        </div>

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-lg p-4">
            <pre className="text-sm text-gray-300 font-mono overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(data.settings, null, 2)}
            </pre>
          </div>
        )}

        {/* MCP Tab */}
        {activeTab === 'mcp' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {Object.entries(data.mcp).length === 0 && (
              <p className="text-gray-500 text-sm col-span-2">No MCP servers configured.</p>
            )}
            {Object.entries(data.mcp).map(([name, config]) => {
              const cfg = config as Record<string, unknown>;
              return (
                <div
                  key={name}
                  className="p-4 bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-lg hover:border-brand-cyan/20 transition-colors"
                >
                  <p className="text-brand-cyan text-sm font-medium mb-3">{name}</p>
                  {cfg.command != null && (
                    <div className="mb-2">
                      <p className="text-gray-500 text-xs">Command</p>
                      <p className="text-white text-sm font-mono">{String(cfg.command)}</p>
                    </div>
                  )}
                  {Array.isArray(cfg.args) && (
                    <div className="mb-2">
                      <p className="text-gray-500 text-xs">Args</p>
                      <p className="text-gray-300 text-xs font-mono break-all">
                        {(cfg.args as string[]).join(' ')}
                      </p>
                    </div>
                  )}
                  {cfg.env != null && typeof cfg.env === 'object' && (
                    <div>
                      <p className="text-gray-500 text-xs">Environment</p>
                      <div className="mt-1 space-y-0.5">
                        {Object.entries(cfg.env as Record<string, string>).map(([k, v]) => (
                          <p key={k} className="text-xs font-mono">
                            <span className="text-chameleon-amber">{k}</span>
                            <span className="text-gray-500">=</span>
                            <span className="text-gray-400">{typeof v === 'string' && v.length > 20 ? v.slice(0, 20) + '...' : String(v)}</span>
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Plugins Tab */}
        {activeTab === 'plugins' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {data.plugins.length === 0 && (
              <p className="text-gray-500 text-sm col-span-2">No plugins installed.</p>
            )}
            {data.plugins.map(plugin => (
              <div
                key={plugin.name}
                className="p-4 bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-lg hover:border-brand-cyan/20 transition-colors"
              >
                <p className="text-white text-sm font-medium">{plugin.name}</p>
                <div className="mt-2 space-y-1 text-xs">
                  <p className="text-gray-400">Scope: <span className="text-chameleon-purple">{plugin.scope}</span></p>
                  <p className="text-gray-400">Installed: <span className="text-gray-300">{new Date(plugin.installedAt).toLocaleDateString()}</span></p>
                  <p className="text-gray-400">Updated: <span className="text-gray-300">{new Date(plugin.lastUpdated).toLocaleDateString()}</span></p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Telemetry Tab */}
        {activeTab === 'telemetry' && (
          <div className="space-y-4">
            {/* Status card */}
            <div className="bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-medium">OTEL Configuration Status</h3>
                <span className={`text-xs px-2 py-1 rounded-full font-mono ${
                  allPresent
                    ? 'bg-chameleon-green/10 text-chameleon-green border border-chameleon-green/20'
                    : 'bg-chameleon-amber/10 text-chameleon-amber border border-chameleon-amber/20'
                }`}>
                  {allPresent ? 'Fully configured' : `${missingCount} key${missingCount !== 1 ? 's' : ''} missing`}
                </span>
              </div>

              <div className="space-y-2">
                {telemetry && Object.entries(telemetry.keys).map(([key, info]) => {
                  const desired = OTEL_DESIRED[key];
                  const isCorrect = info.present && info.value === desired;
                  const isWrong   = info.present && info.value !== desired;
                  return (
                    <div key={key} className="flex items-start gap-3 text-sm">
                      <span className={`mt-0.5 text-base shrink-0 ${
                        isCorrect ? 'text-chameleon-green' :
                        isWrong   ? 'text-chameleon-amber' :
                                    'text-gray-600'
                      }`}>
                        {isCorrect ? '✓' : isWrong ? '!' : '○'}
                      </span>
                      <div className="min-w-0">
                        <p className="text-gray-300 font-mono text-xs truncate">{key}</p>
                        {info.present ? (
                          <p className="text-xs font-mono mt-0.5">
                            <span className={isCorrect ? 'text-chameleon-green/80' : 'text-chameleon-amber/80'}>
                              {info.value}
                            </span>
                            {isWrong && (
                              <span className="text-gray-500 ml-2">(expected: {desired})</span>
                            )}
                          </p>
                        ) : (
                          <p className="text-gray-600 text-xs mt-0.5 font-mono">not set</p>
                        )}
                        <p className="text-gray-500 text-xs mt-0.5">{OTEL_KEY_LABELS[key]}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Event stats card */}
            <div className="bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-lg p-5">
              <h3 className="text-white font-medium mb-3">Ingest Statistics</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-gray-500 text-xs">Total events received</p>
                  <p className="text-2xl font-mono text-brand-cyan mt-1">
                    {telemetry?.totalEvents ?? 0}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Last event received</p>
                  <p className="text-sm text-gray-300 font-mono mt-1">
                    {telemetry?.lastEventAt
                      ? new Date(telemetry.lastEventAt).toLocaleString()
                      : 'No events yet'}
                  </p>
                </div>
              </div>
            </div>

            {/* Setup wizard card */}
            {!allPresent && (
              <div className="bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-lg p-5">
                <h3 className="text-white font-medium mb-2">Quick Setup</h3>
                <p className="text-gray-400 text-sm mb-4">
                  Run the setup wizard to add the missing keys to{' '}
                  <code className="text-brand-cyan font-mono text-xs">~/.claude/settings.json</code>.
                  Existing values are never overwritten.
                </p>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={runWizard}
                      disabled={wizardRunning}
                      className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                        wizardRunning
                          ? 'border-brand-navy-light/30 text-gray-600 cursor-not-allowed'
                          : 'bg-brand-cyan/10 border-brand-cyan/30 text-brand-cyan hover:bg-brand-cyan/20'
                      }`}
                    >
                      {wizardRunning ? 'Running…' : 'Apply missing settings'}
                    </button>
                    <span className="text-gray-500 text-xs">or run</span>
                    <code className="text-brand-cyan font-mono text-xs bg-brand-navy-dark/50 px-2 py-1 rounded">
                      npm run setup:otel
                    </code>
                    <span className="text-gray-500 text-xs">from the terminal</span>
                  </div>
                  {wizardResult && (
                    <p className="text-sm text-gray-300 bg-brand-navy-dark/50 p-3 rounded font-mono">
                      {wizardResult}
                    </p>
                  )}
                  <p className="text-xs text-gray-500">
                    After applying: quit Claude Code and restart it to pick up the new settings.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] **2.5.2** Create `app/api/telemetry/setup/route.ts` — the endpoint the "Apply missing settings" button calls. This runs the same logic as the script but in-process so it can be triggered from the browser. It must NOT use `child_process` to spawn tsx — that would be fragile. Instead it duplicates the merge logic directly.

  ```typescript
  import { NextResponse } from 'next/server';
  import fs from 'fs';
  import path from 'path';
  import { getClaudeHome } from '@/lib/claude-home';

  const REQUIRED_ENV: Record<string, string> = {
    CLAUDE_CODE_ENABLE_TELEMETRY:  '1',
    OTEL_EXPORTER_OTLP_ENDPOINT:   'http://localhost:3000',
    OTEL_EXPORTER_OTLP_PROTOCOL:   'http/json',
    OTEL_METRICS_EXPORTER:         'otlp',
    OTEL_LOGS_EXPORTER:            'otlp',
    OTEL_LOG_TOOL_DETAILS:         '1',
  };

  export async function POST(): Promise<NextResponse<{ message: string }>> {
    const settingsPath = path.join(getClaudeHome(), 'settings.json');

    let settings: Record<string, unknown> = {};
    let fileExisted = false;

    if (fs.existsSync(settingsPath)) {
      fileExisted = true;
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
      } catch {
        return NextResponse.json({ message: 'ERROR: Could not parse settings.json. Edit it manually.' });
      }
    } else {
      // Ensure the directory exists
      const dir = path.dirname(settingsPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    if (!settings['env'] || typeof settings['env'] !== 'object' || Array.isArray(settings['env'])) {
      settings['env'] = {};
    }
    const envBlock = settings['env'] as Record<string, string>;

    const missing: string[] = [];
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      if (envBlock[key] === undefined) {
        envBlock[key] = value;
        missing.push(key);
      }
    }

    if (missing.length === 0) {
      return NextResponse.json({ message: 'All OTEL keys already present. Nothing changed.' });
    }

    // Back up
    if (fileExisted) {
      const ts = new Date().toISOString().replace(/[:.TZ-]/g, '').slice(0, 15);
      const backupPath = `${settingsPath}.bak.${ts}`;
      try {
        fs.copyFileSync(settingsPath, backupPath);
      } catch {
        // Non-fatal — proceed without backup
      }
    }

    // Write
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    } catch (err) {
      return NextResponse.json({ message: `ERROR writing settings.json: ${(err as Error).message}` });
    }

    const addedList = missing.join(', ');
    return NextResponse.json({
      message: `Added ${missing.length} key(s): ${addedList}. Quit and restart Claude Code to apply.`,
    });
  }
  ```

  Note: this uses synchronous `fs` (not `fs/promises`) intentionally — `better-sqlite3` is also sync, and mixing sync file I/O with async in a Next.js route handler is acceptable when the operations are fast. The settings.json file is tiny.

- [ ] **2.5.3** Verify the settings page loads without TypeScript errors:
  ```
  npx tsc --noEmit
  ```
  Expected: zero errors.

- [ ] **2.5.4** Manual verify in browser:
  - Navigate to `http://localhost:3000/dashboard/settings`.
  - Click the "Telemetry" tab. The tab should render without errors.
  - If OTEL keys are missing, the amber badge appears on the tab button.
  - The "Ingest Statistics" card shows total events (at least 1 from the smoke test in 2.2.5).
  - The "Apply missing settings" button is visible when keys are absent.

- [ ] **2.5.5** Commit:
  ```
  git add app/dashboard/settings/page.tsx app/api/telemetry/setup/
  git commit -m "feat(phase-2): add Telemetry tab to Settings page with status card and wizard trigger"
  ```

---

### Phase 2.6 — Integration Test

- [ ] **2.6.1** Create `__tests__/otel-ingest.integration.test.ts`.

  This test requires a running Next.js dev server. It POSTs real OTLP payloads, then queries SQLite directly to verify rows were inserted.

  The test uses `vitest` (already installed) and makes real HTTP calls to `http://localhost:3000`. Run it separately from unit tests.

  Add to `package.json` `scripts`:
  ```json
  "test:integration": "vitest run --config vitest.integration.config.ts"
  ```

  Create `vitest.integration.config.ts`:
  ```typescript
  import { defineConfig } from 'vitest/config';

  export default defineConfig({
    test: {
      environment: 'node',
      include: ['__tests__/**/*.integration.test.ts'],
      testTimeout: 15000,  // allow time for the dev server to respond
    },
  });
  ```

  Full content of `__tests__/otel-ingest.integration.test.ts`:
  ```typescript
  /**
   * Integration test: POST OTLP payloads to the live Next.js dev server,
   * then query SQLite directly to assert rows were inserted.
   *
   * Prerequisites:
   *   - `npm run dev` is running on port 3000
   *   - lib/db.ts is correctly pointing at the SQLite DB
   *
   * Run with: npm run test:integration
   */

  import { describe, it, expect, beforeAll } from 'vitest';
  // Import getDb from the lib — works because vitest runs in Node context
  import { getDb } from '../lib/db';

  const BASE_URL = process.env['INTEGRATION_BASE_URL'] ?? 'http://localhost:3000';

  // Unique session ID so we can assert exactly our rows without collision
  const TEST_SESSION_ID = `integration-test-${Date.now()}`;

  // ─── Fixtures ────────────────────────────────────────────────────────────────

  const LOGS_PAYLOAD = {
    resourceLogs: [{
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'claude-code' } }
        ]
      },
      scopeLogs: [{
        scope: { name: 'claude-code-telemetry', version: '1.0.0' },
        logRecords: [
          // Record 1: api_request
          {
            timeUnixNano: '1714100000000000000',
            attributes: [
              { key: 'event.name',          value: { stringValue: 'api_request' } },
              { key: 'session.id',          value: { stringValue: TEST_SESSION_ID } },
              { key: 'model',               value: { stringValue: 'claude-opus-4-5' } },
              { key: 'cost_usd',            value: { doubleValue: 0.00512 } },
              { key: 'input_tokens',        value: { intValue: '3000' } },
              { key: 'output_tokens',       value: { intValue: '400' } },
              { key: 'cache_read_tokens',   value: { intValue: '12000' } },
              { key: 'cache_create_tokens', value: { intValue: '0' } },
              { key: 'api.duration_ms',     value: { doubleValue: 2100.5 } },
            ]
          },
          // Record 2: tool_result for mcp_tool with tool_parameters
          {
            timeUnixNano: '1714100001000000000',
            attributes: [
              { key: 'event.name',      value: { stringValue: 'tool_result' } },
              { key: 'session.id',      value: { stringValue: TEST_SESSION_ID } },
              { key: 'model',           value: { stringValue: 'claude-opus-4-5' } },
              { key: 'tool.name',       value: { stringValue: 'mcp_tool' } },
              { key: 'tool.success',    value: { boolValue: true } },
              { key: 'tool.duration_ms',value: { doubleValue: 88.0 } },
              { key: 'tool_parameters', value: { stringValue: '{"mcp_server_name":"notion","mcp_tool_name":"search_pages"}' } },
            ]
          },
          // Record 3: malformed — should be dropped (no event.name)
          {
            timeUnixNano: '1714100002000000000',
            attributes: []
          },
        ]
      }]
    }]
  };

  const METRICS_PAYLOAD = {
    resourceMetrics: [{
      scopeMetrics: [{
        metrics: [
          {
            name: 'claude_code.commit.count',
            sum: {
              dataPoints: [{
                timeUnixNano: '1714100060000000000',
                asInt: '5',
                attributes: [
                  { key: 'session.id', value: { stringValue: TEST_SESSION_ID } },
                  { key: 'model',      value: { stringValue: 'claude-opus-4-5' } },
                ]
              }]
            }
          },
          {
            name: 'claude_code.lines_of_code.count',
            gauge: {
              dataPoints: [{
                timeUnixNano: '1714100060000000000',
                asDouble: 287.0,
                attributes: [
                  { key: 'session.id', value: { stringValue: TEST_SESSION_ID } },
                ]
              }]
            }
          }
        ]
      }]
    }]
  };

  // ─── Tests ────────────────────────────────────────────────────────────────────

  describe('OTEL ingest endpoints (integration)', () => {
    beforeAll(async () => {
      // Verify the server is reachable before running any test
      try {
        const res = await fetch(`${BASE_URL}/api/telemetry/status`);
        if (!res.ok) throw new Error(`Status ${res.status}`);
      } catch (err) {
        throw new Error(
          `Next.js dev server is not reachable at ${BASE_URL}. ` +
          `Run 'npm run dev' in another terminal, then retry.\n` +
          String(err)
        );
      }
    });

    it('POST /v1/logs returns 200 with accepted=2 dropped=1', async () => {
      const res = await fetch(`${BASE_URL}/v1/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(LOGS_PAYLOAD),
      });

      expect(res.status).toBe(200);
      const json = await res.json() as { accepted: number; dropped: number };
      expect(json.accepted).toBe(2);
      expect(json.dropped).toBe(1);
    });

    it('rows land in otel_events with correct field values', () => {
      const db = getDb();

      const rows = db.prepare<[string], Record<string, unknown>>(
        `SELECT event_name, session_id, model, cost_usd, input_tokens,
                api_duration_ms, tool_name, tool_success, tool_duration_ms,
                mcp_server_name, mcp_tool_name
         FROM otel_events
         WHERE session_id = ?
         ORDER BY timestamp ASC`
      ).all(TEST_SESSION_ID);

      expect(rows).toHaveLength(2);

      // Row 0: api_request
      const apiRow = rows[0];
      expect(apiRow['event_name']).toBe('api_request');
      expect(apiRow['model']).toBe('claude-opus-4-5');
      expect(typeof apiRow['cost_usd']).toBe('number');
      expect((apiRow['cost_usd'] as number)).toBeCloseTo(0.00512);
      expect(apiRow['input_tokens']).toBe(3000);
      expect(apiRow['api_duration_ms']).toBeCloseTo(2100.5);

      // Row 1: tool_result for mcp_tool
      const mcpRow = rows[1];
      expect(mcpRow['event_name']).toBe('tool_result');
      expect(mcpRow['tool_name']).toBe('mcp_tool');
      expect(mcpRow['tool_success']).toBe(1);
      expect(mcpRow['tool_duration_ms']).toBeCloseTo(88.0);
      expect(mcpRow['mcp_server_name']).toBe('notion');
      expect(mcpRow['mcp_tool_name']).toBe('search_pages');
    });

    it('POST /v1/metrics returns 200 with accepted=2 dropped=0', async () => {
      const res = await fetch(`${BASE_URL}/v1/metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(METRICS_PAYLOAD),
      });

      expect(res.status).toBe(200);
      const json = await res.json() as { accepted: number; dropped: number };
      expect(json.accepted).toBe(2);
      expect(json.dropped).toBe(0);
    });

    it('metric rows land in otel_metrics with correct type and value', () => {
      const db = getDb();

      const rows = db.prepare<[string], Record<string, unknown>>(
        `SELECT metric_name, metric_type, value, model
         FROM otel_metrics
         WHERE session_id = ?
         ORDER BY metric_name ASC`
      ).all(TEST_SESSION_ID);

      expect(rows).toHaveLength(2);

      const commit = rows.find(r => r['metric_name'] === 'claude_code.commit.count');
      const loc    = rows.find(r => r['metric_name'] === 'claude_code.lines_of_code.count');

      expect(commit).toBeDefined();
      expect(commit!['metric_type']).toBe('counter');
      expect(commit!['value']).toBe(5);
      expect(commit!['model']).toBe('claude-opus-4-5');

      expect(loc).toBeDefined();
      expect(loc!['metric_type']).toBe('gauge');
      expect((loc!['value'] as number)).toBeCloseTo(287.0);
    });

    it('GET /api/telemetry/status reflects the ingested events', async () => {
      const res = await fetch(`${BASE_URL}/api/telemetry/status`);
      expect(res.status).toBe(200);
      const json = await res.json() as { totalEvents: number; lastEventAt: string | null };
      expect(json.totalEvents).toBeGreaterThanOrEqual(2);
      expect(json.lastEventAt).not.toBeNull();
    });

    it('always returns 200 even on completely invalid JSON body', async () => {
      const res = await fetch(`${BASE_URL}/v1/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'this is not json at all',
      });
      expect(res.status).toBe(200);
      const json = await res.json() as { accepted: number; dropped: number };
      expect(json.accepted).toBe(0);
      expect(json.dropped).toBe(1);
    });
  });
  ```

- [ ] **2.6.2** Run the integration test with the dev server running:

  Terminal 1:
  ```
  npm run dev
  ```

  Terminal 2:
  ```
  npm run test:integration
  ```

  Expected:
  ```
  ✓ __tests__/otel-ingest.integration.test.ts (5)
    ✓ OTEL ingest endpoints (integration) > POST /v1/logs returns 200 with accepted=2 dropped=1
    ✓ OTEL ingest endpoints (integration) > rows land in otel_events with correct field values
    ✓ OTEL ingest endpoints (integration) > POST /v1/metrics returns 200 with accepted=2 dropped=0
    ✓ OTEL ingest endpoints (integration) > metric rows land in otel_metrics with correct type and value
    ✓ OTEL ingest endpoints (integration) > GET /api/telemetry/status reflects the ingested events
    ✓ OTEL ingest endpoints (integration) > always returns 200 even on completely invalid JSON body

  Test Files  1 passed (1)
  Tests       6 passed (6)
  ```

  If any test fails, fix before committing.

- [ ] **2.6.3** Final typecheck + lint:
  ```
  npx tsc --noEmit
  npm run lint
  ```
  Expected: zero errors.

- [ ] **2.6.4** Commit:
  ```
  git add __tests__/otel-ingest.integration.test.ts vitest.integration.config.ts package.json
  git commit -m "feat(phase-2): add integration tests for /v1/logs and /v1/metrics ingest"
  ```

---

### Phase 2.7 — End-to-End Verification with Real Claude Code

This step requires Claude Code to be installed and restartable. It is the definitive proof that the wiring works.

- [ ] **2.7.1** Run the setup wizard:
  ```
  npm run setup:otel
  ```
  Confirm all 6 keys are now in `~/.claude/settings.json` under the `env` block. Inspect:
  ```bash
  # Windows PowerShell:
  Get-Content "$env:USERPROFILE\.claude\settings.json" | Select-String "OTEL|CLAUDE_CODE"
  # macOS/Linux:
  grep -E "OTEL|CLAUDE_CODE" ~/.claude/settings.json
  ```
  Expected: all 6 keys visible with the correct values.

- [ ] **2.7.2** Quit Claude Code completely. Restart it. Start a new session in any project and run any tool (e.g., ask it to list files). Claude Code will POST to `http://localhost:3000/v1/logs` during the tool call.

- [ ] **2.7.3** Within 30 seconds of the tool call, check the Telemetry tab in the Settings page (`http://localhost:3000/dashboard/settings` → Telemetry). The "Last event received" timestamp should update and "Total events" should be greater than zero.

- [ ] **2.7.4** Alternatively verify directly in SQLite:
  ```bash
  sqlite3 <DB_PATH> "SELECT event_name, session_id, model, received_at FROM otel_events ORDER BY received_at DESC LIMIT 5;"
  ```
  Expected: rows with real session IDs and model names from the Claude Code session.

- [ ] **2.7.5** Final phase commit:
  ```
  git add -A
  git commit -m "feat(phase-2): complete OTEL ingest + setup wizard — phase 2 done"
  ```

---

## Error Handling Strategy

| Scenario | Behavior |
|----------|----------|
| Request body is not valid JSON | Return 200 `{accepted:0, dropped:1}`, log to stderr |
| A log record is missing `event.name` | Drop that record, increment `dropped`, continue batch |
| `tool_parameters` JSON is malformed | Fall through to legacy `mcp__server__tool` parsing |
| Legacy `mcp__` pattern does not match | Set both MCP fields to null — no error |
| `timeUnixNano` is absent or empty | Use `new Date().toISOString()` as fallback |
| `intValue` cannot be parsed as integer | `parseInt` returns NaN → `getNumber` returns null |
| SQLite INSERT fails (schema mismatch) | Drop that row, increment dropped, log to stderr, continue |
| `lib/db.ts` `getDb()` throws (DB not initialized) | Log error, return 200 `{accepted:0, dropped:N}` |
| Setup wizard run twice | Detects all keys present, exits without writing or backing up |
| Setup wizard encounters unreadable settings.json | `process.exit(1)` with error message |

The invariant throughout: **`/v1/logs` and `/v1/metrics` return HTTP 200 always.** Claude Code does not retry on 200. Any deviation from this means dropped events from good batches that contained one bad record.

---

## Performance Notes

- `better-sqlite3` is synchronous — each INSERT runs inline. For typical Claude Code batches (1–20 records per POST), this is fast enough. No batching or transaction wrapper is needed at this volume.
- If event ingestion volume becomes a bottleneck (hundreds of records per second), wrap the INSERT loop in a `db.transaction()` call. The route handler code already isolates the loop so this is a one-line change.
- The parser (`lib/otel-parse.ts`) allocates a `Map` per record. At typical Claude Code rates this is negligible. Do not optimize prematurely.

---

## Security Notes

- The OTLP endpoints accept any POST body. They are designed to be localhost-only (Next.js binds to `0.0.0.0` for dev but the firewall should block external access). No auth is added in this phase — this is a local tool per the project's design.
- The setup wizard uses `fs.copyFileSync` + `fs.writeFileSync` (sync) to avoid a TOCTOU race between reading and writing `settings.json`. On Windows, file locking is handled by the OS.
- The wizard never shells out or spawns child processes — it is pure Node file I/O.

---

## Stop Conditions for Phase 2

Phase 2 is complete when ALL of the following are true:

1. <!-- Phase 1 actual: "test" script runs Phase 1's tsx suite (14 tests). Phase 2 vitest suite is under "test:otel". -->
   `npm run test:otel` passes: 11/11 otel-parse tests green.
   `npm test` still passes: Phase 1's 14 tests all green (no regression).
2. `npm run test:integration` passes: 6/6 tests green (requires `npm run dev` running).
3. `npx tsc --noEmit` — zero errors.
4. `npm run lint` — zero errors.
5. `npm run setup:otel -- --yes` runs without error and correctly writes only missing keys.
6. Running it a second time outputs "All OTEL keys are already present."
7. `http://localhost:3000/dashboard/settings` → Telemetry tab renders, shows key status, shows ingest stats.
8. After restarting Claude Code, real OTEL events appear in the SQLite DB within 30 seconds of any tool call.

---

## Files Created / Modified Summary

| Path | Status |
|------|--------|
| `types/otel.ts` | New |
| `lib/otel-parse.ts` | New |
| `app/api/v1/logs/route.ts` | New |
| `app/api/v1/metrics/route.ts` | New |
| `app/api/telemetry/status/route.ts` | New |
| `app/api/telemetry/setup/route.ts` | New |
| `scripts/setup-otel.ts` | New |
| `app/dashboard/settings/page.tsx` | Modified |
| `__tests__/otel-parse.test.ts` | New |
| `__tests__/otel-ingest.integration.test.ts` | New |
| `vitest.config.ts` | New |
| `vitest.integration.config.ts` | New |
| `package.json` | Modified (add tsx, vitest, scripts) |
