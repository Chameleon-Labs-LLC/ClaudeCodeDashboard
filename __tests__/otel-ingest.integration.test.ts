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
// Import getDb from the lib - works because vitest runs in Node context
import { getDb } from '../lib/db';

const BASE_URL = process.env['INTEGRATION_BASE_URL'] ?? 'http://localhost:3000';

// Unique session ID so we can assert exactly our rows without collision
const TEST_SESSION_ID = `integration-test-${Date.now()}`;

// Fixtures

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
        // Record 3: malformed - should be dropped (no event.name)
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

// Tests

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

    const rows = db.prepare(
      `SELECT event_name, session_id, model, cost_usd, input_tokens,
              api_duration_ms, tool_name, tool_success, tool_duration_ms,
              mcp_server_name, mcp_tool_name
       FROM otel_events
       WHERE session_id = ?
       ORDER BY timestamp ASC`
    ).all(TEST_SESSION_ID) as Record<string, unknown>[];

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

    const rows = db.prepare(
      `SELECT metric_name, metric_type, value, model
       FROM otel_metrics
       WHERE session_id = ?
       ORDER BY metric_name ASC`
    ).all(TEST_SESSION_ID) as Record<string, unknown>[];

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
