import { describe, expect, it, vi } from "vitest";
import type { PullResponse, PushResponse, SyncOp } from "@calmly/shared";
import type { SyncClient } from "../client";
import { createSyncLoop, runSyncOnce } from "../loop";

interface FakeRow {
  id: string;
  table_name: string;
  op: "upsert" | "delete";
  payload_json: string;
  created_at: number;
  attempts: number;
  last_error: string | null;
}

interface FakeState {
  last_pulled_version: number;
  last_pushed_at: number | null;
}

function makeFakeDb(initialRows: FakeRow[], initialState: FakeState) {
  const rows = [...initialRows];
  const state = { ...initialState };
  return {
    prepare(sql: string) {
      const s = sql.trim().toLowerCase();
      return {
        all() {
          if (s.startsWith("select id, table_name")) {
            return [...rows];
          }
          return [];
        },
        get(_arg?: unknown) {
          if (s.startsWith("select last_pulled_version")) return state;
          if (s.startsWith("select count(*)")) return { c: rows.length };
          return undefined;
        },
        run(...args: unknown[]) {
          if (s.startsWith("delete from op_queue")) {
            const id = args[0] as string;
            const idx = rows.findIndex((r) => r.id === id);
            if (idx >= 0) rows.splice(idx, 1);
            return;
          }
          if (s.startsWith("update op_queue")) {
            const error = args[0] as string | null;
            const id = args[1] as string;
            const r = rows.find((r) => r.id === id);
            if (r) {
              r.attempts += 1;
              r.last_error = error;
            }
            return;
          }
          if (s.startsWith("update sync_state set last_pulled_version")) {
            state.last_pulled_version = args[0] as number;
            return;
          }
          if (s.startsWith("update sync_state set last_pushed_at")) {
            state.last_pushed_at = args[0] as number;
            return;
          }
        },
      };
    },
    state,
    rows,
    // Stubbed so the type-cast in production callers compiles in the test.
    // Real production code calls db.prepare/.exec/.transaction/.pragma/.close
    // which we don't all need here.
    exec() {},
    pragma() {
      return [];
    },
    close() {},
    transaction(fn: () => unknown) {
      return fn;
    },
  };
}

const SAMPLE_OP: SyncOp = {
  table: "tasks",
  op: "upsert",
  payload: {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "22222222-2222-4222-8222-222222222222",
    title: "x",
    notes: null,
    type: "task",
    status: "open",
    due_at: null,
    parent_task_id: null,
    source: "desktop",
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    deleted_at: null,
    version: 0,
  },
};

function makeRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: "op-1",
    table_name: "tasks",
    op: "upsert",
    payload_json: JSON.stringify(SAMPLE_OP.payload),
    created_at: Date.now() - 60_000,
    attempts: 0,
    last_error: null,
    ...overrides,
  };
}

function makeClient(overrides: Partial<SyncClient> = {}): SyncClient {
  return {
    pull: vi.fn(
      async (): Promise<PullResponse> => ({ records: {}, version: 0 }),
    ),
    push: vi.fn(
      async (): Promise<PushResponse> => ({ results: [], version: 0 }),
    ),
    ...overrides,
  } as SyncClient;
}

describe("runSyncOnce — push phase", () => {
  it("removes accepted ops from the queue", async () => {
    const db = makeFakeDb([makeRow()], {
      last_pulled_version: 0,
      last_pushed_at: null,
    });
    const client = makeClient({
      push: vi.fn(async () => ({
        results: [
          {
            index: 0,
            status: "accepted" as const,
            table: "tasks" as const,
            id: SAMPLE_OP.payload.id as string,
            version: 1,
            reason: null,
          },
        ],
        version: 1,
      })),
    });

    const r = await runSyncOnce({
      getDb: () => db as never,
      client,
    });

    expect(r.ok).toBe(true);
    expect(r.pushed).toBe(1);
    expect(db.rows.length).toBe(0);
  });

  it("removes 'stale' and 'gone' ops too (replay-safe)", async () => {
    const db = makeFakeDb([makeRow({ id: "a" }), makeRow({ id: "b" })], {
      last_pulled_version: 0,
      last_pushed_at: null,
    });
    const client = makeClient({
      push: vi.fn(async () => ({
        results: [
          {
            index: 0,
            status: "stale" as const,
            table: "tasks" as const,
            id: SAMPLE_OP.payload.id as string,
            version: null,
            reason: "older",
          },
          {
            index: 1,
            status: "gone" as const,
            table: "tasks" as const,
            id: SAMPLE_OP.payload.id as string,
            version: null,
            reason: "deleted",
          },
        ],
        version: 0,
      })),
    });

    const r = await runSyncOnce({ getDb: () => db as never, client });

    expect(r.ok).toBe(true);
    expect(r.pushed).toBe(0);
    expect(db.rows.length).toBe(0);
  });

  it("marks 'invalid' results as attempted but keeps them in the queue", async () => {
    const db = makeFakeDb([makeRow()], {
      last_pulled_version: 0,
      last_pushed_at: null,
    });
    const client = makeClient({
      push: vi.fn(async () => ({
        results: [
          {
            index: 0,
            status: "invalid" as const,
            table: "tasks" as const,
            id: null,
            version: null,
            reason: "payload_failed_meta_validation",
          },
        ],
        version: 0,
      })),
    });

    const r = await runSyncOnce({ getDb: () => db as never, client });

    expect(r.ok).toBe(true);
    expect(db.rows.length).toBe(1);
    expect(db.rows[0]?.attempts).toBe(1);
    expect(db.rows[0]?.last_error).toContain("invalid:");
  });

  it("on push error, marks attempted and surfaces error", async () => {
    const db = makeFakeDb([makeRow()], {
      last_pulled_version: 0,
      last_pushed_at: null,
    });
    const client = makeClient({
      push: vi.fn(async () => {
        throw new Error("network");
      }),
    });

    const r = await runSyncOnce({ getDb: () => db as never, client });

    expect(r.ok).toBe(false);
    expect(r.error).toContain("network");
    expect(db.rows.length).toBe(1);
    expect(db.rows[0]?.attempts).toBe(1);
  });
});

describe("runSyncOnce — pull phase", () => {
  it("advances the cursor when the server returns a higher version", async () => {
    const db = makeFakeDb([], { last_pulled_version: 5, last_pushed_at: null });
    const client = makeClient({
      pull: vi.fn(async () => ({
        records: { tasks: [{ id: "x" }, { id: "y" }] },
        version: 17,
      })),
    });

    const r = await runSyncOnce({ getDb: () => db as never, client });

    expect(r.ok).toBe(true);
    expect(r.pulled).toBe(2);
    expect(r.lastPulledVersion).toBe(17);
    expect(db.state.last_pulled_version).toBe(17);
  });

  it("does not move the cursor backwards", async () => {
    const db = makeFakeDb([], {
      last_pulled_version: 50,
      last_pushed_at: null,
    });
    const client = makeClient({
      pull: vi.fn(async () => ({ records: {}, version: 50 })),
    });

    const r = await runSyncOnce({ getDb: () => db as never, client });

    expect(r.ok).toBe(true);
    expect(db.state.last_pulled_version).toBe(50);
  });
});

describe("createSyncLoop — start/stop", () => {
  it("does not tick after stop()", async () => {
    vi.useFakeTimers();
    const tick = vi.fn(async () => ({
      ok: true,
      pushed: 0,
      pulled: 0,
      pendingAfter: 0,
      lastPulledVersion: 0,
    }));
    const db = makeFakeDb([], { last_pulled_version: 0, last_pushed_at: null });
    const client = makeClient({
      push: tick as never,
      pull: vi.fn(async () => ({ records: {}, version: 0 })),
    });
    const loop = createSyncLoop({
      getDb: () => db as never,
      client,
      intervalMs: 1_000,
    });
    loop.start();
    vi.advanceTimersByTime(2_500);
    loop.stop();
    const callsAfterStop = tick.mock.calls.length;
    vi.advanceTimersByTime(5_000);
    expect(tick.mock.calls.length).toBe(callsAfterStop);
    vi.useRealTimers();
  });

  it("stop() is idempotent — calling twice does not throw", () => {
    const db = makeFakeDb([], { last_pulled_version: 0, last_pushed_at: null });
    const loop = createSyncLoop({
      getDb: () => db as never,
      client: makeClient(),
      intervalMs: 10_000,
    });
    loop.start();
    loop.stop();
    expect(() => loop.stop()).not.toThrow();
  });
});
