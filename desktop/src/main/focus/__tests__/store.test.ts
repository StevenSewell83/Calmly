import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  currentFocus,
  endFocus,
  markDoneFromFocus,
  startFocus,
  switchFocus,
} from "../store";

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
}

function makeFakeDb(): FakeDb {
  const prepared: PreparedCall[] = [];
  const getResults: (FakeRow | undefined)[] = [];
  const db = {
    prepare(sql: string) {
      return {
        run(...args: unknown[]) {
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
  };
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

const USER = "11111111-1111-1111-1111-111111111111";
const TASK = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TASK2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

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

describe("currentFocus", () => {
  it("returns the open session when one exists", () => {
    const fake = makeFakeDb();
    fake.pushGetResult({
      id: "s1",
      user_id: USER,
      task_id: TASK,
      started_at: 100,
      ended_at: null,
      source: "scheduled",
    });
    expect(currentFocus(fake.db, USER)?.id).toBe("s1");

    const sql = fake.prepared[0]!.sql;
    expect(sql).toContain("from focus_sessions");
    expect(sql).toContain("ended_at is null");
    expect(fake.prepared[0]!.args).toEqual([USER]);
  });

  it("returns null when there's no open session", () => {
    const fake = makeFakeDb();
    fake.pushGetResult(undefined);
    expect(currentFocus(fake.db, USER)).toBeNull();
  });
});

describe("startFocus", () => {
  it("rejects an unknown source", () => {
    const fake = makeFakeDb();
    const r = startFocus(fake.db, USER, TASK, "bogus" as never, 1_000);
    expect(r).toEqual({ ok: false, error: "InvalidArgs" });
  });

  it("returns NotFound when the task is missing", () => {
    const fake = makeFakeDb();
    fake.pushGetResult(undefined);
    const r = startFocus(fake.db, USER, TASK, "scheduled", 1_000);
    expect(r).toEqual({ ok: false, error: "NotFound" });
  });

  it("returns NotFound for a non-schedulable status", () => {
    const fake = makeFakeDb();
    fake.pushGetResult({ ...seededTask, status: "done" });
    const r = startFocus(fake.db, USER, TASK, "scheduled", 1_000);
    expect(r).toEqual({ ok: false, error: "NotFound" });
  });

  it("ends prior open sessions before INSERTing the new one", () => {
    const fake = makeFakeDb();
    fake.pushGetResult(seededTask);
    const r = startFocus(fake.db, USER, TASK, "scheduled", 1_000);
    expect(r.ok).toBe(true);

    const sqls = fake.prepared.map((p) => p.sql);
    const closeIdx = sqls.findIndex(
      (s) =>
        s.startsWith("update focus_sessions") && s.includes("ended_at = ?"),
    );
    const insertIdx = sqls.findIndex((s) =>
      s.startsWith("insert into focus_sessions"),
    );
    expect(closeIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThan(closeIdx);
  });
});

describe("endFocus", () => {
  it("returns ended:false when no session is open", () => {
    const fake = makeFakeDb();
    fake.pushGetResult(undefined);
    const r = endFocus(fake.db, USER, 1_000);
    expect(r).toEqual({ ok: true, ended: false });
  });

  it("UPDATEs the open session and reports ended:true", () => {
    const fake = makeFakeDb();
    fake.pushGetResult({
      id: "s1",
      user_id: USER,
      task_id: TASK,
      started_at: 50,
      ended_at: null,
      source: "scheduled",
    });
    const r = endFocus(fake.db, USER, 1_000);
    expect(r).toEqual({ ok: true, ended: true });

    const update = fake.prepared.find((p) =>
      p.sql.startsWith("update focus_sessions"),
    );
    expect(update?.args).toEqual([1_000, USER]);
  });
});

describe("markDoneFromFocus", () => {
  it("returns NoActiveSession when nothing is open", () => {
    const fake = makeFakeDb();
    fake.pushGetResult(undefined);
    const r = markDoneFromFocus(fake.db, USER, 1_000);
    expect(r).toEqual({ ok: false, error: "NoActiveSession" });
  });

  it("flips task status to done, ends session, and enqueues full-snapshot upsert", () => {
    const fake = makeFakeDb();
    fake.pushGetResult({
      id: "s1",
      user_id: USER,
      task_id: TASK,
      started_at: 50,
      ended_at: null,
      source: "scheduled",
    });
    fake.pushGetResult(seededTask);
    const r = markDoneFromFocus(fake.db, USER, 1_000);
    expect(r).toEqual({ ok: true, taskId: TASK });

    const update = fake.prepared.find(
      (p) =>
        p.sql.startsWith("update tasks") && p.sql.includes("status = 'done'"),
    );
    expect(update?.args).toEqual([1_000, 1, TASK, USER]);

    const op = findOpPayload(fake.prepared, "tasks");
    expect(op).toMatchObject({
      id: TASK,
      status: "done",
      updated_at: 1_000,
      version: 1,
      title: "Write PR",
      source: "desktop",
    });

    const closeSession = fake.prepared.find((p) =>
      p.sql.startsWith("update focus_sessions"),
    );
    expect(closeSession).toBeDefined();
  });
});

describe("switchFocus", () => {
  it("rejects an unknown source", () => {
    const fake = makeFakeDb();
    const r = switchFocus(fake.db, USER, TASK2, "bogus" as never, 1_000);
    expect(r).toEqual({ ok: false, error: "InvalidArgs" });
  });

  it("returns NotFound when the new task is missing", () => {
    const fake = makeFakeDb();
    fake.pushGetResult(undefined);
    const r = switchFocus(fake.db, USER, TASK2, "scheduled", 1_000);
    expect(r).toEqual({ ok: false, error: "NotFound" });
  });

  it("ends prior session and INSERTs the new one in one tx", () => {
    const fake = makeFakeDb();
    fake.pushGetResult(seededTask);
    const r = switchFocus(fake.db, USER, TASK2, "ad-hoc", 1_000);
    expect(r.ok).toBe(true);

    const sqls = fake.prepared.map((p) => p.sql);
    const closeIdx = sqls.findIndex(
      (s) =>
        s.startsWith("update focus_sessions") && s.includes("ended_at = ?"),
    );
    const insertIdx = sqls.findIndex((s) =>
      s.startsWith("insert into focus_sessions"),
    );
    expect(closeIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThan(closeIdx);
  });
});
