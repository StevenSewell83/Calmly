import { describe, expect, it } from "vitest";
import type pg from "pg";
import { applyOp } from "../apply";

// Stub client that throws if any DB call is made — domain validation should
// short-circuit before touching the database.
const stubClient = {
  query: () => {
    throw new Error("unexpected DB call");
  },
} as unknown as pg.PoolClient;

const ctx = {
  client: stubClient,
  userId: "00000000-0000-0000-0000-000000000001",
};

const validId = "00000000-0000-0000-0000-000000000002";
const now = Date.now();

describe("applyOp domain validation", () => {
  it("returns invalid for unknown table", async () => {
    const result = await applyOp(ctx, 0, {
      table: "bogus_table" as never,
      op: "upsert",
      payload: {},
    });
    expect(result.status).toBe("invalid");
    expect(result.reason).toBe("unknown_table");
  });

  it("returns invalid when task status is not a valid enum value", async () => {
    const result = await applyOp(ctx, 0, {
      table: "tasks",
      op: "upsert",
      payload: {
        id: validId,
        user_id: ctx.userId,
        title: "Test",
        notes: null,
        type: "task",
        status: "banana", // invalid
        due_at: null,
        parent_task_id: null,
        source: "desktop",
        created_at: now,
        updated_at: now,
        scheduled_start: null,
        scheduled_end: null,
        version: 1,
        deleted_at: null,
      },
    });
    expect(result.status).toBe("invalid");
    expect(result.id).toBe(validId);
    expect(result.reason).toMatch(/status/);
  });

  it("returns invalid when inbox_items raw_text is empty", async () => {
    const result = await applyOp(ctx, 1, {
      table: "inbox_items",
      op: "upsert",
      payload: {
        id: validId,
        user_id: ctx.userId,
        raw_text: "", // min(1) violated
        source: "desktop",
        created_at: now,
        resolved_at: null,
        snoozed_until: null,
        updated_at: now,
        deleted_at: null,
        version: 1,
      },
    });
    expect(result.status).toBe("invalid");
    expect(result.reason).toMatch(/raw_text/);
  });

  it("returns invalid when meta fields are missing (no id)", async () => {
    const result = await applyOp(ctx, 2, {
      table: "tasks",
      op: "upsert",
      payload: { updated_at: now },
    });
    expect(result.status).toBe("invalid");
    expect(result.reason).toContain("meta_validation");
  });

  it("returns invalid for delete op missing id", async () => {
    const result = await applyOp(ctx, 3, {
      table: "tasks",
      op: "delete",
      payload: { updated_at: now },
    });
    expect(result.status).toBe("invalid");
  });
});
