// TGR-03 — outbound-message substrate: send/edit Telegram messages that
// carry inline action buttons, and correlate button presses back to the
// row that produced them. TGR-09 (reminders) and TGR-11 (Done/Snooze/
// Reschedule handlers) build on top of sendMessage/editMessage; this
// bead only owns the send/persist/retry/blocked-event plumbing.
//
// Why persist before sending: callback_data is capped at 64 bytes by
// Telegram, nowhere near enough to carry a button's full payload. So the
// row is written first (status optimistically 'sent' — the insert and
// the API call happen in the same request, there's no queue in between)
// and callback_data is just `<actionId>:<rowId>`; the callback handler
// loads the row and reads the real payload out of its `payload` jsonb.

import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { InlineKeyboardMarkup } from "@grammyjs/types";
import { getLinkingStatus } from "./linking";

const MAX_CALLBACK_DATA_BYTES = 64;
const DEFAULT_INTENT = "message";
const RETRY_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 200;

export class TelegramNotLinkedError extends Error {
  constructor(readonly userId: string) {
    super(`user ${userId} has no linked Telegram chat`);
    this.name = "TelegramNotLinkedError";
  }
}

export class OutboundMessageNotFoundError extends Error {
  constructor(readonly outboundMessageId: string) {
    super(`outbound message ${outboundMessageId} not found`);
    this.name = "OutboundMessageNotFoundError";
  }
}

// Thrown when editMessage targets a row whose original send never
// produced a Telegram message (blocked/failed/still in flight) — there
// is nothing on Telegram to edit in place.
export class OutboundMessageNotSentError extends Error {
  constructor(readonly outboundMessageId: string) {
    super(`outbound message ${outboundMessageId} was never sent — nothing to edit`);
    this.name = "OutboundMessageNotSentError";
  }
}

// Retries exhausted on a 5xx/network error. `sourceError` (not `cause` —
// that name collides with Error's own ES2022 `cause` field, which would
// need an `override` modifier and a different runtime shape) holds
// whatever the bot client last threw.
export class TelegramSendFailedError extends Error {
  constructor(
    readonly outboundMessageId: string,
    readonly sourceError: unknown,
  ) {
    super(`sending outbound message ${outboundMessageId} failed after retries`);
    this.name = "TelegramSendFailedError";
  }
}

export interface SendMessageButton {
  label: string;
  actionId: string;
  payload?: unknown;
}

export interface SendMessageInput {
  text: string;
  buttons?: SendMessageButton[];
  /** Caller-supplied label for what this message is about (e.g. 'reminder'). */
  intent?: string;
}

export type EditMessageInput = Omit<SendMessageInput, "intent">;

export type OutboundStatus = "sent" | "blocked" | "failed";

export interface SendMessageResult {
  outboundMessageId: string;
  status: OutboundStatus;
  telegramMessageId: number | null;
}

// Structural subset of grammy's Bot — enough for outbound sends. Real Bot
// instances satisfy this; tests pass MockTelegramBotApi.
export interface OutboundBotClient {
  api: {
    sendMessage(
      chatId: number | string,
      text: string,
      other?: { reply_markup?: InlineKeyboardMarkup },
    ): Promise<{ message_id: number }>;
    editMessageText(
      chatId: number | string,
      messageId: number,
      text: string,
      other?: { reply_markup?: InlineKeyboardMarkup },
    ): Promise<unknown>;
  };
}

export interface OutboundDeps {
  bot: OutboundBotClient;
  /** Overridable for tests; defaults to a real setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface OutboundBlockedEvent {
  userId: string;
  chatId: string;
  outboundMessageId: string;
  intent: string;
}

type BlockedListener = (event: OutboundBlockedEvent) => void;

const blockedListeners = new Set<BlockedListener>();

/** Subscribe to 403 ("bot blocked by user") outcomes. Returns an unsubscribe fn. */
export function onOutboundBlocked(listener: BlockedListener): () => void {
  blockedListeners.add(listener);
  return () => blockedListeners.delete(listener);
}

function emitBlocked(event: OutboundBlockedEvent): void {
  for (const listener of blockedListeners) {
    // A listener throwing must not break the send/edit call that
    // triggered it — log-and-continue would need a logger here, so we
    // just isolate failures per listener instead.
    try {
      listener(event);
    } catch {
      // intentionally swallowed — see comment above.
    }
  }
}

export async function sendMessage(
  pool: pg.Pool,
  userId: string,
  input: SendMessageInput,
  deps: OutboundDeps,
): Promise<SendMessageResult> {
  const linkStatus = await getLinkingStatus(pool, userId);
  if (!linkStatus.linked) {
    throw new TelegramNotLinkedError(userId);
  }
  const chatId = linkStatus.chatId;
  const intent = input.intent ?? DEFAULT_INTENT;
  const buttons = input.buttons ?? [];
  const id = randomUUID();
  const now = (deps.now ?? Date.now)();

  const replyMarkup = buildReplyMarkup(id, buttons);

  await pool.query(
    `INSERT INTO outbound_messages
       (id, user_id, chat_id, intent, payload, telegram_message_id, status, sent_at, created_at)
     VALUES ($1, $2, $3, $4, $5, NULL, 'sent', NULL, $6)`,
    [id, userId, chatId, intent, JSON.stringify({ buttons }), now],
  );

  const outcome = await sendWithRetry(
    () => deps.bot.api.sendMessage(chatId, input.text, replyMarkup ? { reply_markup: replyMarkup } : undefined),
    deps.sleep,
  );

  if (outcome.kind === "ok") {
    await pool.query(
      `UPDATE outbound_messages SET telegram_message_id = $2, sent_at = $3, status = 'sent' WHERE id = $1`,
      [id, outcome.value.message_id, (deps.now ?? Date.now)()],
    );
    return { outboundMessageId: id, status: "sent", telegramMessageId: outcome.value.message_id };
  }

  if (outcome.kind === "blocked") {
    await pool.query(`UPDATE outbound_messages SET status = 'blocked' WHERE id = $1`, [id]);
    emitBlocked({ userId, chatId, outboundMessageId: id, intent });
    return { outboundMessageId: id, status: "blocked", telegramMessageId: null };
  }

  await pool.query(`UPDATE outbound_messages SET status = 'failed' WHERE id = $1`, [id]);
  throw new TelegramSendFailedError(id, outcome.error);
}

export async function editMessage(
  pool: pg.Pool,
  outboundMessageId: string,
  input: EditMessageInput,
  deps: OutboundDeps,
): Promise<SendMessageResult> {
  const rowResult = await pool.query<{
    user_id: string;
    chat_id: string;
    telegram_message_id: string | null;
    intent: string;
  }>(
    `SELECT user_id, chat_id, telegram_message_id::text AS telegram_message_id, intent
       FROM outbound_messages WHERE id = $1`,
    [outboundMessageId],
  );
  const row = rowResult.rows[0];
  if (!row) {
    throw new OutboundMessageNotFoundError(outboundMessageId);
  }
  if (row.telegram_message_id === null) {
    throw new OutboundMessageNotSentError(outboundMessageId);
  }

  const buttons = input.buttons ?? [];
  const replyMarkup = buildReplyMarkup(outboundMessageId, buttons);
  const telegramMessageId = parseInt(row.telegram_message_id, 10);

  const outcome = await sendWithRetry(
    () =>
      deps.bot.api.editMessageText(
        row.chat_id,
        telegramMessageId,
        input.text,
        replyMarkup ? { reply_markup: replyMarkup } : undefined,
      ),
    deps.sleep,
  );

  if (outcome.kind === "ok") {
    await pool.query(`UPDATE outbound_messages SET payload = $2 WHERE id = $1`, [
      outboundMessageId,
      JSON.stringify({ buttons }),
    ]);
    return { outboundMessageId, status: "sent", telegramMessageId };
  }

  if (outcome.kind === "blocked") {
    await pool.query(`UPDATE outbound_messages SET status = 'blocked' WHERE id = $1`, [
      outboundMessageId,
    ]);
    emitBlocked({
      userId: row.user_id,
      chatId: row.chat_id,
      outboundMessageId,
      intent: row.intent,
    });
    return { outboundMessageId, status: "blocked", telegramMessageId };
  }

  await pool.query(`UPDATE outbound_messages SET status = 'failed' WHERE id = $1`, [
    outboundMessageId,
  ]);
  throw new TelegramSendFailedError(outboundMessageId, outcome.error);
}

function buildReplyMarkup(
  rowId: string,
  buttons: SendMessageButton[],
): InlineKeyboardMarkup | undefined {
  if (buttons.length === 0) return undefined;
  return {
    inline_keyboard: buttons.map((b) => {
      const callbackData = `${b.actionId}:${rowId}`;
      if (Buffer.byteLength(callbackData, "utf8") > MAX_CALLBACK_DATA_BYTES) {
        throw new Error(
          `callback_data "${callbackData}" exceeds Telegram's ${MAX_CALLBACK_DATA_BYTES}-byte limit — shorten actionId "${b.actionId}"`,
        );
      }
      return [{ text: b.label, callback_data: callbackData }];
    }),
  };
}

type RetryOutcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "blocked" }
  | { kind: "failed"; error: unknown };

async function sendWithRetry<T>(
  call: () => Promise<T>,
  sleep: OutboundDeps["sleep"] = defaultSleep,
): Promise<RetryOutcome<T>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const value = await call();
      return { kind: "ok", value };
    } catch (err) {
      if (isBlockedError(err)) {
        return { kind: "blocked" };
      }
      if (!isRetryableError(err)) {
        return { kind: "failed", error: err };
      }
      lastError = err;
      if (attempt < RETRY_ATTEMPTS - 1) {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt);
      }
    }
  }
  return { kind: "failed", error: lastError };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Telegram's "bot was blocked by the user" error — grammy's GrammyError
// carries this as error_code 403. Checked structurally (not via
// instanceof grammy.GrammyError) so tests can throw plain objects
// without importing grammy's error classes.
function isBlockedError(err: unknown): boolean {
  return getErrorCode(err) === 403;
}

// 5xx and network-level failures are retried; any other 4xx (bad
// request, chat not found, etc.) is a caller bug, not a transient
// condition, so it fails immediately instead of retrying 3x for nothing.
function isRetryableError(err: unknown): boolean {
  const code = getErrorCode(err);
  if (code !== undefined) return code >= 500;
  // No error_code at all (e.g. a raw network/fetch failure, grammy's
  // HttpError) — treat as transient.
  return true;
}

function getErrorCode(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const code = (err as { error_code?: unknown }).error_code;
  return typeof code === "number" ? code : undefined;
}

// Test-only escape hatch, mirrors linking.ts's __INTERNAL pattern.
export const __INTERNAL = {
  clearBlockedListeners(): void {
    blockedListeners.clear();
  },
};
