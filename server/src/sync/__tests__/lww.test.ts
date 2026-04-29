import { describe, expect, it } from "vitest";
import { decideDelete, decideUpsert } from "../lww";

describe("decideUpsert", () => {
  it("accepts when nothing exists", () => {
    expect(decideUpsert(null, 1000).accept).toBe(true);
  });

  it("accepts when incoming is newer", () => {
    expect(
      decideUpsert({ updated_at: 1000, deleted_at: null }, 2000).accept,
    ).toBe(true);
  });

  it("rejects equal timestamps as stale", () => {
    const d = decideUpsert({ updated_at: 1000, deleted_at: null }, 1000);
    expect(d.accept).toBe(false);
    if (!d.accept) expect(d.reason).toBe("stale");
  });

  it("rejects older incoming as stale", () => {
    const d = decideUpsert({ updated_at: 2000, deleted_at: null }, 1000);
    expect(d.accept).toBe(false);
    if (!d.accept) expect(d.reason).toBe("stale");
  });

  it("accepts upsert that revives a soft-deleted row when newer", () => {
    expect(
      decideUpsert({ updated_at: 1000, deleted_at: 1500 }, 2000).accept,
    ).toBe(true);
  });

  it("treats string timestamps from pg as numbers", () => {
    expect(
      decideUpsert(
        { updated_at: "1000" as unknown as number, deleted_at: null },
        2000,
      ).accept,
    ).toBe(true);
  });
});

describe("decideDelete", () => {
  it("rejects delete of nothing as gone", () => {
    const d = decideDelete(null, 1000);
    expect(d.accept).toBe(false);
    if (!d.accept) expect(d.reason).toBe("gone");
  });

  it("rejects delete of already-deleted as gone (idempotent replay)", () => {
    const d = decideDelete({ updated_at: 1500, deleted_at: 1500 }, 2000);
    expect(d.accept).toBe(false);
    if (!d.accept) expect(d.reason).toBe("gone");
  });

  it("accepts delete when incoming is newer than stored", () => {
    expect(
      decideDelete({ updated_at: 1000, deleted_at: null }, 2000).accept,
    ).toBe(true);
  });

  it("rejects delete older than stored as stale", () => {
    const d = decideDelete({ updated_at: 2000, deleted_at: null }, 1000);
    expect(d.accept).toBe(false);
    if (!d.accept) expect(d.reason).toBe("stale");
  });

  it("rejects equal timestamps as stale (newer wins, not equal)", () => {
    const d = decideDelete({ updated_at: 1000, deleted_at: null }, 1000);
    expect(d.accept).toBe(false);
    if (!d.accept) expect(d.reason).toBe("stale");
  });
});
