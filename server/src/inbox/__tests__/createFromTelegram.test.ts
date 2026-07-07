import { describe, expect, it } from "vitest";
import type pg from "pg";
import { captureFromTelegram } from "../createFromTelegram";

// TGR-03a-rebuild unit tests. We mock pg.Pool by intercepting `query`
// — captureFromTelegram is a single-statement writer so the mock
// surface is just that one call. Real-DB coverage (partial unique index,
// ON CONFLICT semantics) is left to CI's integration pass.

interface QueryCall {
  sql: string;
  params: readonly unknown[] | undefined;
}

function makeMockPool(
  handler: (
    sql: string,
    params?: readonly unknown[],
  ) => { rows: unknown[] },
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

const NOW = 1_730_000_000_000;
const CHAT_ID = "987654321";

describe("captureFromTelegram", () => {
  it("linked chat, fresh message → inserted row, alreadyProcessed:false", async () => {
    const { pool, calls } = makeMockPool(() => ({
      rows: [{ id: "inbox-1", inserted: true }],
    }));

    const r = await captureFromTelegram(pool, {
      chatId: CHAT_ID,
      telegramMessageId: 42,
      rawText: "buy milk",
      now: NOW,
    });

    expect(r).toEqual({
      ok: true,
      inboxId: "inbox-1",
      truncated: false,
      alreadyProcessed: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toMatch(/INSERT INTO inbox_items/);
    expect(calls[0]?.sql).toMatch(/FROM telegram_links tl/);
    expect(calls[0]?.sql).toMatch(/ON CONFLICT \(user_id, external_ref\)/);
  });

  it("passes the external_ref and chat_id/message text as query params", async () => {
    const { pool, calls } = makeMockPool(() => ({
      rows: [{ id: "inbox-2", inserted: true }],
    }));

    await captureFromTelegram(pool, {
      chatId: CHAT_ID,
      telegramMessageId: 99,
      rawText: "call mom",
      now: NOW,
    });

    const params = calls[0]?.params as unknown[];
    // [id, chatId, text, now, externalRef]
    expect(params[1]).toBe(CHAT_ID);
    expect(params[2]).toBe("call mom");
    expect(params[3]).toBe(NOW);
    expect(params[4]).toBe(`tg:${CHAT_ID}:99`);
  });

  it("unlinked chat → ok:false, error:'unlinked' (empty RETURNING set)", async () => {
    const { pool } = makeMockPool(() => ({ rows: [] }));

    const r = await captureFromTelegram(pool, {
      chatId: "no-such-chat",
      telegramMessageId: 1,
      rawText: "hello",
      now: NOW,
    });

    expect(r).toEqual({ ok: false, error: "unlinked" });
  });

  it("idempotent replay (same external_ref) → alreadyProcessed:true, same inboxId, no duplicate insert", async () => {
    const { pool, calls } = makeMockPool(() => ({
      rows: [{ id: "inbox-3", inserted: false }],
    }));

    const r = await captureFromTelegram(pool, {
      chatId: CHAT_ID,
      telegramMessageId: 7,
      rawText: "buy milk",
      now: NOW,
    });

    expect(r).toEqual({
      ok: true,
      inboxId: "inbox-3",
      truncated: false,
      alreadyProcessed: true,
    });
    expect(calls).toHaveLength(1);
  });

  it("truncates raw_text over 4000 chars and flags truncated:true", async () => {
    const longText = "a".repeat(5000);
    const { pool, calls } = makeMockPool(() => ({
      rows: [{ id: "inbox-4", inserted: true }],
    }));

    const r = await captureFromTelegram(pool, {
      chatId: CHAT_ID,
      telegramMessageId: 8,
      rawText: longText,
      now: NOW,
    });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.truncated).toBe(true);
    const params = calls[0]?.params as unknown[];
    expect((params[2] as string).length).toBe(4000);
  });

  it("does not truncate raw_text at exactly 4000 chars", async () => {
    const exactText = "b".repeat(4000);
    const { pool, calls } = makeMockPool(() => ({
      rows: [{ id: "inbox-5", inserted: true }],
    }));

    const r = await captureFromTelegram(pool, {
      chatId: CHAT_ID,
      telegramMessageId: 9,
      rawText: exactText,
      now: NOW,
    });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.truncated).toBe(false);
    const params = calls[0]?.params as unknown[];
    expect((params[2] as string).length).toBe(4000);
  });
});
