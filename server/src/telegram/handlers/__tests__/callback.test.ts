// TGR-03 — unit tests for the callback_query handler + actions registry.
// pg.Pool is mocked the same way as outbound.test.ts; the bot client only
// needs answerCallbackQuery, which every path below must call exactly
// once (Telegram requires it or the button spins forever on-device).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { CallbackQuery, User } from "grammy/types";
import { handleCallbackQuery, type CallbackBotClient } from "../callback";
import { registerAction, __INTERNAL as ActionsInternal } from "../../actions";

const USER_ID = "user-1";
const CHAT_ID = "chat-42";
const ROW_ID = "row-abc";

const FROM_USER: User = { id: 111, is_bot: false, first_name: "Test" };

interface StubLogger extends FastifyBaseLogger {
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

function makeStubLogger(): StubLogger {
  const noop = (): void => {};
  const logger = {
    info: noop,
    warn: vi.fn(),
    error: vi.fn(),
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => logger,
    level: "info",
    silent: noop,
  } as unknown as StubLogger;
  return logger;
}

function makeCallbackQuery(data: string | undefined, id = "cq-1"): CallbackQuery {
  return { id, from: FROM_USER, chat_instance: "instance-1", data };
}

function makeMockPool(row: Record<string, unknown> | undefined): {
  pool: pg.Pool;
  calls: { sql: string; params: readonly unknown[] | undefined }[];
} {
  const calls: { sql: string; params: readonly unknown[] | undefined }[] = [];
  const pool = {
    async query(sql: string, params?: readonly unknown[]) {
      calls.push({ sql, params });
      return { rows: row ? [row] : [] };
    },
  } as unknown as pg.Pool;
  return { pool, calls };
}

function makeBot(): { bot: CallbackBotClient; answerMock: ReturnType<typeof vi.fn> } {
  const answerMock = vi.fn().mockResolvedValue(true);
  return { bot: { api: { answerCallbackQuery: answerMock } }, answerMock };
}

afterEach(() => {
  ActionsInternal.clear();
});

describe("handleCallbackQuery", () => {
  it("dispatches to the registered handler with the DB-resolved payload, answers with its text", async () => {
    const { pool } = makeMockPool({
      id: ROW_ID,
      user_id: USER_ID,
      chat_id: CHAT_ID,
      payload: { buttons: [{ actionId: "done", payload: { taskId: "t1" } }] },
    });
    const { bot, answerMock } = makeBot();
    const handler = vi.fn().mockResolvedValue({ answerText: "Marked done!" });
    registerAction("done", handler);

    await handleCallbackQuery(makeCallbackQuery(`done:${ROW_ID}`), pool, makeStubLogger(), { bot });

    expect(handler).toHaveBeenCalledWith({
      userId: USER_ID,
      chatId: CHAT_ID,
      outboundMessageId: ROW_ID,
      actionId: "done",
      payload: { taskId: "t1" },
      callbackQueryId: "cq-1",
    });
    expect(answerMock).toHaveBeenCalledWith("cq-1", { text: "Marked done!", show_alert: undefined });
  });

  it("dispatches to the matching button when a message has multiple buttons/actionIds", async () => {
    const { pool } = makeMockPool({
      id: ROW_ID,
      user_id: USER_ID,
      chat_id: CHAT_ID,
      payload: {
        buttons: [
          { actionId: "done", payload: { taskId: "t1" } },
          { actionId: "snooze", payload: { minutes: 10 } },
        ],
      },
    });
    const { bot } = makeBot();
    const doneHandler = vi.fn().mockResolvedValue(undefined);
    const snoozeHandler = vi.fn().mockResolvedValue(undefined);
    registerAction("done", doneHandler);
    registerAction("snooze", snoozeHandler);

    await handleCallbackQuery(makeCallbackQuery(`snooze:${ROW_ID}`), pool, makeStubLogger(), { bot });

    expect(snoozeHandler).toHaveBeenCalledTimes(1);
    expect(snoozeHandler).toHaveBeenCalledWith(expect.objectContaining({ actionId: "snooze", payload: { minutes: 10 } }));
    expect(doneHandler).not.toHaveBeenCalled();
  });

  it("handler returning void → still answers, with no text", async () => {
    const { pool } = makeMockPool({ id: ROW_ID, user_id: USER_ID, chat_id: CHAT_ID, payload: { buttons: [] } });
    const { bot, answerMock } = makeBot();
    registerAction("done", vi.fn().mockResolvedValue(undefined));

    await handleCallbackQuery(makeCallbackQuery(`done:${ROW_ID}`), pool, makeStubLogger(), { bot });

    expect(answerMock).toHaveBeenCalledWith("cq-1", undefined);
  });

  it("unknown actionId → answered gracefully with 'This button expired.', handler not called", async () => {
    const { pool } = makeMockPool({ id: ROW_ID, user_id: USER_ID, chat_id: CHAT_ID, payload: { buttons: [] } });
    const { bot, answerMock } = makeBot();
    const log = makeStubLogger();

    await handleCallbackQuery(makeCallbackQuery(`ghost-action:${ROW_ID}`), pool, log, { bot });

    expect(answerMock).toHaveBeenCalledWith("cq-1", { text: "This button expired.", show_alert: undefined });
    expect(log.warn).toHaveBeenCalled();
  });

  it("unknown outbound message row → answered gracefully, no handler dispatch", async () => {
    const { pool } = makeMockPool(undefined);
    const { bot, answerMock } = makeBot();
    const handler = vi.fn();
    registerAction("done", handler);

    await handleCallbackQuery(makeCallbackQuery(`done:missing-row`), pool, makeStubLogger(), { bot });

    expect(handler).not.toHaveBeenCalled();
    expect(answerMock).toHaveBeenCalledWith("cq-1", { text: "This button expired.", show_alert: undefined });
  });

  it("malformed callback_data (no separator) → answered gracefully, no DB lookup", async () => {
    const { pool, calls } = makeMockPool(undefined);
    const { bot, answerMock } = makeBot();

    await handleCallbackQuery(makeCallbackQuery("not-a-valid-payload"), pool, makeStubLogger(), { bot });

    expect(calls).toHaveLength(0);
    expect(answerMock).toHaveBeenCalledWith("cq-1", { text: "This button expired.", show_alert: undefined });
  });

  it("callback_query with no data → answered gracefully, no DB lookup", async () => {
    const { pool, calls } = makeMockPool(undefined);
    const { bot, answerMock } = makeBot();

    await handleCallbackQuery(makeCallbackQuery(undefined), pool, makeStubLogger(), { bot });

    expect(calls).toHaveLength(0);
    expect(answerMock).toHaveBeenCalledWith("cq-1", { text: "This button expired.", show_alert: undefined });
  });

  it("handler throws → still answers, with a generic error message, and logs the error", async () => {
    const { pool } = makeMockPool({ id: ROW_ID, user_id: USER_ID, chat_id: CHAT_ID, payload: { buttons: [] } });
    const { bot, answerMock } = makeBot();
    const log = makeStubLogger();
    registerAction("done", vi.fn().mockRejectedValue(new Error("handler blew up")));

    await handleCallbackQuery(makeCallbackQuery(`done:${ROW_ID}`), pool, log, { bot });

    expect(answerMock).toHaveBeenCalledWith("cq-1", { text: "Something went wrong. Try again.", show_alert: undefined });
    expect(log.error).toHaveBeenCalled();
  });

  it("answerCallbackQuery itself throwing does not propagate (best-effort ack)", async () => {
    const { pool } = makeMockPool({ id: ROW_ID, user_id: USER_ID, chat_id: CHAT_ID, payload: { buttons: [] } });
    const answerMock = vi.fn().mockRejectedValue(new Error("telegram unreachable"));
    const bot: CallbackBotClient = { api: { answerCallbackQuery: answerMock } };
    registerAction("done", vi.fn().mockResolvedValue(undefined));

    await expect(
      handleCallbackQuery(makeCallbackQuery(`done:${ROW_ID}`), pool, makeStubLogger(), { bot }),
    ).resolves.toBeUndefined();
  });
});

describe("actions registry", () => {
  beforeEach(() => {
    ActionsInternal.clear();
  });

  it("registerAction then getAction round-trips the handler", async () => {
    const { getAction } = await import("../../actions");
    const handler = vi.fn();
    registerAction("reschedule", handler);
    expect(getAction("reschedule")).toBe(handler);
  });

  it("unregisterAction removes a handler", async () => {
    const { getAction, unregisterAction } = await import("../../actions");
    registerAction("reschedule", vi.fn());
    unregisterAction("reschedule");
    expect(getAction("reschedule")).toBeUndefined();
  });
});
