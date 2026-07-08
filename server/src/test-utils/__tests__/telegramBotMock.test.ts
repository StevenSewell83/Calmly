import { describe, expect, it, expectTypeOf } from "vitest";
import { MockTelegramBotApi } from "../telegramBotMock";
import { downloadTelegramFile } from "../../telegram/files";
import type { TelegramFileClient } from "../../telegram/files";

describe("MockTelegramBotApi", () => {
  it("records sendMessage calls in outbound[]", async () => {
    const bot = new MockTelegramBotApi();
    const result = await bot.api.sendMessage(42, "hello");
    expect(bot.outbound).toEqual([
      { method: "sendMessage", chat_id: 42, text: "hello" },
    ]);
    expect(result.message_id).toBeGreaterThan(0);
    expect(result.text).toBe("hello");
  });

  it("preserves reply_markup options on sendMessage", async () => {
    const bot = new MockTelegramBotApi();
    await bot.api.sendMessage("chat-1", "pick one", {
      reply_markup: {
        inline_keyboard: [[{ text: "Done", callback_data: "done" }]],
      },
    });
    expect(bot.outbound).toEqual([
      {
        method: "sendMessage",
        chat_id: "chat-1",
        text: "pick one",
        other: {
          reply_markup: {
            inline_keyboard: [[{ text: "Done", callback_data: "done" }]],
          },
        },
      },
    ]);
  });

  it("records editMessageText distinct from sendMessage", async () => {
    const bot = new MockTelegramBotApi();
    await bot.api.sendMessage(7, "first");
    await bot.api.editMessageText(7, 1000, "edited");
    expect(bot.outbound).toEqual([
      { method: "sendMessage", chat_id: 7, text: "first" },
      {
        method: "editMessageText",
        chat_id: 7,
        message_id: 1000,
        text: "edited",
      },
    ]);
  });

  it("returns canned bot identity from getMe", async () => {
    const bot = new MockTelegramBotApi();
    const me = await bot.api.getMe();
    expect(me.is_bot).toBe(true);
    expect(me.username).toBeTruthy();
  });

  it("returns canned webhook info from getWebhookInfo", async () => {
    const bot = new MockTelegramBotApi();
    const info = await bot.api.getWebhookInfo();
    expect(info.has_custom_certificate).toBe(false);
    expect(info.pending_update_count).toBe(0);
  });

  it("getFile returns a deterministic default if no override is queued", async () => {
    const bot = new MockTelegramBotApi();
    const file = await bot.api.getFile("voice-abc");
    expect(file.file_id).toBe("voice-abc");
    expect(file.file_path).toBe("voice/voice-abc.ogg");
  });

  it("setNextGetFile overrides one call", async () => {
    const bot = new MockTelegramBotApi();
    bot.setNextGetFile({
      file_id: "vid",
      file_unique_id: "u",
      file_size: 99,
      file_path: "voice/custom.ogg",
    });
    const first = await bot.api.getFile("vid");
    expect(first.file_path).toBe("voice/custom.ogg");
    expect(first.file_size).toBe(99);
    // second call falls back to default behaviour
    const second = await bot.api.getFile("vid");
    expect(second.file_path).toBe("voice/vid.ogg");
  });

  it("setNextGetFileError causes the next getFile to throw", async () => {
    const bot = new MockTelegramBotApi();
    bot.setNextGetFileError(new Error("boom"));
    await expect(bot.api.getFile("x")).rejects.toThrow("boom");
    // subsequent call resumes default behaviour
    await expect(bot.api.getFile("x")).resolves.toMatchObject({ file_id: "x" });
  });

  it("fetchImpl returns 200 + bytes for registered file_path", async () => {
    const bot = new MockTelegramBotApi();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    bot.setFileBytes("voice/abc.ogg", bytes, "audio/ogg");
    const url = `https://api.telegram.org/file/bot${bot.token}/voice/abc.ogg`;
    const res = await bot.fetchImpl(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/ogg");
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(buf)).toEqual([1, 2, 3, 4]);
  });

  it("fetchImpl returns 404 for unregistered file_path", async () => {
    const bot = new MockTelegramBotApi();
    const url = `https://api.telegram.org/file/bot${bot.token}/voice/missing.ogg`;
    const res = await bot.fetchImpl(url);
    expect(res.status).toBe(404);
  });

  it("fetchImpl returns 502 for any non-file-download URL (catches accidental real-network)", async () => {
    const bot = new MockTelegramBotApi();
    const res = await bot.fetchImpl(
      "https://api.openai.com/v1/audio/transcriptions",
    );
    expect(res.status).toBe(502);
  });

  it("reset() clears outbound + bytes + queued overrides", async () => {
    const bot = new MockTelegramBotApi();
    await bot.api.sendMessage(1, "hi");
    bot.setFileBytes("voice/x.ogg", new Uint8Array([1]));
    bot.setNextGetFile({
      file_id: "z",
      file_unique_id: "z",
      file_path: "z.ogg",
    });
    bot.reset();
    expect(bot.outbound).toEqual([]);
    const url = `https://api.telegram.org/file/bot${bot.token}/voice/x.ogg`;
    expect((await bot.fetchImpl(url)).status).toBe(404);
    // queued override cleared — falls through to default behaviour
    const file = await bot.api.getFile("anything");
    expect(file.file_id).toBe("anything");
  });

  it("satisfies TelegramFileClient and works end-to-end with downloadTelegramFile", async () => {
    const bot = new MockTelegramBotApi();
    bot.setFileBytes("voice/v1.ogg", new Uint8Array([9, 8, 7]), "audio/ogg");

    // Type-level: the mock IS a TelegramFileClient (no cast needed).
    expectTypeOf<MockTelegramBotApi>().toMatchTypeOf<TelegramFileClient>();

    const result = await downloadTelegramFile(bot, {
      fileId: "v1",
      mimeType: "audio/ogg",
      fetchImpl: bot.fetchImpl,
    });
    expect(Array.from(result.buffer)).toEqual([9, 8, 7]);
    expect(result.mimeType).toBe("audio/ogg");
    expect(result.sizeBytes).toBe(3);
  });
});
