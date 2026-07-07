import type { FastifyBaseLogger } from "fastify";
import type pg from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeTextUpdate,
  makePhotoUpdate,
  resetUpdateCounters,
} from "../../../test-utils/telegramUpdates";
import type { CaptureFromTelegramResult } from "../../../inbox/createFromTelegram";

// TGR-03a-rebuild unit tests. captureFromTelegram is mocked so this spec
// is a pure function-of-inputs test over handleText's reply logic and
// its no-PII-at-info-level logging contract.

let mockCapture: ReturnType<typeof vi.fn>;

vi.mock("../../../inbox/createFromTelegram", () => ({
  captureFromTelegram: (
    pool: unknown,
    input: unknown,
  ): Promise<CaptureFromTelegramResult> => mockCapture(pool, input),
}));

const { handleText } = await import("../text");

interface LogCall {
  fields: Record<string, unknown>;
  msg: string;
}

function makeStubLogger(): { log: FastifyBaseLogger; infoCalls: LogCall[] } {
  const infoCalls: LogCall[] = [];
  const noop = (): void => {};
  const logger = {
    info: (fields: Record<string, unknown>, msg: string) => {
      infoCalls.push({ fields, msg });
    },
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => logger,
    level: "info",
    silent: noop,
  } as unknown as FastifyBaseLogger;
  return { log: logger, infoCalls };
}

const stubPool = {} as unknown as pg.Pool;
const NOW_CHAT = 12345;

describe("handleText", () => {
  beforeEach(() => {
    mockCapture = vi.fn();
    resetUpdateCounters();
  });

  it("ignores slash commands other than /start — returns null, never calls captureFromTelegram", async () => {
    const update = makeTextUpdate("/today", { chat_id: NOW_CHAT });
    const { log } = makeStubLogger();

    const reply = await handleText(update.message!, stubPool, log);

    expect(reply).toBeNull();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("ignores slash commands with leading whitespace", async () => {
    const update = makeTextUpdate("  /inbox", { chat_id: NOW_CHAT });
    const { log } = makeStubLogger();

    const reply = await handleText(update.message!, stubPool, log);

    expect(reply).toBeNull();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("unlinked chat → link prompt", async () => {
    mockCapture.mockResolvedValue({ ok: false, error: "unlinked" });
    const update = makeTextUpdate("buy milk", { chat_id: NOW_CHAT });
    const { log } = makeStubLogger();

    const reply = await handleText(update.message!, stubPool, log);

    expect(reply).toBe("Link your account in Settings → Telegram first.");
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });

  it("linked chat, not truncated → 'Saved to inbox.'", async () => {
    mockCapture.mockResolvedValue({
      ok: true,
      inboxId: "inbox-1",
      truncated: false,
      alreadyProcessed: false,
    });
    const update = makeTextUpdate("buy milk", { chat_id: NOW_CHAT });
    const { log } = makeStubLogger();

    const reply = await handleText(update.message!, stubPool, log);

    expect(reply).toBe("Saved to inbox.");
  });

  it("linked chat, truncated → 'Saved to inbox. (trimmed at 4000 chars)'", async () => {
    mockCapture.mockResolvedValue({
      ok: true,
      inboxId: "inbox-2",
      truncated: true,
      alreadyProcessed: false,
    });
    const update = makeTextUpdate("a".repeat(5000), { chat_id: NOW_CHAT });
    const { log } = makeStubLogger();

    const reply = await handleText(update.message!, stubPool, log);

    expect(reply).toBe("Saved to inbox. (trimmed at 4000 chars)");
  });

  it("replay (alreadyProcessed:true) → re-acks identically to the first delivery", async () => {
    mockCapture.mockResolvedValue({
      ok: true,
      inboxId: "inbox-3",
      truncated: false,
      alreadyProcessed: true,
    });
    const update = makeTextUpdate("buy milk", { chat_id: NOW_CHAT });
    const { log } = makeStubLogger();

    const reply = await handleText(update.message!, stubPool, log);

    expect(reply).toBe("Saved to inbox.");
  });

  it("non-text, non-voice media → fixed fallback reply, captureFromTelegram never called", async () => {
    const update = makePhotoUpdate({ chat_id: NOW_CHAT });
    const { log } = makeStubLogger();

    const reply = await handleText(update.message!, stubPool, log);

    expect(reply).toBe("I only handle text and voice notes for now.");
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("passes chatId (as string) and message_id through to captureFromTelegram", async () => {
    mockCapture.mockResolvedValue({
      ok: true,
      inboxId: "inbox-4",
      truncated: false,
      alreadyProcessed: false,
    });
    const update = makeTextUpdate("call mom", {
      chat_id: 555,
      message_id: 77,
    });
    const { log } = makeStubLogger();

    await handleText(update.message!, stubPool, log);

    expect(mockCapture).toHaveBeenCalledWith(
      stubPool,
      expect.objectContaining({
        chatId: "555",
        telegramMessageId: 77,
        rawText: "call mom",
      }),
    );
  });

  it("does not log the raw message text (no PII at info level)", async () => {
    mockCapture.mockResolvedValue({
      ok: true,
      inboxId: "inbox-5",
      truncated: false,
      alreadyProcessed: false,
    });
    const update = makeTextUpdate("my therapist appointment is at 3pm", {
      chat_id: NOW_CHAT,
    });
    const { log, infoCalls } = makeStubLogger();

    await handleText(update.message!, stubPool, log);

    for (const call of infoCalls) {
      const serialized = JSON.stringify(call.fields);
      expect(serialized).not.toContain("therapist");
      expect(serialized).not.toContain("3pm");
    }
  });
});
