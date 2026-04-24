import type {
  OtlpLogsPayload,
  OtlpMetricsPayload,
  OtlpAttribute,
  OtlpLogRecord,
  OtelEventRow,
  OtelMetricRow,
} from '@/types/otel';

// Attribute extraction helpers

/** Build a key -> raw-value map from an OtlpAttribute array. */
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

// MCP tool name extraction

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
        // malformed JSON - fall through to legacy path
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

// Log record parser

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

// Metrics parser

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
