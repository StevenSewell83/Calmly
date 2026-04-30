import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { FocusSource, InboxSource, TaskStatus } from "@calmly/shared";
import { enqueueOp } from "../sync/queue";

// CL-09 focus mode store.
//
// focus_sessions is local-only — see migration 0008 for rationale.
// Side effects that DO sync (task.status flip on markDone) flow
// through the regular tasks-upsert path with a full-row snapshot so
// the server's EXCLUDED-based ON CONFLICT can't null out unrelated
// columns.
//
// Invariant: at most one open session per user. Every startFocus /
// switchFocus auto-ends the prior open session in the same tx.

export interface FocusSessionRow {
  id: string;
  user_id: string;
  task_id: string;
  started_at: number;
  ended_at: number | null;
  source: FocusSource;
}

const SCHEDULABLE_STATUSES: readonly TaskStatus[] = ["open", "in_progress"];

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

// Returns the currently-open focus session for the user, or null.
export function currentFocus(
  db: Database.Database,
  userId: string,
): FocusSessionRow | null {
  const row = db
    .prepare(
      `SELECT id, user_id, task_id, started_at, ended_at, source
         FROM focus_sessions
        WHERE user_id = ? AND ended_at IS NULL
        ORDER BY started_at DESC
        LIMIT 1`,
    )
    .get(userId) as FocusSessionRow | undefined;
  return row ?? null;
}

// Closes any open session for the user. Internal helper used by
// startFocus / switchFocus / endFocus / markDone. Never throws.
function endOpenSessions(
  db: Database.Database,
  userId: string,
  now: number,
): void {
  db.prepare(
    `UPDATE focus_sessions
        SET ended_at = ?
      WHERE user_id = ? AND ended_at IS NULL`,
  ).run(now, userId);
}

export type StartFocusResult =
  | { ok: true; sessionId: string }
  | {
      ok: false;
      error: "NotFound" | "InvalidArgs" | "InternalError";
    };

// Starts a focus session on `taskId`. Auto-ends any prior open
// session in the same tx so the one-open-at-a-time invariant holds
// even across racey IPC calls.
export function startFocus(
  db: Database.Database,
  userId: string,
  taskId: string,
  source: FocusSource,
  now: number,
): StartFocusResult {
  if (source !== "scheduled" && source !== "ad-hoc") {
    return { ok: false, error: "InvalidArgs" };
  }
  const sessionId = randomUUID();
  let found = false;
  try {
    const tx = db.transaction(() => {
      const task = loadTask(db, userId, taskId);
      if (!task) return;
      if (!SCHEDULABLE_STATUSES.includes(task.status)) {
        // Done/dropped/snoozed tasks aren't valid focus targets.
        return;
      }
      endOpenSessions(db, userId, now);
      db.prepare(
        `INSERT INTO focus_sessions
           (id, user_id, task_id, started_at, ended_at, source)
         VALUES (?, ?, ?, ?, NULL, ?)`,
      ).run(sessionId, userId, taskId, now, source);
      found = true;
    });
    tx();
    return found
      ? { ok: true, sessionId }
      : { ok: false, error: "NotFound" };
  } catch {
    return { ok: false, error: "InternalError" };
  }
}

export type EndFocusResult =
  | { ok: true; ended: boolean }
  | { ok: false; error: "InternalError" };

// Closes the user's open session (if any). Idempotent — `ended:false`
// when there was nothing to close.
export function endFocus(
  db: Database.Database,
  userId: string,
  now: number,
): EndFocusResult {
  try {
    const open = currentFocus(db, userId);
    if (!open) return { ok: true, ended: false };
    endOpenSessions(db, userId, now);
    return { ok: true, ended: true };
  } catch {
    return { ok: false, error: "InternalError" };
  }
}

export type MarkDoneResult =
  | { ok: true; taskId: string }
  | {
      ok: false;
      error: "NoActiveSession" | "NotFound" | "InternalError";
    };

// Marks the task of the open session as done AND ends the session,
// atomically. Bumps task version and enqueues a full-snapshot upsert
// so other clients see the status change.
export function markDoneFromFocus(
  db: Database.Database,
  userId: string,
  now: number,
): MarkDoneResult {
  // Use a plain let with reassignment + read-back on a typed const
  // dance because TS narrows the variable inside the transaction
  // closure to its initial value.
  let resolvedTaskId: string | null = null;
  let taskMissing = false;
  try {
    const tx = db.transaction(() => {
      const open = currentFocus(db, userId);
      if (!open) return;
      const task = loadTask(db, userId, open.task_id);
      if (!task) {
        taskMissing = true;
        return;
      }
      const nextVersion = task.version + 1;
      db.prepare(
        `UPDATE tasks
            SET status = 'done', updated_at = ?, version = ?
          WHERE id = ? AND user_id = ?`,
      ).run(now, nextVersion, open.task_id, userId);
      enqueueTaskUpsert(
        db,
        open.task_id,
        task,
        { status: "done" },
        now,
        nextVersion,
      );
      endOpenSessions(db, userId, now);
      resolvedTaskId = open.task_id;
    });
    tx();
  } catch {
    return { ok: false, error: "InternalError" };
  }
  if (resolvedTaskId !== null) {
    return { ok: true, taskId: resolvedTaskId };
  }
  if (taskMissing) return { ok: false, error: "NotFound" };
  return { ok: false, error: "NoActiveSession" };
}

export type SwitchFocusResult =
  | { ok: true; sessionId: string }
  | {
      ok: false;
      error: "NotFound" | "InvalidArgs" | "InternalError";
    };

// End-current-and-start-new in one transaction. Renderer never sees
// the brief 'no session' state between the two writes.
export function switchFocus(
  db: Database.Database,
  userId: string,
  newTaskId: string,
  source: FocusSource,
  now: number,
): SwitchFocusResult {
  if (source !== "scheduled" && source !== "ad-hoc") {
    return { ok: false, error: "InvalidArgs" };
  }
  const sessionId = randomUUID();
  let found = false;
  try {
    const tx = db.transaction(() => {
      const task = loadTask(db, userId, newTaskId);
      if (!task) return;
      if (!SCHEDULABLE_STATUSES.includes(task.status)) return;
      endOpenSessions(db, userId, now);
      db.prepare(
        `INSERT INTO focus_sessions
           (id, user_id, task_id, started_at, ended_at, source)
         VALUES (?, ?, ?, ?, NULL, ?)`,
      ).run(sessionId, userId, newTaskId, now, source);
      found = true;
    });
    tx();
    return found
      ? { ok: true, sessionId }
      : { ok: false, error: "NotFound" };
  } catch {
    return { ok: false, error: "InternalError" };
  }
}
