import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDb } from '@/lib/db';
import type { OpsInboxItem } from '@/types/mission-control';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUEUE_DIR = path.join(process.cwd(), '.tmp', 'mission-control-queue');

// Next.js 16 dynamic-route params is a Promise — must be awaited.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  const body = await request.json();
  if (typeof body?.body !== 'string' || !body.body.trim()) {
    return NextResponse.json({ error: 'body is required' }, { status: 400 });
  }

  const original = getDb()
    .prepare(`SELECT * FROM ops_inbox WHERE id=?`)
    .get(id) as OpsInboxItem | undefined;
  if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Path-traversal guard: only trust session IDs that match the UUID format.
  if (original.session_id && !UUID_RE.test(original.session_id)) {
    return NextResponse.json({ error: 'Invalid session_id' }, { status: 400 });
  }

  // Record reply as a new inbox row (direction=user_to_agent).
  getDb().prepare(`
    INSERT INTO ops_inbox (task_id, session_id, direction, body, read, created_at)
    VALUES (?, ?, 'user_to_agent', ?, 1, ?)
  `).run(
    original.task_id,
    original.session_id,
    body.body,
    new Date().toISOString(),
  );

  // Append to the queue file so the dispatcher can inject the line into stdin.
  if (original.session_id) {
    fs.mkdirSync(QUEUE_DIR, { recursive: true });
    const queueFile = path.join(QUEUE_DIR, `${original.session_id}.jsonl`);
    fs.appendFileSync(queueFile, body.body + '\n', 'utf-8');
  }

  return NextResponse.json({ queued: true });
}
