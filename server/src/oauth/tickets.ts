import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import type { CalendarProvider } from "@calmly/shared";

// One-shot pickup tickets for OAuth completion. After /callback succeeds the
// server briefly stores the (refresh_token, access_token, expires_in) tuple
// in oauth_tickets and hands the desktop client a signed reference. The
// client then redeems the reference via POST /oauth/<provider>/redeem.
//
// The redeem reference is the literal string `${jti}.${signature}` where
// signature = HMAC_SHA256(secret, `${jti}|${user_id}|${account_id}|${exp}`).
// The signature binds the ticket to the *intended* user and account so an
// attacker who somehow snoops the deep-link cannot redeem against another
// session.

const JTI_BYTES = 24; // → 32 base64url chars
const SIG_LEN_HEX = 64;

export interface IssueTicketArgs {
  pool: pg.Pool;
  secret: string;
  userId: string;
  accountId: string;
  provider: CalendarProvider;
  refreshToken: string;
  accessToken: string;
  expiresInSec: number;
  ticketTtlSec: number;
}

export interface IssuedTicket {
  ticket: string; // public reference (jti.sig)
  jti: string;
  expiresAt: Date;
}

export async function issueOauthTicket(
  args: IssueTicketArgs,
): Promise<IssuedTicket> {
  const jti = randomBytes(JTI_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + args.ticketTtlSec * 1000);

  await args.pool.query(
    `INSERT INTO oauth_tickets
       (jti, user_id, account_id, provider, refresh_token, access_token,
        expires_in, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      jti,
      args.userId,
      args.accountId,
      args.provider,
      args.refreshToken,
      args.accessToken,
      args.expiresInSec,
      expiresAt,
    ],
  );

  const sig = signTicket({
    secret: args.secret,
    jti,
    userId: args.userId,
    accountId: args.accountId,
    expSec: Math.floor(expiresAt.getTime() / 1000),
  });
  return { ticket: `${jti}.${sig}`, jti, expiresAt };
}

interface SignArgs {
  secret: string;
  jti: string;
  userId: string;
  accountId: string;
  expSec: number;
}

function signTicket(args: SignArgs): string {
  const payload = `${args.jti}|${args.userId}|${args.accountId}|${args.expSec}`;
  return createHmac("sha256", args.secret).update(payload).digest("hex");
}

export interface RedeemTicketArgs {
  pool: pg.Pool;
  secret: string;
  userId: string;
  provider: CalendarProvider;
  ticket: string;
}

export interface RedeemedTicket {
  accountId: string;
  refreshToken: string;
  accessToken: string;
  expiresInSec: number;
}

export type RedeemError =
  | "invalid_ticket"
  | "ticket_expired"
  | "ticket_already_redeemed"
  | "ticket_user_mismatch";

export type RedeemResult =
  | { ok: true; data: RedeemedTicket }
  | { ok: false; error: RedeemError };

export async function redeemOauthTicket(
  args: RedeemTicketArgs,
): Promise<RedeemResult> {
  const parts = args.ticket.split(".");
  if (parts.length !== 2) return { ok: false, error: "invalid_ticket" };
  const [jti, sigHex] = parts as [string, string];
  if (!isWellFormedJti(jti) || !isWellFormedSig(sigHex)) {
    return { ok: false, error: "invalid_ticket" };
  }

  // Atomic claim: delete the row only if it matches the expected user +
  // provider AND has not yet expired. RETURNING gives us the secrets to
  // hand back. Anything else is a no-op.
  const r = await args.pool.query<{
    jti: string;
    account_id: string;
    user_id: string;
    refresh_token: string;
    access_token: string;
    expires_in: number;
    expires_at: Date;
  }>(
    `DELETE FROM oauth_tickets
       WHERE jti = $1 AND provider = $2
     RETURNING jti, account_id, user_id, refresh_token, access_token,
               expires_in, expires_at`,
    [jti, args.provider],
  );
  const row = r.rows[0];
  if (!row) {
    // Either never existed, or was redeemed already (we delete on success).
    return { ok: false, error: "ticket_already_redeemed" };
  }

  if (row.expires_at.getTime() <= Date.now()) {
    return { ok: false, error: "ticket_expired" };
  }

  if (row.user_id !== args.userId) {
    // Bound to a different user — refuse. Note: we already deleted the row,
    // so the legitimate owner can no longer redeem. That's intentional —
    // ticket leakage MUST invalidate the ticket.
    return { ok: false, error: "ticket_user_mismatch" };
  }

  const expectedSig = signTicket({
    secret: args.secret,
    jti,
    userId: row.user_id,
    accountId: row.account_id,
    expSec: Math.floor(row.expires_at.getTime() / 1000),
  });
  if (!constantTimeEqualHex(sigHex, expectedSig)) {
    return { ok: false, error: "invalid_ticket" };
  }

  return {
    ok: true,
    data: {
      accountId: row.account_id,
      refreshToken: row.refresh_token,
      accessToken: row.access_token,
      expiresInSec: row.expires_in,
    },
  };
}

const JTI_RE = /^[A-Za-z0-9_-]{16,64}$/;
function isWellFormedJti(s: unknown): s is string {
  return typeof s === "string" && JTI_RE.test(s);
}

const HEX_64_RE = /^[0-9a-f]{64}$/;
function isWellFormedSig(s: unknown): s is string {
  return typeof s === "string" && s.length === SIG_LEN_HEX && HEX_64_RE.test(s);
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a, "hex");
  const bBuf = Buffer.from(b, "hex");
  if (aBuf.length === 0 || aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
