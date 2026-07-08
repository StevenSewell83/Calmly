import type pg from "pg";
import type { Config } from "../config";
import { checkMagicLinkRateLimit } from "./rate-limit";
import { createSession } from "./session";
import { hashToken } from "./tokens";

export interface RedeemSuccess {
  ok: true;
  user: { id: string; email: string };
  rawToken: string;
  expiresAt: Date;
}

export type RedeemError =
  | { ok: false; status: 429; error: string; reason?: string }
  | { ok: false; status: 410; error: string };

export type RedeemOutcome = RedeemSuccess | RedeemError;

// Shared token-redeem logic for both POST and GET endpoints.
// Enforces IP-based rate limiting before touching the DB so brute-force
// guessing is throttled regardless of which HTTP method is used.
export async function redeemMagicLink(
  pool: pg.Pool,
  cfg: Pick<Config, "SESSION_TTL_DAYS">,
  opts: {
    rawToken: string;
    ip: string;
    userAgent: string | null;
  },
): Promise<RedeemOutcome> {
  const limit = await checkMagicLinkRateLimit(pool, {
    userId: null,
    ip: opts.ip,
  });
  if (!limit.allowed) {
    return {
      ok: false,
      status: 429,
      error: "rate_limited",
      reason: limit.reason,
    };
  }

  const tokenHash = hashToken(opts.rawToken);
  const r = await pool.query<{ user_id: string; email: string }>(
    `WITH consumed AS (
       UPDATE magic_link_tokens
          SET consumed_at = now()
        WHERE token_hash = $1
          AND consumed_at IS NULL
          AND expires_at > now()
        RETURNING user_id
     )
     SELECT consumed.user_id, users.email
       FROM consumed
       JOIN users ON users.id = consumed.user_id`,
    [tokenHash],
  );
  const row = r.rows[0];
  if (!row) {
    return { ok: false, status: 410, error: "token_invalid_or_expired" };
  }

  const session = await createSession(pool, {
    userId: row.user_id,
    ttlMs: cfg.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    userAgent: opts.userAgent,
  });

  return {
    ok: true,
    user: { id: row.user_id, email: row.email },
    rawToken: session.rawToken,
    expiresAt: session.expiresAt,
  };
}
