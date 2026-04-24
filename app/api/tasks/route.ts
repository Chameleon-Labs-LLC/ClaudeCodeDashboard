import { NextResponse } from 'next/server';
import { listTasks, createTask, getTask, updateTask, deleteTask } from '@/lib/task-tracker';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') ?? undefined;
  const quadrant = searchParams.get('quadrant') ?? undefined;
  return NextResponse.json(listTasks({ status, quadrant }));
}

export async function POST(request: Request) {
  const body = await request.json();
  if (!body?.title || typeof body.title !== 'string') {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  const task = createTask({
    title: body.title,
    description: body.description,
    priority: body.priority ?? 0,
    assigned_skill: body.assigned_skill,
    model: body.model,
    execution_mode: body.execution_mode ?? 'stream',
    scheduled_for: body.scheduled_for,
    requires_approval: body.requires_approval ?? false,
    risk_level: body.risk_level,
    dry_run: body.dry_run ?? false,
    quadrant: body.quadrant,
  });
  return NextResponse.json(task, { status: 201 });
}

export async function PATCH(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get('id') ?? '0', 10);
  if (!getTask(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  updateTask(id, await request.json());
  return NextResponse.json(getTask(id));
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get('id') ?? '0', 10);
  if (!getTask(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  deleteTask(id);
  return NextResponse.json({ deleted: id });
}
