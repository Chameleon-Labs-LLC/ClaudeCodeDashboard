// app/api/usage/cache/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { rangeToLocalDateCutoff } from '@/lib/observability-helpers';

export interface CacheDay {
  date: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  hitRate: number | null;   // null when billableTokens < 1
  billableTokens: number;
  lowSample: boolean;       // true when billableTokens < 10_000
}

export interface CacheEfficiencyResponse {
  overallHitRate: number | null;
  overallBillableTokens: number;
  lowSample: boolean;
  daily: CacheDay[];
  range: string;
  cutoff: string;
}

const LOW_SAMPLE_THRESHOLD = 10_000;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range');
    const cutoff = rangeToLocalDateCutoff(range);
    const db = getDb();

    const rows = db.prepare(`
      SELECT
        date,
        SUM(input_tokens)        AS input_tokens,
        SUM(cache_read_tokens)   AS cache_read_tokens,
        SUM(cache_create_tokens) AS cache_create_tokens
      FROM token_usage
      WHERE date >= ?
      GROUP BY date
      ORDER BY date ASC
    `).all(cutoff) as Array<{
      date: string;
      input_tokens: number;
      cache_read_tokens: number;
      cache_create_tokens: number;
    }>;

    let totalInput = 0, totalRead = 0, totalCreate = 0;

    const daily: CacheDay[] = rows.map(r => {
      const inp = r.input_tokens ?? 0;
      const read = r.cache_read_tokens ?? 0;
      const create = r.cache_create_tokens ?? 0;
      const billable = inp + read + create;
      const hitRate = billable > 0 ? read / billable : null;
      totalInput += inp;
      totalRead += read;
      totalCreate += create;
      return {
        date: r.date,
        inputTokens: inp,
        cacheReadTokens: read,
        cacheCreateTokens: create,
        hitRate,
        billableTokens: billable,
        lowSample: billable < LOW_SAMPLE_THRESHOLD,
      };
    });

    const totalBillable = totalInput + totalRead + totalCreate;
    const overallHitRate = totalBillable > 0 ? totalRead / totalBillable : null;

    const response: CacheEfficiencyResponse = {
      overallHitRate,
      overallBillableTokens: totalBillable,
      lowSample: totalBillable < LOW_SAMPLE_THRESHOLD,
      daily,
      range: range ?? '7d',
      cutoff,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('GET /api/usage/cache failed:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
