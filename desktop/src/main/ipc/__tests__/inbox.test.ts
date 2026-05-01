// IPC handler unit tests for inbox.ts.
//
// Auth-gating is covered generically by handler.test.ts (authedHandler suite).
// These tests exercise the payload-validation logic and store delegation for
// each inbox channel.

import { vi, describe, it, expect, beforeAll } from "vitest";
import type { HandlerCtx } from "../handler";

type Cb = (ctx: HandlerCtx, raw: unknown) => unknown;
const reg = new Map<string, Cb>();

vi.mock("../handler", () => ({
  authedHandler: (ch: string, fn: Cb) => reg.set(ch, fn),
  isStringId: (v: unknown) => typeof v === "string" && v.length > 0,
  isObject: (v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v),
}));

vi.mock("../../inbox/store", () => ({
  addInboxItem: vi.fn(),
  listInbox: vi.fn(),
  snoozeInboxItem: vi.fn(),
  skipInboxItem: vi.fn(),
}));

import { registerInboxIpc } from "../inbox";
import * as store from "../../inbox/store";

beforeAll(() => registerInboxIpc());

const CTX: HandlerCtx = {
  userId: "u1",
  db: {} as HandlerCtx["db"],
  now: 1_000_000,
  tz: 0,
};
const call = (ch: string, raw: unknown) => reg.get(ch)!(CTX, raw);

// ── inbox:add ──────────────────────────────────────────────────────────────

describe("inbox:add", () => {
  it("rejects non-string payload with InvalidArgs", () => {
    expect(call("inbox:add", 42)).toEqual({ ok: false, error: "InvalidArgs" });
    expect(call("inbox:add", null)).toEqual({ ok: false, error: "InvalidArgs" });
    expect(store.addInboxItem).not.toHaveBeenCalled();
  });

  it("delegates to addInboxItem with correct args and returns its result", () => {
    vi.mocked(store.addInboxItem).mockReturnValue({
      ok: true,
      id: "item-1",
      truncated: false,
    });
    const r = call("inbox:add", "Buy milk");
    expect(store.addInboxItem).toHaveBeenCalledWith({
      db: CTX.db,
      userId: CTX.userId,
      rawText: "Buy milk",
      source: "desktop",
    });
    expect(r).toEqual({ ok: true, id: "item-1", truncated: false });
  });

  it("passes through store error results unchanged", () => {
    vi.mocked(store.addInboxItem).mockReturnValue({
      ok: false,
      error: "InvalidArgs",
    });
    expect(call("inbox:add", "hello")).toEqual({
      ok: false,
      error: "InvalidArgs",
    });
  });
});

// ── inbox:list ─────────────────────────────────────────────────────────────

describe("inbox:list", () => {
  it("calls listInbox with userId and now, returns items", () => {
    const items = [{ id: "i1" }];
    vi.mocked(store.listInbox).mockReturnValue(items as ReturnType<typeof store.listInbox>);
    const r = call("inbox:list", undefined);
    expect(store.listInbox).toHaveBeenCalledWith(CTX.db, CTX.userId, CTX.now);
    expect(r).toEqual({ ok: true, items });
  });
});

// ── inbox:snooze ───────────────────────────────────────────────────────────

describe("inbox:snooze", () => {
  it("rejects missing id with InvalidArgs", () => {
    expect(call("inbox:snooze", [null, 9_999_999])).toEqual({
      ok: false,
      error: "InvalidArgs",
    });
  });

  it("rejects non-number untilMs with InvalidArgs", () => {
    expect(call("inbox:snooze", ["item-1", "not-a-number"])).toEqual({
      ok: false,
      error: "InvalidArgs",
    });
  });

  it("delegates to snoozeInboxItem and returns its result", () => {
    vi.mocked(store.snoozeInboxItem).mockReturnValue({ ok: true });
    const r = call("inbox:snooze", ["item-1", 9_999_999]);
    expect(store.snoozeInboxItem).toHaveBeenCalledWith(
      CTX.db,
      CTX.userId,
      "item-1",
      9_999_999,
      CTX.now,
    );
    expect(r).toEqual({ ok: true });
  });
});

// ── inbox:skip ─────────────────────────────────────────────────────────────

describe("inbox:skip", () => {
  it("rejects empty string id with InvalidArgs", () => {
    expect(call("inbox:skip", "")).toEqual({ ok: false, error: "InvalidArgs" });
    expect(call("inbox:skip", 42)).toEqual({ ok: false, error: "InvalidArgs" });
  });

  it("delegates to skipInboxItem and returns its result", () => {
    vi.mocked(store.skipInboxItem).mockReturnValue({ ok: true });
    const r = call("inbox:skip", "item-2");
    expect(store.skipInboxItem).toHaveBeenCalledWith(
      CTX.db,
      CTX.userId,
      "item-2",
      CTX.now,
    );
    expect(r).toEqual({ ok: true });
  });
});
