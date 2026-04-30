// bot.ts — grammy Bot wrapper for the Calmly Telegram integration.
//
// Why grammy: typed Update objects, async middleware model, built-in
// webhook adapter for Fastify, active maintenance, native ESM support.
//
// The bot is created once at startup and shared with the webhook dispatcher
// and the health route via the module-level singleton below.

import { Bot } from "grammy";
import type { TelegramConfig } from "./config";

let _bot: Bot | null = null;

export function initBot(config: TelegramConfig): Bot {
  if (_bot) return _bot;
  _bot = new Bot(config.TELEGRAM_BOT_TOKEN);
  return _bot;
}

export function getBot(): Bot {
  if (!_bot) throw new Error("Telegram bot not initialised — call initBot first");
  return _bot;
}
