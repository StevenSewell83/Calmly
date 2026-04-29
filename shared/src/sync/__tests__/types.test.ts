import { describe, expect, it } from "vitest";
import {
  PullRequestSchema,
  PullResponseSchema,
  PushOpResultSchema,
  PushRequestSchema,
  PushResponseSchema,
  SyncOpSchema,
  SyncTableSchema,
  syncTables,
} from "../types";

const id = "11111111-1111-4111-8111-111111111111";
const now = 1_730_000_000_000;

describe("SyncTableSchema", () => {
  it("includes the canonical 9 domain tables", () => {
    expect(syncTables.length).toBe(9);
  });

  it("rejects auth tables", () => {
    expect(SyncTableSchema.safeParse("users").success).toBe(false);
    expect(SyncTableSchema.safeParse("sessions").success).toBe(false);
    expect(SyncTableSchema.safeParse("magic_link_tokens").success).toBe(false);
  });

  it("accepts the domain tables", () => {
    for (const t of syncTables) expect(SyncTableSchema.parse(t)).toBe(t);
  });
});

describe("SyncOpSchema", () => {
  it("accepts a well-formed upsert op", () => {
    expect(
      SyncOpSchema.parse({
        table: "tasks",
        op: "upsert",
        payload: { id, updated_at: now, deleted_at: null, version: 0 },
      }).op,
    ).toBe("upsert");
  });

  it("rejects unknown op kinds", () => {
    expect(
      SyncOpSchema.safeParse({
        table: "tasks",
        op: "patch",
        payload: {},
      }).success,
    ).toBe(false);
  });

  it("rejects unknown tables", () => {
    expect(
      SyncOpSchema.safeParse({
        table: "users",
        op: "upsert",
        payload: { id, updated_at: now, deleted_at: null, version: 0 },
      }).success,
    ).toBe(false);
  });
});

describe("PushRequestSchema", () => {
  it("accepts up to 500 ops", () => {
    const ops = Array.from({ length: 500 }, () => ({
      table: "tasks" as const,
      op: "upsert" as const,
      payload: { id, updated_at: now, deleted_at: null, version: 0 },
    }));
    expect(PushRequestSchema.parse({ ops }).ops.length).toBe(500);
  });

  it("rejects more than 500 ops", () => {
    const ops = Array.from({ length: 501 }, () => ({
      table: "tasks" as const,
      op: "upsert" as const,
      payload: { id, updated_at: now, deleted_at: null, version: 0 },
    }));
    expect(PushRequestSchema.safeParse({ ops }).success).toBe(false);
  });
});

describe("PushOpResultSchema + PushResponseSchema", () => {
  it("round-trips a typical accepted result", () => {
    const r = PushOpResultSchema.parse({
      index: 0,
      status: "accepted",
      table: "tasks",
      id,
      version: 1,
      reason: null,
    });
    expect(r.status).toBe("accepted");
  });

  it("accepts stale, gone, invalid as terminal statuses", () => {
    for (const s of ["stale", "gone", "invalid"] as const) {
      expect(
        PushOpResultSchema.parse({
          index: 0,
          status: s,
          table: "tasks",
          id,
          version: null,
          reason: "test",
        }).status,
      ).toBe(s);
    }
  });

  it("validates a wrapped push response", () => {
    expect(
      PushResponseSchema.parse({
        results: [
          {
            index: 0,
            status: "accepted",
            table: "tasks",
            id,
            version: 7,
            reason: null,
          },
        ],
        version: 7,
      }).version,
    ).toBe(7);
  });
});

describe("PullRequestSchema + PullResponseSchema", () => {
  it("defaults since to 0", () => {
    expect(PullRequestSchema.parse({}).since).toBe(0);
  });

  it("rejects negative since", () => {
    expect(PullRequestSchema.safeParse({ since: -1 }).success).toBe(false);
  });

  it("validates a pull response with multiple tables", () => {
    const res = PullResponseSchema.parse({
      records: {
        tasks: [{ id, title: "x" }],
        inbox_items: [{ id, raw_text: "y" }],
      },
      version: 42,
    });
    expect(res.version).toBe(42);
  });
});
