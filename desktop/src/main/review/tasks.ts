import type Database from "better-sqlite3";
import type { InboxSource, TaskStatus } from "@calmly/shared";
import { enqueueOp } from "../sync/queue";

// CL-13 bulk task mutations used by the Daily Shutdown ritual:
// carryForward / drop / moveToDate / markDone. Each mutation bumps
// version and enqueues a full-row sync upsert. The pattern mirrors
// plan/store.ts and focus/store.ts; calmly-3py.5 tracks the cross-
// store dedup of TaskRow + loadTask + enqueueTaskUpsert.

interface TaskRow {
  title: string;
  notes: string | null;
  status: TaskStatus;
  due_at: number | null;
  scheduled_start: number | null;
  scheduled_end: number | null;
  parent_task_id: string | null;
  source: InboxSource;
  created_at: number;
  type: string;
  version: number;
}

function loadTask(
  db: Database.Database,
  userId: string,
  taskId: string,
): TaskRow | undefined {
  return db
    .prepare(
      `SELECT title, notes, status, due_at, scheduled_start, scheduled_end,
              parent_task_id, source, created_at, type, version
         FROM tasks
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .get(taskId, userId) as TaskRow | undefined;
}

function enqueueTaskUpsert(
  db: Database.Database,
  taskId: string,
  row: TaskRow,
  override: Partial<TaskRow>,
  now: number,
  nextVersion: number,
): void {
  const merged = { ...row, ...override };
  enqueueOp(db, {
    table: "tasks",
    op: "upsert",
    payload: {
      id: taskId,
      title: merged.title,
      notes: merged.notes,
      type: merged.type,
      status: merged.status,
      due_at: merged.due_at,
      parent_task_id: merged.parent_task_id,
      source: merged.source,
      created_at: merged.created_at,
      updated_at: now,
      deleted_at: null,
      version: nextVersion,
      scheduled_start: merged.scheduled_start,
      scheduled_end: merged.scheduled_end,
    },
  });
}

export type BulkResult =
  | { ok: true; updated: number }
  | { ok: false; error: "InternalError" };

interface BulkOverrideFn {
  (row: TaskRow): {
    override: Partial<TaskRow>;
    updateSql: string;
    updateArgs: unknown[];
  };
}

function applyBulk(
  db: Database.Database,
  userId: string,
  taskIds: readonly string[],
  now: number,
  buildOverride: BulkOverrideFn,
): BulkResult {
  if (taskIds.length === 0) return { ok: true, updated: 0 };
  let updated = 0;
  try {
    const tx = db.transaction(() => {
      for (const taskId of taskIds) {
        const row = loadTask(db, userId, taskId);
        if (!row) continue;
        const nextVersion = row.version + 1;
        const { override, updateSql, updateArgs } = buildOverride(row);
        db.prepare(updateSql).run(
          ...updateArgs,
          now,
          nextVersion,
          taskId,
          userId,
        );
        enqueueTaskUpsert(db, taskId, row, override, now, nextVersion);
        updated++;
      }
    });
    tx();
    return { ok: true, updated };
  } catch {
    return { ok: false, error: "InternalError" };
  }
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const STATUS_DONE: TaskStatus = "done";
const STATUS_DROPPED: TaskStatus = "dropped";

// Pushes due_at forward 24h and clears the schedule pair so the task
// drops back to tomorrow's plan-view backlog.
export function carryForward(
  db: Database.Database,
  userId: string,
  taskIds: readonly string[],
  now: number,
): BulkResult {
  return applyBulk(db, userId, taskIds, now, (row) => {
    const nextDueAt = (row.due_at ?? now) + ONE_DAY_MS;
    return {
      override: {
        due_at: nextDueAt,
        scheduled_start: null,
        scheduled_end: null,
      },
      updateSql: `UPDATE tasks
                     SET due_at = ?, scheduled_start = NULL, scheduled_end = NULL,
                         updated_at = ?, version = ?
                   WHERE id = ? AND user_id = ?`,
      updateArgs: [nextDueAt],
    };
  });
}

// Marks tasks as 'dropped' — the user explicitly decided they're not
// happening. The schedule pair is left intact so the audit trail
// (when did we drop it, was it placed?) survives.
export function dropTasks(
  db: Database.Database,
  userId: string,
  taskIds: readonly string[],
  now: number,
): BulkResult {
  return applyBulk(db, userId, taskIds, now, () => ({
    override: { status: STATUS_DROPPED },
    updateSql: `UPDATE tasks
                   SET status = 'dropped', updated_at = ?, version = ?
                 WHERE id = ? AND user_id = ?`,
    updateArgs: [],
  }));
}

// Sets due_at to a specific instant + clears the schedule pair. The
// renderer-supplied dueAt is typically start-of-day in the user's tz.
export function moveToDate(
  db: Database.Database,
  userId: string,
  taskIds: readonly string[],
  dueAtMs: number,
  now: number,
): BulkResult {
  if (!Number.isFinite(dueAtMs) || dueAtMs < 0) {
    return { ok: false, error: "InternalError" };
  }
  return applyBulk(db, userId, taskIds, now, () => ({
    override: {
      due_at: dueAtMs,
      scheduled_start: null,
      scheduled_end: null,
    },
    updateSql: `UPDATE tasks
                   SET due_at = ?, scheduled_start = NULL, scheduled_end = NULL,
                       updated_at = ?, version = ?
                 WHERE id = ? AND user_id = ?`,
    updateArgs: [dueAtMs],
  }));
}

// Bulk version of focus.markDoneFromFocus minus the session linkage —
// the "I forgot to mark these earlier" affordance.
export function markTasksDone(
  db: Database.Database,
  userId: string,
  taskIds: readonly string[],
  now: number,
): BulkResult {
  return applyBulk(db, userId, taskIds, now, () => ({
    override: { status: STATUS_DONE },
    updateSql: `UPDATE tasks
                   SET status = 'done', updated_at = ?, version = ?
                 WHERE id = ? AND user_id = ?`,
    updateArgs: [],
  }));
}
