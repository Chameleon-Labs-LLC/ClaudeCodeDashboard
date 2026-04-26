import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export interface ToolUsageStat {
  tool: string;
  count: number;
  sessions: number;
}

export interface ToolAnalytics {
  tools: ToolUsageStat[];
  totalToolCalls: number;
  topTools: ToolUsageStat[];
}

/**
 * Tool analytics, served from the SQLite `tool_calls` table populated by
 * `lib/sync-sessions.ts`. Replaces a legacy filesystem rescan that walked
 * the wrong directory layout (3 levels) and always returned zero.
 */
export async function GET(): Promise<NextResponse<ToolAnalytics>> {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        tool_name AS tool,
        COUNT(*) AS count,
        COUNT(DISTINCT session_id) AS sessions
      FROM tool_calls
      WHERE tool_name IS NOT NULL
      GROUP BY tool_name
      ORDER BY count DESC
    `).all() as ToolUsageStat[];

    const totalToolCalls = rows.reduce((sum, r) => sum + r.count, 0);

    return NextResponse.json({
      tools: rows,
      totalToolCalls,
      topTools: rows.slice(0, 20),
    });
  } catch (err) {
    console.error('GET /api/tools failed:', err);
    return NextResponse.json({ tools: [], totalToolCalls: 0, topTools: [] });
  }
}
