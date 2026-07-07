// TG-09c — hermetic dispatcher spec composing the TG-09a mock harness
// (MockTelegramBotApi) + TG-09b Update builders. Validates the
// dispatcher's routing and fire-and-forget reply pipeline without a
// real DB or Telegram API.
//
// First spec built on the TG-09 harness; demonstrates the pattern the
// later final-assembly specs (linking, inbound text, voice, /now,
// /today, /inbox, outbound) will follow.

import type { FastifyBaseLogger } from "fastify";
import type pg from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockTelegramBotApi } from "../../test-utils/telegramBotMock";
import {
  makeStartUpdate,
  makeTextUpdate,
  makeVoiceUpdate,
  makePhotoUpdate,
  makeCallbackQueryUpdate,
  resetUpdateCounters,
} from "../../test-utils/telegramUpdates";

// `mockBot`, `mockHandleStart`, `mockHandleText` and `mockHandleVoice`
// are reassigned in beforeEach; the vi.mock factories capture the let
// bindings so each test sees the fresh instances.
let mockBot: MockTelegramBotApi;
let mockHandleStart: ReturnType<typeof vi.fn>;
let mockHandleNow: ReturnType<typeof vi.fn>;
let mockHandleText: ReturnType<typeof vi.fn>;
let mockHandleVoice: ReturnType<typeof vi.fn>;
let mockHandleCallbackQuery: ReturnType<typeof vi.fn>;

vi.mock("../bot", () => ({
  getBot: () => mockBot,
  initBot: vi.fn(),
}));

vi.mock("../handlers/start", () => ({
  handleStart: (
    msg: unknown,
    pool: unknown,
    log: unknown,
  ): unknown => mockHandleStart(msg, pool, log),
}));

vi.mock("../handlers/commands/now", () => ({
  handleNow: (
    msg: unknown,
    pool: unknown,
    log: unknown,
  ): unknown => mockHandleNow(msg, pool, log),
}));

vi.mock("../handlers/text", () => ({
  handleText: (
    msg: unknown,
    pool: unknown,
    log: unknown,
  ): unknown => mockHandleText(msg, pool, log),
}));

vi.mock("../handlers/voice", () => ({
  handleVoice: (
    msg: unknown,
    pool: unknown,
    log: unknown,
    deps: unknown,
  ): unknown => mockHandleVoice(msg, pool, log, deps),
  getDefaultTranscriptionProvider: () => ({ transcribe: vi.fn() }),
}));

vi.mock("../handlers/callback", () => ({
  handleCallbackQuery: (
    callbackQuery: unknown,
    pool: unknown,
    log: unknown,
    deps: unknown,
  ): unknown => mockHandleCallbackQuery(callbackQuery, pool, log, deps),
}));

// Imported after vi.mock so the dispatcher picks up the mocked modules.
const { dispatchUpdate } = await import("../dispatcher");

function makeStubLogger(): FastifyBaseLogger {
  const noop = (): void => {};
  const logger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => logger,
    level: "info",
    silent: noop,
  } as unknown as FastifyBaseLogger;
  return logger;
}

const stubPool = {} as unknown as pg.Pool;

describe("dispatchUpdate — hermetic routing + reply pipeline", () => {
  beforeEach(() => {
    mockBot = new MockTelegramBotApi();
    mockHandleStart = vi.fn();
    mockHandleNow = vi.fn();
    mockHandleText = vi.fn().mockResolvedValue(null);
    mockHandleVoice = vi.fn().mockResolvedValue(null);
    mockHandleCallbackQuery = vi.fn().mockResolvedValue(undefined);
    resetUpdateCounters();
  });

  it("/start CODE → handleStart called, reply sent via mock bot", async () => {
    mockHandleStart.mockResolvedValue("Linked! Welcome.");
    const update = makeStartUpdate("ABC123", { chat_id: 9001 });

    dispatchUpdate(update, makeStubLogger(), stubPool);

    await vi.waitFor(() => {
      expect(mockBot.outbound).toHaveLength(1);
    });

    expect(mockHandleStart).toHaveBeenCalledTimes(1);
    expect(mockHandleStart).toHaveBeenCalledWith(
      update.message,
      stubPool,
      expect.anything(),
    );
    expect(mockBot.outbound[0]).toEqual({
      method: "sendMessage",
      chat_id: 9001,
      text: "Linked! Welcome.",
    });
  });

  it("/start (no code) → handleStart called with the no-arg onboarding flow", async () => {
    mockHandleStart.mockResolvedValue("Welcome to Calmly.");
    const update = makeStartUpdate(undefined, { chat_id: 9002 });

    dispatchUpdate(update, makeStubLogger(), stubPool);

    await vi.waitFor(() => {
      expect(mockBot.outbound).toHaveLength(1);
    });
    expect(mockHandleStart).toHaveBeenCalledTimes(1);
    expect(mockBot.outbound[0]).toMatchObject({
      method: "sendMessage",
      chat_id: 9002,
      text: "Welcome to Calmly.",
    });
  });

  it("plain text NOT starting with /start → routed to handleText, reply sent via mock bot", async () => {
    mockHandleText.mockResolvedValue("Saved to inbox.");
    const update = makeTextUpdate("buy milk", { chat_id: 9003 });

    dispatchUpdate(update, makeStubLogger(), stubPool);

    await vi.waitFor(() => {
      expect(mockBot.outbound).toHaveLength(1);
    });
    expect(mockHandleStart).not.toHaveBeenCalled();
    expect(mockHandleText).toHaveBeenCalledTimes(1);
    expect(mockHandleText).toHaveBeenCalledWith(
      update.message,
      stubPool,
      expect.anything(),
    );
    expect(mockBot.outbound[0]).toEqual({
      method: "sendMessage",
      chat_id: 9003,
      text: "Saved to inbox.",
    });
  });

  it("handleText resolving null → no outbound (e.g. an out-of-scope slash command)", async () => {
    mockHandleText.mockResolvedValue(null);
    const update = makeTextUpdate("/today");

    dispatchUpdate(update, makeStubLogger(), stubPool);

    await new Promise((r) => setTimeout(r, 20));
    expect(mockHandleText).toHaveBeenCalledTimes(1);
    expect(mockBot.outbound).toEqual([]);
  });

  it("non-text, non-voice media → routed to handleText, reply sent via mock bot", async () => {
    mockHandleText.mockResolvedValue("I only handle text and voice notes for now.");
    const update = makePhotoUpdate({ chat_id: 9004 });

    dispatchUpdate(update, makeStubLogger(), stubPool);

    await vi.waitFor(() => {
      expect(mockBot.outbound).toHaveLength(1);
    });
    expect(mockHandleText).toHaveBeenCalledTimes(1);
    expect(mockBot.outbound[0]).toMatchObject({
      method: "sendMessage",
      chat_id: 9004,
      text: "I only handle text and voice notes for now.",
    });
  });

  it("voice update → routed to handleVoice, reply sent via mock bot", async () => {
    mockHandleVoice.mockResolvedValue("Saved to inbox: buy milk");
    const update = makeVoiceUpdate({ durationSec: 4, chat_id: 9005 });

    dispatchUpdate(update, makeStubLogger(), stubPool);

    await vi.waitFor(() => {
      expect(mockBot.outbound).toHaveLength(1);
    });
    expect(mockHandleStart).not.toHaveBeenCalled();
    expect(mockHandleText).not.toHaveBeenCalled();
    expect(mockHandleVoice).toHaveBeenCalledTimes(1);
    expect(mockHandleVoice).toHaveBeenCalledWith(
      update.message,
      stubPool,
      expect.anything(),
      expect.objectContaining({ bot: mockBot }),
    );
    expect(mockBot.outbound[0]).toEqual({
      method: "sendMessage",
      chat_id: 9005,
      text: "Saved to inbox: buy milk",
    });
  });

  it("voice update, handleVoice resolving null → no outbound", async () => {
    mockHandleVoice.mockResolvedValue(null);
    const update = makeVoiceUpdate({ durationSec: 4 });

    dispatchUpdate(update, makeStubLogger(), stubPool);

    await new Promise((r) => setTimeout(r, 20));
    expect(mockHandleVoice).toHaveBeenCalledTimes(1);
    expect(mockBot.outbound).toEqual([]);
  });

  it("voice update, handleVoice throws → dispatcher swallows the error, no outbound", async () => {
    mockHandleVoice.mockRejectedValue(new Error("transcription blew up"));
    const update = makeVoiceUpdate({ durationSec: 4 });

    expect(() =>
      dispatchUpdate(update, makeStubLogger(), stubPool),
    ).not.toThrow();

    await new Promise((r) => setTimeout(r, 20));
    expect(mockHandleVoice).toHaveBeenCalledTimes(1);
    expect(mockBot.outbound).toEqual([]);
  });

  it("callback_query update → routed to handleCallbackQuery, no sendMessage/editMessageText call", async () => {
    const update = makeCallbackQueryUpdate("done:42");

    dispatchUpdate(update, makeStubLogger(), stubPool);

    await vi.waitFor(() => {
      expect(mockHandleCallbackQuery).toHaveBeenCalledTimes(1);
    });
    expect(mockHandleStart).not.toHaveBeenCalled();
    expect(mockHandleText).not.toHaveBeenCalled();
    expect(mockHandleVoice).not.toHaveBeenCalled();
    expect(mockHandleCallbackQuery).toHaveBeenCalledWith(
      update.callback_query,
      stubPool,
      expect.anything(),
      expect.objectContaining({ bot: mockBot }),
    );
    // handleCallbackQuery itself is mocked out (it owns answerCallbackQuery),
    // so the dispatcher shouldn't have sent/edited anything on its own.
    expect(mockBot.outbound).toEqual([]);
  });

  it("callback_query update, handleCallbackQuery throws → dispatcher swallows the error", async () => {
    mockHandleCallbackQuery.mockRejectedValue(new Error("db blew up"));
    const update = makeCallbackQueryUpdate("done:99");

    expect(() =>
      dispatchUpdate(update, makeStubLogger(), stubPool),
    ).not.toThrow();

    await new Promise((r) => setTimeout(r, 20));
    expect(mockHandleCallbackQuery).toHaveBeenCalledTimes(1);
    expect(mockBot.outbound).toEqual([]);
  });

  it("handleStart throws → dispatcher swallows the error, no outbound, no synchronous throw", async () => {
    mockHandleStart.mockRejectedValue(new Error("DB blew up"));
    const update = makeStartUpdate("BADBAD");

    expect(() =>
      dispatchUpdate(update, makeStubLogger(), stubPool),
    ).not.toThrow();

    // Give the rejected promise time to settle through .catch.
    await new Promise((r) => setTimeout(r, 20));
    expect(mockHandleStart).toHaveBeenCalledTimes(1);
    expect(mockBot.outbound).toEqual([]);
  });

  it("/now → handleNow called, reply sent with MarkdownV2 parse_mode", async () => {
    mockHandleNow.mockResolvedValue("Now: Write report\nNext: —");
    const update = makeTextUpdate("/now", { chat_id: 9006 });

    dispatchUpdate(update, makeStubLogger(), stubPool);

    await vi.waitFor(() => {
      expect(mockBot.outbound).toHaveLength(1);
    });
    expect(mockHandleStart).not.toHaveBeenCalled();
    expect(mockHandleText).not.toHaveBeenCalled();
    expect(mockHandleNow).toHaveBeenCalledTimes(1);
    expect(mockHandleNow).toHaveBeenCalledWith(
      update.message,
      stubPool,
      expect.anything(),
    );
    expect(mockBot.outbound[0]).toEqual({
      method: "sendMessage",
      chat_id: 9006,
      text: "Now: Write report\nNext: —",
      other: { parse_mode: "MarkdownV2" },
    });
  });

  it("/now is routed before the text-capture branch — never reaches handleText", async () => {
    mockHandleNow.mockResolvedValue("No focus task right now.");
    const update = makeTextUpdate("/now");

    dispatchUpdate(update, makeStubLogger(), stubPool);

    await vi.waitFor(() => {
      expect(mockHandleNow).toHaveBeenCalledTimes(1);
    });
    expect(mockHandleText).not.toHaveBeenCalled();
  });

  it("/now with trailing whitespace still routes to handleNow", async () => {
    mockHandleNow.mockResolvedValue("No focus task right now.");
    const update = makeTextUpdate("/now  ", { chat_id: 9007 });

    dispatchUpdate(update, makeStubLogger(), stubPool);

    await vi.waitFor(() => {
      expect(mockHandleNow).toHaveBeenCalledTimes(1);
    });
    expect(mockHandleText).not.toHaveBeenCalled();
  });

  it("handleNow throws → dispatcher swallows the error, no outbound", async () => {
    mockHandleNow.mockRejectedValue(new Error("db blew up"));
    const update = makeTextUpdate("/now");

    expect(() =>
      dispatchUpdate(update, makeStubLogger(), stubPool),
    ).not.toThrow();

    await new Promise((r) => setTimeout(r, 20));
    expect(mockHandleNow).toHaveBeenCalledTimes(1);
    expect(mockBot.outbound).toEqual([]);
  });

  it("respects chat_id from the inbound update when sending the reply", async () => {
    mockHandleStart.mockResolvedValue("ack");
    const update = makeStartUpdate("XYZ", { chat_id: 555 });

    dispatchUpdate(update, makeStubLogger(), stubPool);

    await vi.waitFor(() => {
      expect(mockBot.outbound).toHaveLength(1);
    });
    expect((mockBot.outbound[0] as { chat_id?: number | string } | undefined)?.chat_id).toBe(555);
  });
});
