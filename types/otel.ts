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
  speed: string | null;
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
