import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  countUnresolvedInbox,
  listTodayEvents,
  listTodayTasks,
  localDayWindow,
} from "../store";

// Same fake-db pattern as the inbox + auth specs — better-sqlite3's
// native binding is built for Electron's ABI, not the host node, so a
// minimal mock that records prepared SQL + bound args + returns canned
// rows is what we exercise.

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
  } as unknown as Database.Database;
  return {
    db,
    prepared,
    pushAllResult(rows) {
      allResults.push(rows);
    },
    pushGetResult(row) {
      getResults.push(row);
    },
  };
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

const USER = "11111111-1111-1111-1111-111111111111";

describe("localDayWindow", () => {
  it("computes start/end in UTC when offset is zero", () => {
    // 2026-04-30T15:30:00Z, offset 0
    const now = Date.UTC(2026, 3, 30, 15, 30, 0);
    const w = localDayWindow(now, 0);
    expect(w.start).toBe(Date.UTC(2026, 3, 30, 0, 0, 0));
    expect(w.endExclusive).toBe(Date.UTC(2026, 4, 1, 0, 0, 0));
  });

  it("rolls back to the local day for offsets that put 'now' on the previous UTC day", () => {
    // 2026-04-30T01:00:00Z, but local zone is UTC+8 (offset -480 in JS
    // convention, since getTimezoneOffset returns minutes to add to
    // local to get UTC). Local time is 2026-04-30T09:00 → start of day
    // is 2026-04-30T00:00 local = 2026-04-29T16:00 UTC.
    const now = Date.UTC(2026, 3, 30, 1, 0, 0);
    const w = localDayWindow(now, -480);
    expect(new Date(w.start).toISOString()).toBe("2026-04-29T16:00:00.000Z");
    expect(new Date(w.endExclusive).toISOString()).toBe(
      "2026-04-30T16:00:00.000Z",
    );
  });

  it("handles positive offsets (zones behind UTC)", () => {
    // 2026-04-30T23:00:00Z, local zone PST (UTC-8 → offset +480).
    // Local time is 2026-04-30T15:00 → start of day is 2026-04-30T00:00
    // local = 2026-04-30T08:00 UTC.
    const now = Date.UTC(2026, 3, 30, 23, 0, 0);
    const w = localDayWindow(now, 480);
    expect(new Date(w.start).toISOString()).toBe("2026-04-30T08:00:00.000Z");
    expect(new Date(w.endExclusive).toISOString()).toBe(
      "2026-05-01T08:00:00.000Z",
    );
  });
});

describe("listTodayTasks", () => {
  it("filters by user, in_progress OR (open AND due in window), excludes deleted", () => {
    const fake = makeFakeDb();
    fake.pushAllResult([]);
    const now = Date.UTC(2026, 3, 30, 12, 0, 0);
    listTodayTasks(fake.db, USER, now, 0);

    expect(fake.prepared).toHaveLength(1);
    const sql = fake.prepared[0]!.sql;
    expect(sql).toContain("from tasks");
    expect(sql).toContain("where user_id = ?");
    expect(sql).toContain("deleted_at is null");
    expect(sql).toContain("status = 'in_progress'");
    expect(sql).toContain("status = 'open'");
    expect(sql).toContain("due_at >= ? and due_at < ?");
    // userId, then start, then endExclusive (matching the three placeholders).
    expect(fake.prepared[0]!.args[0]).toBe(USER);
    expect(fake.prepared[0]!.args[1]).toBe(Date.UTC(2026, 3, 30, 0, 0, 0));
    expect(fake.prepared[0]!.args[2]).toBe(Date.UTC(2026, 4, 1, 0, 0, 0));
  });

  it("returns the rows the db produced", () => {
    const fake = makeFakeDb();
    fake.pushAllResult([
      {
        id: "t1",
        title: "Design",
        status: "in_progress",
        due_at: null,
        updated_at: 1,
      },
      {
        id: "t2",
        title: "Email",
        status: "open",
        due_at: 2,
        updated_at: 0,
      },
    ]);
    const out = listTodayTasks(fake.db, USER, 1234, 0);
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe("t1");
    expect(out[1]!.title).toBe("Email");
  });
});

describe("listTodayEvents", () => {
  it("uses overlap window (start < endExclusive AND end > start)", () => {
    const fake = makeFakeDb();
    fake.pushAllResult([]);
    const now = Date.UTC(2026, 3, 30, 15, 0, 0);
    listTodayEvents(fake.db, USER, now, 0);

    const call = fake.prepared[0]!;
    expect(call.sql).toContain("from events");
    expect(call.sql).toContain("start_at < ?");
    expect(call.sql).toContain("end_at > ?");
    // userId, endExclusive, start (the two range placeholders are in
    // the inverted order the overlap predicate uses).
    expect(call.args[0]).toBe(USER);
    expect(call.args[1]).toBe(Date.UTC(2026, 4, 1, 0, 0, 0));
    expect(call.args[2]).toBe(Date.UTC(2026, 3, 30, 0, 0, 0));
  });
});

describe("countUnresolvedInbox", () => {
  it("returns 0 when the count row is missing", () => {
    const fake = makeFakeDb();
    fake.pushGetResult(undefined);
    expect(countUnresolvedInbox(fake.db, USER)).toBe(0);
  });

  it("returns the count and filters by user, deleted_at, resolved_at", () => {
    const fake = makeFakeDb();
    fake.pushGetResult({ c: 7 });
    expect(countUnresolvedInbox(fake.db, USER)).toBe(7);

    const sql = fake.prepared[0]!.sql;
    expect(sql).toContain("from inbox_items");
    expect(sql).toContain("user_id = ?");
    expect(sql).toContain("deleted_at is null");
    expect(sql).toContain("resolved_at is null");
    expect(fake.prepared[0]!.args[0]).toBe(USER);
  });
});
