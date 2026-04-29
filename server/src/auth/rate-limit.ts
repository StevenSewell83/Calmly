import type pg from "pg";

export interface RateLimitConfig {
  perEmailPerHour: number;
  perIpPerHour: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  perEmailPerHour: 5,
  perIpPerHour: 20,
};

export interface RateLimitResult {
  allowed: boolean;
  reason?: "email" | "ip";
}

interface CountRow {
  count: string;
}

export async function checkMagicLinkRateLimit(
  pool: pg.Pool,
  args: { userId: string | null; ip: string | null },
  config: RateLimitConfig = DEFAULT_RATE_LIMIT,
): Promise<RateLimitResult> {
  if (args.userId !== null) {
    const r = await pool.query<CountRow>(
      `SELECT count(*)::text AS count FROM magic_link_tokens
        WHERE user_id = $1 AND requested_at > now() - interval '1 hour'`,
      [args.userId],
    );
    const c = parseInt(r.rows[0]?.count ?? "0", 10);
    if (c >= config.perEmailPerHour) return { allowed: false, reason: "email" };
  }
  if (args.ip !== null && args.ip.length > 0) {
    const r = await pool.query<CountRow>(
      `SELECT count(*)::text AS count FROM magic_link_tokens
        WHERE requested_ip = $1 AND requested_at > now() - interval '1 hour'`,
      [args.ip],
    );
    const c = parseInt(r.rows[0]?.count ?? "0", 10);
    if (c >= config.perIpPerHour) return { allowed: false, reason: "ip" };
  }
  return { allowed: true };
}
