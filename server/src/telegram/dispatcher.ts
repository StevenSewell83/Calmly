// dispatcher.ts — stub update dispatcher.
//
// Receives a validated Telegram Update, logs update_id + type, and returns
// immediately. Real handlers (text capture, voice, commands) will be
// registered here in TG-03/TG-05/TG-06.

import type { Update } from "grammy/types";
import type { FastifyBaseLogger } from "fastify";

export function dispatchUpdate(update: Update, log: FastifyBaseLogger): void {
  const type =
    "message" in update && update.message
      ? update.message.text
        ? "text"
        : update.message.voice
          ? "voice"
          : "other-message"
      : "non-message";
  log.info({ update_id: update.update_id, type }, "[telegram] update received");
}
