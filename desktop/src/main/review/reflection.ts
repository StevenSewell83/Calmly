import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { enqueueOp } from "../sync/queue";

// CL-13 reflection upsert. UNIQUE (user_id, date) makes one row per
// day; the renderer hands us a 'YYYY-MM-DD' string and we look up
// existing-or-mint-new so the sync server's ON CONFLICT (id) path
// stays consistent across replicas.

export type SaveReflectionResult =
  | { ok: true; id: string }
  | { ok: false; error: "EmptyText" | "InternalError" };

export function saveReflection(
  db: Database.Database,
  userId: string,
  date: string,
  text: string,
  now: number,
): SaveReflectionResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, error: "EmptyText" };
  try {
    let id = "";
    const tx = db.transaction(() => {
      const existing = db
        .prepare(
          `SELECT id, version FROM daily_reflections
            WHERE user_id = ? AND date = ?`,
        )
        .get(userId, date) as
        | { id: string; version: number }
        | undefined;
      if (existing) {
        id = existing.id;
        const nextVersion = existing.version + 1;
        db.prepare(
          `UPDATE daily_reflections
              SET text = ?, updated_at = ?, version = ?, deleted_at = NULL
            WHERE id = ? AND user_id = ?`,
        ).run(trimmed, now, nextVersion, id, userId);
        enqueueReflectionUpsert(db, id, date, trimmed, now, nextVersion);
      } else {
        id = randomUUID();
        db.prepare(
          `INSERT INTO daily_reflections
             (id, user_id, date, text, created_at, updated_at, version)
           VALUES (?, ?, ?, ?, ?, ?, 1)`,
        ).run(id, userId, date, trimmed, now, now);
        enqueueReflectionUpsert(db, id, date, trimmed, now, 1);
      }
    });
    tx();
    return { ok: true, id };
  } catch {
    return { ok: false, error: "InternalError" };
  }
}

function enqueueReflectionUpsert(
  db: Database.Database,
  id: string,
  date: string,
  text: string,
  now: number,
  version: number,
): void {
  enqueueOp(db, {
    table: "daily_reflections",
    op: "upsert",
    payload: {
      id,
      date,
      text,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      version,
    },
  });
}
