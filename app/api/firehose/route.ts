import { getDb } from '@/lib/db';
import { sseEncode, sseComment, SSE_HEADERS } from '@/lib/sse';
import type { FirehoseEvent } from '@/types/live';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(sseComment('connected'));

      let closed = false;
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try { controller.enqueue(chunk); } catch { closed = true; }
      };

      // cursor starts at "now minus 10s" so the first tick may backfill a
      // tiny bit. On each event received, cursor advances monotonically so
      // reconnects don't duplicate rows.
      let cursor = new Date(Date.now() - 10_000).toISOString();

      const stmt = getDb().prepare(
        `SELECT event_name, session_id, model, timestamp, received_at,
                tool_name, tool_duration_ms, cost_usd
         FROM otel_events
         WHERE received_at > ?
         ORDER BY received_at ASC
         LIMIT 500`
      );

      const tick = () => {
        try {
          const rows = stmt.all(cursor) as Array<{
            event_name: string; session_id: string | null; model: string | null;
            timestamp: string; received_at: string;
            tool_name: string | null; tool_duration_ms: number | null; cost_usd: number | null;
          }>;
          for (const r of rows) {
            const evt: FirehoseEvent = {
              eventName: r.event_name,
              sessionId: r.session_id,
              model: r.model,
              timestamp: r.timestamp,
              receivedAt: r.received_at,
              toolName: r.tool_name,
              durationMs: r.tool_duration_ms,
              costUsd: r.cost_usd,
            };
            safeEnqueue(sseEncode(evt, 'otel'));
            cursor = r.received_at;
          }
        } catch (err) {
          // db may briefly be locked during WAL checkpoint — just skip this tick
          safeEnqueue(sseComment(`error ${(err as Error).message}`));
        }
      };

      const pollTimer = setInterval(tick, 2000);
      const heartbeat = setInterval(() => safeEnqueue(sseComment('ping')), 15_000);
      tick(); // immediate first tick

      const cleanup = () => {
        closed = true;
        clearInterval(pollTimer);
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      };

      if (request.signal.aborted) { cleanup(); return; }
      request.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
