import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  addInboxItem,
  listInbox,
  MAX_RAW_TEXT_CHARS,
  skipInboxItem,
  snoozeInboxItem,
} from "../store";

// We can't load the real better-sqlite3 native binding from system Node
// (it's compiled for Electron's ABI, not the host's), so this fake mirrors
// just the surface the store touches: prepare(...).run|all|get() and
// transaction(fn)(). Captures every prepared SQL + its bound args so the
// assertions can be specific.

interface PreparedCall {
  sql: string;
  args: unknown[];
}

interface FakeRow {
  [key: string]: unknown;
}

interface FakeDb {
  db: Database.Database;
  prepared: PreparedCall[];
  failNextRun: (err?: Error) => void;
  pushAllResult: (rows: FakeRow[]) => void;
  pushGetResult: (row: FakeRow | undefined) => void;
}

function makeFakeDb(): FakeDb {
  const prepared: PreparedCall[] = [];
  let nextRunFails: Error | null = null;
  const allResults: FakeRow[][] = [];
  const getResults: (FakeRow | undefined)[] = [];
  const db = {
    prepare(sql: string) {
      return {
        run(...args: unknown[]): { changes: number; lastInsertRowid: number } {
          if (nextRunFails) {
            const err = nextRunFails;
            nextRunFails = null;
            throw err;
          }
          prepared.push({ sql: normalize(sql), args });
          return { changes: 1, lastInsertRowid: 0 };
        },
        all(...args: unknown[]): FakeRow[] {
          prepared.push({ sql: normalize(sql), args });
          return allResults.shift() ?? [];
        },
        get(...args: unknown[]): FakeRow | undefined {
          prepared.push({ sql: normalize(sql), args });
          return getResults.shift();
        },
      };
    },
    // better-sqlite3.transaction returns a function that, when called, runs
    // the body inside a tx; for the mock we just call the body directly.
    // If the body throws, surfacing the error replicates the rollback path
    // (no rows committed, exception propagates).
    transaction<TArgs extends unknown[], TResult>(
      fn: (...args: TArgs) => TResult,
    ): (...args: TArgs) => TResult {
      return (...args: TArgs) => fn(...args);
    },
  } as unknown as Database.Database;
  return {
    db,
    prepared,
    failNextRun: (err = new Error("simulated FK failure")) => {
      nextRunFails = err;
    },
    pushAllResult: (rows) => {
      allResults.push(rows);
    },
    pushGetResult: (row) => {
      getResults.push(row);
    },
  };
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

const TEST_USER = "11111111-1111-1111-1111-111111111111";

describe("addInboxItem · validation", () => {
  it("rejects empty / whitespace-only input without writing", () => {
    const fake = makeFakeDb();
    const empty = addInboxItem({
      db: fake.db,
      userId: TEST_USER,
      rawText: "",
      source: "desktop",
    });
    expect(empty).toEqual({ ok: false, error: "InvalidArgs" });

    const whitespace = addInboxItem({
      db: fake.db,
      userId: TEST_USER,
      rawText: "   \t\n  ",
      source: "desktop",
    });
    expect(whitespace).toEqual({ ok: false, error: "InvalidArgs" });

    expect(fake.prepared).toHaveLength(0);
  });

  it("trims whitespace before persisting", () => {
    const fake = makeFakeDb();
    const result = addInboxItem({
      db: fake.db,
      userId: TEST_USER,
      rawText: "   buy milk   \n",
      source: "desktop",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const insert = fake.prepared.find((p) => p.sql.startsWith("insert into"));
    expect(insert).toBeDefined();
    // raw_text bound at position 3 (id, user_id, raw_text, source, created_at).
    expect(insert?.args[2]).toBe("buy milk");
  });

  it("truncates oversized text and returns truncated:true", () => {
    const fake = makeFakeDb();
    const oversize = "a".repeat(MAX_RAW_TEXT_CHARS + 500);
    const result = addInboxItem({
      db: fake.db,
      userId: TEST_USER,
      rawText: oversize,
      source: "desktop",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(true);

    const insert = fake.prepared.find((p) => p.sql.startsWith("insert into"));
    expect((insert?.args[2] as string).length).toBe(MAX_RAW_TEXT_CHARS);
  });

  it("does not flag truncated:false when input is exactly at the cap", () => {
    const fake = makeFakeDb();
    const exact = "a".repeat(MAX_RAW_TEXT_CHARS);
    const result = addInboxItem({
      db: fake.db,
      userId: TEST_USER,
      rawText: exact,
      source: "desktop",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(false);
  });
});

describe("addInboxItem · persistence", () => {
  it("issues both an inbox INSERT and an op_queue INSERT under one transaction", () => {
    const fake = makeFakeDb();
    const result = addInboxItem({
      db: fake.db,
      userId: TEST_USER,
      rawText: "buy milk",
      source: "desktop",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sqls = fake.prepared.map((p) => p.sql);
    expect(sqls.some((s) => s.includes("insert into inbox_items"))).toBe(true);
    expect(sqls.some((s) => s.includes("insert into op_queue"))).toBe(true);

    // Sanity: the queued payload references the same id we returned.
    const opCall = fake.prepared.find((p) =>
      p.sql.includes("insert into op_queue"),
    );
    expect(opCall?.args[1]).toBe("inbox_items");
    expect(opCall?.args[2]).toBe("upsert");
    const payload = JSON.parse(opCall!.args[3] as string) as {
      id: string;
      raw_text: string;
    };
    expect(payload.id).toBe(result.id);
    expect(payload.raw_text).toBe("buy milk");
  });

  it("returns InternalError and surfaces nothing when the insert throws", () => {
    const fake = makeFakeDb();
    const error = new Error("FOREIGN KEY constraint failed");
    fake.failNextRun(error);

    const result = addInboxItem({
      db: fake.db,
      userId: "00000000-0000-0000-0000-000000000000",
      rawText: "buy milk",
      source: "desktop",
    });
    expect(result).toEqual({ ok: false, error: "InternalError" });
  });

  it("includes snoozed_until:null in the synced upsert payload", () => {
    const fake = makeFakeDb();
    const result = addInboxItem({
      db: fake.db,
      userId: TEST_USER,
      rawText: "buy milk",
      source: "desktop",
    });
    expect(result.ok).toBe(true);
    const opCall = fake.prepared.find((p) =>
      p.sql.includes("insert into op_queue"),
    );
    const payload = JSON.parse(opCall!.args[3] as string) as Record<
      string,
      unknown
    >;
    expect(payload.snoozed_until).toBeNull();
  });
});

describe("listInbox", () => {
  it("filters by user, deleted_at, resolved_at, and snooze visibility", () => {
    const fake = makeFakeDb();
    fake.pushAllResult([]);
    listInbox(fake.db, TEST_USER, 1_730_000_000_000);

    const sql = fake.prepared[0]!.sql;
    expect(sql).toContain("from inbox_items");
    expect(sql).toContain("user_id = ?");
    expect(sql).toContain("deleted_at is null");
    expect(sql).toContain("resolved_at is null");
    expect(sql).toContain("snoozed_until is null or snoozed_until <= ?");
    expect(sql).toContain("order by created_at desc");
    expect(fake.prepared[0]!.args).toEqual([TEST_USER, 1_730_000_000_000]);
  });

  it("returns rows verbatim", () => {
    const fake = makeFakeDb();
    fake.pushAllResult([
      {
        id: "i1",
        raw_text: "buy milk",
        source: "desktop",
        created_at: 1,
        resolved_at: null,
        snoozed_until: null,
      },
    ]);
    const out = listInbox(fake.db, TEST_USER, 0);
    expect(out).toHaveLength(1);
    expect(out[0]!.raw_text).toBe("buy milk");
  });
});

describe("snoozeInboxItem", () => {
  const ITEM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  it("rejects past untilMs as InvalidArgs", () => {
    const fake = makeFakeDb();
    const r = snoozeInboxItem(
      fake.db,
      TEST_USER,
      ITEM,
      1_000,
      2_000,
    );
    expect(r).toEqual({ ok: false, error: "InvalidArgs" });
    expect(fake.prepared).toHaveLength(0);
  });

  it("returns NotFound when the item doesn't exist for this user", () => {
    const fake = makeFakeDb();
    fake.pushGetResult(undefined);
    const r = snoozeInboxItem(
      fake.db,
      TEST_USER,
      ITEM,
      2_000,
      1_000,
    );
    expect(r).toEqual({ ok: false, error: "NotFound" });
  });

  it("issues UPDATE + full-snapshot upsert with bumped version", () => {
    const fake = makeFakeDb();
    fake.pushGetResult({
      raw_text: "feed cat",
      source: "desktop",
      created_at: 100,
      resolved_at: null,
      version: 3,
    });
    const r = snoozeInboxItem(
      fake.db,
      TEST_USER,
      ITEM,
      9_000,
      1_000,
    );
    expect(r).toEqual({ ok: true });

    const update = fake.prepared.find((p) =>
      p.sql.startsWith("update inbox_items"),
    );
    expect(update?.args).toEqual([9_000, 4, ITEM, TEST_USER]);

    const opCall = fake.prepared.find((p) =>
      p.sql.includes("insert into op_queue"),
    );
    const payload = JSON.parse(opCall!.args[3] as string) as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      id: ITEM,
      raw_text: "feed cat",
      source: "desktop",
      created_at: 100,
      resolved_at: null,
      snoozed_until: 9_000,
      updated_at: 1_000,
      deleted_at: null,
      version: 4,
    });
  });
});

describe("skipInboxItem", () => {
  const ITEM = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  it("returns NotFound when the row is missing or already resolved", () => {
    const fake = makeFakeDb();
    fake.pushGetResult(undefined);
    const r = skipInboxItem(fake.db, TEST_USER, ITEM, 5_000);
    expect(r).toEqual({ ok: false, error: "NotFound" });
  });

  it("sets resolved_at = now and enqueues a full-snapshot upsert", () => {
    const fake = makeFakeDb();
    fake.pushGetResult({
      raw_text: "garbage thought",
      source: "telegram-text",
      created_at: 50,
      snoozed_until: 200,
      version: 1,
    });
    const r = skipInboxItem(fake.db, TEST_USER, ITEM, 5_000);
    expect(r).toEqual({ ok: true });

    const update = fake.prepared.find((p) =>
      p.sql.startsWith("update inbox_items"),
    );
    expect(update?.args).toEqual([5_000, 2, ITEM, TEST_USER]);

    const opCall = fake.prepared.find((p) =>
      p.sql.includes("insert into op_queue"),
    );
    const payload = JSON.parse(opCall!.args[3] as string) as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      id: ITEM,
      raw_text: "garbage thought",
      source: "telegram-text",
      created_at: 50,
      resolved_at: 5_000,
      snoozed_until: 200,
      version: 2,
    });
  });
});
