import type { FastifyBaseLogger } from "fastify";
import type pg from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeVoiceUpdate, resetUpdateCounters } from "../../../test-utils/telegramUpdates";
import { MockTelegramBotApi } from "../../../test-utils/telegramBotMock";
import { createMockTranscriptionProvider } from "../../../transcription/mock";
import type { CaptureFromTelegramResult } from "../../../inbox/createFromTelegram";
import {
  voiceReplyForDownloadError,
  voiceReplyForTranscriptionError,
  voiceReplyForTooLongDuration,
  voiceReplySuccess,
} from "../voiceReplies";
import type { TelegramDownloadErrorCode } from "../../files";
import type { TranscriptionErrorCode } from "../../../transcription/types";

// TGR-02 unit tests. captureFromTelegram/isTelegramChatLinked and
// downloadTelegramFile are mocked (same "pure function-of-inputs"
// philosophy as text.test.ts) so this spec exercises handleVoice's
// orchestration — ordering, error mapping, ack copy, no-PII logging —
// without a real DB or network. The transcription provider is the real
// MockTranscriptionProvider (transcription/mock.ts), and the bot dep is
// a real MockTelegramBotApi instance (unused by downloadTelegramFile
// here since that call is mocked, but it exercises the real
// TelegramFileClient shape end to end via the dispatcher-level wiring
// covered in dispatcher.test.ts).

let mockCapture: ReturnType<typeof vi.fn>;
let mockIsLinked: ReturnType<typeof vi.fn>;
let mockDownload: ReturnType<typeof vi.fn>;
let mockFindExisting: ReturnType<typeof vi.fn>;

vi.mock("../../../inbox/createFromTelegram", () => ({
  captureFromTelegram: (
    pool: unknown,
    input: unknown,
  ): Promise<CaptureFromTelegramResult> => mockCapture(pool, input),
  isTelegramChatLinked: (pool: unknown, chatId: unknown): Promise<boolean> =>
    mockIsLinked(pool, chatId),
  findExistingTelegramCapture: (
    pool: unknown,
    input: unknown,
  ): Promise<string | null> => mockFindExisting(pool, input),
}));

vi.mock("../../files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../files")>();
  return {
    ...actual,
    downloadTelegramFile: (
      client: unknown,
      params: unknown,
    ): Promise<unknown> => mockDownload(client, params),
  };
});

const { handleVoice } = await import("../voice");
const { TelegramDownloadError } = await import("../../files");

interface LogCall {
  fields: Record<string, unknown>;
  msg: string;
}

function makeStubLogger(): {
  log: FastifyBaseLogger;
  infoCalls: LogCall[];
  warnCalls: LogCall[];
} {
  const infoCalls: LogCall[] = [];
  const warnCalls: LogCall[] = [];
  const noop = (): void => {};
  const logger = {
    info: (fields: Record<string, unknown>, msg: string) => {
      infoCalls.push({ fields, msg });
    },
    warn: (fields: Record<string, unknown>, msg: string) => {
      warnCalls.push({ fields, msg });
    },
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => logger,
    level: "info",
    silent: noop,
  } as unknown as FastifyBaseLogger;
  return { log: logger, infoCalls, warnCalls };
}

const stubPool = {} as unknown as pg.Pool;
const CHAT_ID = 12345;

function makeDeps(providerOpts: Parameters<typeof createMockTranscriptionProvider>[0] = {}): {
  bot: MockTelegramBotApi;
  provider: ReturnType<typeof createMockTranscriptionProvider>;
} {
  return {
    bot: new MockTelegramBotApi(),
    provider: createMockTranscriptionProvider(providerOpts),
  };
}

const OK_DOWNLOAD = {
  fileId: "voice-1",
  sizeBytes: 4,
  mimeType: "audio/ogg",
  buffer: Buffer.from([1, 2, 3, 4]),
};

describe("handleVoice", () => {
  beforeEach(() => {
    mockCapture = vi.fn();
    mockIsLinked = vi.fn();
    mockDownload = vi.fn();
    mockFindExisting = vi.fn().mockResolvedValue(null); // no replay by default
    resetUpdateCounters();
  });

  it("unlinked chat → link prompt, no download, no transcription, no capture", async () => {
    mockIsLinked.mockResolvedValue(false);
    const update = makeVoiceUpdate({ chat_id: CHAT_ID, durationSec: 4 });
    const { log } = makeStubLogger();
    const { bot, provider } = makeDeps();

    const reply = await handleVoice(update.message!, stubPool, log, {
      bot,
      provider,
    });

    expect(reply).toBe("Link your account in Settings → Telegram first.");
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
    expect(provider.calls()).toEqual([]);
  });

  it("duration over the 300s cap → too-long reply, download never attempted", async () => {
    mockIsLinked.mockResolvedValue(true);
    const update = makeVoiceUpdate({ chat_id: CHAT_ID, durationSec: 400 });
    const { log } = makeStubLogger();
    const { bot, provider } = makeDeps();

    const reply = await handleVoice(update.message!, stubPool, log, {
      bot,
      provider,
    });

    expect(reply).toBe(voiceReplyForTooLongDuration(400, 300));
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("duration exactly at the 300s cap is allowed (only strictly-over rejected)", async () => {
    mockIsLinked.mockResolvedValue(true);
    mockDownload.mockResolvedValue(OK_DOWNLOAD);
    mockCapture.mockResolvedValue({
      ok: true,
      inboxId: "inbox-cap",
      truncated: false,
      alreadyProcessed: false,
    });
    const update = makeVoiceUpdate({ chat_id: CHAT_ID, durationSec: 300 });
    const { log } = makeStubLogger();
    const { bot, provider } = makeDeps({ text: "buy milk" });

    const reply = await handleVoice(update.message!, stubPool, log, {
      bot,
      provider,
    });

    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(reply).toBe("Saved to inbox: buy milk");
  });

  describe("download errors map to the exact voiceReplies string", () => {
    const codes: TelegramDownloadErrorCode[] = [
      "too_large",
      "not_found",
      "auth",
      "network",
      "timeout",
      "unsupported",
    ];
    for (const code of codes) {
      it(`code='${code}'`, async () => {
        mockIsLinked.mockResolvedValue(true);
        mockDownload.mockRejectedValue(
          new TelegramDownloadError(code, `download failed: ${code}`),
        );
        const update = makeVoiceUpdate({ chat_id: CHAT_ID, durationSec: 4 });
        const { log } = makeStubLogger();
        const { bot, provider } = makeDeps();

        const reply = await handleVoice(update.message!, stubPool, log, {
          bot,
          provider,
        });

        expect(reply).toBe(voiceReplyForDownloadError({ code }));
        expect(mockCapture).not.toHaveBeenCalled();
      });
    }
  });

  describe("transcription errors map to the exact voiceReplies string", () => {
    const codes: TranscriptionErrorCode[] = [
      "provider_error",
      "audio_too_long",
      "unsupported_format",
      "auth",
      "quota",
      "timeout",
    ];
    for (const code of codes) {
      it(`code='${code}'`, async () => {
        mockIsLinked.mockResolvedValue(true);
        mockDownload.mockResolvedValue(OK_DOWNLOAD);
        const update = makeVoiceUpdate({ chat_id: CHAT_ID, durationSec: 4 });
        const { log } = makeStubLogger();
        const { bot, provider } = makeDeps({ failWith: code });

        const reply = await handleVoice(update.message!, stubPool, log, {
          bot,
          provider,
        });

        expect(reply).toBe(voiceReplyForTranscriptionError({ code }));
        expect(mockCapture).not.toHaveBeenCalled();
      });
    }
  });

  it("rethrows a non-TelegramDownloadError from downloadTelegramFile (unexpected bug surfaces, not silently mapped)", async () => {
    mockIsLinked.mockResolvedValue(true);
    mockDownload.mockRejectedValue(new Error("boom"));
    const update = makeVoiceUpdate({ chat_id: CHAT_ID, durationSec: 4 });
    const { log } = makeStubLogger();
    const { bot, provider } = makeDeps();

    await expect(
      handleVoice(update.message!, stubPool, log, { bot, provider }),
    ).rejects.toThrow("boom");
  });

  it("rethrows a non-TranscriptionError from the provider", async () => {
    mockIsLinked.mockResolvedValue(true);
    mockDownload.mockResolvedValue(OK_DOWNLOAD);
    const update = makeVoiceUpdate({ chat_id: CHAT_ID, durationSec: 4 });
    const { log } = makeStubLogger();
    const bot = new MockTelegramBotApi();
    const provider = { transcribe: vi.fn().mockRejectedValue(new Error("kaboom")) };

    await expect(
      handleVoice(update.message!, stubPool, log, { bot, provider }),
    ).rejects.toThrow("kaboom");
  });

  it("happy path → captures a telegram-voice inbox row and acks with the transcript", async () => {
    mockIsLinked.mockResolvedValue(true);
    mockDownload.mockResolvedValue(OK_DOWNLOAD);
    mockCapture.mockResolvedValue({
      ok: true,
      inboxId: "inbox-1",
      truncated: false,
      alreadyProcessed: false,
    });
    const update = makeVoiceUpdate({
      chat_id: CHAT_ID,
      message_id: 55,
      durationSec: 4,
    });
    const { log } = makeStubLogger();
    const { bot, provider } = makeDeps({ text: "buy milk" });

    const reply = await handleVoice(update.message!, stubPool, log, {
      bot,
      provider,
    });

    expect(reply).toBe("Saved to inbox: buy milk");
    expect(mockCapture).toHaveBeenCalledWith(
      stubPool,
      expect.objectContaining({
        chatId: String(CHAT_ID),
        telegramMessageId: 55,
        rawText: "buy milk",
        source: "telegram-voice",
      }),
    );
  });

  it("truncates a long transcript in the ack at 80 chars (voiceReplySuccess contract)", async () => {
    const longText = "a".repeat(100);
    mockIsLinked.mockResolvedValue(true);
    mockDownload.mockResolvedValue(OK_DOWNLOAD);
    mockCapture.mockResolvedValue({
      ok: true,
      inboxId: "inbox-2",
      truncated: false,
      alreadyProcessed: false,
    });
    const update = makeVoiceUpdate({ chat_id: CHAT_ID, durationSec: 4 });
    const { log } = makeStubLogger();
    const { bot, provider } = makeDeps({ text: longText });

    const reply = await handleVoice(update.message!, stubPool, log, {
      bot,
      provider,
    });

    expect(reply).toBe(voiceReplySuccess(longText));
    expect(reply?.endsWith("…")).toBe(true);
  });

  it("replayed update (alreadyProcessed:true) → same ack, no duplicate insert attempted twice", async () => {
    mockIsLinked.mockResolvedValue(true);
    mockDownload.mockResolvedValue(OK_DOWNLOAD);
    mockCapture.mockResolvedValue({
      ok: true,
      inboxId: "inbox-3",
      truncated: false,
      alreadyProcessed: true,
    });
    const update = makeVoiceUpdate({ chat_id: CHAT_ID, durationSec: 4 });
    const { log } = makeStubLogger();
    const { bot, provider } = makeDeps({ text: "buy milk" });

    const reply = await handleVoice(update.message!, stubPool, log, {
      bot,
      provider,
    });

    expect(reply).toBe("Saved to inbox: buy milk");
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });

  it("chat unlinked between the early check and the write → unlinked reply, not a crash", async () => {
    mockIsLinked.mockResolvedValue(true);
    mockDownload.mockResolvedValue(OK_DOWNLOAD);
    mockCapture.mockResolvedValue({ ok: false, error: "unlinked" });
    const update = makeVoiceUpdate({ chat_id: CHAT_ID, durationSec: 4 });
    const { log } = makeStubLogger();
    const { bot, provider } = makeDeps({ text: "buy milk" });

    const reply = await handleVoice(update.message!, stubPool, log, {
      bot,
      provider,
    });

    expect(reply).toBe("Link your account in Settings → Telegram first.");
  });

  it("does not log the transcript at info or warn level (no PII)", async () => {
    mockIsLinked.mockResolvedValue(true);
    mockDownload.mockResolvedValue(OK_DOWNLOAD);
    mockCapture.mockResolvedValue({
      ok: true,
      inboxId: "inbox-4",
      truncated: false,
      alreadyProcessed: false,
    });
    const update = makeVoiceUpdate({ chat_id: CHAT_ID, durationSec: 4 });
    const { log, infoCalls, warnCalls } = makeStubLogger();
    const { bot, provider } = makeDeps({ text: "my therapist appointment is at 3pm" });

    await handleVoice(update.message!, stubPool, log, { bot, provider });

    for (const call of [...infoCalls, ...warnCalls]) {
      const serialized = JSON.stringify(call.fields);
      expect(serialized).not.toContain("therapist");
      expect(serialized).not.toContain("3pm");
    }
  });

  it("passes the downloaded buffer and mime type through to the transcription provider", async () => {
    mockIsLinked.mockResolvedValue(true);
    mockDownload.mockResolvedValue(OK_DOWNLOAD);
    mockCapture.mockResolvedValue({
      ok: true,
      inboxId: "inbox-5",
      truncated: false,
      alreadyProcessed: false,
    });
    const update = makeVoiceUpdate({ chat_id: CHAT_ID, durationSec: 4 });
    const { log } = makeStubLogger();
    const { bot, provider } = makeDeps({ text: "buy milk" });

    await handleVoice(update.message!, stubPool, log, { bot, provider });

    expect(provider.calls()).toEqual([
      { mimeType: "audio/ogg", byteLength: 4 },
    ]);
  });
});

describe("handleVoice webhook replay", () => {
  beforeEach(() => {
    mockCapture = vi.fn();
    mockIsLinked = vi.fn();
    mockDownload = vi.fn();
    mockFindExisting = vi.fn();
    resetUpdateCounters();
  });

  it("already-captured message → re-acks with stored transcript, no download, no transcription", async () => {
    mockIsLinked.mockResolvedValue(true);
    mockFindExisting.mockResolvedValue("previously stored transcript");
    const update = makeVoiceUpdate({ chat_id: CHAT_ID, durationSec: 4 });
    const { log } = makeStubLogger();
    const { bot, provider } = makeDeps();

    const reply = await handleVoice(update.message!, stubPool, log, { bot, provider });

    expect(reply).toBe(voiceReplySuccess("previously stored transcript"));
    // download never ran, so transcription (which needs its buffer) can't have either
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });
});
