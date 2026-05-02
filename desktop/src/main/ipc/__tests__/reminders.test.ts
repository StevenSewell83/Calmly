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

vi.mock("../../reminders/store", () => ({
  getReminderRule: vi.fn(),
  upsertReminderRule: vi.fn(),
  deleteReminderRule: vi.fn(),
}));

import { registerRemindersIpc } from "../reminders";
import * as store from "../../reminders/store";

beforeAll(() => registerRemindersIpc());

const CTX: HandlerCtx = {
  userId: "u-1",
  db: {} as HandlerCtx["db"],
  now: 4_000_000,
  tz: 0,
};
const call = (ch: string, raw: unknown) => reg.get(ch)!(CTX, raw);

// ── reminders:get ──────────────────────────────────────────────────────────

describe("reminders:get", () => {
  it("rejects non-object payload with InvalidArgs", () => {
    expect(call("reminders:get", "bad")).toEqual({ ok: false, error: "InvalidArgs" });
  });

  it("rejects payload missing taskId", () => {
    expect(call("reminders:get", {})).toEqual({ ok: false, error: "InvalidArgs" });
  });

  it("delegates to getReminderRule and wraps in { ok, rule }", () => {
    vi.mocked(store.getReminderRule).mockReturnValue(null);
    const r = call("reminders:get", { taskId: "t1" });
    expect(store.getReminderRule).toHaveBeenCalledWith(CTX.db, CTX.userId, "t1");
    expect(r).toEqual({ ok: true, rule: null });
  });

  it("passes through a non-null rule", () => {
    const rule = {
      id: "r1",
      task_id: "t1",
      importance: "important" as const,
      interval_seconds: 600,
      escalation_json: "{}",
      active: 1 as const,
      version: 0,
    };
    vi.mocked(store.getReminderRule).mockReturnValue(rule);
    expect(call("reminders:get", { taskId: "t1" })).toEqual({ ok: true, rule });
  });
});

// ── reminders:upsert ───────────────────────────────────────────────────────

describe("reminders:upsert", () => {
  const validPayload = {
    taskId: "t1",
    importance: "soft",
    intervalSeconds: 3600,
    escalationJson: "{}",
    active: true,
  };

  it("rejects non-object payload", () => {
    expect(call("reminders:upsert", null)).toEqual({ ok: false, error: "InvalidArgs" });
  });

  it("rejects payload missing taskId", () => {
    expect(call("reminders:upsert", { ...validPayload, taskId: undefined })).toEqual({
      ok: false,
      error: "InvalidArgs",
    });
  });

  it("rejects non-string importance", () => {
    expect(call("reminders:upsert", { ...validPayload, importance: 1 })).toEqual({
      ok: false,
      error: "InvalidArgs",
    });
  });

  it("rejects non-numeric intervalSeconds", () => {
    expect(
      call("reminders:upsert", { ...validPayload, intervalSeconds: "1h" }),
    ).toEqual({ ok: false, error: "InvalidArgs" });
  });

  it("rejects non-string escalationJson", () => {
    expect(
      call("reminders:upsert", { ...validPayload, escalationJson: { a: 1 } }),
    ).toEqual({ ok: false, error: "InvalidArgs" });
  });

  it("rejects non-boolean active", () => {
    expect(
      call("reminders:upsert", { ...validPayload, active: "yes" }),
    ).toEqual({ ok: false, error: "InvalidArgs" });
  });

  it("delegates to upsertReminderRule on the happy path", () => {
    vi.mocked(store.upsertReminderRule).mockReturnValue({ ok: true, id: "r-new" });
    const r = call("reminders:upsert", validPayload);
    expect(store.upsertReminderRule).toHaveBeenCalledWith(
      CTX.db,
      CTX.userId,
      "t1",
      {
        importance: "soft",
        intervalSeconds: 3600,
        escalationJson: "{}",
        active: true,
      },
      CTX.now,
    );
    expect(r).toEqual({ ok: true, id: "r-new" });
  });
});

// ── reminders:delete ───────────────────────────────────────────────────────

describe("reminders:delete", () => {
  it("rejects non-object payload", () => {
    expect(call("reminders:delete", "x")).toEqual({ ok: false, error: "InvalidArgs" });
  });

  it("rejects payload missing taskId", () => {
    expect(call("reminders:delete", {})).toEqual({ ok: false, error: "InvalidArgs" });
  });

  it("delegates to deleteReminderRule on the happy path", () => {
    vi.mocked(store.deleteReminderRule).mockReturnValue({ ok: true });
    const r = call("reminders:delete", { taskId: "t1" });
    expect(store.deleteReminderRule).toHaveBeenCalledWith(
      CTX.db,
      CTX.userId,
      "t1",
      CTX.now,
    );
    expect(r).toEqual({ ok: true });
  });

  it("passes through NotFound from the store", () => {
    vi.mocked(store.deleteReminderRule).mockReturnValue({ ok: false, error: "NotFound" });
    expect(call("reminders:delete", { taskId: "t1" })).toEqual({
      ok: false,
      error: "NotFound",
    });
  });
});
