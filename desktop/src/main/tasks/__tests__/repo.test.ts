import type Database from "better-sqlite3";
import { describe, it, expect } from "vitest";
import { enqueueTaskUpsert, loadTask, SCHEDULABLE_STATUSES } from "../repo";

// Fake DB matching the pattern used across desktop unit tests.
// Returns the stub alongside captured SQL/args for assertions.
interface PreparedCall {
  sql: string;
  args: unknown[];
}

function makeFakeDb(opts: { getResult?: unknown } = {}): {
  db: Database.Database;
  prepared: PreparedCall[];
} {
  const prepared: PreparedCall[] = [];
  const getResult = opts.getResult;
  const db = {
    prepare(sql: string) {
      return {
        run(...args: unknown[]) {
          prepared.push({ sql, args });
          return { changes: 1, lastInsertRowid: 0 };
        },
        get(...args: unknown[]) {
          prepared.push({ sql, args });
          return getResult;
        },
      };
    },
    transaction<TArgs extends unknown[], TResult>(
      fn: (...args: TArgs) => TResult,
    ): (...args: TArgs) => TResult {
      return (...args: TArgs) => fn(...args);
    },
  } as unknown as Database.Database;
  return { db, prepared };
}

const USER = "11111111-1111-1111-1111-111111111111";
const TASK = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const NOW = 1_700_000_000_000;

const baseRow = {
  title: "My task",
  notes: null,
  status: "open" as const,
  due_at: null,
  scheduled_start: null,
  scheduled_end: null,
  parent_task_id: null,
  source: "desktop" as const,
  created_at: NOW,
  type: "task",
  version: 0,
};

describe("tasks/repo", () => {
  it("SCHEDULABLE_STATUSES includes open and in_progress only", () => {
    expect(SCHEDULABLE_STATUSES).toContain("open");
    expect(SCHEDULABLE_STATUSES).toContain("in_progress");
    expect(SCHEDULABLE_STATUSES).not.toContain("done");
    expect(SCHEDULABLE_STATUSES).toHaveLength(2);
  });

  it("loadTask issues the correct SELECT and returns the row", () => {
    const { db, prepared } = makeFakeDb({ getResult: baseRow });
    const row = loadTask(db, USER, TASK);
    expect(row).toBe(baseRow);
    expect(prepared).toHaveLength(1);
    expect(prepared[0]!.args).toEqual([TASK, USER]);
  });

  it("loadTask returns undefined when no matching row", () => {
    const { db } = makeFakeDb({ getResult: undefined });
    expect(loadTask(db, USER, TASK)).toBeUndefined();
  });

  it("enqueueTaskUpsert writes a full-snapshot payload with the bumped version", () => {
    const { db, prepared } = makeFakeDb();
    enqueueTaskUpsert(
      db,
      TASK,
      baseRow,
      { status: "in_progress" },
      NOW + 1000,
      7,
    );

    // One INSERT into op_queue.
    expect(prepared).toHaveLength(1);
    const call = prepared[0]!;
    expect(call.sql).toContain("INSERT INTO op_queue");

    // Locate the JSON arg (4th positional — id, table_name, op, payload_json).
    const payloadJson = call.args[3] as string;
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;

    expect(payload["id"]).toBe(TASK);
    expect(payload["status"]).toBe("in_progress");
    expect(payload["version"]).toBe(7);
    expect(payload["updated_at"]).toBe(NOW + 1000);
    expect(payload["deleted_at"]).toBeNull();
    // Non-overridden fields come from the base row.
    expect(payload["title"]).toBe("My task");
    expect(payload["source"]).toBe("desktop");
  });

  it("enqueueTaskUpsert always sets deleted_at to null (upsert clears tombstone)", () => {
    const { db, prepared } = makeFakeDb();
    enqueueTaskUpsert(db, TASK, baseRow, {}, NOW, 1);
    const payload = JSON.parse(prepared[0]!.args[3] as string) as Record<
      string,
      unknown
    >;
    expect(payload["deleted_at"]).toBeNull();
  });
});
