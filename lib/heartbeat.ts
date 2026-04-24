/**
 * heartbeat — schedule materialiser.
 *
 * `parseCronSimple` supports a 5-field cron expression `{minute} {hour} * * {dow}`
 * where `dow` is 0..6 with Mon=0, Sun=6. This matches Python's `dt.weekday()`
 * and the ScheduleComposer UI. DST-safe because it iterates wall-clock minutes
 * using `Date` arithmetic rather than UTC epoch offsets.
 *
 * `materializeSchedules` transforms due `ops_schedules` rows into pending
 * `ops_tasks` rows under a BEGIN EXCLUSIVE guard so two daemon processes
 * cannot double-materialise the same schedule window.
 */

import { getDb } from './db';
import { createTask } from './task-tracker';
import type { OpsSchedule } from '@/types/mission-control';

export function parseCronSimple(expr: string, from: Date): Date | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minStr, hourStr, , , dowStr] = parts;
  const minute = parseInt(minStr, 10);
  const hour = parseInt(hourStr, 10);
  const targetDow = parseInt(dowStr, 10); // Mon=0..Sun=6

  if (isNaN(minute) || isNaN(hour) || isNaN(targetDow)) return null;
  if (minute < 0 || minute > 59) return null;
  if (hour < 0 || hour > 23) return null;
  if (targetDow < 0 || targetDow > 6) return null;

  // JS getDay(): Sun=0, Mon=1..Sat=6. Convert to Mon=0..Sun=6:
  function jsDayToPython(jsDay: number): number {
    return jsDay === 0 ? 6 : jsDay - 1;
  }

  // Start from the next minute to avoid re-firing the same minute.
  const candidate = new Date(from.getTime() + 60_000);
  candidate.setSeconds(0, 0);

  for (let i = 0; i < 10_080; i++) { // scan up to 7 days of minutes
    if (
      candidate.getMinutes() === minute &&
      candidate.getHours() === hour &&
      jsDayToPython(candidate.getDay()) === targetDow
    ) {
      return new Date(candidate); // clone before returning
    }
    candidate.setTime(candidate.getTime() + 60_000);
  }
  return null;
}

export function materializeSchedules(): number {
  const db = getDb();
  const now = new Date();
  let created = 0;

  // .exclusive() maps to BEGIN EXCLUSIVE — prevents two daemon processes
  // from double-materialising the same schedule window.
  db.transaction(() => {
    const schedules = db
      .prepare(
        `SELECT * FROM ops_schedules
         WHERE enabled=1 AND (next_run_at IS NULL OR next_run_at <= ?)`,
      )
      .all(now.toISOString()) as OpsSchedule[];

    for (const sched of schedules) {
      createTask({
        title: sched.task_title,
        description: sched.task_description ?? undefined,
        assigned_skill: sched.assigned_skill ?? undefined,
      });
      created++;

      const next = sched.cron_expression
        ? parseCronSimple(sched.cron_expression, now)
        : null;

      db.prepare(
        `UPDATE ops_schedules SET last_run_at=?, next_run_at=? WHERE id=?`,
      ).run(now.toISOString(), next?.toISOString() ?? null, sched.id);
    }
  }).exclusive()();

  return created;
}
