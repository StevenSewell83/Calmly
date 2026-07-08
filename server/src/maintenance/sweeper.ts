/**
 * Periodic expiry sweeper (calmly-aa3.6).
 *
 * Only oauth_states had cleanup before this (an opportunistic sweep from the
 * OAuth /start route); every other short-lived auth table grew forever:
 *  - magic_link_tokens rows are scanned live by the rate limiter, so an
 *    unbounded table slowly degrades every sign-in attempt;
 *  - abandoned oauth_tickets rows retain provider refresh/access tokens
 *    past their 300s TTL until redeem-or-never;
 *  - sessions and telegram_linking_codes simply accumulate.
 *
 * Retention rules:
 *  - magic_link_tokens: expired AND requested over an hour ago. The rate
 *    limiter counts rows by requested_at over a 1-hour window (rate-limit.ts),
 *    so expired-but-recent rows must survive the sweep or a burst of expired
 *    tokens would reset the limit.
 *  - sessions / oauth_states / oauth_tickets: past expires_at (timestamptz).
 *  - telegram_linking_codes: past expires_at (epoch ms) or already consumed.
 */
import type pg from "pg";

const SWEEP_STATEMENTS: ReadonlyArray<{ table: string; sql: string }> = [
  {
    table: "magic_link_tokens",
    sql: `DELETE FROM magic_link_tokens
           WHERE expires_at <= now() AND requested_at <= now() - interval '1 hour'`,
  },
  {
    table: "sessions",
    sql: `DELETE FROM sessions WHERE expires_at <= now()`,
  },
  {
    table: "oauth_states",
    sql: `DELETE FROM oauth_states WHERE expires_at <= now()`,
  },
  {
    table: "oauth_tickets",
    sql: `DELETE FROM oauth_tickets WHERE expires_at <= now()`,
  },
  {
    table: "telegram_linking_codes",
    sql: `DELETE FROM telegram_linking_codes
           WHERE expires_at <= (extract(epoch from now()) * 1000)::bigint
              OR consumed_at IS NOT NULL`,
  },
];

export interface SweepLogger {
  debug: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
}

/** One sweep pass over every table. Failures are per-table and non-fatal —
 * a broken table (e.g. mid-migration) must not stop the others. */
export async function sweepExpiredAuthRows(
  pool: pg.Pool,
  log?: SweepLogger,
): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  for (const { table, sql } of SWEEP_STATEMENTS) {
    try {
      const r = await pool.query(sql);
      deleted[table] = r.rowCount ?? 0;
    } catch (err) {
      log?.warn({ err, table }, "[sweeper] sweep failed for table");
    }
  }
  log?.debug({ deleted }, "[sweeper] sweep complete");
  return deleted;
}

/** Start the periodic sweeper. Returns a stop function; the interval is
 * unref'd so it never holds the process open. */
export function startSweeper(
  pool: pg.Pool,
  intervalMs: number,
  log?: SweepLogger,
): () => void {
  const timer = setInterval(() => {
    void sweepExpiredAuthRows(pool, log);
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
