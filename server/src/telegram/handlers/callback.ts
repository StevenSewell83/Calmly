// TGR-03 — callback_query handler: parses `<actionId>:<rowId>` out of
// callback_data, loads the outbound_messages row rowId points at (that's
// where the button's real payload lives — see outbound.ts), and dispatches
// to whatever handler registered itself under actionId (actions.ts).
// Telegram requires every callback_query to be answered even when nothing
// useful happened — an unanswered button just spins in the Telegram
// client — so every exit path below calls answerCallbackQuery.

import type { CallbackQuery } from "grammy/types";
import type { FastifyBaseLogger } from "fastify";
import type pg from "pg";
import { getAction, type ActionContext } from "../actions";

const EXPIRED_TEXT = "This button expired.";
const ERROR_TEXT = "Something went wrong. Try again.";

interface StoredButton {
  actionId: string;
  payload?: unknown;
}

interface StoredPayload {
  buttons?: StoredButton[];
}

export interface CallbackBotClient {
  api: {
    answerCallbackQuery(
      callbackQueryId: string,
      other?: { text?: string; show_alert?: boolean },
    ): Promise<unknown>;
  };
}

export interface HandleCallbackQueryDeps {
  bot: CallbackBotClient;
}

export async function handleCallbackQuery(
  callbackQuery: CallbackQuery,
  pool: pg.Pool,
  log: FastifyBaseLogger,
  deps: HandleCallbackQueryDeps,
): Promise<void> {
  const data = callbackQuery.data;
  if (data === undefined) {
    log.warn({ callbackQueryId: callbackQuery.id }, "[telegram] callback_query with no data");
    await answer(deps.bot, callbackQuery.id, EXPIRED_TEXT);
    return;
  }

  const sep = data.indexOf(":");
  if (sep === -1) {
    log.warn(
      { callbackQueryId: callbackQuery.id, data },
      "[telegram] malformed callback_data (no separator)",
    );
    await answer(deps.bot, callbackQuery.id, EXPIRED_TEXT);
    return;
  }
  const actionId = data.slice(0, sep);
  const rowId = data.slice(sep + 1);

  const rowResult = await pool.query<{
    id: string;
    user_id: string;
    chat_id: string;
    payload: StoredPayload | null;
  }>(`SELECT id, user_id, chat_id, payload FROM outbound_messages WHERE id = $1`, [rowId]);
  const row = rowResult.rows[0];
  if (!row) {
    log.warn(
      { callbackQueryId: callbackQuery.id, rowId },
      "[telegram] callback references unknown outbound message",
    );
    await answer(deps.bot, callbackQuery.id, EXPIRED_TEXT);
    return;
  }

  const handler = getAction(actionId);
  if (!handler) {
    log.warn(
      { callbackQueryId: callbackQuery.id, actionId },
      "[telegram] callback for unregistered action",
    );
    await answer(deps.bot, callbackQuery.id, EXPIRED_TEXT);
    return;
  }

  const button = row.payload?.buttons?.find((b) => b.actionId === actionId);
  const ctx: ActionContext = {
    userId: row.user_id,
    chatId: row.chat_id,
    outboundMessageId: row.id,
    actionId,
    payload: button?.payload,
    callbackQueryId: callbackQuery.id,
  };

  try {
    const result = await handler(ctx);
    await answer(deps.bot, callbackQuery.id, result?.answerText, result?.showAlert);
  } catch (err) {
    log.error(
      { err, actionId, callbackQueryId: callbackQuery.id },
      "[telegram] action handler threw",
    );
    await answer(deps.bot, callbackQuery.id, ERROR_TEXT);
  }
}

async function answer(
  bot: CallbackBotClient,
  callbackQueryId: string,
  text?: string,
  showAlert?: boolean,
): Promise<void> {
  try {
    await bot.api.answerCallbackQuery(
      callbackQueryId,
      text === undefined ? undefined : { text, show_alert: showAlert },
    );
  } catch {
    // Best-effort ack — if Telegram itself is unreachable here there's
    // nothing more useful to do than let the update finish processing.
  }
}
