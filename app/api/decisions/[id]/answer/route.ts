import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// Next.js 16 dynamic-route params is a Promise — must be awaited.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  const body = await request.json();
  if (typeof body?.answer !== 'string') {
    return NextResponse.json({ error: 'answer is required' }, { status: 400 });
  }
  const result = getDb().prepare(`
    UPDATE ops_decisions SET answer=?, status='answered', answered_at=?
    WHERE id=? AND status='pending'
  `).run(body.answer, new Date().toISOString(), id);
  if (result.changes === 0) {
    return NextResponse.json({ error: 'Not found or already answered' }, { status: 404 });
  }
  return NextResponse.json({ answered: true, id });
}
