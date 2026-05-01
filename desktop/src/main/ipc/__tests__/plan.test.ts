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

vi.mock("../../plan/store", () => ({
  listForDay: vi.fn(),
  scheduleTask: vi.fn(),
  unscheduleTask: vi.fn(),
  updateTask: vi.fn(),
}));

import { registerPlanIpc } from "../plan";
import * as store from "../../plan/store";

beforeAll(() => registerPlanIpc());

const CTX: HandlerCtx = {
  userId: "u4",
  db: {} as HandlerCtx["db"],
  now: 4_000_000,
  tz: -300,
};
const call = (ch: string, raw: unknown) => reg.get(ch)!(CTX, raw);

// ── plan:listForDay ────────────────────────────────────────────────────────

describe("plan:listForDay", () => {
  it("uses ctx.now as day when no day field provided", () => {
    const plan = { scheduled: [], backlog: [] };
    vi.mocked(store.listForDay).mockReturnValue(plan as ReturnType<typeof store.listForDay>);
    const r = call("plan:listForDay", {});
    expect(store.listForDay).toHaveBeenCalledWith(CTX.db, CTX.userId, CTX.now, CTX.tz);
    expect(r).toEqual({ ok: true, plan, day: CTX.now });
  });

  it("uses provided numeric day when valid", () => {
    const plan = { scheduled: [], backlog: [] };
    vi.mocked(store.listForDay).mockReturnValue(plan as ReturnType<typeof store.listForDay>);
    call("plan:listForDay", { day: 1_234_567 });
    expect(store.listForDay).toHaveBeenCalledWith(CTX.db, CTX.userId, 1_234_567, CTX.tz);
  });
});

// ── plan:schedule ──────────────────────────────────────────────────────────

describe("plan:schedule", () => {
  it("rejects non-object payload with InvalidArgs", () => {
    expect(call("plan:schedule", "bad")).toEqual({
      ok: false,
      error: "InvalidArgs",
    });
  });

  it("rejects missing or non-string taskId with InvalidArgs", () => {
    expect(
      call("plan:schedule", { taskId: 42, startAt: 1_000, endAt: 2_000 }),
    ).toEqual({ ok: false, error: "InvalidArgs" });
  });

  it("rejects non-number startAt/endAt with InvalidArgs", () => {
    expect(
      call("plan:schedule", { taskId: "t1", startAt: "noon", endAt: 2_000 }),
    ).toEqual({ ok: false, error: "InvalidArgs" });
  });

  it("happy path: delegates to scheduleTask and passes through result", () => {
    vi.mocked(store.scheduleTask).mockReturnValue({ ok: true });
    const r = call("plan:schedule", {
      taskId: "t1",
      startAt: 5_000,
      endAt: 6_000,
    });
    expect(store.scheduleTask).toHaveBeenCalledWith(
      CTX.db,
      CTX.userId,
      "t1",
      5_000,
      6_000,
      CTX.now,
    );
    expect(r).toEqual({ ok: true });
  });
});

// ── plan:unschedule ────────────────────────────────────────────────────────

describe("plan:unschedule", () => {
  it("rejects non-string taskId with InvalidArgs", () => {
    expect(call("plan:unschedule", null)).toEqual({
      ok: false,
      error: "InvalidArgs",
    });
    expect(call("plan:unschedule", "")).toEqual({
      ok: false,
      error: "InvalidArgs",
    });
  });

  it("delegates to unscheduleTask and returns result", () => {
    vi.mocked(store.unscheduleTask).mockReturnValue({ ok: true });
    const r = call("plan:unschedule", "task-abc");
    expect(store.unscheduleTask).toHaveBeenCalledWith(
      CTX.db,
      CTX.userId,
      "task-abc",
      CTX.now,
    );
    expect(r).toEqual({ ok: true });
  });
});

// ── plan:update ────────────────────────────────────────────────────────────

describe("plan:update", () => {
  it("rejects missing or non-string taskId with InvalidArgs", () => {
    expect(call("plan:update", {})).toEqual({
      ok: false,
      error: "InvalidArgs",
    });
    expect(call("plan:update", { taskId: 42 })).toEqual({
      ok: false,
      error: "InvalidArgs",
    });
  });

  it("rejects non-string title field with InvalidArgs", () => {
    expect(call("plan:update", { taskId: "t1", title: 99 })).toEqual({
      ok: false,
      error: "InvalidArgs",
    });
  });

  it("happy path: delegates updateTask with parsed args", () => {
    vi.mocked(store.updateTask).mockReturnValue({ ok: true });
    const r = call("plan:update", {
      taskId: "t2",
      title: "New title",
      scheduledStart: null,
    });
    expect(store.updateTask).toHaveBeenCalledWith(
      CTX.db,
      CTX.userId,
      "t2",
      expect.objectContaining({ title: "New title", scheduledStart: null }),
      CTX.now,
    );
    expect(r).toEqual({ ok: true });
  });
});
