// app/api/mcp/[server]/tools/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { rangeToLocalDateCutoff, percentile, parseMcpToolName } from '@/lib/observability-helpers';

// Next.js 16: dynamic route params is a Promise — must be awaited.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ server: string }> }
) {
  try {
    const { server: rawServer } = await params;
    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range');
    const cutoff = rangeToLocalDateCutoff(range);
    const server = decodeURIComponent(rawServer);
    const db = getDb();

    // Source 1: OTEL events with mcp_server_name + mcp_tool_name (highest fidelity)
    const otelRows = db.prepare(`
      SELECT
        mcp_tool_name AS tool,
        tool_duration_ms AS ms,
        tool_success,
        tool_error
      FROM otel_events
      WHERE event_name = 'tool_result'
        AND mcp_server_name = ?
        AND DATE(timestamp, 'localtime') >= ?
      ORDER BY mcp_tool_name, tool_duration_ms
    `).all(server, cutoff) as Array<{
      tool: string;
      ms: number | null;
      tool_success: number | null;
      tool_error: string | null;
    }>;

    // Source 2: tool_calls with mcp__<server>__<tool> naming
    const jsonlRows = db.prepare(`
      SELECT
        tool_name,
        duration_ms,
        error
      FROM tool_calls
      WHERE tool_name LIKE ?
        AND DATE(ts, 'localtime') >= ?
      ORDER BY tool_name, duration_ms
    `).all(`mcp__${server}__%`, cutoff) as Array<{
      tool_name: string;
      duration_ms: number | null;
      error: string | null;
    }>;

    // Group all rows by tool name
    interface ToolBucket { durations: number[]; errors: number; calls: number }
    const toolMap = new Map<string, ToolBucket>();

    const ensure = (tool: string) => {
      if (!toolMap.has(tool)) toolMap.set(tool, { durations: [], errors: 0, calls: 0 });
      return toolMap.get(tool)!;
    };

    for (const r of otelRows) {
      if (!r.tool) continue;
      const b = ensure(r.tool);
      b.calls++;
      if (r.ms != null) b.durations.push(r.ms);
      if (r.tool_success === 0 || r.tool_error) b.errors++;
    }

    for (const r of jsonlRows) {
      const parsed = parseMcpToolName(r.tool_name);
      if (!parsed) continue;
      const b = ensure(parsed.tool);
      b.calls++;
      if (r.duration_ms != null) b.durations.push(r.duration_ms);
      if (r.error) b.errors++;
    }

    const tools = Array.from(toolMap.entries()).map(([tool, b]) => {
      const sorted = b.durations.sort((a, c) => a - c);
      return {
        tool,
        calls: b.calls,
        errors: b.errors,
        errorRate: b.calls > 0 ? b.errors / b.calls : 0,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        maxMs: sorted.length > 0 ? sorted[sorted.length - 1] : null,
      };
    }).sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0));

    return NextResponse.json({ server, tools, range: range ?? '7d', cutoff });
  } catch (err) {
    console.error('GET /api/mcp/[server]/tools failed:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
