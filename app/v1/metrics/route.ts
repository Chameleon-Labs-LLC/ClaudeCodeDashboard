import { NextResponse } from 'next/server';
import { parseOtelMetrics } from '@/lib/otel-parse';
import { getDb } from '@/lib/db';
import type { OtlpMetricsPayload, IngestResponse } from '@/types/otel';

const INSERT_OTEL_METRIC = `
  INSERT INTO otel_metrics (
    metric_name, metric_type, value, session_id, model, timestamp
  ) VALUES (
    @metric_name, @metric_type, @value, @session_id, @model, @timestamp
  )
`;

export async function POST(request: Request): Promise<NextResponse<IngestResponse>> {
  const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB
  const lenHeader = request.headers.get('content-length');
  const len = lenHeader ? parseInt(lenHeader, 10) : 0;
  if (len > MAX_BODY_BYTES) {
    // Return 200 (not 413) so OTEL clients do not retry the oversized batch.
    console.error(`[/v1/metrics] Rejected payload of ${len} bytes (limit ${MAX_BODY_BYTES})`);
    return NextResponse.json(
      { accepted: 0, dropped: 0, error: 'payload too large' },
      { status: 200 }
    );
  }

  let body: OtlpMetricsPayload;
  try {
    body = (await request.json()) as OtlpMetricsPayload;
  } catch {
    console.error('[/v1/metrics] Failed to parse request body as JSON');
    return NextResponse.json({ accepted: 0, dropped: 1 });
  }

  const { rows, dropped: parseDropped } = parseOtelMetrics(body);

  let accepted = 0;
  let insertDropped = 0;

  try {
    const db = getDb();
    const stmt = db.prepare(INSERT_OTEL_METRIC);

    for (const row of rows) {
      try {
        stmt.run(row);
        accepted++;
      } catch (err) {
        insertDropped++;
        console.error('[/v1/metrics] Failed to insert otel_metric row:', err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error('[/v1/metrics] Database unavailable:', err instanceof Error ? err.message : err);
    insertDropped += rows.length - accepted;
  }

  return NextResponse.json({ accepted, dropped: parseDropped + insertDropped });
}

export async function GET(): Promise<NextResponse> {
  return new NextResponse('Method Not Allowed', { status: 405 });
}
