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
  | { ok: false; error: "EmptyInput" | "InternalError" };

// Persists a captured inbox item to local SQLite and queues the upsert for
// sync. Trims, rejects empty, truncates oversized text rather than failing
// loudly — the bead's anti-shame stance prefers a soft "trimmed" notice over
// a blocking error. Returns a discriminated union; never throws past the IPC
// boundary.
export function addInboxItem(args: AddInboxItemArgs): AddInboxItemResult {
  const trimmed = args.rawText.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "EmptyInput" };
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
