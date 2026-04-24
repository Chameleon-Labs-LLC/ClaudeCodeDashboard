/**
 * task-tracker — CRUD surface for `ops_tasks` backed by better-sqlite3.
 *
 * All functions are synchronous. `claimPending` uses a WHERE-guarded UPDATE
 * as an atomicity fence — SQLite serialises writes so `changes === 0` is
 * definitive when another runner has already claimed the row.
 */

import { getDb } from './db';
import type { CreateTaskInput, OpsTask } from '@/types/mission-control';

export type { OpsTask, CreateTaskInput };

function boolToInt(v: boolean | number | undefined, fallback = 0): number {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'number') return v ? 1 : 0;
  return v ? 1 : 0;
}

export function createTask(input: CreateTaskInput): OpsTask {
  const now = new Date().toISOString();
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO ops_tasks
        (title, description, status, priority, assigned_skill, model,
         execution_mode, scheduled_for, requires_approval, risk_level,
         dry_run, quadrant, consecutive_failures, created_at)
       VALUES
        (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(
      input.title,
      input.description ?? null,
      input.priority ?? 0,
      input.assigned_skill ?? null,
      input.model ?? null,
      input.execution_mode ?? 'stream',
      input.scheduled_for ?? null,
      boolToInt(input.requires_approval),
      input.risk_level ?? null,
      boolToInt(input.dry_run),
      input.quadrant ?? null,
      now,
    );
  const task = getTask(Number(result.lastInsertRowid));
  if (!task) throw new Error('createTask: row not found after insert');
  return task;
}

export function getTask(id: number): OpsTask | null {
  const row = getDb().prepare(`SELECT * FROM ops_tasks WHERE id = ?`).get(id);
  return (row ?? null) as OpsTask | null;
}

export function claimPending(taskId: number): OpsTask | null {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `UPDATE ops_tasks
       SET status='running', started_at=?
       WHERE id=? AND status='pending'`,
    )
    .run(now, taskId);
  if (result.changes === 0) return null;
  return getTask(taskId);
}

const UPDATABLE_COLS: (keyof OpsTask)[] = [
  'title', 'description', 'status', 'priority', 'assigned_skill', 'model',
  'execution_mode', 'scheduled_for', 'requires_approval', 'risk_level',
  'dry_run', 'quadrant', 'approved_at', 'session_id', 'started_at',
  'completed_at', 'duration_ms', 'cost_usd', 'output_summary',
  'error_message', 'consecutive_failures',
];

export function updateTask(id: number, fields: Partial<OpsTask>): void {
  const entries = Object.entries(fields).filter(([k]) =>
    (UPDATABLE_COLS as string[]).includes(k),
  );
  if (entries.length === 0) return;
  const sets = entries.map(([k]) => `${k}=?`).join(', ');
  const values = entries.map(([, v]) => v ?? null);
  getDb()
    .prepare(`UPDATE ops_tasks SET ${sets} WHERE id=?`)
    .run(...values, id);
}

export function completeTask(
  id: number,
  outputSummary: string,
  durationMs: number,
  costUsd?: number,
): void {
  getDb()
    .prepare(
      `UPDATE ops_tasks
       SET status='done',
           output_summary=?,
           duration_ms=?,
           cost_usd=COALESCE(?, cost_usd),
           completed_at=?,
           consecutive_failures=0
       WHERE id=?`,
    )
    .run(outputSummary, durationMs, costUsd ?? null, new Date().toISOString(), id);
}

export function failTask(id: number, errorMessage: string, durationMs?: number): void {
  getDb()
    .prepare(
      `UPDATE ops_tasks
       SET status='failed',
           error_message=?,
           completed_at=?,
           duration_ms=COALESCE(?, duration_ms),
           consecutive_failures=consecutive_failures+1
       WHERE id=?`,
    )
    .run(errorMessage, new Date().toISOString(), durationMs ?? null, id);
}

export function listTasks(
  filters: { status?: string; quadrant?: string } = {},
): OpsTask[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filters.status) { where.push('status=?'); args.push(filters.status); }
  if (filters.quadrant) { where.push('quadrant=?'); args.push(filters.quadrant); }
  const sql =
    `SELECT * FROM ops_tasks` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY priority DESC, created_at ASC`;
  return getDb().prepare(sql).all(...args) as OpsTask[];
}

export function deleteTask(id: number): void {
  getDb().prepare(`DELETE FROM ops_tasks WHERE id=?`).run(id);
}
