// types/observability.ts

export interface McpServer {
  server: string;
  calls: number;
  errors: number;
  errorRate: number;
  avgMs: number | null;
  p95Ms: number | null;
}

export interface McpTool {
  tool: string;
  calls: number;
  errors: number;
  errorRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export interface CacheDay {
  date: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  hitRate: number | null;
  billableTokens: number;
  lowSample: boolean;
}

export interface CacheEfficiencyData {
  overallHitRate: number | null;
  overallBillableTokens: number;
  lowSample: boolean;
  daily: CacheDay[];
  range: string;
  cutoff: string;
}

export interface OutcomeDay {
  date: string;
  errored: number;
  rateLimited: number;
  truncated: number;
  unfinished: number;
  ok: number;
  total: number;
}

export interface ToolLatencyRow {
  tool: string;
  calls: number;
  errors: number;
  errorRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export interface HookDay {
  date: string;
  fires: number;
  pairedCount: number;
  avgDurationMs: number | null;
}

export interface PressureData {
  retryExhaustedCount: number;
  compactionCount: number;
  maxRetriesThreshold: number;
  recentErrors: Array<{
    session_id: string | null;
    timestamp: string;
    error_message: string | null;
    status_code: number | null;
    attempt_count: number | null;
  }>;
  range: string;
  cutoff: string;
}
