// TGR-03a-rebuild — server-side writer for Telegram text captures.
// Pure pg.Pool function (no Fastify/grammy coupling) so the bot handler
// layer and any future ingestion path can share it. Rebuilds the lost
// TG-03b writer on top of the external_ref schema TG-03a already landed
// (server/migrations/0011_inbox_external_ref.cjs).
//
// One INSERT .. SELECT resolves user_id from telegram_links and performs
// the insert in the same round trip; ON CONFLICT (user_id, external_ref)
// makes retried Telegram webhook deliveries idempotent — no duplicate row,
// same inboxId returned.

import { randomUUID } from "node:crypto";
import type pg from "pg";

const MAX_RAW_TEXT_LENGTH = 4000;

export interface CaptureFromTelegramInput {
  chatId: string;
  telegramMessageId: number;
  rawText: string;
  now: number;
}

export interface CaptureFromTelegramOk {
  ok: true;
  inboxId: string;
  truncated: boolean;
  alreadyProcessed: boolean;
}

export interface CaptureFromTelegramUnlinked {
  ok: false;
  error: "unlinked";
}

export type CaptureFromTelegramResult =
  | CaptureFromTelegramOk
  | CaptureFromTelegramUnlinked;

export async function captureFromTelegram(
  pool: pg.Pool,
  input: CaptureFromTelegramInput,
): Promise<CaptureFromTelegramResult> {
  const { chatId, telegramMessageId, rawText, now } = input;

  const truncated = rawText.length > MAX_RAW_TEXT_LENGTH;
  const text = truncated ? rawText.slice(0, MAX_RAW_TEXT_LENGTH) : rawText;
  const externalRef = `tg:${chatId}:${telegramMessageId}`;
  const inboxId = randomUUID();

  // Discriminate a fresh insert from a replay hitting the conflict path
  // via the `xmax = 0` trick: a newly inserted row's xmax is 0, while a
  // row touched by the DO UPDATE branch gets a non-zero xmax from this
  // transaction. The SELECT ... FROM telegram_links resolves user_id and
  // doubles as the "unlinked" check — zero source rows means zero rows
  // to insert, so RETURNING comes back empty.
  const result = await pool.query<{ id: string; inserted: boolean }>(
    `INSERT INTO inbox_items
       (id, user_id, raw_text, source, created_at, resolved_at, snoozed_until,
        external_ref, version, updated_at, deleted_at)
     SELECT $1, tl.user_id, $3, 'telegram-text', $4, NULL, NULL, $5,
            nextval('sync_version'), $4, NULL
       FROM telegram_links tl
      WHERE tl.chat_id = $2 AND tl.deleted_at IS NULL
      LIMIT 1
     ON CONFLICT (user_id, external_ref) WHERE external_ref IS NOT NULL
       DO UPDATE SET updated_at = inbox_items.updated_at
     RETURNING id, (xmax = 0) AS inserted`,
    [inboxId, chatId, text, now, externalRef],
  );

  const row = result.rows[0];
  if (!row) {
    return { ok: false, error: "unlinked" };
  }

  return {
    ok: true,
    inboxId: row.id,
    truncated,
    alreadyProcessed: !row.inserted,
  };
}
