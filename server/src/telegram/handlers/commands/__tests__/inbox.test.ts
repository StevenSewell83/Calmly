// TGR-05 — /inbox handler unit tests. Same pg.Pool mocking-by-SQL-text
// style as now.test.ts / today.test.ts.

import type { FastifyBaseLogger } from "fastify";
import type { Message, Chat, User } from "grammy/types";
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { handleInbox } from "../inbox";

const FROM_USER: User = { id: 111, is_bot: false, first_name: "Test" };
const CHAT: Chat.PrivateChat = { id: 555, type: "private", first_name: "Test" };
const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-07-07T12:00:00.000Z");

function makeMessage(): Message {
  return {
    message_id: 1,
    date: Math.floor(NOW / 1000),
    chat: CHAT,
    from: FROM_USER,
    text: "/inbox",
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

function makeStubLogger(): { log: FastifyBaseLogger; infoCalls: Array<{ fields: Record<string, unknown>; msg: string }> } {
  const infoCalls: Array<{ fields: Record<string, unknown>; msg: string }> = [];
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

function countRows(n: number): { rows: unknown[] } {
  return { rows: [{ count: String(n) }] };
}

describe("handleInbox", () => {
  it("unlinked chat → link prompt, only queries telegram_links", async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log } = makeStubLogger();

    const reply = await handleInbox(makeMessage(), pool, log, NOW);

    expect(reply).toBe("Link your account in Settings → Telegram first\\.");
    expect(calls).toHaveLength(1);
  });

  it("linked, empty inbox → empty-state reply, no preview query issued", async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return { rows: [{ user_id: USER_ID }] };
      if (/count\(\*\)/i.test(sql)) return countRows(0);
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log } = makeStubLogger();

    const reply = await handleInbox(makeMessage(), pool, log, NOW);

    expect(reply).toBe("Inbox is empty\\.");
    expect(calls).toHaveLength(2);
  });

  it("linked, populated → count + bullet previews", async () => {
    const { pool } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return { rows: [{ user_id: USER_ID }] };
      if (/count\(\*\)/i.test(sql)) return countRows(2);
      if (/SELECT raw_text/i.test(sql)) {
        return { rows: [{ raw_text: "Buy milk" }, { raw_text: "Call dentist" }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log } = makeStubLogger();

    const reply = await handleInbox(makeMessage(), pool, log, NOW);

    expect(reply).toBe("Inbox: 2 items\n• Buy milk\n• Call dentist");
  });

  it("caps previews at 5 even when count is higher", async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return { rows: [{ user_id: USER_ID }] };
      if (/count\(\*\)/i.test(sql)) return countRows(9);
      if (/SELECT raw_text/i.test(sql)) {
        return { rows: [1, 2, 3, 4, 5].map((n) => ({ raw_text: `Item ${n}` })) };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log } = makeStubLogger();

    const reply = await handleInbox(makeMessage(), pool, log, NOW);

    const bulletLines = reply.split("\n").filter((l) => l.startsWith("•"));
    expect(bulletLines).toHaveLength(5);
    expect(reply.startsWith("Inbox: 9 items")).toBe(true);
    const previewCall = calls.find((c) => /SELECT raw_text/i.test(c.sql));
    expect(previewCall?.params).toEqual([USER_ID, NOW, 5]);
  });

  it("truncates a preview longer than 80 chars", async () => {
    const longText = "a".repeat(120);
    const { pool } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return { rows: [{ user_id: USER_ID }] };
      if (/count\(\*\)/i.test(sql)) return countRows(1);
      if (/SELECT raw_text/i.test(sql)) return { rows: [{ raw_text: longText }] };
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log } = makeStubLogger();

    const reply = await handleInbox(makeMessage(), pool, log, NOW);

    const bulletLine = reply.split("\n")[1]!;
    // "• " prefix + 79 chars + ellipsis = 82 chars total
    expect(bulletLine).toBe(`• ${"a".repeat(79)}…`);
    expect(bulletLine.length).toBe(2 + 80);
  });

  it("escapes MarkdownV2 special chars in preview text", async () => {
    const { pool } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return { rows: [{ user_id: USER_ID }] };
      if (/count\(\*\)/i.test(sql)) return countRows(1);
      if (/SELECT raw_text/i.test(sql)) {
        return { rows: [{ raw_text: "Email boss (re: Q3!)" }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log } = makeStubLogger();

    const reply = await handleInbox(makeMessage(), pool, log, NOW);

    expect(reply).toBe("Inbox: 1 items\n• Email boss \\(re: Q3\\!\\)");
  });

  it("resolves the linked user via the chat_id on the incoming message", async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log } = makeStubLogger();

    await handleInbox(makeMessage(), pool, log, NOW);

    expect(calls[0]?.params).toEqual(["555"]);
  });

  it("does not log inbox item text (no PII at info level)", async () => {
    const { pool } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return { rows: [{ user_id: USER_ID }] };
      if (/count\(\*\)/i.test(sql)) return countRows(1);
      if (/SELECT raw_text/i.test(sql)) {
        return { rows: [{ raw_text: "my therapist appointment notes" }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log, infoCalls } = makeStubLogger();

    await handleInbox(makeMessage(), pool, log, NOW);

    for (const call of infoCalls) {
      expect(JSON.stringify(call.fields)).not.toContain("therapist");
    }
  });
});
