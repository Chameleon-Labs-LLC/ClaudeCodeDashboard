import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getTask } from '@/lib/task-tracker';

// Next.js 16 dynamic-route params is a Promise — must be awaited.
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (task.status !== 'failed')
    return NextResponse.json({ error: 'Can only rerun failed tasks' }, { status: 400 });

  // consecutive_failures is deliberately preserved.
  getDb().prepare(`
    UPDATE ops_tasks SET
      status='pending',
      error_message=NULL,
      completed_at=NULL,
      started_at=NULL,
      duration_ms=NULL,
      output_summary=NULL,
      session_id=NULL
    WHERE id=?
  `).run(id);

  return NextResponse.json({ rerun: true, task_id: id });
}
