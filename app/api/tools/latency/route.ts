// app/api/tools/latency/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { rangeToLocalDateCutoff, percentile } from '@/lib/observability-helpers';

export interface ToolLatencyRow {
  tool: string;
  calls: number;
  errors: number;
  errorRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range');
    const cutoff = rangeToLocalDateCutoff(range);
    const db = getDb();

    // Fetch all rows with durations so we can compute percentiles in JS.
    // Filter: only rows where duration_ms is present (pairing succeeded).
    const rows = db.prepare(`
      SELECT
        tool_name,
        duration_ms,
        error
      FROM tool_calls
      WHERE DATE(ts, 'localtime') >= ?
      ORDER BY tool_name, duration_ms ASC
    `).all(cutoff) as Array<{ tool_name: string; duration_ms: number | null; error: string | null }>;

    interface Bucket { durations: number[]; totalCalls: number; errors: number }
    const toolMap = new Map<string, Bucket>();

    for (const r of rows) {
      if (!toolMap.has(r.tool_name)) {
        toolMap.set(r.tool_name, { durations: [], totalCalls: 0, errors: 0 });
      }
      const b = toolMap.get(r.tool_name)!;
      b.totalCalls++;
      if (r.duration_ms != null) b.durations.push(r.duration_ms);
      if (r.error) b.errors++;
    }

    const tools: ToolLatencyRow[] = Array.from(toolMap.entries()).map(([tool, b]) => {
      const sorted = b.durations.sort((a, c) => a - c);
      return {
        tool,
        calls: b.totalCalls,
        errors: b.errors,
        errorRate: b.totalCalls > 0 ? b.errors / b.totalCalls : 0,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        maxMs: sorted.length > 0 ? sorted[sorted.length - 1] : null,
      };
    }).sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0));

    return NextResponse.json({ tools, range: range ?? '7d', cutoff });
  } catch (err) {
    console.error('GET /api/tools/latency failed:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
