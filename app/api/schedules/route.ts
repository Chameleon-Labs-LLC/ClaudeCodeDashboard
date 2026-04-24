import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { parseCronSimple } from '@/lib/heartbeat';
import type { OpsSchedule } from '@/types/mission-control';

export async function GET() {
  const rows = getDb()
    .prepare(`SELECT * FROM ops_schedules ORDER BY created_at DESC`)
    .all() as OpsSchedule[];
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const body = await request.json();
  if (!body?.name || !body?.cron_expression || !body?.task_title) {
    return NextResponse.json(
      { error: 'name, cron_expression, and task_title are required' },
      { status: 400 },
    );
  }
  const now = new Date();
  const next = parseCronSimple(body.cron_expression, now);
  const result = getDb().prepare(`
    INSERT INTO ops_schedules
      (name, cron_expression, task_title, task_description, assigned_skill,
       enabled, next_run_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    body.name,
    body.cron_expression,
    body.task_title,
    body.task_description ?? null,
    body.assigned_skill ?? null,
    body.enabled === false ? 0 : 1,
    next?.toISOString() ?? null,
    now.toISOString(),
  );
  const row = getDb()
    .prepare(`SELECT * FROM ops_schedules WHERE id=?`)
    .get(Number(result.lastInsertRowid)) as OpsSchedule;
  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get('id') ?? '0', 10);
  const existing = getDb()
    .prepare(`SELECT * FROM ops_schedules WHERE id=?`)
    .get(id) as OpsSchedule | undefined;
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json();
  // If cron changed, recompute next_run_at.
  let nextRunAt: string | null | undefined = undefined;
  if (typeof body.cron_expression === 'string' && body.cron_expression !== existing.cron_expression) {
    const next = parseCronSimple(body.cron_expression, new Date());
    nextRunAt = next?.toISOString() ?? null;
  }

  getDb().prepare(`
    UPDATE ops_schedules SET
      name             = COALESCE(?, name),
      cron_expression  = COALESCE(?, cron_expression),
      task_title       = COALESCE(?, task_title),
      task_description = COALESCE(?, task_description),
      assigned_skill   = COALESCE(?, assigned_skill),
      enabled          = COALESCE(?, enabled),
      next_run_at      = COALESCE(?, next_run_at)
    WHERE id=?
  `).run(
    body.name ?? null,
    body.cron_expression ?? null,
    body.task_title ?? null,
    body.task_description ?? null,
    body.assigned_skill ?? null,
    typeof body.enabled === 'boolean' ? (body.enabled ? 1 : 0) : null,
    nextRunAt ?? null,
    id,
  );
  const row = getDb()
    .prepare(`SELECT * FROM ops_schedules WHERE id=?`)
    .get(id) as OpsSchedule;
  return NextResponse.json(row);
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get('id') ?? '0', 10);
  const result = getDb().prepare(`DELETE FROM ops_schedules WHERE id=?`).run(id);
  if (result.changes === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ deleted: id });
}
