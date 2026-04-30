import type Database from "better-sqlite3";
import type { InboxSource, TaskStatus } from "@calmly/shared";
import { enqueueOp } from "../sync/queue";

// Single source of truth for the task row snapshot shape and the two helpers
// (loadTask, enqueueTaskUpsert) that were previously duplicated across
// plan/store.ts and focus/store.ts.

export const SCHEDULABLE_STATUSES: readonly TaskStatus[] = ["open", "in_progress"];

export interface TaskRow {
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

export function loadTask(
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

// Enqueues a full-row upsert snapshot so the server's EXCLUDED-based
// ON CONFLICT can't null out unrelated columns during sync.
export function enqueueTaskUpsert(
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
