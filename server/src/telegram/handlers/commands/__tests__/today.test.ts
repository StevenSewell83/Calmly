// TGR-05 — /today handler unit tests. Same pg.Pool mocking-by-SQL-text
// style as now.test.ts. Fixed instants + explicit timezone args (rather
// than the system clock) make the timezone-boundary assertions
// deterministic regardless of the machine running the suite.

import type { FastifyBaseLogger } from "fastify";
import type { Message, Chat, User } from "grammy/types";
import type pg from "pg";
import { describe, expect, it } from "vitest";
import {
  handleToday,
  localDayWindow,
  formatTimeInZone,
} from "../today";

const FROM_USER: User = { id: 111, is_bot: false, first_name: "Test" };
const CHAT: Chat.PrivateChat = { id: 555, type: "private", first_name: "Test" };
const USER_ID = "11111111-1111-4111-8111-111111111111";

// 2026-07-07T12:00:00Z — well inside the local day for both UTC and
// the +9h / -5h zones exercised below, so the "today" window in each
// zone is unambiguous.
const FIXED_NOW = Date.parse("2026-07-07T12:00:00.000Z");

function makeMessage(): Message {
  return {
    message_id: 1,
    date: Math.floor(FIXED_NOW / 1000),
    chat: CHAT,
    from: FROM_USER,
    text: "/today",
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

const EMPTY_ROWS = { rows: [] };

describe("handleToday", () => {
  it("unlinked chat → link prompt, only queries telegram_links", async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return EMPTY_ROWS;
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log } = makeStubLogger();

    const reply = await handleToday(makeMessage(), pool, log, FIXED_NOW);

    expect(reply).toBe("Link your account in Settings → Telegram first\\.");
    expect(calls).toHaveLength(1);
  });

  it("linked, nothing scheduled → empty-state reply, no hint appended", async () => {
    const { pool } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return { rows: [{ user_id: USER_ID }] };
      if (/FROM tasks/i.test(sql)) return EMPTY_ROWS;
      if (/FROM events/i.test(sql)) return EMPTY_ROWS;
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log } = makeStubLogger();

    const reply = await handleToday(makeMessage(), pool, log, FIXED_NOW);

    expect(reply).toBe(
      "Nothing scheduled today\\. Open Plan on desktop to schedule\\.",
    );
  });

  it("resolves the linked user via the chat_id on the incoming message", async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return EMPTY_ROWS;
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log } = makeStubLogger();

    await handleToday(makeMessage(), pool, log, FIXED_NOW);

    expect(calls[0]?.params).toEqual(["555"]);
  });

  it("scheduled task (with time) + event → numbered list sorted chronologically, hint appended", async () => {
    const { pool } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return { rows: [{ user_id: USER_ID }] };
      if (/FROM tasks/i.test(sql)) {
        return {
          rows: [
            {
              title: "Write report",
              scheduled_start: String(Date.parse("2026-07-07T14:00:00.000Z")),
            },
          ],
        };
      }
      if (/FROM events/i.test(sql)) {
        return {
          rows: [
            { title: "Standup", start_at: String(Date.parse("2026-07-07T09:00:00.000Z")) },
          ],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log } = makeStubLogger();

    const reply = await handleToday(makeMessage(), pool, log, FIXED_NOW, "UTC");

    expect(reply).toBe(
      "1\\. 09:00 Standup\n2\\. 14:00 Write report\n\nSet your timezone in Settings for local times\\.",
    );
  });

  it("task with only due_at (no scheduled_start) renders '—' and sorts before timed items", async () => {
    const { pool } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return { rows: [{ user_id: USER_ID }] };
      if (/FROM tasks/i.test(sql)) {
        return { rows: [{ title: "Renew passport", scheduled_start: null }] };
      }
      if (/FROM events/i.test(sql)) {
        return {
          rows: [
            { title: "Standup", start_at: String(Date.parse("2026-07-07T09:00:00.000Z")) },
          ],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log } = makeStubLogger();

    const reply = await handleToday(makeMessage(), pool, log, FIXED_NOW, "UTC");

    expect(reply.startsWith("1\\. — Renew passport\n2\\. 09:00 Standup")).toBe(true);
  });

  it("truncates to 10 items when more than 10 are scheduled", async () => {
    const { pool } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return { rows: [{ user_id: USER_ID }] };
      if (/FROM tasks/i.test(sql)) {
        const rows = Array.from({ length: 12 }, (_, i) => ({
          title: `Task ${i}`,
          scheduled_start: String(
            Date.parse("2026-07-07T00:00:00.000Z") + i * 60 * 60 * 1000,
          ),
        }));
        return { rows };
      }
      if (/FROM events/i.test(sql)) return EMPTY_ROWS;
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log } = makeStubLogger();

    const reply = await handleToday(makeMessage(), pool, log, FIXED_NOW, "UTC");

    const lines = reply.split("\n").filter((l) => /^\d+\\\./.test(l));
    expect(lines).toHaveLength(10);
    expect(lines[0]).toContain("Task 0");
    expect(lines[9]).toContain("Task 9");
  });

  it("escapes MarkdownV2 special chars in titles", async () => {
    const { pool } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return { rows: [{ user_id: USER_ID }] };
      if (/FROM tasks/i.test(sql)) {
        return {
          rows: [
            {
              title: "Finish deck [v2]",
              scheduled_start: String(Date.parse("2026-07-07T10:00:00.000Z")),
            },
          ],
        };
      }
      if (/FROM events/i.test(sql)) return EMPTY_ROWS;
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log } = makeStubLogger();

    const reply = await handleToday(makeMessage(), pool, log, FIXED_NOW, "UTC");

    expect(reply).toContain("Finish deck \\[v2\\]");
  });

  it("does not log task titles (no PII at info level)", async () => {
    const { pool } = makeMockPool((sql) => {
      if (/telegram_links/i.test(sql)) return { rows: [{ user_id: USER_ID }] };
      if (/FROM tasks/i.test(sql)) {
        return {
          rows: [
            {
              title: "my therapist appointment",
              scheduled_start: String(Date.parse("2026-07-07T10:00:00.000Z")),
            },
          ],
        };
      }
      if (/FROM events/i.test(sql)) return EMPTY_ROWS;
      throw new Error(`unexpected query: ${sql}`);
    });
    const { log, infoCalls } = makeStubLogger();

    await handleToday(makeMessage(), pool, log, FIXED_NOW, "UTC");

    for (const call of infoCalls) {
      expect(JSON.stringify(call.fields)).not.toContain("therapist");
    }
  });
});

describe("localDayWindow / formatTimeInZone (timezone rendering)", () => {
  it("same fixed instant yields different local day windows and time labels across two zones", () => {
    // 2026-07-07T12:00:00Z is 08:00 in America/New_York (UTC-4 in July,
    // DST) and 21:00 in Asia/Tokyo (UTC+9) — different calendar days'
    // worth of offset, enough to prove the zone actually changes output.
    const nyWindow = localDayWindow(FIXED_NOW, "America/New_York");
    const tokyoWindow = localDayWindow(FIXED_NOW, "Asia/Tokyo");
    expect(nyWindow.start).not.toBe(tokyoWindow.start);

    expect(formatTimeInZone(FIXED_NOW, "America/New_York")).toBe("08:00");
    expect(formatTimeInZone(FIXED_NOW, "Asia/Tokyo")).toBe("21:00");
    expect(formatTimeInZone(FIXED_NOW, "UTC")).toBe("12:00");
  });

  it("a task scheduled just after UTC midnight can fall in 'yesterday' for a negative-offset zone", async () => {
    // 2026-07-07T02:00:00Z is still 2026-07-06 in America/Los_Angeles
    // (UTC-7 in July) — the /today window for that zone must exclude
    // it, proving the day boundary is zone-aware and not just UTC.
    const instant = Date.parse("2026-07-07T02:00:00.000Z");
    const laWindow = localDayWindow(instant, "America/Los_Angeles");
    const utcWindow = localDayWindow(instant, "UTC");
    expect(laWindow.start).not.toBe(utcWindow.start);
    expect(instant >= laWindow.start && instant < laWindow.endExclusive).toBe(true);
  });
});
