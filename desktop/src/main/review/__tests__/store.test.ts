import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  carryForward,
  completeShutdown,
  dropTasks,
  localDateString,
  markTasksDone,
  moveToDate,
  saveReflection,
  summarize,
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
const TASK_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TASK_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

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

function findAllOpPayloads(
  prepared: PreparedCall[],
  table: string,
): Record<string, unknown>[] {
  return prepared
    .filter(
      (p) =>
        p.sql.includes("insert into op_queue") &&
        typeof p.args[1] === "string" &&
        p.args[1] === table,
    )
    .map((p) => JSON.parse(p.args[3] as string) as Record<string, unknown>);
}

describe("localDateString", () => {
  it("returns YYYY-MM-DD in UTC when offset is 0", () => {
    const t = Date.UTC(2026, 3, 30, 23, 59, 0);
    expect(localDateString(t, 0)).toBe("2026-04-30");
  });

  it("respects positive offset (zone behind UTC)", () => {
    // UTC midnight on May 1st is still April 30th in PST (offset +480).
    const t = Date.UTC(2026, 4, 1, 0, 0, 0);
    expect(localDateString(t, 480)).toBe("2026-04-30");
  });
});

describe("summarize", () => {
  it("issues the expected reads and exposes lastShutdownDate from settings_json", () => {
    const fake = makeFakeDb();
    fake.pushAllResult([{ id: "t1", title: "Done thing" } as FakeRow]);
    fake.pushAllResult([{ id: "t2", title: "Not done" } as FakeRow]);
    fake.pushGetResult({ ms: 1_800_000 });
    fake.pushGetResult({ id: "r1", text: "long day" });
    fake.pushGetResult({
      settings_json: JSON.stringify({ last_shutdown_date: "2026-04-29" }),
    });

    const now = Date.UTC(2026, 3, 30, 15, 0, 0);
    const out = summarize(fake.db, USER, now, 0);

    expect(out.date).toBe("2026-04-30");
    expect(out.completedTasks).toEqual([{ id: "t1", title: "Done thing" }]);
    expect(out.unfinishedTasks).toEqual([{ id: "t2", title: "Not done" }]);
    expect(out.focusedMs).toBe(1_800_000);
    expect(out.reflection).toEqual({ id: "r1", text: "long day" });
    expect(out.lastShutdownDate).toBe("2026-04-29");
  });

  it("treats malformed settings_json as no last_shutdown_date", () => {
    const fake = makeFakeDb();
    fake.pushAllResult([]);
    fake.pushAllResult([]);
    fake.pushGetResult({ ms: 0 });
    fake.pushGetResult(undefined);
    fake.pushGetResult({ settings_json: "not-json{" });

    const out = summarize(fake.db, USER, 0, 0);
    expect(out.lastShutdownDate).toBeNull();
    expect(out.reflection).toBeNull();
    expect(out.focusedMs).toBe(0);
  });
});

describe("carryForward", () => {
  it("no-ops on empty array", () => {
    const fake = makeFakeDb();
    const r = carryForward(fake.db, USER, [], 1_000);
    expect(r).toEqual({ ok: true, updated: 0 });
    expect(fake.prepared).toHaveLength(0);
  });

  it("pushes due_at +24h, clears schedule pair, enqueues full snapshot", () => {
    const fake = makeFakeDb();
    fake.pushGetResult({ ...seededTask, due_at: 1_000 });
    const r = carryForward(fake.db, USER, [TASK_A], 5_000);
    expect(r).toEqual({ ok: true, updated: 1 });

    const op = findOpPayload(fake.prepared, "tasks");
    expect(op).toMatchObject({
      id: TASK_A,
      due_at: 1_000 + 24 * 60 * 60 * 1000,
      scheduled_start: null,
      scheduled_end: null,
      version: 1,
    });
  });

  it("when due_at is null, carry-forward uses now+24h", () => {
    const fake = makeFakeDb();
    fake.pushGetResult({ ...seededTask, due_at: null });
    carryForward(fake.db, USER, [TASK_A], 10_000);
    const op = findOpPayload(fake.prepared, "tasks");
    expect(op?.due_at).toBe(10_000 + 24 * 60 * 60 * 1000);
  });

  it("skips missing tasks but reports the count of those it updated", () => {
    const fake = makeFakeDb();
    fake.pushGetResult(undefined);
    fake.pushGetResult(seededTask);
    const r = carryForward(fake.db, USER, [TASK_A, TASK_B], 5_000);
    expect(r).toEqual({ ok: true, updated: 1 });
  });
});

describe("dropTasks", () => {
  it("sets status='dropped' and bumps version", () => {
    const fake = makeFakeDb();
    fake.pushGetResult(seededTask);
    const r = dropTasks(fake.db, USER, [TASK_A], 7_000);
    expect(r).toEqual({ ok: true, updated: 1 });

    const op = findOpPayload(fake.prepared, "tasks");
    expect(op).toMatchObject({
      id: TASK_A,
      status: "dropped",
      version: 1,
    });
  });
});

describe("markTasksDone", () => {
  it("flips multiple tasks to status='done' in one tx", () => {
    const fake = makeFakeDb();
    fake.pushGetResult({ ...seededTask, version: 3 });
    fake.pushGetResult({ ...seededTask, version: 7 });
    const r = markTasksDone(fake.db, USER, [TASK_A, TASK_B], 9_000);
    expect(r).toEqual({ ok: true, updated: 2 });
    const ops = findAllOpPayloads(fake.prepared, "tasks");
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ status: "done", version: 4 });
    expect(ops[1]).toMatchObject({ status: "done", version: 8 });
  });
});

describe("moveToDate", () => {
  it("rejects non-finite dueAt", () => {
    const fake = makeFakeDb();
    const r = moveToDate(fake.db, USER, [TASK_A], NaN, 5_000);
    expect(r).toEqual({ ok: false, error: "InternalError" });
    expect(fake.prepared).toHaveLength(0);
  });

  it("sets due_at and clears schedule pair", () => {
    const fake = makeFakeDb();
    fake.pushGetResult({
      ...seededTask,
      scheduled_start: 1_000,
      scheduled_end: 2_000,
    });
    const r = moveToDate(fake.db, USER, [TASK_A], 50_000, 60_000);
    expect(r).toEqual({ ok: true, updated: 1 });
    const op = findOpPayload(fake.prepared, "tasks");
    expect(op).toMatchObject({
      due_at: 50_000,
      scheduled_start: null,
      scheduled_end: null,
    });
  });
});

describe("saveReflection", () => {
  it("rejects whitespace-only text without touching the db", () => {
    const fake = makeFakeDb();
    const r = saveReflection(fake.db, USER, "2026-04-30", "   ", 1_000);
    expect(r).toEqual({ ok: false, error: "EmptyText" });
    expect(fake.prepared).toHaveLength(0);
  });

  it("inserts a new row when none exists", () => {
    const fake = makeFakeDb();
    fake.pushGetResult(undefined);
    const r = saveReflection(fake.db, USER, "2026-04-30", "  long day  ", 5_000);
    expect(r.ok).toBe(true);

    const insert = fake.prepared.find((p) =>
      p.sql.startsWith("insert into daily_reflections"),
    );
    expect(insert).toBeDefined();
    // Trimmed text is what gets stored AND enqueued.
    expect(insert?.args).toContain("long day");

    const op = findOpPayload(fake.prepared, "daily_reflections");
    expect(op).toMatchObject({
      date: "2026-04-30",
      text: "long day",
      version: 1,
    });
  });

  it("updates the existing row and reuses its id when one exists", () => {
    const fake = makeFakeDb();
    fake.pushGetResult({ id: "existing-id", version: 4 });
    const r = saveReflection(fake.db, USER, "2026-04-30", "different", 9_000);
    expect(r).toEqual({ ok: true, id: "existing-id" });

    const update = fake.prepared.find((p) =>
      p.sql.startsWith("update daily_reflections"),
    );
    expect(update).toBeDefined();
    const op = findOpPayload(fake.prepared, "daily_reflections");
    expect(op).toMatchObject({
      id: "existing-id",
      text: "different",
      version: 5,
    });
  });
});

describe("completeShutdown", () => {
  it("writes settings only when reflection is null", () => {
    const fake = makeFakeDb();
    // settings lookup returns no existing row
    fake.pushGetResult(undefined);
    const r = completeShutdown(
      fake.db,
      USER,
      "2026-04-30",
      null,
      9_000,
    );
    expect(r).toEqual({ ok: true, reflectionId: null });

    // Should have inserted user_settings + enqueued user_settings upsert,
    // and NOT enqueued a daily_reflections op.
    const settingsOp = findOpPayload(fake.prepared, "user_settings");
    expect(settingsOp).toMatchObject({
      user_id: USER,
      version: 1,
    });
    expect(JSON.parse(String(settingsOp?.settings_json))).toMatchObject({
      last_shutdown_date: "2026-04-30",
    });
    expect(findOpPayload(fake.prepared, "daily_reflections")).toBeUndefined();
  });

  it("saves reflection AND last_shutdown_date in one tx when text given", () => {
    const fake = makeFakeDb();
    // saveReflection lookup → none existing
    fake.pushGetResult(undefined);
    // user_settings lookup → existing row keyed by id (BUG-AUDIT-1)
    fake.pushGetResult({
      id: "settings-id-1",
      settings_json: JSON.stringify({ theme: "warm" }),
      version: 2,
    });
    const r = completeShutdown(
      fake.db,
      USER,
      "2026-04-30",
      "long day",
      11_000,
    );
    expect(r.ok).toBe(true);

    const reflectionOp = findOpPayload(fake.prepared, "daily_reflections");
    expect(reflectionOp).toMatchObject({
      date: "2026-04-30",
      text: "long day",
      version: 1,
    });

    const settingsOp = findOpPayload(fake.prepared, "user_settings");
    const merged = JSON.parse(String(settingsOp?.settings_json)) as Record<
      string,
      unknown
    >;
    expect(merged).toMatchObject({
      theme: "warm",
      last_shutdown_date: "2026-04-30",
    });
    // Existing id is reused so the server's ON CONFLICT (id) path
    // updates the row instead of crashing on a missing column.
    expect(settingsOp).toMatchObject({ id: "settings-id-1", version: 3 });
  });

  it("treats whitespace-only reflection as 'no reflection'", () => {
    const fake = makeFakeDb();
    fake.pushGetResult(undefined); // user_settings lookup
    const r = completeShutdown(
      fake.db,
      USER,
      "2026-04-30",
      "   \n  ",
      11_000,
    );
    expect(r).toEqual({ ok: true, reflectionId: null });
    expect(findOpPayload(fake.prepared, "daily_reflections")).toBeUndefined();
  });
});
