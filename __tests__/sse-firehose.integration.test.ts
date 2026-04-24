import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import EventSource from 'eventsource';
import { getDb } from '../lib/db';
import type { FirehoseEvent } from '../types/live';

const DEV_URL = process.env.DEV_URL ?? 'http://localhost:3000';

async function ping(): Promise<boolean> {
  try {
    const r = await fetch(`${DEV_URL}/api/firehose`, { method: 'HEAD' });
    return r.ok || r.status === 200 || r.status === 405;
  } catch { return false; }
}

describe('SSE firehose integration', () => {
  beforeAll(async () => {
    if (!(await ping())) {
      throw new Error(`dev server not reachable at ${DEV_URL} — run \`npm run dev\` first`);
    }
  });

  it('delivers a newly-inserted otel_events row within 3 seconds', async () => {
    const marker = `test-event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const received: FirehoseEvent[] = [];

    const es = new EventSource(`${DEV_URL}/api/firehose`);
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout: no matching firehose event in 3s')), 3000);
      es.addEventListener('otel', (ev: MessageEvent) => {
        const parsed: FirehoseEvent = JSON.parse(ev.data);
        received.push(parsed);
        if (parsed.eventName === marker) {
          clearTimeout(timer);
          resolve();
        }
      });
      es.addEventListener('error', () => { /* auto-reconnects — ignore transient errors */ });
    });

    // give the SSE its first tick to set cursor
    await new Promise(r => setTimeout(r, 500));

    // insert fixture row — matches otel_events schema from Phase 1
    const now = new Date().toISOString();
    getDb().prepare(
      `INSERT INTO otel_events (event_name, session_id, timestamp, received_at)
       VALUES (?, ?, ?, ?)`
    ).run(marker, 'integration-test-session', now, now);

    try { await done; }
    finally { es.close(); }

    const match = received.find(e => e.eventName === marker);
    expect(match).toBeTruthy();
    expect(match?.sessionId).toBe('integration-test-session');
  }, 10_000);

  afterAll(() => {
    // clean up fixture rows
    getDb().prepare(`DELETE FROM otel_events WHERE event_name LIKE 'test-event-%'`).run();
  });
});
