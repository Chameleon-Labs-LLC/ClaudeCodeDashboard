import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getTask } from '@/lib/task-tracker';

// Next.js 16 dynamic-route params is a Promise — must be awaited.
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (task.status !== 'awaiting_approval')
    return NextResponse.json({ error: 'Not awaiting approval' }, { status: 400 });
  getDb()
    .prepare(`UPDATE ops_tasks SET status='pending', approved_at=? WHERE id=?`)
    .run(new Date().toISOString(), id);
  return NextResponse.json({ approved: true });
}
