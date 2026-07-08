import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { discardInboxItem, resolveAsEvent, resolveAsTask } from "../store";

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
  pushGetResult: (row: FakeRow | undefined) => void;
  failNextRun: (err?: Error) => void;
}

// Same mock pattern as inbox/today specs — better-sqlite3's native
// binding can't load under host node, so we substitute a minimal
// surface that records prepares + canned SELECT results.
function makeFakeDb(): FakeDb {
  const prepared: PreparedCall[] = [];
  const getResults: (FakeRow | undefined)[] = [];
  let nextRunFails: Error | null = null;
  const db = {
    prepare(sql: string) {
      return {
        run(...args: unknown[]) {
          if (nextRunFails) {
            const err = nextRunFails;
            nextRunFails = null;
            throw err;
          }
          prepared.push({ sql: normalize(sql), args });
          return { changes: 1, lastInsertRowid: 0 };
        },
        get(...args: unknown[]): FakeRow | undefined {
          prepared.push({ sql: normalize(sql), args });
          return getResults.shift();
        },
      };
    },
    transaction<TArgs extends unknown[], TResult>(
      fn: (...args: TArgs) => TResult,
    ): (...args: TArgs) => TResult {
      return (...args: TArgs) => fn(...args);
    },
  } as unknown as Database.Database;
  return {
    db,
    prepared,
    pushGetResult: (row) => {
      getResults.push(row);
    },
    failNextRun: (err = new Error("simulated failure")) => {
      nextRunFails = err;
    },
  };
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

const USER = "11111111-1111-1111-1111-111111111111";
const ITEM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const seededRow: FakeRow = {
  raw_text: "buy milk",
  source: "desktop",
  created_at: 100,
  resolved_at: null,
  snoozed_until: null,
  version: 0,
};

function findOpPayload(
  prepared: PreparedCall[],
  table: string,
): Record<string, unknown> | undefined {
  const row = prepared.find(
    (p) =>
      p.sql.includes("insert into op_queue") &&
      typeof p.args[1] === "string" &&
      p.args[1] === table,
  );
  if (!row) return undefined;
  return JSON.parse(row.args[3] as string) as Record<string, unknown>;
}

describe("resolveAsTask", () => {
  it("rejects an empty title without writing", () => {
    const fake = makeFakeDb();
    const r = resolveAsTask({
      db: fake.db,
      userId: USER,
      inboxId: ITEM,
      title: "  \t  ",
      dueAt: null,
      now: 1_000,
    });
    expect(r).toEqual({ ok: false, error: "InvalidArgs" });
    expect(fake.prepared).toHaveLength(0);
  });

  it("returns NotFound when the inbox row is missing", () => {
    const fake = makeFakeDb();
    fake.pushGetResult(undefined);
    const r = resolveAsTask({
      db: fake.db,
      userId: USER,
      inboxId: ITEM,
      title: "buy milk",
      dueAt: null,
      now: 1_000,
    });
    expect(r).toEqual({ ok: false, error: "NotFound" });
  });

  it("returns AlreadyResolved when resolved_at is already set", () => {
    const fake = makeFakeDb();
    fake.pushGetResult({ ...seededRow, resolved_at: 500 });
    const r = resolveAsTask({
      db: fake.db,
      userId: USER,
      inboxId: ITEM,
      title: "buy milk",
      dueAt: null,
      now: 1_000,
    });
    expect(r).toEqual({ ok: false, error: "AlreadyResolved" });
  });

  it("inserts the task, resolves the inbox, enqueues both upserts in one tx", () => {
    const fake = makeFakeDb();
    fake.pushGetResult(seededRow);
    const r = resolveAsTask({
      db: fake.db,
      userId: USER,
      inboxId: ITEM,
      title: "buy milk",
      dueAt: 9_000,
      now: 1_000,
    });
    expect(r.ok).toBe(true);

    const sqls = fake.prepared.map((p) => p.sql);
    expect(sqls.some((s) => s.startsWith("insert into tasks"))).toBe(true);
    expect(sqls.some((s) => s.startsWith("update inbox_items"))).toBe(true);

    const taskOp = findOpPayload(fake.prepared, "tasks");
    expect(taskOp).toMatchObject({
      title: "buy milk",
      type: "task",
      status: "open",
      due_at: 9_000,
      source: "desktop",
      created_at: 1_000,
      updated_at: 1_000,
      deleted_at: null,
      version: 0,
    });

    const inboxOp = findOpPayload(fake.prepared, "inbox_items");
    expect(inboxOp).toMatchObject({
      id: ITEM,
      raw_text: "buy milk",
      source: "desktop",
      created_at: 100,
      resolved_at: 1_000,
      snoozed_until: null,
      updated_at: 1_000,
      deleted_at: null,
      version: 1,
    });
  });

  it("accepts dueAt: null for the 'Later' chip", () => {
    const fake = makeFakeDb();
    fake.pushGetResult(seededRow);
    const r = resolveAsTask({
      db: fake.db,
      userId: USER,
      inboxId: ITEM,
      title: "loose thought",
      dueAt: null,
      now: 1_000,
    });
    expect(r.ok).toBe(true);
    const taskOp = findOpPayload(fake.prepared, "tasks");
    expect(taskOp?.due_at).toBeNull();
  });
});

describe("resolveAsEvent", () => {
  it("rejects when end_at < start_at", () => {
    const fake = makeFakeDb();
    const r = resolveAsEvent({
      db: fake.db,
      userId: USER,
      inboxId: ITEM,
      title: "lunch",
      startAt: 200,
      endAt: 100,
      now: 1_000,
    });
    expect(r).toEqual({ ok: false, error: "InvalidArgs" });
    expect(fake.prepared).toHaveLength(0);
  });

  it("inserts an event with source='manual' and resolves the inbox", () => {
    const fake = makeFakeDb();
    fake.pushGetResult(seededRow);
    const r = resolveAsEvent({
      db: fake.db,
      userId: USER,
      inboxId: ITEM,
      title: "lunch with sam",
      startAt: 5_000,
      endAt: 7_000,
      now: 1_000,
    });
    expect(r.ok).toBe(true);

    const eventOp = findOpPayload(fake.prepared, "events");
    expect(eventOp).toMatchObject({
      title: "lunch with sam",
      start_at: 5_000,
      end_at: 7_000,
      source: "manual",
      created_at: 1_000,
      updated_at: 1_000,
      deleted_at: null,
      version: 0,
    });

    const inboxOp = findOpPayload(fake.prepared, "inbox_items");
    expect(inboxOp?.resolved_at).toBe(1_000);
    expect(inboxOp?.version).toBe(1);
  });
});

describe("discardInboxItem", () => {
  it("resolves without writing tasks/events", () => {
    const fake = makeFakeDb();
    fake.pushGetResult(seededRow);
    const r = discardInboxItem({
      db: fake.db,
      userId: USER,
      inboxId: ITEM,
      now: 1_000,
    });
    expect(r).toEqual({ ok: true });

    const sqls = fake.prepared.map((p) => p.sql);
    expect(sqls.some((s) => s.startsWith("insert into tasks"))).toBe(false);
    expect(sqls.some((s) => s.startsWith("insert into events"))).toBe(false);
    expect(findOpPayload(fake.prepared, "inbox_items")?.resolved_at).toBe(
      1_000,
    );
  });

  it("returns AlreadyResolved when the inbox is already done", () => {
    const fake = makeFakeDb();
    fake.pushGetResult({ ...seededRow, resolved_at: 500 });
    const r = discardInboxItem({
      db: fake.db,
      userId: USER,
      inboxId: ITEM,
      now: 1_000,
    });
    expect(r).toEqual({ ok: false, error: "AlreadyResolved" });
  });

  it("returns InternalError when the UPDATE throws", () => {
    const fake = makeFakeDb();
    fake.pushGetResult(seededRow);
    fake.failNextRun(new Error("disk full"));
    const r = discardInboxItem({
      db: fake.db,
      userId: USER,
      inboxId: ITEM,
      now: 1_000,
    });
    expect(r).toEqual({ ok: false, error: "InternalError" });
  });
});
