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
let mockHandleText: ReturnType<typeof vi.fn>;
let mockHandleVoice: ReturnType<typeof vi.fn>;

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
    mockHandleText = vi.fn().mockResolvedValue(null);
    mockHandleVoice = vi.fn().mockResolvedValue(null);
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

  it("non-message update (callback_query only) → early return, no outbound", async () => {
    const update = makeCallbackQueryUpdate("done:42");

    dispatchUpdate(update, makeStubLogger(), stubPool);

    await new Promise((r) => setTimeout(r, 20));
    expect(mockHandleStart).not.toHaveBeenCalled();
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

  it("respects chat_id from the inbound update when sending the reply", async () => {
    mockHandleStart.mockResolvedValue("ack");
    const update = makeStartUpdate("XYZ", { chat_id: 555 });

    dispatchUpdate(update, makeStubLogger(), stubPool);

    await vi.waitFor(() => {
      expect(mockBot.outbound).toHaveLength(1);
    });
    expect(mockBot.outbound[0]?.chat_id).toBe(555);
  });
});
