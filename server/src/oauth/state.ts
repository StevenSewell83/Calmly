import type pg from "pg";
import type { CalendarProvider } from "@calmly/shared";

// Persists the (state, code_verifier) tuple created at /oauth/<p>/start so
// the matching /oauth/<p>/callback can re-derive the verifier and prove the
// browser hop hasn't been hijacked. Rows are one-shot (deleted on consume)
// and time-bound (expires_at).

export interface CreateOauthStateArgs {
  state: string;
  userId: string;
  provider: CalendarProvider;
  codeVerifier: string;
  ttlSec: number;
}

export async function createOauthStateRow(
  pool: pg.Pool,
  args: CreateOauthStateArgs,
): Promise<void> {
  const expiresAt = new Date(Date.now() + args.ttlSec * 1000);
  await pool.query(
    `INSERT INTO oauth_states (state, user_id, provider, code_verifier, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [args.state, args.userId, args.provider, args.codeVerifier, expiresAt],
  );
}

export interface ConsumedOauthState {
  userId: string;
  provider: CalendarProvider;
  codeVerifier: string;
}

export async function consumeOauthState(
  pool: pg.Pool,
  args: { state: string; provider: CalendarProvider },
): Promise<ConsumedOauthState | null> {
  const r = await pool.query<{
    user_id: string;
    provider: CalendarProvider;
    code_verifier: string;
  }>(
    `DELETE FROM oauth_states
       WHERE state = $1
         AND provider = $2
         AND expires_at > now()
     RETURNING user_id, provider, code_verifier`,
    [args.state, args.provider],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    userId: row.user_id,
    provider: row.provider,
    codeVerifier: row.code_verifier,
  };
}

// Best-effort sweeper for expired rows. Cheap on its own and bounded by the
// expires_at index; meant to be called occasionally (e.g. from /start).
export async function sweepExpiredOauthStates(pool: pg.Pool): Promise<void> {
  await pool.query("DELETE FROM oauth_states WHERE expires_at <= now()");
}
