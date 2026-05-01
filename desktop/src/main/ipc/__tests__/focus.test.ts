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

vi.mock("../../focus/store", () => ({
  currentFocus: vi.fn(),
  startFocus: vi.fn(),
  endFocus: vi.fn(),
  markDoneFromFocus: vi.fn(),
  switchFocus: vi.fn(),
}));

import { registerFocusIpc } from "../focus";
import * as store from "../../focus/store";

beforeAll(() => registerFocusIpc());

const CTX: HandlerCtx = {
  userId: "u5",
  db: {} as HandlerCtx["db"],
  now: 5_000_000,
  tz: 0,
};
const call = (ch: string, raw?: unknown) => reg.get(ch)!(CTX, raw);

// ── focus:current ──────────────────────────────────────────────────────────

describe("focus:current", () => {
  it("returns current session from store", () => {
    const session = { id: "s1" };
    vi.mocked(store.currentFocus).mockReturnValue(session as ReturnType<typeof store.currentFocus>);
    const r = call("focus:current");
    expect(store.currentFocus).toHaveBeenCalledWith(CTX.db, CTX.userId);
    expect(r).toEqual({ ok: true, session });
  });

  it("returns ok:true with null session when none active", () => {
    vi.mocked(store.currentFocus).mockReturnValue(null);
    expect(call("focus:current")).toEqual({ ok: true, session: null });
  });
});

// ── focus:start ────────────────────────────────────────────────────────────

describe("focus:start", () => {
  it("rejects non-object payload with InvalidArgs", () => {
    expect(call("focus:start", "bad")).toEqual({
      ok: false,
      error: "InvalidArgs",
    });
  });

  it("rejects invalid source value with InvalidArgs", () => {
    expect(
      call("focus:start", { taskId: "t1", source: "unknown-source" }),
    ).toEqual({ ok: false, error: "InvalidArgs" });
  });

  it("rejects empty taskId with InvalidArgs", () => {
    expect(call("focus:start", { taskId: "", source: "ad-hoc" })).toEqual({
      ok: false,
      error: "InvalidArgs",
    });
  });

  it("happy path (scheduled): delegates to startFocus and returns result", () => {
    vi.mocked(store.startFocus).mockReturnValue({
      ok: true,
      sessionId: "sess-1",
    });
    const r = call("focus:start", { taskId: "t1", source: "scheduled" });
    expect(store.startFocus).toHaveBeenCalledWith(
      CTX.db,
      CTX.userId,
      "t1",
      "scheduled",
      CTX.now,
    );
    expect(r).toEqual({ ok: true, sessionId: "sess-1" });
  });

  it("happy path (ad-hoc): delegates to startFocus", () => {
    vi.mocked(store.startFocus).mockReturnValue({
      ok: true,
      sessionId: "sess-2",
    });
    call("focus:start", { taskId: "t2", source: "ad-hoc" });
    expect(store.startFocus).toHaveBeenCalledWith(
      CTX.db,
      CTX.userId,
      "t2",
      "ad-hoc",
      CTX.now,
    );
  });
});

// ── focus:end ──────────────────────────────────────────────────────────────

describe("focus:end", () => {
  it("delegates to endFocus with userId and now", () => {
    vi.mocked(store.endFocus).mockReturnValue({ ok: true, ended: true });
    const r = call("focus:end");
    expect(store.endFocus).toHaveBeenCalledWith(CTX.db, CTX.userId, CTX.now);
    expect(r).toEqual({ ok: true, ended: true });
  });
});

// ── focus:markDone ─────────────────────────────────────────────────────────

describe("focus:markDone", () => {
  it("delegates to markDoneFromFocus and returns result", () => {
    vi.mocked(store.markDoneFromFocus).mockReturnValue({
      ok: true,
      taskId: "t3",
    });
    const r = call("focus:markDone");
    expect(store.markDoneFromFocus).toHaveBeenCalledWith(
      CTX.db,
      CTX.userId,
      CTX.now,
    );
    expect(r).toEqual({ ok: true, taskId: "t3" });
  });
});

// ── focus:switch ───────────────────────────────────────────────────────────

describe("focus:switch", () => {
  it("rejects invalid source with InvalidArgs", () => {
    expect(
      call("focus:switch", { taskId: "t1", source: "bad" }),
    ).toEqual({ ok: false, error: "InvalidArgs" });
  });

  it("happy path: delegates to switchFocus", () => {
    vi.mocked(store.switchFocus).mockReturnValue({
      ok: true,
      sessionId: "sess-3",
    });
    const r = call("focus:switch", { taskId: "t4", source: "ad-hoc" });
    expect(store.switchFocus).toHaveBeenCalledWith(
      CTX.db,
      CTX.userId,
      "t4",
      "ad-hoc",
      CTX.now,
    );
    expect(r).toEqual({ ok: true, sessionId: "sess-3" });
  });
});
