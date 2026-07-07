// dispatcher.ts — routes Telegram updates to the appropriate handler.
//
// /start <CODE> — redeem a linking code (handleStart)
// /start        — onboarding message (handleStart)
// voice notes   — download + transcribe + inbox capture (handleVoice)
// plain text / other media — inbox capture + fallback reply (handleText)
// Slash commands other than /start (TGR-04/05) are still out of scope
// here.

import type { Update } from "grammy/types";
import type { FastifyBaseLogger } from "fastify";
import type pg from "pg";
import { getBot } from "./bot";
import { handleStart } from "./handlers/start";
import { handleText } from "./handlers/text";
import { handleVoice, getDefaultTranscriptionProvider } from "./handlers/voice";
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
      : "non-message";
  log.info({ update_id: update.update_id, type }, "[telegram] update received");

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
