// app/api/sessions/outcomes/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { rangeToLocalDateCutoff } from '@/lib/observability-helpers';

export interface OutcomeDay {
  date: string;
  errored: number;
  rateLimited: number;
  truncated: number;
  unfinished: number;
  ok: number;
  total: number;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range');
    const cutoff = rangeToLocalDateCutoff(range);
    const db = getDb();

    // Phase 1 schema: sessions.error_count, sessions.rate_limit_hit,
    // sessions.stop_reason ('end_turn'|'max_tokens'|null), sessions.ended_at (null = unfinished)
    // Priority order (mutually exclusive): errored > rate_limited > truncated > unfinished > ok.
    const rows = db.prepare(`
      SELECT
        DATE(started_at, 'localtime') AS date,
        CASE
          WHEN error_count > 0                          THEN 'errored'
          WHEN rate_limit_hit = 1                       THEN 'rate_limited'
          WHEN stop_reason = 'max_tokens'               THEN 'truncated'
          WHEN ended_at IS NULL                         THEN 'unfinished'
          ELSE                                               'ok'
        END AS outcome
      FROM sessions
      WHERE DATE(started_at, 'localtime') >= ?
      ORDER BY date ASC
    `).all(cutoff) as Array<{ date: string; outcome: string }>;

    const dayMap = new Map<string, OutcomeDay>();
    const ensure = (date: string): OutcomeDay => {
      if (!dayMap.has(date)) {
        dayMap.set(date, { date, errored: 0, rateLimited: 0, truncated: 0, unfinished: 0, ok: 0, total: 0 });
      }
      return dayMap.get(date)!;
    };

    for (const r of rows) {
      const d = ensure(r.date);
      d.total++;
      if (r.outcome === 'errored') d.errored++;
      else if (r.outcome === 'rate_limited') d.rateLimited++;
      else if (r.outcome === 'truncated') d.truncated++;
      else if (r.outcome === 'unfinished') d.unfinished++;
      else d.ok++;
    }

    const daily = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({ daily, range: range ?? '7d', cutoff });
  } catch (err) {
    console.error('GET /api/sessions/outcomes failed:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
