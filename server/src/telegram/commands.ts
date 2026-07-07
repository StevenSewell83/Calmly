// TGR-04 — bot command list + setMyCommands registration. /now is the
// first entry beyond /start; TGR-05 appends /today and /inbox to this
// same list rather than introducing a second registration call.

import type { BotCommand } from "@grammyjs/types";

export const BOT_COMMANDS: readonly BotCommand[] = [
  { command: "start", description: "Link your Telegram account to Calmly" },
  { command: "now", description: "See your current focus task and next step" },
  { command: "today", description: "See today's plan" },
  { command: "inbox", description: "See your inbox count and recent items" },
];

// Structural subset of grammy's Bot — enough to register commands. Real
// Bot instances satisfy this; tests pass MockTelegramBotApi.
export interface CommandRegistrationBotClient {
  api: {
    setMyCommands(commands: readonly BotCommand[]): Promise<true>;
  };
}

export async function registerBotCommands(
  bot: CommandRegistrationBotClient,
): Promise<true> {
  return bot.api.setMyCommands(BOT_COMMANDS);
}
