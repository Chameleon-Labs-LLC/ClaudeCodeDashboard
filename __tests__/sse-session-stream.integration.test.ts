import { describe, it, expect, beforeAll } from 'vitest';
import EventSource from 'eventsource';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { LiveTimelineEntry } from '../types/live';

const DEV_URL = process.env.DEV_URL ?? 'http://localhost:3000';
const CLAUDE_HOME = process.env.CLAUDE_HOME;

describe('SSE per-session stream integration', () => {
  beforeAll(() => {
    if (!CLAUDE_HOME) throw new Error('set CLAUDE_HOME to a scratch dir and start dev server with it');
  });

  it('delivers a newly-appended JSONL line as a timeline event within 3 seconds', async () => {
    const projectsDir = path.join(CLAUDE_HOME!, 'projects', 'integration-proj');
    await fs.mkdir(projectsDir, { recursive: true });
    const sessionId = `integration-${Date.now()}`;
    const fp = path.join(projectsDir, `${sessionId}.jsonl`);
    await fs.writeFile(fp, JSON.stringify({ type: 'user', message: { content: 'hi' }, timestamp: new Date().toISOString() }) + '\n');

    const entries: LiveTimelineEntry[] = [];
    const es = new EventSource(`${DEV_URL}/api/sessions/live/${sessionId}/stream`);
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout: no appended line arrived in 3s')), 3000);
      es.addEventListener('timeline', (ev: MessageEvent) => {
        const parsed: LiveTimelineEntry = JSON.parse(ev.data);
        entries.push(parsed);
        if (parsed.preview?.includes('appended-marker')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    // wait for initial backfill to land + watcher/poll to arm
    await new Promise(r => setTimeout(r, 1200));

    await fs.appendFile(fp, JSON.stringify({
      type: 'user',
      message: { content: 'appended-marker payload' },
      timestamp: new Date().toISOString(),
    }) + '\n');

    try { await done; }
    finally { es.close(); await fs.rm(fp, { force: true }); }

    expect(entries.some(e => e.preview?.includes('appended-marker'))).toBe(true);
  }, 10_000);
});
