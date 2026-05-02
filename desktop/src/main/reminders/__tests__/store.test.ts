import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  deleteReminderRule,
  getReminderRule,
  upsertReminderRule,
  MIN_INTERVAL_SECONDS,
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
  pushGet: (row: FakeRow | undefined) => void;
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
        all(...args: unknown[]): FakeRow[] {
          prepared.push({ sql: normalize(sql), args });
          return [];
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
    pushGet: (row) => {
      getResults.push(row);
    },
  };
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

const USER = "11111111-1111-1111-1111-111111111111";
const TASK = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

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

// ── getReminderRule ────────────────────────────────────────────────────────

describe("getReminderRule", () => {
  it("returns null when the user does not own the task", () => {
    const fake = makeFakeDb();
    fake.pushGet(undefined); // ownership probe → no row
    const rule = getReminderRule(fake.db, USER, TASK);
    expect(rule).toBeNull();
  });

  it("returns null when the task has no rule", () => {
    const fake = makeFakeDb();
    fake.pushGet({ ok: 1 }); // ownership probe → owned
    fake.pushGet(undefined); // rule lookup → none
    const rule = getReminderRule(fake.db, USER, TASK);
    expect(rule).toBeNull();
  });

  it("returns the rule mapped to the row shape", () => {
    const fake = makeFakeDb();
    fake.pushGet({ ok: 1 });
    fake.pushGet({
      id: "r1",
      task_id: TASK,
      importance: "important",
      interval_seconds: 600,
      escalation_json: '{"escalate":true}',
      active: 1,
      version: 3,
    });
    const rule = getReminderRule(fake.db, USER, TASK);
    expect(rule).toEqual({
      id: "r1",
      task_id: TASK,
      importance: "important",
      interval_seconds: 600,
      escalation_json: '{"escalate":true}',
      active: 1,
      version: 3,
    });
  });
});

// ── upsertReminderRule ─────────────────────────────────────────────────────

describe("upsertReminderRule", () => {
  const validArgs = {
    importance: "soft" as const,
    intervalSeconds: 3600,
    escalationJson: "{}",
    active: true,
  };

  it("rejects intervalSeconds below the 5-minute floor", () => {
    const fake = makeFakeDb();
    const r = upsertReminderRule(
      fake.db,
      USER,
      TASK,
      { ...validArgs, intervalSeconds: 60 },
      1_000,
    );
    expect(r).toEqual({ ok: false, error: "InvalidArgs" });
    expect(fake.prepared).toHaveLength(0);
  });

  it("accepts exactly the 5-minute floor", () => {
    const fake = makeFakeDb();
    fake.pushGet({ ok: 1 });
    fake.pushGet(undefined);
    const r = upsertReminderRule(
      fake.db,
      USER,
      TASK,
      { ...validArgs, intervalSeconds: MIN_INTERVAL_SECONDS },
      1_000,
    );
    expect(r.ok).toBe(true);
  });

  it("rejects unknown importance values", () => {
    const fake = makeFakeDb();
    const r = upsertReminderRule(
      fake.db,
      USER,
      TASK,
      { ...validArgs, importance: "urgent" as never },
      1_000,
    );
    expect(r).toEqual({ ok: false, error: "InvalidArgs" });
  });

  it("rejects malformed escalationJson", () => {
    const fake = makeFakeDb();
    const r = upsertReminderRule(
      fake.db,
      USER,
      TASK,
      { ...validArgs, escalationJson: "{not-json" },
      1_000,
    );
    expect(r).toEqual({ ok: false, error: "InvalidArgs" });
  });

  it("returns NotFound when the task does not belong to the user", () => {
    const fake = makeFakeDb();
    fake.pushGet(undefined); // ownership probe
    const r = upsertReminderRule(fake.db, USER, TASK, validArgs, 1_000);
    expect(r).toEqual({ ok: false, error: "NotFound" });
  });

  it("INSERTs a fresh rule + enqueues a v0 upsert when none exists", () => {
    const fake = makeFakeDb();
    fake.pushGet({ ok: 1 }); // ownership probe
    fake.pushGet(undefined); // existing rule lookup
    const r = upsertReminderRule(
      fake.db,
      USER,
      TASK,
      { importance: "important", intervalSeconds: 600, escalationJson: '{"escalate":true}', active: true },
      1_000,
    );
    expect(r.ok).toBe(true);
    const insert = fake.prepared.find((p) => p.sql.startsWith("insert into reminder_rules"));
    expect(insert).toBeDefined();
    const op = findOpPayload(fake.prepared, "reminder_rules");
    expect(op).toMatchObject({
      task_id: TASK,
      importance: "important",
      interval_seconds: 600,
      escalation_json: '{"escalate":true}',
      active: 1,
      updated_at: 1_000,
      deleted_at: null,
      version: 0,
    });
  });

  it("UPDATEs an existing rule + bumps version when one already exists", () => {
    const fake = makeFakeDb();
    fake.pushGet({ ok: 1 });
    fake.pushGet({ id: "r-existing", version: 4 });
    const r = upsertReminderRule(
      fake.db,
      USER,
      TASK,
      { importance: "soft", intervalSeconds: 1800, escalationJson: "{}", active: false },
      9_000,
    );
    expect(r).toEqual({ ok: true, id: "r-existing" });
    const update = fake.prepared.find((p) => p.sql.startsWith("update reminder_rules"));
    expect(update).toBeDefined();
    const op = findOpPayload(fake.prepared, "reminder_rules");
    expect(op).toMatchObject({
      id: "r-existing",
      task_id: TASK,
      importance: "soft",
      interval_seconds: 1800,
      escalation_json: "{}",
      active: 0,
      version: 5,
      updated_at: 9_000,
      deleted_at: null,
    });
  });
});

// ── deleteReminderRule ─────────────────────────────────────────────────────

describe("deleteReminderRule", () => {
  it("returns NotFound when the user does not own the task", () => {
    const fake = makeFakeDb();
    fake.pushGet(undefined);
    const r = deleteReminderRule(fake.db, USER, TASK, 1_000);
    expect(r).toEqual({ ok: false, error: "NotFound" });
  });

  it("returns NotFound when no active rule exists", () => {
    const fake = makeFakeDb();
    fake.pushGet({ ok: 1 });
    fake.pushGet(undefined);
    const r = deleteReminderRule(fake.db, USER, TASK, 1_000);
    expect(r).toEqual({ ok: false, error: "NotFound" });
  });

  it("soft-deletes via deleted_at + version bump and enqueues a delete op", () => {
    const fake = makeFakeDb();
    fake.pushGet({ ok: 1 });
    fake.pushGet({ id: "r-x", version: 7 });
    const r = deleteReminderRule(fake.db, USER, TASK, 9_000);
    expect(r).toEqual({ ok: true });
    const update = fake.prepared.find((p) => p.sql.startsWith("update reminder_rules"));
    expect(update?.args).toEqual([9_000, 8, "r-x"]);
    const op = findOpPayload(fake.prepared, "reminder_rules");
    expect(op).toMatchObject({ id: "r-x", updated_at: 9_000 });
  });
});
