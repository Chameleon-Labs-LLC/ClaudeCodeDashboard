// app/api/mcp/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { rangeToLocalDateCutoff, percentile } from '@/lib/observability-helpers';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range');
    const cutoff = rangeToLocalDateCutoff(range);
    const db = getDb();

    // Source 1: OTEL events with explicit mcp_server_name
    const otelRows = db.prepare(`
      SELECT
        mcp_server_name AS server,
        COUNT(*) AS calls,
        AVG(tool_duration_ms) AS avg_ms,
        SUM(CASE WHEN tool_success = 0 THEN 1 ELSE 0 END) AS errors
      FROM otel_events
      WHERE event_name = 'tool_result'
        AND mcp_server_name IS NOT NULL
        AND DATE(timestamp, 'localtime') >= ?
      GROUP BY mcp_server_name
    `).all(cutoff) as Array<{ server: string; calls: number; avg_ms: number | null; errors: number }>;

    // Source 2: tool_calls rows with mcp__ prefix (for p95 we need raw durations)
    const jsonlRows = db.prepare(`
      SELECT
        tool_name,
        duration_ms
      FROM tool_calls
      WHERE tool_name LIKE 'mcp__%'
        AND DATE(ts, 'localtime') >= ?
      ORDER BY tool_name
    `).all(cutoff) as Array<{ tool_name: string; duration_ms: number | null }>;

    // Group jsonl rows by server
    const jsonlByServer = new Map<string, number[]>();
    for (const row of jsonlRows) {
      const m = row.tool_name.match(/^mcp__([^_]+)__/);
      if (!m) continue;
      const server = m[1];
      if (!jsonlByServer.has(server)) jsonlByServer.set(server, []);
      if (row.duration_ms != null) jsonlByServer.get(server)!.push(row.duration_ms);
    }

    // Merge: OTEL rows take precedence; add any JSONL-only servers
    const merged = new Map<string, { calls: number; durations: number[]; errors: number }>();

    for (const row of otelRows) {
      merged.set(row.server, {
        calls: row.calls,
        durations: [], // we'll fetch per-tool durations in the /tools sub-route
        errors: row.errors,
      });
    }

    for (const [server, durations] of jsonlByServer.entries()) {
      if (!merged.has(server)) {
        merged.set(server, { calls: durations.length, durations, errors: 0 });
      }
    }

    // Fetch per-server raw durations from OTEL for p95 calc
    const otelDurationRows = db.prepare(`
      SELECT mcp_server_name AS server, tool_duration_ms AS ms
      FROM otel_events
      WHERE event_name = 'tool_result'
        AND mcp_server_name IS NOT NULL
        AND tool_duration_ms IS NOT NULL
        AND DATE(timestamp, 'localtime') >= ?
      ORDER BY mcp_server_name, tool_duration_ms
    `).all(cutoff) as Array<{ server: string; ms: number }>;

    const otelDurationsByServer = new Map<string, number[]>();
    for (const r of otelDurationRows) {
      if (!otelDurationsByServer.has(r.server)) otelDurationsByServer.set(r.server, []);
      otelDurationsByServer.get(r.server)!.push(r.ms);
    }

    const servers = Array.from(merged.entries()).map(([server, data]) => {
      const durations = (otelDurationsByServer.get(server) || data.durations).sort((a, b) => a - b);
      const p95ms = percentile(durations, 95);
      const avgMs = durations.length > 0
        ? durations.reduce((s, v) => s + v, 0) / durations.length
        : null;
      return {
        server,
        calls: data.calls,
        errors: data.errors,
        errorRate: data.calls > 0 ? data.errors / data.calls : 0,
        avgMs: avgMs != null ? Math.round(avgMs) : null,
        p95Ms: p95ms != null ? Math.round(p95ms) : null,
      };
    }).sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0));

    return NextResponse.json({ servers, range: range ?? '7d', cutoff });
  } catch (err) {
    console.error('GET /api/mcp failed:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
