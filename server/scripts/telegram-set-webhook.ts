#!/usr/bin/env node
// telegram-set-webhook.ts — registers or clears the webhook with Telegram,
// and (TGR-04) registers the bot's slash-command list via setMyCommands.
//
// Usage:
//   TELEGRAM_BOT_TOKEN=<token> TELEGRAM_WEBHOOK_URL=https://... \
//     TELEGRAM_WEBHOOK_SECRET=<secret> \
//     node --import=tsx/esm server/scripts/telegram-set-webhook.ts
//
// Pass --delete to remove the webhook instead (commands are left as-is).

import "dotenv/config";
import { loadTelegramConfig } from "../src/telegram/config";
import { registerBotCommands } from "../src/telegram/commands";
import { Bot } from "grammy";

const doDelete = process.argv.includes("--delete");

const config = loadTelegramConfig();
if (!config) {
  console.error("TELEGRAM_BOT_TOKEN is not set");
  process.exit(1);
}

const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

if (doDelete) {
  const result = await bot.api.deleteWebhook();
  console.log("Webhook deleted:", result);
} else {
  if (!config.TELEGRAM_WEBHOOK_URL) {
    console.error("TELEGRAM_WEBHOOK_URL is required to set the webhook");
    process.exit(1);
  }
  const result = await bot.api.setWebhook(config.TELEGRAM_WEBHOOK_URL, {
    secret_token: config.TELEGRAM_WEBHOOK_SECRET,
  });
  console.log("Webhook set:", result);
  const info = await bot.api.getWebhookInfo();
  console.log("Webhook info:", JSON.stringify(info, null, 2));

  await registerBotCommands(bot);
  console.log("Bot commands registered.");
}
