import type Database from "better-sqlite3";
import type { PlanTaskRow } from "../wireTypes";
import { localDayWindow } from "../today/store";
import {
  SCHEDULABLE_STATUSES,
  type TaskRow,
  loadTask,
  enqueueTaskUpsert,
} from "../tasks/repo";

// CL-06 plan-view reads + writes.
//
// listForDay returns the day's two columns in one IPC: scheduled
// (open|in_progress tasks with scheduled_start in the local-day
// window) and backlog (open|in_progress tasks with due_at in the day
// window AND no scheduled_start). schedule + unschedule mutate the
// pair as a unit and enqueue full-snapshot upserts so the server's
// EXCLUDED-based ON CONFLICT can't null out unrelated columns.

// Re-export the canonical wire row from ../wireTypes so existing
// callers and IPC handlers keep their import paths after
// REFACTOR-AUDIT-2b. The previous inline definition referenced
// InboxSource without importing it; routing through wireTypes also
// fixes that latent typecheck issue.
export type { PlanTaskRow };

export interface PlanForDay {
  scheduled: PlanTaskRow[];
  backlog: PlanTaskRow[];
}

const TASK_COLS =
  "id, title, notes, status, due_at, scheduled_start, scheduled_end, source, created_at, updated_at, version, type, parent_task_id";

// Returns the day's scheduled blocks AND the backlog of unplaced
// tasks that target the same day. Both lists exclude done/dropped/
// snoozed and soft-deleted rows.
export function listForDay(
  db: Database.Database,
  userId: string,
  now: number,
  tzOffsetMinutes: number,
): PlanForDay {
  const { start, endExclusive } = localDayWindow(now, tzOffsetMinutes);

  const scheduled = db
    .prepare(
      `SELECT ${TASK_COLS}
         FROM tasks
        WHERE user_id = ?
          AND deleted_at IS NULL
          AND status IN ('open', 'in_progress')
          AND scheduled_start IS NOT NULL
          AND scheduled_start >= ? AND scheduled_start < ?
        ORDER BY scheduled_start ASC`,
    )
    .all(userId, start, endExclusive) as PlanTaskRow[];

  const backlog = db
    .prepare(
      `SELECT ${TASK_COLS}
         FROM tasks
        WHERE user_id = ?
          AND deleted_at IS NULL
          AND status IN ('open', 'in_progress')
          AND scheduled_start IS NULL
          AND due_at IS NOT NULL
          AND due_at >= ? AND due_at < ?
        ORDER BY COALESCE(due_at, updated_at) ASC`,
    )
    .all(userId, start, endExclusive) as PlanTaskRow[];

  return { scheduled, backlog };
}

export type ScheduleResult =
  | { ok: true }
  | {
      ok: false;
      error: "NotFound" | "InvalidArgs" | "InternalError";
    };

// Places a task on the day grid (or moves an already-placed one).
// startMs/endMs are unix-ms; end must be >= start. Status must be
// schedulable (open|in_progress). Atomic: UPDATE + sync upsert in one
// tx.
export function scheduleTask(
  db: Database.Database,
  userId: string,
  taskId: string,
  startMs: number,
  endMs: number,
  now: number,
): ScheduleResult {
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs < startMs
  ) {
    return { ok: false, error: "InvalidArgs" };
  }
  try {
    let found = false;
    const tx = db.transaction(() => {
      const row = loadTask(db, userId, taskId);
      if (!row) return;
      if (!SCHEDULABLE_STATUSES.includes(row.status)) {
        // Out-of-band guard — the renderer should never offer scheduling
        // for done/dropped tasks, but a stale render could try.
        return;
      }
      const nextVersion = row.version + 1;
      db.prepare(
        `UPDATE tasks
            SET scheduled_start = ?, scheduled_end = ?, updated_at = ?, version = ?
          WHERE id = ? AND user_id = ?`,
      ).run(startMs, endMs, now, nextVersion, taskId, userId);
      enqueueTaskUpsert(
        db,
        taskId,
        row,
        { scheduled_start: startMs, scheduled_end: endMs },
        now,
        nextVersion,
      );
      found = true;
    });
    tx();
    return found ? { ok: true } : { ok: false, error: "NotFound" };
  } catch {
    return { ok: false, error: "InternalError" };
  }
}

export type UpdateTaskResult =
  | { ok: true }
  | { ok: false; error: "NotFound" | "InvalidArgs" | "InternalError" };

export interface UpdateTaskArgs {
  title?: string;
  notes?: string | null;
  dueAt?: number | null;
  scheduledStart?: number | null;
  scheduledEnd?: number | null;
}

// Patches mutable task fields from the TaskSidePanel. Clears schedule
// pair atomically when scheduledStart is explicitly set to null.
export function updateTask(
  db: Database.Database,
  userId: string,
  taskId: string,
  args: UpdateTaskArgs,
  now: number,
): UpdateTaskResult {
  if (args.title !== undefined && (typeof args.title !== "string" || args.title.trim() === "")) {
    return { ok: false, error: "InvalidArgs" };
  }
  try {
    let found = false;
    const tx = db.transaction(() => {
      const row = loadTask(db, userId, taskId);
      if (!row) return;
      const nextVersion = row.version + 1;
      const title = args.title ?? row.title;
      const notes = args.notes !== undefined ? args.notes : row.notes;
      const dueAt = args.dueAt !== undefined ? args.dueAt : row.due_at;
      // Clearing scheduledStart also clears scheduledEnd.
      const scheduledStart = args.scheduledStart !== undefined ? args.scheduledStart : row.scheduled_start;
      const scheduledEnd =
        args.scheduledStart === null
          ? null
          : args.scheduledEnd !== undefined
            ? args.scheduledEnd
            : row.scheduled_end;
      db.prepare(
        `UPDATE tasks
            SET title = ?, notes = ?, due_at = ?,
                scheduled_start = ?, scheduled_end = ?,
                updated_at = ?, version = ?
          WHERE id = ? AND user_id = ?`,
      ).run(title, notes, dueAt, scheduledStart, scheduledEnd, now, nextVersion, taskId, userId);
      enqueueTaskUpsert(
        db, taskId, row,
        { title, notes, due_at: dueAt, scheduled_start: scheduledStart, scheduled_end: scheduledEnd },
        now, nextVersion,
      );
      found = true;
    });
    tx();
    return found ? { ok: true } : { ok: false, error: "NotFound" };
  } catch {
    return { ok: false, error: "InternalError" };
  }
}

export type MoveToDateResult =
  | { ok: true }
  | { ok: false; error: "NotFound" | "InvalidArgs" | "InternalError" };

// Moves a task to a different calendar day. Preserves the time-of-day
// for scheduled_start/end; shifts due_at to the same target day.
export function moveToDate(
  db: Database.Database,
  userId: string,
  taskId: string,
  targetDayMs: number,
  now: number,
): MoveToDateResult {
  if (!Number.isFinite(targetDayMs)) return { ok: false, error: "InvalidArgs" };
  try {
    let found = false;
    const tx = db.transaction(() => {
      const row = loadTask(db, userId, taskId);
      if (!row) return;
      const target = new Date(targetDayMs);
      const applyDay = (ms: number | null): number | null => {
        if (ms === null) return null;
        const d = new Date(ms);
        d.setFullYear(target.getFullYear(), target.getMonth(), target.getDate());
        return d.getTime();
      };
      const nextVersion = row.version + 1;
      const dueAt = row.due_at !== null ? applyDay(targetDayMs) : null;
      const scheduledStart = applyDay(row.scheduled_start);
      const scheduledEnd = applyDay(row.scheduled_end);
      db.prepare(
        `UPDATE tasks SET due_at=?, scheduled_start=?, scheduled_end=?, updated_at=?, version=? WHERE id=? AND user_id=?`,
      ).run(dueAt, scheduledStart, scheduledEnd, now, nextVersion, taskId, userId);
      enqueueTaskUpsert(db, taskId, row, { due_at: dueAt, scheduled_start: scheduledStart, scheduled_end: scheduledEnd }, now, nextVersion);
      found = true;
    });
    tx();
    return found ? { ok: true } : { ok: false, error: "NotFound" };
  } catch {
    return { ok: false, error: "InternalError" };
  }
}

export type PushByResult =
  | { ok: true }
  | { ok: false; error: "NotFound" | "InvalidArgs" | "InternalError" };

// Shifts a placed task's scheduled_start/end forward by offsetMs.
export function pushBy(
  db: Database.Database,
  userId: string,
  taskId: string,
  offsetMs: number,
  now: number,
): PushByResult {
  if (!Number.isFinite(offsetMs) || offsetMs <= 0) return { ok: false, error: "InvalidArgs" };
  try {
    let found = false;
    const tx = db.transaction(() => {
      const row = loadTask(db, userId, taskId);
      if (!row || row.scheduled_start === null) return;
      const nextVersion = row.version + 1;
      const scheduledStart = row.scheduled_start + offsetMs;
      const scheduledEnd = row.scheduled_end !== null ? row.scheduled_end + offsetMs : null;
      db.prepare(
        `UPDATE tasks SET scheduled_start=?, scheduled_end=?, updated_at=?, version=? WHERE id=? AND user_id=?`,
      ).run(scheduledStart, scheduledEnd, now, nextVersion, taskId, userId);
      enqueueTaskUpsert(db, taskId, row, { scheduled_start: scheduledStart, scheduled_end: scheduledEnd }, now, nextVersion);
      found = true;
    });
    tx();
    return found ? { ok: true } : { ok: false, error: "NotFound" };
  } catch {
    return { ok: false, error: "InternalError" };
  }
}

export type DropFromTodayResult =
  | { ok: true }
  | { ok: false; error: "NotFound" | "InternalError" };

// Removes the task from today's plan view by clearing due_at + scheduled pair.
export function dropFromToday(
  db: Database.Database,
  userId: string,
  taskId: string,
  now: number,
): DropFromTodayResult {
  try {
    let found = false;
    const tx = db.transaction(() => {
      const row = loadTask(db, userId, taskId);
      if (!row) return;
      const nextVersion = row.version + 1;
      db.prepare(
        `UPDATE tasks SET due_at=NULL, scheduled_start=NULL, scheduled_end=NULL, updated_at=?, version=? WHERE id=? AND user_id=?`,
      ).run(now, nextVersion, taskId, userId);
      enqueueTaskUpsert(db, taskId, row, { due_at: null, scheduled_start: null, scheduled_end: null }, now, nextVersion);
      found = true;
    });
    tx();
    return found ? { ok: true } : { ok: false, error: "NotFound" };
  } catch {
    return { ok: false, error: "InternalError" };
  }
}

export type UnscheduleResult =
  | { ok: true }
  | { ok: false; error: "NotFound" | "InvalidArgs" | "InternalError" };

// Returns a placed task to the backlog (clears scheduled_start/end
// pair). Idempotent — clearing an already-cleared task succeeds and
// still bumps version so other clients converge.
export function unscheduleTask(
  db: Database.Database,
  userId: string,
  taskId: string,
  now: number,
): UnscheduleResult {
  try {
    let found = false;
    const tx = db.transaction(() => {
      const row = loadTask(db, userId, taskId);
      if (!row) return;
      const nextVersion = row.version + 1;
      db.prepare(
        `UPDATE tasks
            SET scheduled_start = NULL, scheduled_end = NULL,
                updated_at = ?, version = ?
          WHERE id = ? AND user_id = ?`,
      ).run(now, nextVersion, taskId, userId);
      enqueueTaskUpsert(
        db,
        taskId,
        row,
        { scheduled_start: null, scheduled_end: null },
        now,
        nextVersion,
      );
      found = true;
    });
    tx();
    return found ? { ok: true } : { ok: false, error: "NotFound" };
  } catch {
    return { ok: false, error: "InternalError" };
  }
}
