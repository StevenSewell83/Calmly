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
import type { InboxSource } from "@calmly/shared";

const MAX_RAW_TEXT_LENGTH = 4000;
const DEFAULT_SOURCE: InboxSource = "telegram-text";

export interface CaptureFromTelegramInput {
  chatId: string;
  telegramMessageId: number;
  rawText: string;
  now: number;
  // TGR-02: voice captures pass 'telegram-voice' so the row is
  // distinguishable in the inbox; defaults to the original text-capture
  // source so TGR-01 callers are unaffected.
  source?: InboxSource;
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
  const { chatId, telegramMessageId, rawText, now, source } = input;

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
     SELECT $1, tl.user_id, $3, $6, $4, NULL, NULL, $5,
            nextval('sync_version'), $4, NULL
       FROM telegram_links tl
      WHERE tl.chat_id = $2 AND tl.deleted_at IS NULL
      LIMIT 1
     ON CONFLICT (user_id, external_ref) WHERE external_ref IS NOT NULL
       DO UPDATE SET updated_at = inbox_items.updated_at
     RETURNING id, (xmax = 0) AS inserted`,
    [inboxId, chatId, text, now, externalRef, source ?? DEFAULT_SOURCE],
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

// TGR-02: the voice handler needs to know a chat is linked BEFORE it
// downloads and transcribes (no point paying for either on an unlinked
// chat) — captureFromTelegram only surfaces "unlinked" as a side effect
// of the insert, which needs the transcript in hand already. This is a
// plain existence check against the same table, kept here alongside the
// writer it fronts.
export async function isTelegramChatLinked(
  pool: pg.Pool,
  chatId: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM telegram_links WHERE chat_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [chatId],
  );
  return (result.rowCount ?? 0) > 0;
}

// TGR-02 replay guard: Telegram retries webhooks it thinks failed, and the
// insert-time ON CONFLICT only dedupes AFTER download + transcription have
// already been paid for. This lets the voice handler detect a replay up
// front and re-ack with the stored transcript instead.
export async function findExistingTelegramCapture(
  pool: pg.Pool,
  { chatId, telegramMessageId }: { chatId: string; telegramMessageId: number },
): Promise<string | null> {
  const externalRef = `tg:${chatId}:${telegramMessageId}`;
  const result = await pool.query<{ raw_text: string }>(
    `SELECT i.raw_text
       FROM inbox_items i
       JOIN telegram_links l ON l.user_id = i.user_id AND l.deleted_at IS NULL
      WHERE l.chat_id = $1 AND i.external_ref = $2 AND i.deleted_at IS NULL
      LIMIT 1`,
    [chatId, externalRef],
  );
  return result.rows[0]?.raw_text ?? null;
}
