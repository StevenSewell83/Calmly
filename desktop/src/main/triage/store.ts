import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { InboxSource, TaskStatus } from "@calmly/shared";
import { enqueueOp } from "../sync/queue";

// CL-04 triage resolutions.
//
// All three resolutions share the same atomicity contract: the inbox
// row's resolved_at update + (optionally) the new task/event INSERT
// MUST commit together, and the sync ops for both rows MUST enqueue in
// the same transaction. Otherwise a sync-push between the two writes
// could leak a task with no inbox provenance, or the inverse.
//
// Server-side ON CONFLICT DO UPDATE SET col=EXCLUDED.col rule (see
// server/src/sync/apply.ts) means partial upserts null out missing
// columns. Each helper therefore enqueues a FULL-row snapshot for the
// inbox upsert (raw_text + source + created_at all preserved by the
// in-tx SELECT) and a complete row for the new task/event.

export interface ResolveBaseArgs {
  db: Database.Database;
  userId: string;
  inboxId: string;
  // Caller-supplied 'now' for testability. Production passes Date.now().
  now: number;
}

export interface ResolveAsTaskArgs extends ResolveBaseArgs {
  title: string;
  // null when the user picked 'Later' — task with no due_at.
  dueAt: number | null;
}

export interface ResolveAsEventArgs extends ResolveBaseArgs {
  title: string;
  startAt: number;
  endAt: number;
}

export type ResolveResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error:
        | "NotFound"
        | "AlreadyResolved"
        | "InvalidArgs"
        | "InternalError";
    };

export type DiscardResult =
  | { ok: true }
  | {
      ok: false;
      error: "NotFound" | "AlreadyResolved" | "InternalError";
    };

interface InboxRow {
  raw_text: string;
  source: InboxSource;
  created_at: number;
  resolved_at: number | null;
  snoozed_until: number | null;
  version: number;
}

// Pulls the inbox row inside the tx and short-circuits if it doesn't
// exist or already has a resolution. Centralized so all three flows
// produce the same error narrowing.
function loadInboxForResolve(
  db: Database.Database,
  userId: string,
  inboxId: string,
):
  | { kind: "ok"; row: InboxRow }
  | { kind: "missing" }
  | { kind: "already-resolved" } {
  const row = db
    .prepare(
      `SELECT raw_text, source, created_at, resolved_at, snoozed_until, version
         FROM inbox_items
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .get(inboxId, userId) as InboxRow | undefined;
  if (!row) return { kind: "missing" };
  if (row.resolved_at !== null) return { kind: "already-resolved" };
  return { kind: "ok", row };
}

// Marks the inbox item resolved and enqueues a full-snapshot upsert.
// The caller has already SELECTed the row (so we don't repeat it) —
// this wraps the UPDATE + enqueueOp pair so each resolution flow
// stays focused on its own entity creation.
function markInboxResolved(
  db: Database.Database,
  userId: string,
  inboxId: string,
  row: InboxRow,
  now: number,
): void {
  const nextVersion = row.version + 1;
  db.prepare(
    `UPDATE inbox_items
        SET resolved_at = ?, version = ?
      WHERE id = ? AND user_id = ?`,
  ).run(now, nextVersion, inboxId, userId);

  enqueueOp(db, {
    table: "inbox_items",
    op: "upsert",
    payload: {
      id: inboxId,
      raw_text: row.raw_text,
      source: row.source,
      created_at: row.created_at,
      resolved_at: now,
      snoozed_until: row.snoozed_until,
      updated_at: now,
      deleted_at: null,
      version: nextVersion,
    },
  });
}

// Resolves an inbox item by converting it into a Task. Title is
// already trimmed renderer-side; we trust the IPC boundary will have
// rejected obviously-bad input. dueAt may be null (user picked
// 'Later'). Returns the new task id so the renderer can deep-link.
export function resolveAsTask(args: ResolveAsTaskArgs): ResolveResult {
  const trimmedTitle = args.title.trim();
  if (trimmedTitle.length === 0) {
    return { ok: false, error: "InvalidArgs" };
  }
  if (args.dueAt !== null && !Number.isFinite(args.dueAt)) {
    return { ok: false, error: "InvalidArgs" };
  }

  const taskId = randomUUID();
  const initialStatus: TaskStatus = "open";
  let outcome: "ok" | "missing" | "already-resolved" = "missing";
  try {
    const tx = args.db.transaction(() => {
      const loaded = loadInboxForResolve(args.db, args.userId, args.inboxId);
      if (loaded.kind !== "ok") {
        outcome = loaded.kind === "missing" ? "missing" : "already-resolved";
        return;
      }

      args.db
        .prepare(
          `INSERT INTO tasks
             (id, user_id, title, notes, type, status, due_at, parent_task_id,
              source, created_at, updated_at, version, deleted_at)
           VALUES (?, ?, ?, NULL, 'task', ?, ?, NULL, ?, ?, ?, 0, NULL)`,
        )
        .run(
          taskId,
          args.userId,
          trimmedTitle,
          initialStatus,
          args.dueAt,
          loaded.row.source,
          args.now,
          args.now,
        );

      enqueueOp(args.db, {
        table: "tasks",
        op: "upsert",
        payload: {
          id: taskId,
          title: trimmedTitle,
          notes: null,
          type: "task",
          status: initialStatus,
          due_at: args.dueAt,
          parent_task_id: null,
          source: loaded.row.source,
          created_at: args.now,
          updated_at: args.now,
          deleted_at: null,
          version: 0,
        },
      });

      markInboxResolved(
        args.db,
        args.userId,
        args.inboxId,
        loaded.row,
        args.now,
      );
      outcome = "ok";
    });
    tx();
  } catch {
    return { ok: false, error: "InternalError" };
  }
  if (outcome === "missing") return { ok: false, error: "NotFound" };
  if (outcome === "already-resolved") {
    return { ok: false, error: "AlreadyResolved" };
  }
  return { ok: true, id: taskId };
}

// Resolves an inbox item by converting it into an Event with explicit
// start/end times. source='manual' on events (calendar imports flow
// through a different path). end >= start required.
export function resolveAsEvent(args: ResolveAsEventArgs): ResolveResult {
  const trimmedTitle = args.title.trim();
  if (trimmedTitle.length === 0) {
    return { ok: false, error: "InvalidArgs" };
  }
  if (
    !Number.isFinite(args.startAt) ||
    !Number.isFinite(args.endAt) ||
    args.endAt < args.startAt
  ) {
    return { ok: false, error: "InvalidArgs" };
  }

  const eventId = randomUUID();
  let outcome: "ok" | "missing" | "already-resolved" = "missing";
  try {
    const tx = args.db.transaction(() => {
      const loaded = loadInboxForResolve(args.db, args.userId, args.inboxId);
      if (loaded.kind !== "ok") {
        outcome = loaded.kind === "missing" ? "missing" : "already-resolved";
        return;
      }

      args.db
        .prepare(
          `INSERT INTO events
             (id, user_id, title, start_at, end_at, source, created_at,
              version, deleted_at)
           VALUES (?, ?, ?, ?, ?, 'manual', ?, 0, NULL)`,
        )
        .run(
          eventId,
          args.userId,
          trimmedTitle,
          args.startAt,
          args.endAt,
          args.now,
        );

      enqueueOp(args.db, {
        table: "events",
        op: "upsert",
        payload: {
          id: eventId,
          title: trimmedTitle,
          start_at: args.startAt,
          end_at: args.endAt,
          source: "manual",
          created_at: args.now,
          updated_at: args.now,
          deleted_at: null,
          version: 0,
        },
      });

      markInboxResolved(
        args.db,
        args.userId,
        args.inboxId,
        loaded.row,
        args.now,
      );
      outcome = "ok";
    });
    tx();
  } catch {
    return { ok: false, error: "InternalError" };
  }
  if (outcome === "missing") return { ok: false, error: "NotFound" };
  if (outcome === "already-resolved") {
    return { ok: false, error: "AlreadyResolved" };
  }
  return { ok: true, id: eventId };
}

// Resolves an inbox item with no follow-up entity — the user discarded
// the thought. Equivalent to skipInboxItem in spirit but lives here
// for symmetry with the other triage flows.
export function discardInboxItem(args: ResolveBaseArgs): DiscardResult {
  let outcome: "ok" | "missing" | "already-resolved" = "missing";
  try {
    const tx = args.db.transaction(() => {
      const loaded = loadInboxForResolve(args.db, args.userId, args.inboxId);
      if (loaded.kind !== "ok") {
        outcome = loaded.kind === "missing" ? "missing" : "already-resolved";
        return;
      }
      markInboxResolved(
        args.db,
        args.userId,
        args.inboxId,
        loaded.row,
        args.now,
      );
      outcome = "ok";
    });
    tx();
  } catch {
    return { ok: false, error: "InternalError" };
  }
  if (outcome === "missing") return { ok: false, error: "NotFound" };
  if (outcome === "already-resolved") {
    return { ok: false, error: "AlreadyResolved" };
  }
  return { ok: true };
}
