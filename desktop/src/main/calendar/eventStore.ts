// CAL-04: CRUD helpers for the local calendar_event_imports table.
//
// Upsert strategy: ON CONFLICT(user_id, provider, external_id) DO UPDATE.
// Soft-delete: set deleted_at to now(); hard sweep is left to a future
// maintenance task. All functions accept an open Database handle so they
// can participate in transactions from the import worker.

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export interface EventImportRow {
  id: string;
  user_id: string;
  provider: "google" | "microsoft";
  external_id: string;
  raw_json: string;
  start_at: number;
  end_at: number;
  last_seen_at: number;
  version: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface UpsertEventArgs {
  userId: string;
  provider: "google" | "microsoft";
  externalId: string;
  rawJson: string;
  startAt: number;
  endAt: number;
  now: number;
}

// Insert or update a calendar event row. Returns the row's id.
export function upsertCalendarEvent(
  db: Database.Database,
  args: UpsertEventArgs,
): string {
  const existing = db
    .prepare(
      `SELECT id FROM calendar_event_imports
         WHERE user_id = ? AND provider = ? AND external_id = ?`,
    )
    .get(args.userId, args.provider, args.externalId) as
    | { id: string }
    | undefined;

  const id = existing?.id ?? randomUUID();
  db.prepare(
    `INSERT INTO calendar_event_imports
       (id, user_id, provider, external_id, raw_json, start_at, end_at,
        last_seen_at, version, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL)
     ON CONFLICT(user_id, provider, external_id) DO UPDATE SET
       raw_json     = excluded.raw_json,
       start_at     = excluded.start_at,
       end_at       = excluded.end_at,
       last_seen_at = excluded.last_seen_at,
       version      = version + 1,
       updated_at   = excluded.updated_at,
       deleted_at   = NULL`,
  ).run(
    id,
    args.userId,
    args.provider,
    args.externalId,
    args.rawJson,
    args.startAt,
    args.endAt,
    args.now,
    args.now,
  );
  return id;
}

// Soft-delete a single event by (userId, provider, externalId).
export function softDeleteCalendarEvent(
  db: Database.Database,
  userId: string,
  provider: "google" | "microsoft",
  externalId: string,
  now: number,
): boolean {
  const result = db
    .prepare(
      `UPDATE calendar_event_imports
          SET deleted_at = ?, updated_at = ?, version = version + 1
        WHERE user_id = ? AND provider = ? AND external_id = ?
          AND deleted_at IS NULL`,
    )
    .run(now, now, userId, provider, externalId);
  return result.changes > 0;
}

// List active (non-deleted) events in a UTC time window.
export function listCalendarEvents(
  db: Database.Database,
  userId: string,
  fromMs: number,
  toMs: number,
): EventImportRow[] {
  return db
    .prepare(
      `SELECT * FROM calendar_event_imports
         WHERE user_id = ?
           AND start_at < ?
           AND end_at > ?
           AND deleted_at IS NULL
         ORDER BY start_at ASC`,
    )
    .all(userId, toMs, fromMs) as EventImportRow[];
}
