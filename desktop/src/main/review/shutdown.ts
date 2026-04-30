import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { enqueueOp } from "../sync/queue";
import { saveReflection } from "./reflection";

// CL-13 completeShutdown. Closes the day in a single transaction:
//   1. (optional) save reflection for `date`
//   2. write last_shutdown_date=`date` into user_settings.settings_json
// Both writes enqueue sync upserts so other devices converge.

export type CompleteShutdownResult =
  | { ok: true; reflectionId: string | null }
  | { ok: false; error: "InternalError" };

export function completeShutdown(
  db: Database.Database,
  userId: string,
  date: string,
  reflectionText: string | null,
  now: number,
): CompleteShutdownResult {
  let reflectionId: string | null = null;
  try {
    const tx = db.transaction(() => {
      if (reflectionText !== null && reflectionText.trim().length > 0) {
        const r = saveReflection(db, userId, date, reflectionText, now);
        if (r.ok) reflectionId = r.id;
      }
      writeLastShutdownDate(db, userId, date, now);
    });
    tx();
    return { ok: true, reflectionId };
  } catch {
    return { ok: false, error: "InternalError" };
  }
}

function writeLastShutdownDate(
  db: Database.Database,
  userId: string,
  date: string,
  now: number,
): void {
  // Reuse an existing settings row's id so the sync server's
  // ON CONFLICT (id) path finds it; only mint a fresh UUID on first
  // settings write (mirrors the saveReflection upsert pattern).
  const existing = db
    .prepare(
      `SELECT id, settings_json, version FROM user_settings WHERE user_id = ?`,
    )
    .get(userId) as
    | { id: string; settings_json: string; version: number }
    | undefined;

  const id = existing?.id ?? randomUUID();
  const nextSettings = mergeShutdownDate(existing?.settings_json, date);
  const nextVersion = (existing?.version ?? 0) + 1;

  if (existing) {
    db.prepare(
      `UPDATE user_settings
          SET settings_json = ?, updated_at = ?, version = ?, deleted_at = NULL
        WHERE id = ?`,
    ).run(nextSettings, now, nextVersion, id);
  } else {
    db.prepare(
      `INSERT INTO user_settings (id, user_id, settings_json, updated_at, version)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, userId, nextSettings, now, nextVersion);
  }

  enqueueOp(db, {
    table: "user_settings",
    op: "upsert",
    payload: {
      id,
      user_id: userId,
      settings_json: nextSettings,
      updated_at: now,
      deleted_at: null,
      version: nextVersion,
    },
  });
}

function mergeShutdownDate(
  existingJson: string | undefined,
  date: string,
): string {
  let obj: Record<string, unknown> = {};
  if (existingJson) {
    try {
      const parsed = JSON.parse(existingJson) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      // Fall through with empty obj — overwriting unparseable
      // settings is the lesser harm than blocking shutdown.
    }
  }
  obj["last_shutdown_date"] = date;
  return JSON.stringify(obj);
}
