// app/api/system/pressure/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { rangeToLocalDateCutoff } from '@/lib/observability-helpers';

const DEFAULT_MAX_RETRIES = 10;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range');
    const cutoff = rangeToLocalDateCutoff(range);
    const db = getDb();

    // Read CLAUDE_CODE_MAX_RETRIES env with ValueError-equivalent fallback
    let maxRetries = DEFAULT_MAX_RETRIES;
    try {
      const envVal = process.env.CLAUDE_CODE_MAX_RETRIES;
      if (envVal) {
        const parsed = parseInt(envVal, 10);
        if (!isNaN(parsed) && parsed > 0) maxRetries = parsed;
      }
    } catch { /* keep default */ }

    // Retry exhaustion: api_error events where attempt_count >= maxRetries
    const retryExhausted = db.prepare(`
      SELECT COUNT(*) AS n
      FROM otel_events
      WHERE event_name = 'api_error'
        AND attempt_count >= ?
        AND DATE(timestamp, 'localtime') >= ?
    `).get(maxRetries, cutoff) as { n: number };

    // Compaction events
    const compactions = db.prepare(`
      SELECT COUNT(*) AS n
      FROM otel_events
      WHERE event_name = 'compaction'
        AND DATE(timestamp, 'localtime') >= ?
    `).get(cutoff) as { n: number };

    // Recent api_errors (last 10, most recent first)
    const recentErrors = db.prepare(`
      SELECT
        session_id,
        timestamp,
        error_message,
        status_code,
        attempt_count
      FROM otel_events
      WHERE event_name = 'api_error'
        AND DATE(timestamp, 'localtime') >= ?
      ORDER BY timestamp DESC
      LIMIT 10
    `).all(cutoff) as Array<{
      session_id: string | null;
      timestamp: string;
      error_message: string | null;
      status_code: number | null;
      attempt_count: number | null;
    }>;

    return NextResponse.json({
      retryExhaustedCount: retryExhausted.n,
      compactionCount: compactions.n,
      maxRetriesThreshold: maxRetries,
      recentErrors,
      range: range ?? '7d',
      cutoff,
    });
  } catch (err) {
    console.error('GET /api/system/pressure failed:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
