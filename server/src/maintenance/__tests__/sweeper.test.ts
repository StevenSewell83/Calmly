import { describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { startSweeper, sweepExpiredAuthRows } from "../sweeper";

function stubPool(fail: Set<string> = new Set()) {
  const queries: string[] = [];
  const pool = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      const table = /DELETE FROM (\w+)/.exec(sql)?.[1] ?? "";
      if (fail.has(table)) throw new Error(`boom: ${table}`);
      return { rowCount: 2 };
    }),
  } as unknown as pg.Pool;
  return { pool, queries };
}

const ALL_TABLES = [
  "magic_link_tokens",
  "sessions",
  "oauth_states",
  "oauth_tickets",
  "telegram_linking_codes",
];

describe("sweepExpiredAuthRows", () => {
  it("sweeps every short-lived auth table", async () => {
    const { pool, queries } = stubPool();
    const deleted = await sweepExpiredAuthRows(pool);
    expect(Object.keys(deleted).sort()).toEqual([...ALL_TABLES].sort());
    for (const table of ALL_TABLES) {
      expect(queries.some((q) => q.includes(`DELETE FROM ${table}`))).toBe(
        true,
      );
    }
  });

  it("keeps expired-but-recent magic-link tokens for the rate-limit window", async () => {
    const { queries, pool } = stubPool();
    await sweepExpiredAuthRows(pool);
    const magicLink = queries.find((q) =>
      q.includes("DELETE FROM magic_link_tokens"),
    );
    // The rate limiter counts rows by requested_at over a 1-hour window;
    // sweeping expired-but-recent rows would silently reset the limit.
    expect(magicLink).toContain("requested_at <= now() - interval '1 hour'");
  });

  it("deletes consumed telegram linking codes, not just expired ones", async () => {
    const { queries, pool } = stubPool();
    await sweepExpiredAuthRows(pool);
    const linking = queries.find((q) =>
      q.includes("DELETE FROM telegram_linking_codes"),
    );
    expect(linking).toContain("consumed_at IS NOT NULL");
  });

  it("continues past a failing table and reports the rest", async () => {
    const { pool } = stubPool(new Set(["sessions"]));
    const warn = vi.fn();
    const deleted = await sweepExpiredAuthRows(pool, {
      debug: vi.fn(),
      warn,
    });
    expect(deleted.sessions).toBeUndefined();
    expect(deleted.oauth_tickets).toBe(2);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("startSweeper", () => {
  it("runs on the interval and stops cleanly", async () => {
    vi.useFakeTimers();
    try {
      const { pool } = stubPool();
      const stop = startSweeper(pool, 1000);
      expect(pool.query).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1000);
      expect(pool.query).toHaveBeenCalledTimes(ALL_TABLES.length);

      stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(pool.query).toHaveBeenCalledTimes(ALL_TABLES.length);
    } finally {
      vi.useRealTimers();
    }
  });
});
