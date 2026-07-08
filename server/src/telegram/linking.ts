// TG-02a — Telegram linking service. Pure functions over a pg.Pool;
// no Fastify or grammy imports. The HTTP routes (TG-02b) call
// generateLinkingCode / getLinkingStatus / unlinkTelegram; the bot's
// /start handler (TG-02b) calls redeemLinkingCode.
//
// Why server-only state for codes: the code itself is a one-time
// shared secret between the user's desktop and the bot. It never
// needs to reach another device, and replicating it through sync
// would widen the secret's surface area for no benefit.

import { randomInt, randomUUID } from "node:crypto";
import type pg from "pg";

// 32-char ambiguity-free alphabet — no 0/O, 1/I/L, removes the most
// common transcription errors when a user types the code from desktop
// into Telegram on a phone. 32^8 = 1.1 × 10^12 possibilities; with
// 5 active codes per user the collision chance per generation is
// negligible (we still retry on the unique-constraint violation).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_ACTIVE_CODES_PER_USER = 5;
const COLLISION_RETRIES = 5;

export interface GenerateCodeOk {
  ok: true;
  code: string;
  /** Epoch ms when the code stops being redeemable. */
  expiresAt: number;
}

export interface GenerateCodeErr {
  ok: false;
  error: "rate_limited";
}

export type GenerateCodeResult = GenerateCodeOk | GenerateCodeErr;

export async function generateLinkingCode(
  pool: pg.Pool,
  userId: string,
  now: number,
): Promise<GenerateCodeResult> {
  const activeCount = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM telegram_linking_codes
      WHERE user_id = $1
        AND consumed_at IS NULL
        AND expires_at > $2`,
    [userId, now],
  );
  if (
    parseInt(activeCount.rows[0]?.count ?? "0", 10) >= MAX_ACTIVE_CODES_PER_USER
  ) {
    return { ok: false, error: "rate_limited" };
  }

  const expiresAt = now + CODE_TTL_MS;
  for (let attempt = 0; attempt < COLLISION_RETRIES; attempt++) {
    const code = randomCode();
    try {
      await pool.query(
        `INSERT INTO telegram_linking_codes (code, user_id, expires_at, created_at)
         VALUES ($1, $2, $3, $4)`,
        [code, userId, expiresAt, now],
      );
      return { ok: true, code, expiresAt };
    } catch (e: unknown) {
      // Postgres unique_violation = 23505. Retry on collision; rethrow
      // anything else so the route surfaces a 500 rather than silently
      // looping. node-postgres puts the SQLSTATE on .code.
      if (isUniqueViolation(e) && attempt < COLLISION_RETRIES - 1) continue;
      throw e;
    }
  }
  // Exhausted retries — vanishingly unlikely with 32^8 keyspace, but
  // surface as rate_limited rather than 500 since the user-facing
  // experience is "try again in a moment" either way.
  return { ok: false, error: "rate_limited" };
}

export interface RedeemCodeOk {
  ok: true;
  userId: string;
  /** True when the user already had a different chat linked and this call replaced it. */
  replacedExistingLink: boolean;
}

export type RedeemCodeError =
  | { ok: false; error: "not_found" }
  | { ok: false; error: "expired" }
  | { ok: false; error: "already_used" };

export type RedeemCodeResult = RedeemCodeOk | RedeemCodeError;

// Atomic in a single transaction: validate code → mark consumed →
// upsert telegram_links row. Caller passes the bot's chat_id and
// optional username (Telegram users without a public username are
// permitted; we store NULL).
export async function redeemLinkingCode(
  pool: pg.Pool,
  rawCode: string,
  chatId: string,
  telegramUsername: string | null,
  now: number,
): Promise<RedeemCodeResult> {
  const code = rawCode.toUpperCase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // FOR UPDATE locks the row so two parallel /start commands with the
    // same code can't both succeed.
    const codeRow = await client.query<{
      user_id: string;
      expires_at: string;
      consumed_at: string | null;
    }>(
      `SELECT user_id, expires_at::text AS expires_at,
              consumed_at::text AS consumed_at
         FROM telegram_linking_codes
        WHERE code = $1
        FOR UPDATE`,
      [code],
    );
    const row = codeRow.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, error: "not_found" };
    }
    if (row.consumed_at !== null) {
      await client.query("ROLLBACK");
      return { ok: false, error: "already_used" };
    }
    if (parseInt(row.expires_at, 10) <= now) {
      await client.query("ROLLBACK");
      return { ok: false, error: "expired" };
    }

    await client.query(
      `UPDATE telegram_linking_codes SET consumed_at = $1 WHERE code = $2`,
      [now, code],
    );

    // Replace any existing link for this user. The unique chat_id
    // constraint also kicks in if a *different* user previously linked
    // this same Telegram chat — handle that by reassigning the row
    // (DELETE then INSERT inside the same tx).
    const existing = await client.query<{ id: string; chat_id: string }>(
      `SELECT id, chat_id FROM telegram_links WHERE user_id = $1`,
      [row.user_id],
    );
    const replacedExistingLink =
      existing.rows.length > 0 && existing.rows[0]!.chat_id !== chatId;

    await client.query(
      `DELETE FROM telegram_links WHERE user_id = $1 OR chat_id = $2`,
      [row.user_id, chatId],
    );
    await client.query(
      `INSERT INTO telegram_links
         (id, user_id, chat_id, linked_at, version, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, 1, $4, NULL)`,
      [randomUUID(), row.user_id, chatId, now],
    );

    // telegram_username isn't currently a column on telegram_links —
    // adding it would be a schema-touches-three-places change scoped
    // to a future bead. For now the username is logged by the route
    // layer and dropped here.
    void telegramUsername;

    await client.query("COMMIT");
    return { ok: true, userId: row.user_id, replacedExistingLink };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export interface LinkingStatusUnlinked {
  linked: false;
}

export interface LinkingStatusLinked {
  linked: true;
  chatId: string;
  linkedAt: number;
}

export type LinkingStatus = LinkingStatusUnlinked | LinkingStatusLinked;

export async function getLinkingStatus(
  pool: pg.Pool,
  userId: string,
): Promise<LinkingStatus> {
  const r = await pool.query<{ chat_id: string; linked_at: string }>(
    `SELECT chat_id, linked_at::text AS linked_at
       FROM telegram_links
      WHERE user_id = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [userId],
  );
  const row = r.rows[0];
  if (!row) return { linked: false };
  return {
    linked: true,
    chatId: row.chat_id,
    linkedAt: parseInt(row.linked_at, 10),
  };
}

export async function unlinkTelegram(
  pool: pg.Pool,
  userId: string,
): Promise<{ ok: true; deleted: number }> {
  const r = await pool.query(`DELETE FROM telegram_links WHERE user_id = $1`, [
    userId,
  ]);
  return { ok: true, deleted: r.rowCount ?? 0 };
}

function randomCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

function isUniqueViolation(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const code = (e as { code?: unknown }).code;
  return code === "23505";
}

// Exported for tests so they can synthesize codes without going
// through the keyspace lottery.
export const __INTERNAL = {
  CODE_ALPHABET,
  CODE_LENGTH,
  CODE_TTL_MS,
  MAX_ACTIVE_CODES_PER_USER,
  randomCode,
};
