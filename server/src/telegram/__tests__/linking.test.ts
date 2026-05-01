import { describe, expect, it, vi } from "vitest";
import type pg from "pg";
import {
  generateLinkingCode,
  getLinkingStatus,
  redeemLinkingCode,
  unlinkTelegram,
  __INTERNAL,
} from "../linking";

// TG-02a unit tests. We mock pg.Pool by intercepting query / connect
// — the linking service is the only consumer of those two methods so
// the mock surface is small. Integration coverage (real DB, real bot)
// lives in TG-02b.

interface QueryCall {
  sql: string;
  params: readonly unknown[] | undefined;
}

interface MockPoolOptions {
  query: (
    sql: string,
    params?: readonly unknown[],
  ) => { rows: unknown[]; rowCount?: number };
  connectQuery?: (
    sql: string,
    params?: readonly unknown[],
  ) => { rows: unknown[]; rowCount?: number };
}

function makeMockPool(opts: MockPoolOptions): {
  pool: pg.Pool;
  poolCalls: QueryCall[];
  connectCalls: QueryCall[];
  released: () => boolean;
} {
  const poolCalls: QueryCall[] = [];
  const connectCalls: QueryCall[] = [];
  let releaseCalled = false;

  const pool = {
    async query(sql: string, params?: readonly unknown[]) {
      poolCalls.push({ sql, params });
      return opts.query(sql, params);
    },
    async connect() {
      const client = {
        async query(sql: string, params?: readonly unknown[]) {
          connectCalls.push({ sql, params });
          if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
            return { rows: [], rowCount: 0 };
          }
          if (opts.connectQuery) return opts.connectQuery(sql, params);
          return { rows: [], rowCount: 0 };
        },
        release() {
          releaseCalled = true;
        },
      };
      return client;
    },
  } as unknown as pg.Pool;

  return {
    pool,
    poolCalls,
    connectCalls,
    released: () => releaseCalled,
  };
}

const NOW = 1_730_000_000_000;
const USER = "11111111-1111-4111-8111-111111111111";
const CHAT = "987654321";

// ── generateLinkingCode ────────────────────────────────────────────────────

describe("generateLinkingCode", () => {
  it("issues a fresh code when under the active-code cap", async () => {
    const { pool, poolCalls } = makeMockPool({
      query: (sql) => {
        if (/SELECT count/i.test(sql)) return { rows: [{ count: "0" }] };
        if (/INSERT INTO telegram_linking_codes/i.test(sql))
          return { rows: [], rowCount: 1 };
        throw new Error(`unexpected sql: ${sql}`);
      },
    });
    const r = await generateLinkingCode(pool, USER, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.code).toMatch(/^[A-Z0-9]{8}$/);
      expect(r.expiresAt).toBe(NOW + __INTERNAL.CODE_TTL_MS);
    }
    expect(poolCalls).toHaveLength(2);
  });

  it("rejects with rate_limited when the user already has 5 active codes", async () => {
    const { pool } = makeMockPool({
      query: (sql) => {
        if (/SELECT count/i.test(sql))
          return { rows: [{ count: "5" }] };
        throw new Error(`unexpected sql: ${sql}`);
      },
    });
    const r = await generateLinkingCode(pool, USER, NOW);
    expect(r).toEqual({ ok: false, error: "rate_limited" });
  });

  it("retries on a unique-violation collision", async () => {
    let insertAttempts = 0;
    const { pool } = makeMockPool({
      query: (sql) => {
        if (/SELECT count/i.test(sql)) return { rows: [{ count: "0" }] };
        if (/INSERT INTO telegram_linking_codes/i.test(sql)) {
          insertAttempts++;
          if (insertAttempts === 1) {
            const e = new Error("unique violation") as Error & {
              code: string;
            };
            e.code = "23505";
            throw e;
          }
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`unexpected sql: ${sql}`);
      },
    });
    const r = await generateLinkingCode(pool, USER, NOW);
    expect(r.ok).toBe(true);
    expect(insertAttempts).toBe(2);
  });

  it("rethrows non-unique-violation database errors", async () => {
    const { pool } = makeMockPool({
      query: (sql) => {
        if (/SELECT count/i.test(sql)) return { rows: [{ count: "0" }] };
        throw new Error("connection refused");
      },
    });
    await expect(generateLinkingCode(pool, USER, NOW)).rejects.toThrow(
      /connection refused/,
    );
  });
});

// ── redeemLinkingCode ──────────────────────────────────────────────────────

describe("redeemLinkingCode", () => {
  it("uppercases the input code before lookup", async () => {
    const { pool, connectCalls } = makeMockPool({
      query: () => ({ rows: [], rowCount: 0 }),
      connectQuery: (sql) => {
        if (/SELECT user_id, expires_at/i.test(sql)) {
          return {
            rows: [
              {
                user_id: USER,
                expires_at: String(NOW + 60_000),
                consumed_at: null,
              },
            ],
          };
        }
        if (/SELECT id, chat_id FROM telegram_links/i.test(sql))
          return { rows: [] };
        return { rows: [], rowCount: 1 };
      },
    });
    const r = await redeemLinkingCode(pool, "abc12345", CHAT, "alex_dev", NOW);
    expect(r.ok).toBe(true);
    // The first SELECT (with FOR UPDATE) carries the uppercased code.
    const lookup = connectCalls.find((c) =>
      /SELECT user_id, expires_at/i.test(c.sql),
    );
    expect(lookup?.params?.[0]).toBe("ABC12345");
  });

  it("returns not_found for an unknown code", async () => {
    const { pool } = makeMockPool({
      query: () => ({ rows: [], rowCount: 0 }),
      connectQuery: (sql) => {
        if (/SELECT user_id, expires_at/i.test(sql)) return { rows: [] };
        return { rows: [], rowCount: 1 };
      },
    });
    const r = await redeemLinkingCode(pool, "MISSING1", CHAT, null, NOW);
    expect(r).toEqual({ ok: false, error: "not_found" });
  });

  it("returns expired when the code's expiry is past", async () => {
    const { pool } = makeMockPool({
      query: () => ({ rows: [], rowCount: 0 }),
      connectQuery: (sql) => {
        if (/SELECT user_id, expires_at/i.test(sql)) {
          return {
            rows: [
              {
                user_id: USER,
                expires_at: String(NOW - 1),
                consumed_at: null,
              },
            ],
          };
        }
        return { rows: [], rowCount: 1 };
      },
    });
    const r = await redeemLinkingCode(pool, "AAAA1111", CHAT, null, NOW);
    expect(r).toEqual({ ok: false, error: "expired" });
  });

  it("returns already_used when consumed_at is set", async () => {
    const { pool } = makeMockPool({
      query: () => ({ rows: [], rowCount: 0 }),
      connectQuery: (sql) => {
        if (/SELECT user_id, expires_at/i.test(sql)) {
          return {
            rows: [
              {
                user_id: USER,
                expires_at: String(NOW + 60_000),
                consumed_at: String(NOW - 1000),
              },
            ],
          };
        }
        return { rows: [], rowCount: 1 };
      },
    });
    const r = await redeemLinkingCode(pool, "AAAA1111", CHAT, null, NOW);
    expect(r).toEqual({ ok: false, error: "already_used" });
  });

  it("flags replacedExistingLink when the user previously linked a different chat", async () => {
    const { pool } = makeMockPool({
      query: () => ({ rows: [], rowCount: 0 }),
      connectQuery: (sql) => {
        if (/SELECT user_id, expires_at/i.test(sql)) {
          return {
            rows: [
              {
                user_id: USER,
                expires_at: String(NOW + 60_000),
                consumed_at: null,
              },
            ],
          };
        }
        if (/SELECT id, chat_id FROM telegram_links/i.test(sql))
          return { rows: [{ id: "old-row", chat_id: "999" }] };
        return { rows: [], rowCount: 1 };
      },
    });
    const r = await redeemLinkingCode(pool, "AAAA1111", CHAT, null, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.replacedExistingLink).toBe(true);
  });

  it("releases the client even when an error is thrown mid-transaction", async () => {
    const { pool, released } = makeMockPool({
      query: () => ({ rows: [], rowCount: 0 }),
      connectQuery: (sql) => {
        if (/SELECT user_id, expires_at/i.test(sql)) {
          throw new Error("db blew up");
        }
        return { rows: [], rowCount: 1 };
      },
    });
    await expect(
      redeemLinkingCode(pool, "AAAA1111", CHAT, null, NOW),
    ).rejects.toThrow(/db blew up/);
    expect(released()).toBe(true);
  });
});

// ── getLinkingStatus ───────────────────────────────────────────────────────

describe("getLinkingStatus", () => {
  it("returns linked:false when there is no telegram_links row", async () => {
    const { pool } = makeMockPool({
      query: () => ({ rows: [] }),
    });
    expect(await getLinkingStatus(pool, USER)).toEqual({ linked: false });
  });

  it("returns the chat_id and linked_at when a link exists", async () => {
    const { pool } = makeMockPool({
      query: () => ({
        rows: [{ chat_id: CHAT, linked_at: String(NOW) }],
      }),
    });
    const r = await getLinkingStatus(pool, USER);
    expect(r).toEqual({ linked: true, chatId: CHAT, linkedAt: NOW });
  });
});

// ── unlinkTelegram ─────────────────────────────────────────────────────────

describe("unlinkTelegram", () => {
  it("returns the row count from the DELETE", async () => {
    const { pool, poolCalls } = makeMockPool({
      query: () => ({ rows: [], rowCount: 1 }),
    });
    const r = await unlinkTelegram(pool, USER);
    expect(r).toEqual({ ok: true, deleted: 1 });
    expect(poolCalls[0]?.sql).toMatch(/DELETE FROM telegram_links/);
  });

  it("treats a missing-row delete as deleted:0 (idempotent)", async () => {
    const { pool } = makeMockPool({
      query: () => ({ rows: [], rowCount: 0 }),
    });
    expect(await unlinkTelegram(pool, USER)).toEqual({
      ok: true,
      deleted: 0,
    });
  });
});

// ── Code alphabet sanity ──────────────────────────────────────────────────

describe("code alphabet", () => {
  it("excludes ambiguous characters (0/O/1/I/L)", () => {
    for (const c of __INTERNAL.CODE_ALPHABET) {
      expect("01IOL".includes(c)).toBe(false);
    }
  });

  it("randomCode returns 8 chars from the alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = __INTERNAL.randomCode();
      expect(code).toHaveLength(__INTERNAL.CODE_LENGTH);
      for (const ch of code) {
        expect(__INTERNAL.CODE_ALPHABET).toContain(ch);
      }
    }
  });
});

// vi import retained for future expansion (not currently used).
void vi;
