import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { ReminderImportance } from "@calmly/shared";
import { MIN_REMINDER_INTERVAL_SECONDS, reminderImportances } from "@calmly/shared";
import { enqueueOp } from "../sync/queue";

// One reminder rule per task in v1 (per-task editor — RM-01). Profile
// defaults that fan out across many tasks live in RM-02. Ownership
// flows through tasks.user_id; the table itself has no user_id column.

// Re-exported under the historical name — the shared constant lives in
// @calmly/shared so the renderer (RM-01b/RM-07) can read the same floor
// without pulling in main's better-sqlite3 module graph.
export const MIN_INTERVAL_SECONDS = MIN_REMINDER_INTERVAL_SECONDS;

export interface ReminderRuleRow {
  id: string;
  task_id: string;
  importance: ReminderImportance;
  interval_seconds: number;
  escalation_json: string;
  active: 0 | 1;
  version: number;
}

interface DbRule {
  id: string;
  task_id: string;
  importance: string;
  interval_seconds: number;
  escalation_json: string;
  active: number;
  version: number;
}

function isImportance(v: unknown): v is ReminderImportance {
  return typeof v === "string" && (reminderImportances as readonly string[]).includes(v);
}

function rowFromDb(row: DbRule): ReminderRuleRow {
  return {
    id: row.id,
    task_id: row.task_id,
    importance: row.importance as ReminderImportance,
    interval_seconds: row.interval_seconds,
    escalation_json: row.escalation_json,
    active: row.active === 1 ? 1 : 0,
    version: row.version,
  };
}

// Ownership check: returns true iff the task exists for this user and is
// not soft-deleted. Cheap predicate every mutation runs first.
function userOwnsTask(
  db: Database.Database,
  userId: string,
  taskId: string,
): boolean {
  const r = db
    .prepare(
      `SELECT 1 AS ok FROM tasks
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL
        LIMIT 1`,
    )
    .get(taskId, userId) as { ok: number } | undefined;
  return r !== undefined;
}

// Returns the active (non-deleted) rule for this task, or null. The
// schema has no UNIQUE constraint on task_id but we treat it as 1:1 in
// v1 — pickFirst is the contract.
export function getReminderRule(
  db: Database.Database,
  userId: string,
  taskId: string,
): ReminderRuleRow | null {
  if (!userOwnsTask(db, userId, taskId)) return null;
  const row = db
    .prepare(
      `SELECT id, task_id, importance, interval_seconds, escalation_json, active, version
         FROM reminder_rules
        WHERE task_id = ? AND deleted_at IS NULL
        ORDER BY version DESC
        LIMIT 1`,
    )
    .get(taskId) as DbRule | undefined;
  return row ? rowFromDb(row) : null;
}

export interface UpsertReminderRuleArgs {
  importance: ReminderImportance;
  intervalSeconds: number;
  escalationJson: string;
  active: boolean;
}

export type UpsertReminderRuleResult =
  | { ok: true; id: string }
  | { ok: false; error: "NotFound" | "InvalidArgs" | "InternalError" };

// Validates payload fields the IPC handler hasn't already type-narrowed
// on. Checks here are repeated on the server via the domain Zod schema,
// but we want a clean local error before enqueueing a guaranteed-reject.
function validateUpsert(args: UpsertReminderRuleArgs): string | null {
  if (!isImportance(args.importance)) return "importance";
  if (
    !Number.isFinite(args.intervalSeconds) ||
    !Number.isInteger(args.intervalSeconds) ||
    args.intervalSeconds < MIN_INTERVAL_SECONDS
  ) {
    return "interval_seconds";
  }
  try {
    JSON.parse(args.escalationJson);
  } catch {
    return "escalation_json";
  }
  return null;
}

// Insert-or-replace the per-task rule. If one already exists, update it
// in place (preserves the id so sync stays stable across edits). Soft-
// deleted rows are revived rather than left as tombstones — re-using the
// id avoids a delete+insert round-trip on the server.
export function upsertReminderRule(
  db: Database.Database,
  userId: string,
  taskId: string,
  args: UpsertReminderRuleArgs,
  now: number,
): UpsertReminderRuleResult {
  if (validateUpsert(args) !== null) {
    return { ok: false, error: "InvalidArgs" };
  }
  if (!userOwnsTask(db, userId, taskId)) {
    return { ok: false, error: "NotFound" };
  }
  const activeInt: 0 | 1 = args.active ? 1 : 0;
  try {
    let resolvedId = "";
    const tx = db.transaction(() => {
      // Look across ALL rows for this task — including tombstones — so
      // re-adding a reminder reuses the original id.
      const existing = db
        .prepare(
          `SELECT id, version FROM reminder_rules
            WHERE task_id = ?
            ORDER BY version DESC
            LIMIT 1`,
        )
        .get(taskId) as { id: string; version: number } | undefined;

      if (existing) {
        const nextVersion = existing.version + 1;
        db.prepare(
          `UPDATE reminder_rules
              SET importance = ?, interval_seconds = ?, escalation_json = ?,
                  active = ?, version = ?, deleted_at = NULL
            WHERE id = ?`,
        ).run(
          args.importance,
          args.intervalSeconds,
          args.escalationJson,
          activeInt,
          nextVersion,
          existing.id,
        );
        enqueueOp(db, {
          table: "reminder_rules",
          op: "upsert",
          payload: {
            id: existing.id,
            task_id: taskId,
            importance: args.importance,
            interval_seconds: args.intervalSeconds,
            escalation_json: args.escalationJson,
            active: activeInt,
            updated_at: now,
            deleted_at: null,
            version: nextVersion,
          },
        });
        resolvedId = existing.id;
      } else {
        const id = randomUUID();
        db.prepare(
          `INSERT INTO reminder_rules
             (id, task_id, importance, interval_seconds, escalation_json, active, version, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, NULL)`,
        ).run(
          id,
          taskId,
          args.importance,
          args.intervalSeconds,
          args.escalationJson,
          activeInt,
        );
        enqueueOp(db, {
          table: "reminder_rules",
          op: "upsert",
          payload: {
            id,
            task_id: taskId,
            importance: args.importance,
            interval_seconds: args.intervalSeconds,
            escalation_json: args.escalationJson,
            active: activeInt,
            updated_at: now,
            deleted_at: null,
            version: 0,
          },
        });
        resolvedId = id;
      }
    });
    tx();
    return { ok: true, id: resolvedId };
  } catch {
    return { ok: false, error: "InternalError" };
  }
}

export type DeleteReminderRuleResult =
  | { ok: true }
  | { ok: false; error: "NotFound" | "InternalError" };

// Soft-delete via the sync trio (deleted_at + version bump). The id is
// retained so a later upsert can revive it.
export function deleteReminderRule(
  db: Database.Database,
  userId: string,
  taskId: string,
  now: number,
): DeleteReminderRuleResult {
  if (!userOwnsTask(db, userId, taskId)) {
    return { ok: false, error: "NotFound" };
  }
  try {
    let found = false;
    const tx = db.transaction(() => {
      const existing = db
        .prepare(
          `SELECT id, version FROM reminder_rules
            WHERE task_id = ? AND deleted_at IS NULL
            ORDER BY version DESC
            LIMIT 1`,
        )
        .get(taskId) as { id: string; version: number } | undefined;
      if (!existing) return;
      const nextVersion = existing.version + 1;
      db.prepare(
        `UPDATE reminder_rules
            SET deleted_at = ?, version = ?, active = 0
          WHERE id = ?`,
      ).run(now, nextVersion, existing.id);
      enqueueOp(db, {
        table: "reminder_rules",
        op: "delete",
        payload: {
          id: existing.id,
          updated_at: now,
        },
      });
      found = true;
    });
    tx();
    return found ? { ok: true } : { ok: false, error: "NotFound" };
  } catch {
    return { ok: false, error: "InternalError" };
  }
}
