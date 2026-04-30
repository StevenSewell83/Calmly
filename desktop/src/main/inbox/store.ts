import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { InboxSource } from "@calmly/shared";
import { enqueueOp } from "../sync/queue";

export const MAX_RAW_TEXT_CHARS = 4000;

export interface AddInboxItemArgs {
  db: Database.Database;
  userId: string;
  rawText: string;
  source: InboxSource;
}

export type AddInboxItemResult =
  | {
      ok: true;
      id: string;
      // True when the input exceeded MAX_RAW_TEXT_CHARS and was clipped.
      // Renderer surfaces a brief "Trimmed at 4000 chars" note in that case.
      truncated: boolean;
    }
  | { ok: false; error: "InvalidArgs" | "InternalError" };

// Persists a captured inbox item to local SQLite and queues the upsert for
// sync. Trims, rejects empty, truncates oversized text rather than failing
// loudly — the bead's anti-shame stance prefers a soft "trimmed" notice over
// a blocking error. Returns a discriminated union; never throws past the IPC
// boundary.
export function addInboxItem(args: AddInboxItemArgs): AddInboxItemResult {
  const trimmed = args.rawText.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "InvalidArgs" };
  }

  const truncated = trimmed.length > MAX_RAW_TEXT_CHARS;
  const text = truncated ? trimmed.slice(0, MAX_RAW_TEXT_CHARS) : trimmed;

  const id = randomUUID();
  const now = Date.now();
  try {
    // Local insert + sync enqueue must happen atomically: a successful
    // insert without an enqueue would orphan the row from sync forever, and
    // an enqueue without an insert would push a record the local cache
    // doesn't know about. better-sqlite3 transactions are synchronous and
    // fast enough that this stays well under one frame.
    const tx = args.db.transaction(() => {
      args.db
        .prepare(
          `INSERT INTO inbox_items
             (id, user_id, raw_text, source, created_at, resolved_at, version, deleted_at)
           VALUES (?, ?, ?, ?, ?, NULL, 0, NULL)`,
        )
        .run(id, args.userId, text, args.source, now);
      enqueueOp(args.db, {
        table: "inbox_items",
        op: "upsert",
        payload: {
          id,
          raw_text: text,
          source: args.source,
          created_at: now,
          resolved_at: null,
          snoozed_until: null,
          updated_at: now,
          deleted_at: null,
          version: 0,
        },
      });
    });
    tx();
    return { ok: true, id, truncated };
  } catch {
    return { ok: false, error: "InternalError" };
  }
}

// Wire shape for the inbox list IPC. Mirrors the columns the renderer
// actually shows; resolved_at + snoozed_until come along so future
// sort modes (e.g. 'recently snoozed') can derive without a re-fetch.
export interface InboxListRow {
  id: string;
  raw_text: string;
  source: InboxSource;
  created_at: number;
  resolved_at: number | null;
  snoozed_until: number | null;
}

// Lists the user's visible inbox: unresolved, not currently snoozed,
// not soft-deleted. Ordered newest-first; renderer re-sorts in memory
// because user inboxes are small and the list IPC stays simple.
export function listInbox(
  db: Database.Database,
  userId: string,
  now: number,
): InboxListRow[] {
  return db
    .prepare(
      `SELECT id, raw_text, source, created_at, resolved_at, snoozed_until
         FROM inbox_items
        WHERE user_id = ?
          AND deleted_at IS NULL
          AND resolved_at IS NULL
          AND (snoozed_until IS NULL OR snoozed_until <= ?)
        ORDER BY created_at DESC`,
    )
    .all(userId, now) as InboxListRow[];
}

export type SnoozeInboxResult =
  | { ok: true }
  | { ok: false; error: "NotFound" | "InternalError" | "InvalidArgs" };

// Sets snoozed_until on an item the caller owns. The user_id predicate
// in the UPDATE doubles as the ownership check — a stale renderer that
// races with sign-out gets a NotFound rather than touching someone
// else's row. Bumps version + enqueues a FULL-snapshot upsert: the
// server's ON CONFLICT DO UPDATE SET ${col}=EXCLUDED.${col} would
// clobber any column missing from the payload, so partial upserts are
// not safe. Reading the row inside the same tx keeps the snapshot
// consistent with the UPDATE.
export function snoozeInboxItem(
  db: Database.Database,
  userId: string,
  id: string,
  untilMs: number,
  now: number,
): SnoozeInboxResult {
  if (!Number.isFinite(untilMs) || untilMs <= now) {
    return { ok: false, error: "InvalidArgs" };
  }
  try {
    let found = false;
    const tx = db.transaction(() => {
      const existing = db
        .prepare(
          `SELECT raw_text, source, created_at, resolved_at, version
             FROM inbox_items
            WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        )
        .get(id, userId) as
        | {
            raw_text: string;
            source: InboxSource;
            created_at: number;
            resolved_at: number | null;
            version: number;
          }
        | undefined;
      if (!existing) return;

      const nextVersion = existing.version + 1;
      db.prepare(
        `UPDATE inbox_items
            SET snoozed_until = ?, version = ?
          WHERE id = ? AND user_id = ?`,
      ).run(untilMs, nextVersion, id, userId);

      enqueueOp(db, {
        table: "inbox_items",
        op: "upsert",
        payload: {
          id,
          raw_text: existing.raw_text,
          source: existing.source,
          created_at: existing.created_at,
          resolved_at: existing.resolved_at,
          snoozed_until: untilMs,
          updated_at: now,
          deleted_at: null,
          version: nextVersion,
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

export type SkipInboxResult =
  | { ok: true }
  | { ok: false; error: "NotFound" | "InternalError" };

// Marks an item as resolved with no triage outcome — the user
// dismissed it. Same full-snapshot rule as snoozeInboxItem: the
// upsert payload must round-trip every owned column or the server's
// EXCLUDED-based update will null them out.
export function skipInboxItem(
  db: Database.Database,
  userId: string,
  id: string,
  now: number,
): SkipInboxResult {
  try {
    let found = false;
    const tx = db.transaction(() => {
      const existing = db
        .prepare(
          `SELECT raw_text, source, created_at, snoozed_until, version
             FROM inbox_items
            WHERE id = ? AND user_id = ? AND deleted_at IS NULL
              AND resolved_at IS NULL`,
        )
        .get(id, userId) as
        | {
            raw_text: string;
            source: InboxSource;
            created_at: number;
            snoozed_until: number | null;
            version: number;
          }
        | undefined;
      if (!existing) return;

      const nextVersion = existing.version + 1;
      db.prepare(
        `UPDATE inbox_items
            SET resolved_at = ?, version = ?
          WHERE id = ? AND user_id = ?`,
      ).run(now, nextVersion, id, userId);

      enqueueOp(db, {
        table: "inbox_items",
        op: "upsert",
        payload: {
          id,
          raw_text: existing.raw_text,
          source: existing.source,
          created_at: existing.created_at,
          resolved_at: now,
          snoozed_until: existing.snoozed_until,
          updated_at: now,
          deleted_at: null,
          version: nextVersion,
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
