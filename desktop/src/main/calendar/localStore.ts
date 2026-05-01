import { getDb } from "../db";
import { getCurrentUser } from "../auth/currentUser";
import type { CalendarAccount, CalendarAccountStatus } from "@calmly/shared";

export type LocalCalendarAccount = CalendarAccount;

interface AccountRow {
  id: string;
  provider: "google" | "microsoft";
  external_account_id: string;
  email: string;
  status: CalendarAccountStatus;
}

export interface UpsertLocalCalendarAccountArgs {
  id: string;
  provider: "google" | "microsoft";
  external_account_id: string;
  email: string;
  status: CalendarAccountStatus;
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

export function getLocalCalendarAccount(
  accountId: string,
): LocalCalendarAccount | null {
  const user = getCurrentUser();
  if (!user) return null;
  const row = getDb()
    .prepare(
      `SELECT id, provider, external_account_id, email, status
         FROM calendar_accounts
         WHERE id = ? AND user_id = ?`,
    )
    .get(accountId, user.id) as AccountRow | undefined;
  return row ?? null;
}

// Updates local mirror status. Returns true when a row was actually
// changed (the new status differed from the old). The renderer subscribes
// to status changes via the IPC `calendar:account-status-changed` channel.
export function markLocalCalendarAccountStatus(
  accountId: string,
  status: CalendarAccountStatus,
): boolean {
  const user = getCurrentUser();
  if (!user) return false;
  const result = getDb()
    .prepare(
      `UPDATE calendar_accounts
          SET status = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND status != ?`,
    )
    .run(status, Date.now(), accountId, user.id, status);
  return result.changes > 0;
}

export function deleteLocalCalendarAccount(accountId: string): boolean {
  const user = getCurrentUser();
  if (!user) return false;
  const result = getDb()
    .prepare(`DELETE FROM calendar_accounts WHERE id = ? AND user_id = ?`)
    .run(accountId, user.id);
  return result.changes > 0;
}
