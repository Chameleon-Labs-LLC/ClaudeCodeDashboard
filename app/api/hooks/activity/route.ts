// app/api/hooks/activity/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { rangeToLocalDateCutoff } from '@/lib/observability-helpers';

const OUTLIER_CAP_MS = 60_000;

export interface HookDay {
  date: string;
  fires: number;
  pairedCount: number;
  avgDurationMs: number | null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range');
    const cutoff = rangeToLocalDateCutoff(range);
    const db = getDb();

    const rows = db.prepare(`
      SELECT
        event_name,
        session_id,
        timestamp,
        DATE(timestamp, 'localtime') AS date
      FROM otel_events
      WHERE event_name IN ('hook_execution_start', 'hook_execution_complete')
        AND DATE(timestamp, 'localtime') >= ?
      ORDER BY timestamp ASC
    `).all(cutoff) as Array<{
      event_name: string;
      session_id: string | null;
      timestamp: string;
      date: string;
    }>;

    // FIFO queue: key = `${session_id}` — queues timestamps of unmatched starts
    const startQueues = new Map<string, number[]>();

    interface DayBucket { fires: number; durations: number[] }
    const dayMap = new Map<string, DayBucket>();
    const ensureDay = (d: string): DayBucket => {
      if (!dayMap.has(d)) dayMap.set(d, { fires: 0, durations: [] });
      return dayMap.get(d)!;
    };

    for (const r of rows) {
      const sid = r.session_id ?? 'unknown';
      const ts = new Date(r.timestamp).getTime();
      const day = ensureDay(r.date);

      if (r.event_name === 'hook_execution_start') {
        if (!startQueues.has(sid)) startQueues.set(sid, []);
        startQueues.get(sid)!.push(ts);
        day.fires++;
      } else if (r.event_name === 'hook_execution_complete') {
        day.fires++;
        const queue = startQueues.get(sid);
        if (queue && queue.length > 0) {
          const startTs = queue.shift()!;
          const dur = Math.min(ts - startTs, OUTLIER_CAP_MS);
          if (dur >= 0) day.durations.push(dur);
        }
      }
    }

    const daily: HookDay[] = Array.from(dayMap.entries())
      .map(([date, b]) => ({
        date,
        fires: b.fires,
        pairedCount: b.durations.length,
        avgDurationMs: b.durations.length > 0
          ? Math.round(b.durations.reduce((s, v) => s + v, 0) / b.durations.length)
          : null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const totalFires = daily.reduce((s, d) => s + d.fires, 0);

    return NextResponse.json({ daily, totalFires, range: range ?? '7d', cutoff });
  } catch (err) {
    console.error('GET /api/hooks/activity failed:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
