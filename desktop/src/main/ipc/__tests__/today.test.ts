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

vi.mock("../../today/store", () => ({
  listTodayTasks: vi.fn(),
  listTodayEvents: vi.fn(),
  countUnresolvedInbox: vi.fn(),
}));

import { registerTodayIpc } from "../today";
import * as store from "../../today/store";

beforeAll(() => registerTodayIpc());

const CTX: HandlerCtx = {
  userId: "u2",
  db: {} as HandlerCtx["db"],
  now: 2_000_000,
  tz: -60,
};
const call = (ch: string) => reg.get(ch)!(CTX, undefined);

describe("tasks:listToday", () => {
  it("passes ctx fields to listTodayTasks and wraps result", () => {
    const tasks = [{ id: "t1" }];
    vi.mocked(store.listTodayTasks).mockReturnValue(tasks as ReturnType<typeof store.listTodayTasks>);
    const r = call("tasks:listToday");
    expect(store.listTodayTasks).toHaveBeenCalledWith(CTX.db, CTX.userId, CTX.now, CTX.tz);
    expect(r).toEqual({ ok: true, tasks });
  });
});

describe("events:listToday", () => {
  it("passes ctx fields to listTodayEvents and wraps result", () => {
    const events = [{ id: "e1" }];
    vi.mocked(store.listTodayEvents).mockReturnValue(events as ReturnType<typeof store.listTodayEvents>);
    const r = call("events:listToday");
    expect(store.listTodayEvents).toHaveBeenCalledWith(CTX.db, CTX.userId, CTX.now, CTX.tz);
    expect(r).toEqual({ ok: true, events });
  });
});

describe("inbox:unresolvedCount", () => {
  it("delegates to countUnresolvedInbox and returns count", () => {
    vi.mocked(store.countUnresolvedInbox).mockReturnValue(7);
    const r = call("inbox:unresolvedCount");
    expect(store.countUnresolvedInbox).toHaveBeenCalledWith(CTX.db, CTX.userId, CTX.now);
    expect(r).toEqual({ ok: true, count: 7 });
  });
});
