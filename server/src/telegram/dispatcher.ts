// dispatcher.ts — routes Telegram updates to the appropriate handler.
//
// /start <CODE> — redeem a linking code (handleStart)
// /start        — onboarding message (handleStart)
// Other handlers (text capture, voice, commands) will be added in TG-03/TG-05/TG-06.

import type { Update } from "grammy/types";
import type { FastifyBaseLogger } from "fastify";
import type pg from "pg";
import { getBot } from "./bot";
import { handleStart } from "./handlers/start";

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
    void handleStart(msg, pool, log)
      .then((reply) => {
        const bot = getBot();
        return bot.api.sendMessage(msg.chat.id, reply);
      })
      .catch((err: unknown) => {
        log.error({ err }, "[telegram] failed to reply to /start");
      });
  }
}
