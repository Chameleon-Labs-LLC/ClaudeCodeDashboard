import path from 'node:path';
import os from 'node:os';
import { promises as fs, watch as fsWatch, type FSWatcher } from 'node:fs';
import { getClaudeHome } from '@/lib/claude-home';
import { readNewLines, lineToTimelineEntry } from '@/lib/live-sessions';
import { sseEncode, sseComment, SSE_HEADERS } from '@/lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

async function findJsonlPath(id: string): Promise<string | null> {
  const projectsDir = path.join(getClaudeHome(), 'projects');
  const projects = await fs.readdir(projectsDir, { withFileTypes: true }).catch(() => []);
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    const candidate = path.join(projectsDir, p.name, `${id}.jsonl`);
    try { await fs.access(candidate); return candidate; } catch { continue; }
  }
  return null;
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return new Response('bad id', { status: 400 });

  const jsonlPath = await findJsonlPath(id);
  if (!jsonlPath) return new Response('not found', { status: 404 });

  let offset = 0; // start from the top so reconnects get the whole timeline

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(sseComment('connected'));

      let closed = false;
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try { controller.enqueue(chunk); } catch { closed = true; }
      };

      const pushNewLines = async () => {
        const { lines, newOffset } = await readNewLines(jsonlPath, offset);
        offset = newOffset;
        for (const line of lines) {
          const entry = lineToTimelineEntry(line);
          if (entry) safeEnqueue(sseEncode(entry, 'timeline'));
        }
      };

      // 1. initial backfill — everything on disk already
      await pushNewLines();

      // 2. live source: win32 → polling, everything else → fs.watch
      // (fs.watch on Windows is unreliable beyond simple cases — polling is safer.)
      let watcher: FSWatcher | undefined;
      let pollTimer: ReturnType<typeof setInterval> | undefined;

      if (os.platform() === 'win32') {
        pollTimer = setInterval(() => { void pushNewLines(); }, 1000);
      } else {
        try {
          watcher = fsWatch(jsonlPath, { persistent: false }, (eventType) => {
            if (eventType === 'change' || eventType === 'rename') void pushNewLines();
          });
          watcher.on('error', () => { /* ignore — teardown via abort */ });
        } catch {
          // some exotic filesystems don't support fs.watch — fall back to polling
          pollTimer = setInterval(() => { void pushNewLines(); }, 1000);
        }
      }

      // 3. heartbeat — keep proxies from closing idle connections
      const heartbeat = setInterval(() => safeEnqueue(sseComment('ping')), 15_000);

      // 4. teardown on client disconnect
      const cleanup = () => {
        closed = true;
        clearInterval(heartbeat);
        if (pollTimer) clearInterval(pollTimer);
        if (watcher) { try { watcher.close(); } catch { /* ignore */ } }
        try { controller.close(); } catch { /* already closed */ }
      };

      if (request.signal.aborted) { cleanup(); return; }
      request.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
