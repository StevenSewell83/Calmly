import type pg from "pg";
import type { CalendarProvider, CalendarAccount } from "@calmly/shared";

export interface UpsertCalendarAccountArgs {
  userId: string;
  provider: CalendarProvider;
  externalAccountId: string;
  email: string;
}

interface CalendarAccountRow {
  id: string;
  provider: CalendarProvider;
  external_account_id: string;
  email: string;
  status: "connected" | "disconnected" | "error";
}

// Upserts on (user_id, provider, external_account_id) — the same Google
// account under the same Calmly user collapses to a single row even on
// repeated connect attempts. status is reset to 'connected' so a previously
// errored row recovers cleanly.
export async function upsertCalendarAccount(
  pool: pg.Pool,
  args: UpsertCalendarAccountArgs,
): Promise<CalendarAccount> {
  const r = await pool.query<CalendarAccountRow>(
    `INSERT INTO calendar_accounts
       (user_id, provider, external_account_id, email, status, updated_at)
     VALUES ($1, $2, $3, $4, 'connected', now())
     ON CONFLICT (user_id, provider, external_account_id) DO UPDATE
       SET email = EXCLUDED.email,
           status = 'connected',
           updated_at = now()
     RETURNING id, provider, external_account_id, email, status`,
    [args.userId, args.provider, args.externalAccountId, args.email],
  );
  const row = r.rows[0];
  if (!row) throw new Error("calendar_accounts upsert returned no row");
  return {
    id: row.id,
    provider: row.provider,
    external_account_id: row.external_account_id,
    email: row.email,
    status: row.status,
  };
}
