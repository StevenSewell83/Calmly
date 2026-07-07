// TGR-04 — /now handler unit tests. pg.Pool is mocked by matching on the
// SQL text (same style as linking.test.ts / callback.test.ts) since
// handleNow issues up to three distinct queries (link lookup, candidate
// task, next-step subtask).

import type { FastifyBaseLogger } from "fastify";
import type { Message, Chat, User } from "grammy/types";
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { handleNow } from "../now";

const FROM_USER: User = { id: 111, is_bot: false, first_name: "Test" };
const CHAT: Chat.PrivateChat = { id: 555, type: "private", first_name: "Test" };
const USER_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";

function makeMessage(): Message {
  return {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    chat: CHAT,
    from: FROM_USER,
    text: "/now",
  };
}

interface QueryCall {
  sql: string;
  params: readonly unknown[] | undefined;
}

function makeMockPool(
  handler: (sql: string, params?: readonly unknown[]) => { rows: unknown[] },
): { pool: pg.Pool; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const pool = {
    async query(sql: string, params?: readonly unknown[]) {
      calls.push({ sql, params });
      return handler(sql, params);
    },
  } as unknown as pg.Pool;
  return { pool, calls };
}

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

describe("handleNow", () => {
  it("unlinked chat → link prompt, only queries telegram_links", async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log } = makeStubLogger();

    const reply = await handleNow(makeMessage(), pool, log);

    expect(reply).toBe("Link your account in Settings → Telegram first\\.");
    expect(calls).toHaveLength(1);
  });

  it("linked, no candidate task → calm empty-state reply", async () => {
    const { pool } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return { rows: [{ user_id: USER_ID }] };
      if (/FROM tasks/i.test(sql)) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log } = makeStubLogger();

    const reply = await handleNow(makeMessage(), pool, log);

    expect(reply).toBe(
      "No focus task right now\\. Open Focus on desktop to start one\\.",
    );
  });

  it("linked, candidate task with no subtasks → Next: em dash", async () => {
    const { pool } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return { rows: [{ user_id: USER_ID }] };
      if (/parent_task_id/i.test(sql)) return { rows: [] };
      if (/FROM tasks/i.test(sql)) {
        return { rows: [{ id: TASK_ID, title: "Write report" }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log } = makeStubLogger();

    const reply = await handleNow(makeMessage(), pool, log);

    expect(reply).toBe("Now: Write report\nNext: —");
  });

  it("linked, candidate task with an open subtask → Next: subtask title", async () => {
    const { pool } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return { rows: [{ user_id: USER_ID }] };
      if (/parent_task_id/i.test(sql)) {
        return { rows: [{ title: "Draft the outline" }] };
      }
      if (/FROM tasks/i.test(sql)) {
        return { rows: [{ id: TASK_ID, title: "Write report" }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log } = makeStubLogger();

    const reply = await handleNow(makeMessage(), pool, log);

    expect(reply).toBe("Now: Write report\nNext: Draft the outline");
  });

  it("escapes MarkdownV2 special chars in both title and next step", async () => {
    const { pool } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return { rows: [{ user_id: USER_ID }] };
      if (/parent_task_id/i.test(sql)) {
        return { rows: [{ title: "Email boss (re: Q3!)" }] };
      }
      if (/FROM tasks/i.test(sql)) {
        return { rows: [{ id: TASK_ID, title: "Finish deck [v2]" }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log } = makeStubLogger();

    const reply = await handleNow(makeMessage(), pool, log);

    expect(reply).toBe(
      "Now: Finish deck \\[v2\\]\nNext: Email boss \\(re: Q3\\!\\)",
    );
  });

  it("passes the candidate task's own id as parent_task_id when looking up the next step", async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return { rows: [{ user_id: USER_ID }] };
      if (/parent_task_id/i.test(sql)) return { rows: [] };
      if (/FROM tasks/i.test(sql)) {
        return { rows: [{ id: TASK_ID, title: "Write report" }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log } = makeStubLogger();

    await handleNow(makeMessage(), pool, log);

    const nextStepCall = calls.find((c) => /parent_task_id/i.test(c.sql));
    expect(nextStepCall?.params).toEqual([TASK_ID]);
  });

  it("does not log the task title (no PII at info level)", async () => {
    const { pool } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return { rows: [{ user_id: USER_ID }] };
      if (/parent_task_id/i.test(sql)) return { rows: [] };
      if (/FROM tasks/i.test(sql)) {
        return { rows: [{ id: TASK_ID, title: "my therapist appointment" }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log, infoCalls } = makeStubLogger();

    await handleNow(makeMessage(), pool, log);

    for (const call of infoCalls) {
      expect(JSON.stringify(call.fields)).not.toContain("therapist");
    }
  });

  it("resolves the linked user via the chat_id on the incoming message", async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log } = makeStubLogger();

    await handleNow(makeMessage(), pool, log);

    expect(calls[0]?.params).toEqual(["555"]);
  });
});
