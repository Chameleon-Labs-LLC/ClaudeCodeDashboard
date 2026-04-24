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
