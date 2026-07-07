// TGR-04 — bot command list + setMyCommands registration. Exercised
// against the shared MockTelegramBotApi harness rather than real
// Telegram (see server/scripts/telegram-set-webhook.ts for the CLI
// entrypoint that calls this in production).

import { describe, expect, it } from "vitest";
import { MockTelegramBotApi } from "../../test-utils/telegramBotMock";
import { BOT_COMMANDS, registerBotCommands } from "../commands";

describe("BOT_COMMANDS", () => {
  it("includes /start and /now", () => {
    const names = BOT_COMMANDS.map((c) => c.command);
    expect(names).toContain("start");
    expect(names).toContain("now");
  });

  it("every command has a non-empty description", () => {
    for (const c of BOT_COMMANDS) {
      expect(c.description.length).toBeGreaterThan(0);
    }
  });
});

describe("registerBotCommands", () => {
  it("calls setMyCommands with the full BOT_COMMANDS list against the bot mock", async () => {
    const bot = new MockTelegramBotApi();

    const result = await registerBotCommands(bot);

    expect(result).toBe(true);
    expect(bot.outbound).toEqual([
      { method: "setMyCommands", commands: BOT_COMMANDS },
    ]);
  });
});
