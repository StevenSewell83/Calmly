import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { listForDay, scheduleTask, unscheduleTask } from "../store";

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
  pushAllResult: (rows: FakeRow[]) => void;
  pushGetResult: (row: FakeRow | undefined) => void;
}

function makeFakeDb(): FakeDb {
  const prepared: PreparedCall[] = [];
  const allResults: FakeRow[][] = [];
  const getResults: (FakeRow | undefined)[] = [];
  const db = {
    prepare(sql: string) {
      return {
        run(...args: unknown[]) {
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
    transaction<TArgs extends unknown[], TResult>(
      fn: (...args: TArgs) => TResult,
    ): (...args: TArgs) => TResult {
      return (...args: TArgs) => fn(...args);
    },
  } as unknown as Database.Database;
  return {
    db,
    prepared,
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

const USER = "11111111-1111-1111-1111-111111111111";
const TASK = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const seededTask: FakeRow = {
  title: "Write PR",
  notes: null,
  status: "open",
  due_at: null,
  scheduled_start: null,
  scheduled_end: null,
  parent_task_id: null,
  source: "desktop",
  created_at: 100,
  type: "task",
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

describe("listForDay", () => {
  it("issues two queries with the matching local-day window", () => {
    const fake = makeFakeDb();
    fake.pushAllResult([]);
    fake.pushAllResult([]);
    const now = Date.UTC(2026, 3, 30, 15, 0, 0);
    listForDay(fake.db, USER, now, 0);

    expect(fake.prepared).toHaveLength(2);
    const [sched, backlog] = fake.prepared;
    expect(sched!.sql).toContain("from tasks");
    expect(sched!.sql).toContain("scheduled_start is not null");
    expect(sched!.sql).toContain("status in ('open', 'in_progress')");
    expect(backlog!.sql).toContain("scheduled_start is null");
    expect(backlog!.sql).toContain("due_at is not null");
    // Both queries should bind the same window.
    expect(sched!.args[1]).toBe(Date.UTC(2026, 3, 30, 0, 0, 0));
    expect(sched!.args[2]).toBe(Date.UTC(2026, 4, 1, 0, 0, 0));
    expect(backlog!.args[1]).toBe(sched!.args[1]);
    expect(backlog!.args[2]).toBe(sched!.args[2]);
  });

  it("returns the rows the db produced for both columns", () => {
    const fake = makeFakeDb();
    fake.pushAllResult([{ id: "s1", title: "Block" } as FakeRow]);
    fake.pushAllResult([{ id: "b1", title: "Backlog" } as FakeRow]);
    const out = listForDay(fake.db, USER, 1234, 0);
    expect(out.scheduled).toHaveLength(1);
    expect(out.backlog).toHaveLength(1);
    expect(out.scheduled[0]!.id).toBe("s1");
    expect(out.backlog[0]!.id).toBe("b1");
  });
});

describe("scheduleTask", () => {
  it("rejects end < start", () => {
    const fake = makeFakeDb();
    const r = scheduleTask(fake.db, USER, TASK, 200, 100, 1_000);
    expect(r).toEqual({ ok: false, error: "InvalidArgs" });
    expect(fake.prepared).toHaveLength(0);
  });

  it("rejects non-finite values", () => {
    const fake = makeFakeDb();
    const r = scheduleTask(fake.db, USER, TASK, NaN, 100, 1_000);
    expect(r).toEqual({ ok: false, error: "InvalidArgs" });
  });

  it("returns NotFound when the task is missing", () => {
    const fake = makeFakeDb();
    fake.pushGetResult(undefined);
    const r = scheduleTask(fake.db, USER, TASK, 100, 200, 1_000);
    expect(r).toEqual({ ok: false, error: "NotFound" });
  });

  it("returns NotFound when the task has a non-schedulable status", () => {
    const fake = makeFakeDb();
    fake.pushGetResult({ ...seededTask, status: "done" });
    const r = scheduleTask(fake.db, USER, TASK, 100, 200, 1_000);
    expect(r).toEqual({ ok: false, error: "NotFound" });
  });

  it("UPDATEs the schedule and enqueues a full-snapshot upsert", () => {
    const fake = makeFakeDb();
    fake.pushGetResult(seededTask);
    const r = scheduleTask(fake.db, USER, TASK, 5_000, 7_000, 1_000);
    expect(r).toEqual({ ok: true });

    const update = fake.prepared.find((p) =>
      p.sql.startsWith("update tasks"),
    );
    // (start, end, updated_at, version, id, user_id)
    expect(update?.args).toEqual([5_000, 7_000, 1_000, 1, TASK, USER]);

    const op = findOpPayload(fake.prepared, "tasks");
    expect(op).toMatchObject({
      id: TASK,
      title: "Write PR",
      type: "task",
      status: "open",
      due_at: null,
      source: "desktop",
      created_at: 100,
      updated_at: 1_000,
      deleted_at: null,
      version: 1,
      scheduled_start: 5_000,
      scheduled_end: 7_000,
    });
  });
});

describe("unscheduleTask", () => {
  it("clears the pair to NULL and enqueues a snapshot", () => {
    const fake = makeFakeDb();
    fake.pushGetResult({
      ...seededTask,
      scheduled_start: 5_000,
      scheduled_end: 7_000,
      version: 3,
    });
    const r = unscheduleTask(fake.db, USER, TASK, 9_000);
    expect(r).toEqual({ ok: true });

    const update = fake.prepared.find((p) =>
      p.sql.startsWith("update tasks"),
    );
    expect(update?.args).toEqual([9_000, 4, TASK, USER]);

    const op = findOpPayload(fake.prepared, "tasks");
    expect(op).toMatchObject({
      id: TASK,
      scheduled_start: null,
      scheduled_end: null,
      updated_at: 9_000,
      version: 4,
    });
  });

  it("returns NotFound when the task is missing", () => {
    const fake = makeFakeDb();
    fake.pushGetResult(undefined);
    const r = unscheduleTask(fake.db, USER, TASK, 1_000);
    expect(r).toEqual({ ok: false, error: "NotFound" });
  });
});
