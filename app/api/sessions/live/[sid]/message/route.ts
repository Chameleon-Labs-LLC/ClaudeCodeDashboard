import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUEUE_DIR = path.join(process.cwd(), '.tmp', 'mission-control-queue');

// Next.js 16 dynamic-route params is a Promise — must be awaited.
export async function POST(request: Request, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  if (!UUID_RE.test(sid))
    return NextResponse.json({ error: 'Invalid session_id format' }, { status: 400 });
  const { message } = await request.json();
  if (typeof message !== 'string' || !message.trim())
    return NextResponse.json({ error: 'Empty message' }, { status: 400 });

  fs.mkdirSync(QUEUE_DIR, { recursive: true });
  const queueFile = path.join(QUEUE_DIR, `${sid}.jsonl`);
  fs.appendFileSync(queueFile, message + '\n', 'utf-8');
  return NextResponse.json({ queued: true });
}
