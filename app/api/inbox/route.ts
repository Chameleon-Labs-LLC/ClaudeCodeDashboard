import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { OpsInboxItem } from '@/types/mission-control';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const unread = searchParams.get('unread') === '1';
  const maxAgeDays = parseInt(searchParams.get('max_age_days') ?? '30', 10);
  const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();

  const where = [`direction='agent_to_user'`, `created_at >= ?`];
  const args: unknown[] = [cutoff];
  if (unread) where.push('read=0');

  const rows = getDb()
    .prepare(
      `SELECT * FROM ops_inbox WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 200`,
    )
    .all(...args) as OpsInboxItem[];
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const body = await request.json();
  if (!body?.body || typeof body.body !== 'string') {
    return NextResponse.json({ error: 'body is required' }, { status: 400 });
  }
  const direction = body.direction === 'user_to_agent' ? 'user_to_agent' : 'agent_to_user';
  const result = getDb().prepare(`
    INSERT INTO ops_inbox (task_id, session_id, direction, body, read, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(
    body.task_id ?? null,
    body.session_id ?? null,
    direction,
    body.body,
    new Date().toISOString(),
  );
  const row = getDb()
    .prepare(`SELECT * FROM ops_inbox WHERE id=?`)
    .get(Number(result.lastInsertRowid));
  return NextResponse.json(row, { status: 201 });
}
