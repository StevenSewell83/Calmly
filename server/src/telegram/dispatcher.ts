// dispatcher.ts — routes Telegram updates to the appropriate handler.
//
// /start <CODE> — redeem a linking code (handleStart)
// /start        — onboarding message (handleStart)
// /now          — current focus task + next step (TGR-04, handleNow)
// /today        — today's plan (TGR-05, handleToday)
// /inbox        — inbox count + previews (TGR-05, handleInbox)
// voice notes   — download + transcribe + inbox capture (handleVoice)
// plain text / other media — inbox capture + fallback reply (handleText)
// callback_query — inline button presses on outbound messages (TGR-03,
//   handleCallbackQuery)

import type { Update } from "grammy/types";
import type { FastifyBaseLogger } from "fastify";
import type pg from "pg";
import { getBot } from "./bot";
import { handleStart } from "./handlers/start";
import { handleNow } from "./handlers/commands/now";
import { handleToday } from "./handlers/commands/today";
import { handleInbox } from "./handlers/commands/inbox";
import { handleText } from "./handlers/text";
import { handleVoice, getDefaultTranscriptionProvider } from "./handlers/voice";
import { handleCallbackQuery, type CallbackBotClient } from "./handlers/callback";
import type { TelegramFileClient } from "./files";

export function dispatchUpdate(
  update: Update,
  log: FastifyBaseLogger,
  pool: pg.Pool,
): void {
  const type =
    "message" in update && update.message
      ? update.message.text
        ? "text"
        : update.message.voice
          ? "voice"
          : "other-message"
      : "callback_query" in update && update.callback_query
        ? "callback_query"
        : "non-message";
  log.info({ update_id: update.update_id, type }, "[telegram] update received");

  if ("callback_query" in update && update.callback_query) {
    const callbackQuery = update.callback_query;
    // grammy's Bot.api really does satisfy CallbackBotClient at runtime
    // (a single answerCallbackQuery(id, other?) method); the cast mirrors
    // the one below for handleVoice's TelegramFileClient — grammy's Other<>
    // helper types are structurally richer than our narrow test-facing
    // interface, not incompatible with it.
    void handleCallbackQuery(callbackQuery, pool, log, {
      bot: getBot() as unknown as CallbackBotClient,
    }).catch((err: unknown) => {
      log.error({ err }, "[telegram] failed to handle callback_query");
    });
    return;
  }

  if (!update.message) return;
  const msg = update.message;

  const text = msg.text?.trim() ?? "";
  if (text === "/start" || text.startsWith("/start ")) {
    void handleStart(msg, pool, log).then((reply) => {
      const bot = getBot();
      return bot.api.sendMessage(msg.chat.id, reply);
    }).catch((err: unknown) => {
      log.error({ err }, "[telegram] failed to reply to /start");
    });
    return;
  }

  if (text === "/now") {
    // MarkdownV2 so handleNow's escaped task title/next-step interpolate
    // safely; the fixed template text it returns is already hand-escaped.
    void handleNow(msg, pool, log).then((reply) => {
      const bot = getBot();
      return bot.api.sendMessage(msg.chat.id, reply, { parse_mode: "MarkdownV2" });
    }).catch((err: unknown) => {
      log.error({ err }, "[telegram] failed to reply to /now");
    });
    return;
  }

  if (text === "/today") {
    void handleToday(msg, pool, log).then((reply) => {
      const bot = getBot();
      return bot.api.sendMessage(msg.chat.id, reply, { parse_mode: "MarkdownV2" });
    }).catch((err: unknown) => {
      log.error({ err }, "[telegram] failed to reply to /today");
    });
    return;
  }

  if (text === "/inbox") {
    void handleInbox(msg, pool, log).then((reply) => {
      const bot = getBot();
      return bot.api.sendMessage(msg.chat.id, reply, { parse_mode: "MarkdownV2" });
    }).catch((err: unknown) => {
      log.error({ err }, "[telegram] failed to reply to /inbox");
    });
    return;
  }

  if (msg.voice) {
    // Deferred via Promise.resolve().then so a synchronous throw while
    // resolving the default transcription provider (e.g. missing
    // TRANSCRIPTION_PROVIDER config) becomes a rejection the trailing
    // .catch swallows, instead of escaping dispatchUpdate synchronously.
    void Promise.resolve()
      .then(() =>
        handleVoice(msg, pool, log, {
          // grammy's Bot.api.getFile really does match TelegramFileClient
          // at runtime (token + api.getFile(fileId, signal?)); the cast
          // is needed because grammy types the signal param against its
          // bundled 'abort-controller' polyfill class, not the ambient
          // DOM AbortSignal files.ts declares against — two structurally
          // incompatible classes for what is the same runtime value.
          bot: getBot() as unknown as TelegramFileClient,
          provider: getDefaultTranscriptionProvider(),
        }),
      )
      .then((reply) => {
        if (reply === null) return;
        const bot = getBot();
        return bot.api.sendMessage(msg.chat.id, reply);
      })
      .catch((err: unknown) => {
        log.error({ err }, "[telegram] failed to reply to voice update");
      });
    return;
  }

  void handleText(msg, pool, log).then((reply) => {
    if (reply === null) return;
    const bot = getBot();
    return bot.api.sendMessage(msg.chat.id, reply);
  }).catch((err: unknown) => {
    log.error({ err }, "[telegram] failed to reply to text/media update");
  });
}
