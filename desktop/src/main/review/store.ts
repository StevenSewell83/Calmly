import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { ReviewTaskRow } from "../wireTypes";
import { localDayWindow } from "../today/store";
import { loadTask, enqueueTaskUpsert } from "../tasks/repo";

// CL-13 Review / Daily Shutdown store.
//
// summary()          — completed + unfinished tasks for today
// carryForward()     — moves unfinished task(s) due_at to tomorrow
// drop()             — drops task(s) to status='dropped'
// markDone()         — marks task(s) done
// moveTo()           — sets due_at to a specific future day
// saveReflection()   — upserts daily_reflections row for today
// completeShutdown() — writes last_shutdown_date into settings_json

// Re-export the canonical wire row from ../wireTypes. Note:
// wireTypes tightens `status` to TaskStatus (was `string` here);
// the SELECT below only fetches rows whose status comes from the
// shared union, so the narrowing is safe at runtime.
export type { ReviewTaskRow };

const TASK_COLS =
  "id, title, notes, status, due_at, scheduled_start, scheduled_end, source, created_at, updated_at, version, type, parent_task_id";

const DAY_MS = 24 * 60 * 60 * 1000;

function todayLocalStr(now: number, tzOffsetMinutes: number): string {
  const local = new Date(now - tzOffsetMinutes * 60 * 1000);
  // Date relative to UTC epoch shifted, so use UTC getters
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export interface ReviewSummary {
  completed: ReviewTaskRow[];
  unfinished: ReviewTaskRow[];
  focusedMs: number;
  dateStr: string;
}

export function getReviewSummary(
  db: Database.Database,
  userId: string,
  now: number,
  tz: number,
): ReviewSummary {
  const { start, endExclusive } = localDayWindow(now, tz);

  const completed = db
    .prepare(
      `SELECT ${TASK_COLS} FROM tasks
        WHERE user_id = ? AND deleted_at IS NULL
          AND status = 'done'
          AND updated_at >= ? AND updated_at < ?
        ORDER BY updated_at DESC`,
    )
    .all(userId, start, endExclusive) as ReviewTaskRow[];

  const unfinished = db
    .prepare(
      `SELECT ${TASK_COLS} FROM tasks
        WHERE user_id = ? AND deleted_at IS NULL
          AND status IN ('open', 'in_progress')
          AND (
            (due_at >= ? AND due_at < ?)
            OR (scheduled_start >= ? AND scheduled_start < ?)
          )
        ORDER BY COALESCE(scheduled_start, due_at) ASC`,
    )
    .all(userId, start, endExclusive, start, endExclusive) as ReviewTaskRow[];

  const focusRow = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN ended_at IS NOT NULL THEN ended_at - started_at ELSE ? - started_at END), 0) AS total
         FROM focus_sessions
        WHERE user_id = ? AND started_at >= ? AND started_at < ?`,
    )
    .get(now, userId, start, endExclusive) as { total: number };

  return {
    completed,
    unfinished,
    focusedMs: focusRow.total,
    dateStr: todayLocalStr(now, tz),
  };
}

export type CarryForwardResult =
  | { ok: true; count: number }
  | { ok: false; error: "NotFound" | "InvalidArgs" | "InternalError" };

export function carryForward(
  db: Database.Database,
  userId: string,
  taskIds: string[],
  now: number,
): CarryForwardResult {
  if (!taskIds.length) return { ok: false, error: "InvalidArgs" };
  const tomorrowMidnight = (() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime() + DAY_MS + 12 * 60 * 60 * 1000;
  })();

  const tx = db.transaction(() => {
    let count = 0;
    for (const taskId of taskIds) {
      const row = loadTask(db, userId, taskId);
      if (!row) continue;
      const next = row.version + 1;
      db.prepare(
        `UPDATE tasks SET due_at = ?, scheduled_start = NULL, scheduled_end = NULL,
                          updated_at = ?, version = ?
          WHERE id = ? AND user_id = ?`,
      ).run(tomorrowMidnight, now, next, taskId, userId);
      enqueueTaskUpsert(db, taskId, row, { due_at: tomorrowMidnight, scheduled_start: null, scheduled_end: null }, now, next);
      count++;
    }
    return count;
  });
  return { ok: true, count: tx() };
}

export type DropResult =
  | { ok: true; count: number }
  | { ok: false; error: "InvalidArgs" | "InternalError" };

export function dropTasks(
  db: Database.Database,
  userId: string,
  taskIds: string[],
  now: number,
): DropResult {
  if (!taskIds.length) return { ok: false, error: "InvalidArgs" };
  const tx = db.transaction(() => {
    let count = 0;
    for (const taskId of taskIds) {
      const row = loadTask(db, userId, taskId);
      if (!row) continue;
      const next = row.version + 1;
      db.prepare(
        `UPDATE tasks SET status = 'dropped', updated_at = ?, version = ?
          WHERE id = ? AND user_id = ?`,
      ).run(now, next, taskId, userId);
      enqueueTaskUpsert(db, taskId, row, { status: "dropped" as const }, now, next);
      count++;
    }
    return count;
  });
  return { ok: true, count: tx() };
}

export type MarkDoneResult =
  | { ok: true; count: number }
  | { ok: false; error: "InvalidArgs" | "InternalError" };

export function markDoneTasks(
  db: Database.Database,
  userId: string,
  taskIds: string[],
  now: number,
): MarkDoneResult {
  if (!taskIds.length) return { ok: false, error: "InvalidArgs" };
  const tx = db.transaction(() => {
    let count = 0;
    for (const taskId of taskIds) {
      const row = loadTask(db, userId, taskId);
      if (!row) continue;
      const next = row.version + 1;
      db.prepare(
        `UPDATE tasks SET status = 'done', updated_at = ?, version = ?
          WHERE id = ? AND user_id = ?`,
      ).run(now, next, taskId, userId);
      enqueueTaskUpsert(db, taskId, row, { status: "done" as const }, now, next);
      count++;
    }
    return count;
  });
  return { ok: true, count: tx() };
}

export type MoveToResult =
  | { ok: true }
  | { ok: false; error: "NotFound" | "InvalidArgs" | "InternalError" };

export function moveTaskTo(
  db: Database.Database,
  userId: string,
  taskId: string,
  targetDayMs: number,
  now: number,
): MoveToResult {
  const row = loadTask(db, userId, taskId);
  if (!row) return { ok: false, error: "NotFound" };
  const next = row.version + 1;
  db.prepare(
    `UPDATE tasks SET due_at = ?, scheduled_start = NULL, scheduled_end = NULL,
                      updated_at = ?, version = ?
      WHERE id = ? AND user_id = ?`,
  ).run(targetDayMs, now, next, taskId, userId);
  enqueueTaskUpsert(db, taskId, row, { due_at: targetDayMs, scheduled_start: null, scheduled_end: null }, now, next);
  return { ok: true };
}

export type SaveReflectionResult =
  | { ok: true }
  | { ok: false; error: "InternalError" };

export function saveReflection(
  db: Database.Database,
  userId: string,
  text: string,
  now: number,
  tz: number,
): SaveReflectionResult {
  const dateStr = todayLocalStr(now, tz);
  const id = randomUUID();
  db.prepare(
    `INSERT INTO daily_reflections (id, user_id, date, text, created_at, updated_at, version)
     VALUES (?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(user_id, date) DO UPDATE SET
       text = excluded.text, updated_at = excluded.updated_at, version = version + 1`,
  ).run(id, userId, dateStr, text, now, now);
  return { ok: true };
}

export type CompleteShutdownResult =
  | { ok: true }
  | { ok: false; error: "InternalError" };

export function completeShutdown(
  db: Database.Database,
  userId: string,
  text: string | null,
  now: number,
  tz: number,
): CompleteShutdownResult {
  const dateStr = todayLocalStr(now, tz);
  const tx = db.transaction(() => {
    if (text !== null && text.length > 0) {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO daily_reflections (id, user_id, date, text, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(user_id, date) DO UPDATE SET
           text = excluded.text, updated_at = excluded.updated_at, version = version + 1`,
      ).run(id, userId, dateStr, text, now, now);
    }
    const existing = db
      .prepare("SELECT settings_json FROM user_settings WHERE user_id = ?")
      .get(userId) as { settings_json: string } | undefined;
    const settings = existing ? (JSON.parse(existing.settings_json) as Record<string, unknown>) : {};
    settings.last_shutdown_date = dateStr;
    db.prepare(
      `UPDATE user_settings SET settings_json = ?, updated_at = ? WHERE user_id = ?`,
    ).run(JSON.stringify(settings), now, userId);
  });
  tx();
  return { ok: true };
}
