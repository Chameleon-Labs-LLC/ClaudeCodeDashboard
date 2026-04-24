import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// Next.js 16 dynamic-route params is a Promise — must be awaited.
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  const result = getDb().prepare(`UPDATE ops_inbox SET read=1 WHERE id=?`).run(id);
  if (result.changes === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ read: true, id });
}
