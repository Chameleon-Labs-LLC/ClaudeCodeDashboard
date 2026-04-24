import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { OpsDecision } from '@/types/mission-control';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const where = status ? 'WHERE status=?' : '';
  const args = status ? [status] : [];
  const rows = getDb()
    .prepare(`SELECT * FROM ops_decisions ${where} ORDER BY created_at DESC`)
    .all(...args) as OpsDecision[];
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const body = await request.json();
  if (!body?.prompt || typeof body.prompt !== 'string') {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  }
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT OR IGNORE INTO ops_decisions(task_id, session_id, prompt, status, created_at)
    VALUES(?,?,?,'pending',?)
  `).run(body.task_id ?? null, body.session_id ?? null, body.prompt, now);

  if (result.changes === 0) {
    // Deduplicated — return existing row.
    const existing = db.prepare(
      `SELECT * FROM ops_decisions WHERE session_id=? AND prompt=?`,
    ).get(body.session_id, body.prompt);
    return NextResponse.json({ ...(existing as object), created: false });
  }
  const row = db.prepare(`SELECT * FROM ops_decisions WHERE id=?`)
    .get(Number(result.lastInsertRowid));
  return NextResponse.json({ ...(row as object), created: true }, { status: 201 });
}
