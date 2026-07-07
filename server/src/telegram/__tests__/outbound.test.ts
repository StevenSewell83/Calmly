// TGR-03 — unit tests for outbound.ts. pg.Pool is mocked by intercepting
// query() and dispatching on a regex against the SQL text (same shape as
// createFromTelegram.test.ts); the bot client is a plain object exposing
// sendMessage/editMessageText so retry/error-classification behaviour can
// be driven without any real grammy Bot or network.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import {
  sendMessage,
  editMessage,
  onOutboundBlocked,
  TelegramNotLinkedError,
  OutboundMessageNotFoundError,
  OutboundMessageNotSentError,
  TelegramSendFailedError,
  __INTERNAL,
  type OutboundBotClient,
  type OutboundBlockedEvent,
} from "../outbound";

const USER_ID = "user-1";
const CHAT_ID = "chat-42";
const NOW = 1_730_000_000_000;

interface QueryCall {
  sql: string;
  params: readonly unknown[] | undefined;
}

interface MockHandler {
  match: RegExp;
  respond: (params: readonly unknown[]) => { rows: unknown[] };
}

function makeMockPool(handlers: MockHandler[]): { pool: pg.Pool; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const pool = {
    async query(sql: string, params?: readonly unknown[]) {
      calls.push({ sql, params });
      const handler = handlers.find((h) => h.match.test(sql));
      if (!handler) throw new Error(`no mock handler for query: ${sql}`);
      return handler.respond(params ?? []);
    },
  } as unknown as pg.Pool;
  return { pool, calls };
}

function linkedHandler(): MockHandler {
  return {
    match: /FROM telegram_links/,
    respond: () => ({ rows: [{ chat_id: CHAT_ID, linked_at: String(NOW) }] }),
  };
}

function unlinkedHandler(): MockHandler {
  return { match: /FROM telegram_links/, respond: () => ({ rows: [] }) };
}

function insertHandler(): MockHandler {
  return { match: /INSERT INTO outbound_messages/, respond: () => ({ rows: [] }) };
}

function updateHandler(): MockHandler {
  return { match: /UPDATE outbound_messages/, respond: () => ({ rows: [] }) };
}

// A structural stand-in for grammy's GrammyError — outbound.ts only
// inspects `.error_code`, it never does `instanceof`.
function grammyError(code: number, description = "boom"): Error & { error_code: number } {
  const err = new Error(description) as Error & { error_code: number };
  err.error_code = code;
  return err;
}

function networkError(): Error {
  return new Error("fetch failed");
}

function makeBot(overrides: Partial<OutboundBotClient["api"]> = {}): {
  bot: OutboundBotClient;
  // The mock actually wired into `bot.api` — either the caller's override
  // or our default — so assertions always inspect the live spy.
  sendMessageMock: ReturnType<typeof vi.fn>;
  editMessageTextMock: ReturnType<typeof vi.fn>;
} {
  const sendMessageMock = (overrides.sendMessage as ReturnType<typeof vi.fn>) ??
    vi.fn().mockResolvedValue({ message_id: 555 });
  const editMessageTextMock = (overrides.editMessageText as ReturnType<typeof vi.fn>) ??
    vi.fn().mockResolvedValue(true);
  const bot: OutboundBotClient = {
    api: {
      sendMessage: sendMessageMock,
      editMessageText: editMessageTextMock,
    },
  };
  return { bot, sendMessageMock, editMessageTextMock };
}

const noopSleep = async (): Promise<void> => {};

beforeEach(() => {
  __INTERNAL.clearBlockedListeners();
});

describe("sendMessage", () => {
  it("linked user, no buttons → inserts row, sends without reply_markup, returns sent + telegramMessageId", async () => {
    const { pool, calls } = makeMockPool([linkedHandler(), insertHandler(), updateHandler()]);
    const { bot, sendMessageMock } = makeBot();

    const result = await sendMessage(pool, USER_ID, { text: "hello" }, { bot, sleep: noopSleep, now: () => NOW });

    expect(result).toEqual({
      outboundMessageId: expect.any(String),
      status: "sent",
      telegramMessageId: 555,
    });
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledWith(CHAT_ID, "hello", undefined);

    const insertCall = calls.find((c) => /INSERT INTO outbound_messages/.test(c.sql));
    expect(insertCall).toBeDefined();
  });

  it("linked user, with buttons → row keyboard shape is one button per row, callback_data = actionId:rowId", async () => {
    const { pool } = makeMockPool([linkedHandler(), insertHandler(), updateHandler()]);
    const { bot, sendMessageMock } = makeBot();

    const result = await sendMessage(
      pool,
      USER_ID,
      {
        text: "Buy milk — done?",
        buttons: [
          { label: "Done", actionId: "done", payload: { taskId: "t1" } },
          { label: "Snooze", actionId: "snooze", payload: { taskId: "t1" } },
        ],
      },
      { bot, sleep: noopSleep, now: () => NOW },
    );

    const [, , other] = sendMessageMock.mock.calls[0] as [unknown, unknown, { reply_markup: { inline_keyboard: unknown[][] } }];
    expect(other.reply_markup.inline_keyboard).toEqual([
      [{ text: "Done", callback_data: `done:${result.outboundMessageId}` }],
      [{ text: "Snooze", callback_data: `snooze:${result.outboundMessageId}` }],
    ]);
  });

  it("unlinked user → throws TelegramNotLinkedError, no INSERT/send attempted", async () => {
    const { pool, calls } = makeMockPool([unlinkedHandler(), insertHandler(), updateHandler()]);
    const { bot, sendMessageMock } = makeBot();

    await expect(
      sendMessage(pool, USER_ID, { text: "hi" }, { bot, sleep: noopSleep }),
    ).rejects.toThrow(TelegramNotLinkedError);

    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(calls.some((c) => /INSERT INTO outbound_messages/.test(c.sql))).toBe(false);
  });

  it("403 on first attempt → status='blocked', no retry, blocked event fires, no throw", async () => {
    const { pool, calls } = makeMockPool([linkedHandler(), insertHandler(), updateHandler()]);
    const { bot, sendMessageMock } = makeBot({
      sendMessage: vi.fn().mockRejectedValue(grammyError(403, "Forbidden: bot was blocked by the user")),
    });

    const events: OutboundBlockedEvent[] = [];
    onOutboundBlocked((e) => events.push(e));

    const result = await sendMessage(pool, USER_ID, { text: "hi" }, { bot, sleep: noopSleep });

    expect(result.status).toBe("blocked");
    expect(result.telegramMessageId).toBeNull();
    expect(sendMessageMock).toHaveBeenCalledTimes(1); // not retried
    expect(events).toEqual([
      { userId: USER_ID, chatId: CHAT_ID, outboundMessageId: result.outboundMessageId, intent: "message" },
    ]);
    const statusUpdate = calls.find((c) => /SET status = 'blocked'/.test(c.sql));
    expect(statusUpdate?.params).toEqual([result.outboundMessageId]);
  });

  it("5xx retried 3x then throws TelegramSendFailedError, status set to failed", async () => {
    const { pool, calls } = makeMockPool([linkedHandler(), insertHandler(), updateHandler()]);
    const { bot, sendMessageMock } = makeBot({
      sendMessage: vi.fn().mockRejectedValue(grammyError(500, "Internal Server Error")),
    });

    await expect(
      sendMessage(pool, USER_ID, { text: "hi" }, { bot, sleep: noopSleep }),
    ).rejects.toThrow(TelegramSendFailedError);

    expect(sendMessageMock).toHaveBeenCalledTimes(3);
    expect(calls.some((c) => /SET status = 'failed'/.test(c.sql))).toBe(true);
  });

  it("network error (no error_code) is treated as retryable, exhausted → failed", async () => {
    const { pool } = makeMockPool([linkedHandler(), insertHandler(), updateHandler()]);
    const { bot, sendMessageMock } = makeBot({
      sendMessage: vi.fn().mockRejectedValue(networkError()),
    });

    await expect(
      sendMessage(pool, USER_ID, { text: "hi" }, { bot, sleep: noopSleep }),
    ).rejects.toThrow(TelegramSendFailedError);
    expect(sendMessageMock).toHaveBeenCalledTimes(3);
  });

  it("succeeds on the 2nd attempt after one 5xx → only 2 calls, status sent", async () => {
    const { pool } = makeMockPool([linkedHandler(), insertHandler(), updateHandler()]);
    const sendMessageMock = vi
      .fn()
      .mockRejectedValueOnce(grammyError(502))
      .mockResolvedValueOnce({ message_id: 777 });
    const { bot } = makeBot({ sendMessage: sendMessageMock });

    const result = await sendMessage(pool, USER_ID, { text: "hi" }, { bot, sleep: noopSleep });

    expect(result).toMatchObject({ status: "sent", telegramMessageId: 777 });
    expect(sendMessageMock).toHaveBeenCalledTimes(2);
  });

  it("non-403 4xx error is not retried and fails immediately", async () => {
    const { pool } = makeMockPool([linkedHandler(), insertHandler(), updateHandler()]);
    const { bot, sendMessageMock } = makeBot({
      sendMessage: vi.fn().mockRejectedValue(grammyError(400, "Bad Request: chat not found")),
    });

    await expect(
      sendMessage(pool, USER_ID, { text: "hi" }, { bot, sleep: noopSleep }),
    ).rejects.toThrow(TelegramSendFailedError);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });

  it("throws if a button's callback_data would exceed 64 bytes", async () => {
    const { pool } = makeMockPool([linkedHandler(), insertHandler(), updateHandler()]);
    const { bot } = makeBot();
    const longActionId = "a".repeat(60);

    await expect(
      sendMessage(
        pool,
        USER_ID,
        { text: "hi", buttons: [{ label: "X", actionId: longActionId }] },
        { bot, sleep: noopSleep },
      ),
    ).rejects.toThrow(/exceeds Telegram/);
  });
});

describe("editMessage", () => {
  function selectRowHandler(row: Record<string, unknown> | undefined): MockHandler {
    return {
      match: /SELECT user_id, chat_id, telegram_message_id/,
      respond: () => ({ rows: row ? [row] : [] }),
    };
  }

  it("edits in place: no new row inserted, editMessageText called with the existing telegram_message_id", async () => {
    const { pool, calls } = makeMockPool([
      selectRowHandler({ user_id: USER_ID, chat_id: CHAT_ID, telegram_message_id: "555", intent: "reminder" }),
      updateHandler(),
    ]);
    const { bot, editMessageTextMock } = makeBot();

    const result = await editMessage(
      pool,
      "row-1",
      { text: "Updated text", buttons: [{ label: "Done", actionId: "done" }] },
      { bot, sleep: noopSleep },
    );

    expect(result).toEqual({ outboundMessageId: "row-1", status: "sent", telegramMessageId: 555 });
    expect(editMessageTextMock).toHaveBeenCalledWith(
      CHAT_ID,
      555,
      "Updated text",
      { reply_markup: { inline_keyboard: [[{ text: "Done", callback_data: "done:row-1" }]] } },
    );
    expect(calls.some((c) => /INSERT INTO outbound_messages/.test(c.sql))).toBe(false);
  });

  it("edits with no buttons → sends an explicit empty inline_keyboard (clears any prior buttons)", async () => {
    // TGR-11: Done/Snooze/Reschedule edit the original reminder message to
    // remove its buttons. Telegram's editMessageText leaves an existing
    // keyboard untouched when reply_markup is omitted from the request, so
    // "no buttons" must be sent as an explicit empty array, not omitted.
    const { pool } = makeMockPool([
      selectRowHandler({ user_id: USER_ID, chat_id: CHAT_ID, telegram_message_id: "555", intent: "reminder" }),
      updateHandler(),
    ]);
    const { bot, editMessageTextMock } = makeBot();

    await editMessage(pool, "row-1", { text: "Done ✓ Buy milk" }, { bot, sleep: noopSleep });

    expect(editMessageTextMock).toHaveBeenCalledWith(
      CHAT_ID,
      555,
      "Done ✓ Buy milk",
      { reply_markup: { inline_keyboard: [] } },
    );
  });

  it("unknown outboundMessageId → throws OutboundMessageNotFoundError", async () => {
    const { pool } = makeMockPool([selectRowHandler(undefined)]);
    const { bot } = makeBot();

    await expect(
      editMessage(pool, "missing-row", { text: "x" }, { bot, sleep: noopSleep }),
    ).rejects.toThrow(OutboundMessageNotFoundError);
  });

  it("row whose original send never produced a telegram_message_id → throws OutboundMessageNotSentError", async () => {
    const { pool } = makeMockPool([
      selectRowHandler({ user_id: USER_ID, chat_id: CHAT_ID, telegram_message_id: null, intent: "reminder" }),
    ]);
    const { bot } = makeBot();

    await expect(
      editMessage(pool, "row-2", { text: "x" }, { bot, sleep: noopSleep }),
    ).rejects.toThrow(OutboundMessageNotSentError);
  });

  it("403 on edit → status='blocked', blocked event fires with the row's intent", async () => {
    const { pool, calls } = makeMockPool([
      selectRowHandler({ user_id: USER_ID, chat_id: CHAT_ID, telegram_message_id: "555", intent: "reminder" }),
      updateHandler(),
    ]);
    const { bot } = makeBot({
      editMessageText: vi.fn().mockRejectedValue(grammyError(403)),
    });
    const events: OutboundBlockedEvent[] = [];
    onOutboundBlocked((e) => events.push(e));

    const result = await editMessage(pool, "row-3", { text: "x" }, { bot, sleep: noopSleep });

    expect(result.status).toBe("blocked");
    expect(events).toEqual([{ userId: USER_ID, chatId: CHAT_ID, outboundMessageId: "row-3", intent: "reminder" }]);
    expect(calls.some((c) => /SET status = 'blocked'/.test(c.sql))).toBe(true);
  });
});
