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
  const existing = db
    .prepare(
      `SELECT settings_json, version FROM user_settings WHERE user_id = ?`,
    )
    .get(userId) as
    | { settings_json: string; version: number }
    | undefined;

  const nextSettings = mergeShutdownDate(existing?.settings_json, date);
  const nextVersion = (existing?.version ?? 0) + 1;

  if (existing) {
    db.prepare(
      `UPDATE user_settings
          SET settings_json = ?, updated_at = ?, version = ?, deleted_at = NULL
        WHERE user_id = ?`,
    ).run(nextSettings, now, nextVersion, userId);
  } else {
    db.prepare(
      `INSERT INTO user_settings (user_id, settings_json, updated_at, version)
       VALUES (?, ?, ?, ?)`,
    ).run(userId, nextSettings, now, nextVersion);
  }

  enqueueOp(db, {
    table: "user_settings",
    op: "upsert",
    payload: {
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
