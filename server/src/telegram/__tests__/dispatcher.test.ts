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
  makeCallbackQueryUpdate,
  resetUpdateCounters,
} from "../../test-utils/telegramUpdates";

// `mockBot` and `mockHandleStart` are reassigned in beforeEach; the
// vi.mock factories capture the let bindings so each test sees the
// fresh instances.
let mockBot: MockTelegramBotApi;
let mockHandleStart: ReturnType<typeof vi.fn>;

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

  it("plain text NOT starting with /start → no handler call, no outbound (current dispatcher floor)", async () => {
    const update = makeTextUpdate("buy milk");

    dispatchUpdate(update, makeStubLogger(), stubPool);

    // Wait a microtask + a small budget; nothing should fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(mockHandleStart).not.toHaveBeenCalled();
    expect(mockBot.outbound).toEqual([]);
  });

  it("voice update → no outbound until TG-04 voice wiring lands on the dispatcher", async () => {
    const update = makeVoiceUpdate({ durationSec: 4 });

    dispatchUpdate(update, makeStubLogger(), stubPool);

    await new Promise((r) => setTimeout(r, 20));
    expect(mockHandleStart).not.toHaveBeenCalled();
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
