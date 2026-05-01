import { getDb } from "../db";
import { getCurrentUser } from "../auth/currentUser";
import type { CalendarAccount } from "@calmly/shared";

export type LocalCalendarAccount = CalendarAccount;

interface AccountRow {
  id: string;
  provider: "google" | "microsoft";
  external_account_id: string;
  email: string;
  status: "connected" | "disconnected" | "error";
}

export interface UpsertLocalCalendarAccountArgs {
  id: string;
  provider: "google" | "microsoft";
  external_account_id: string;
  email: string;
  status: "connected" | "disconnected" | "error";
}

// Mirrors a server-side calendar_accounts row into the local cache. Returns
// the canonical row as it now sits in SQLite. Throws if no user is signed in
// — calendar connections are always per-user.
export function upsertLocalCalendarAccount(
  args: UpsertLocalCalendarAccountArgs,
): LocalCalendarAccount {
  const user = getCurrentUser();
  if (!user) throw new Error("upsertLocalCalendarAccount: no signed-in user");

  const now = Date.now();
  const db = getDb();
  db.prepare(
    `INSERT INTO calendar_accounts
       (id, user_id, provider, external_account_id, email, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       status = excluded.status,
       updated_at = excluded.updated_at`,
  ).run(
    args.id,
    user.id,
    args.provider,
    args.external_account_id,
    args.email,
    args.status,
    now,
    now,
  );

  const row = db
    .prepare(
      `SELECT id, provider, external_account_id, email, status
         FROM calendar_accounts WHERE id = ? AND user_id = ?`,
    )
    .get(args.id, user.id) as AccountRow | undefined;
  if (!row) throw new Error("calendar_accounts upsert vanished");
  return row;
}

export function listLocalCalendarAccounts(): LocalCalendarAccount[] {
  const user = getCurrentUser();
  if (!user) return [];
  const rows = getDb()
    .prepare(
      `SELECT id, provider, external_account_id, email, status
         FROM calendar_accounts
         WHERE user_id = ?
         ORDER BY created_at ASC`,
    )
    .all(user.id) as AccountRow[];
  return rows;
}
