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

vi.mock("../triage/store", () => ({
  resolveAsTask: vi.fn(),
  resolveAsEvent: vi.fn(),
  discardInboxItem: vi.fn(),
}));

import { registerTriageIpc } from "../triage";
import * as store from "../triage/store";

beforeAll(() => registerTriageIpc());

const CTX: HandlerCtx = {
  userId: "u3",
  db: {} as HandlerCtx["db"],
  now: 3_000_000,
  tz: 0,
};
const call = (ch: string, raw: unknown) => reg.get(ch)!(CTX, raw);

// ── triage:resolveAsTask ───────────────────────────────────────────────────

describe("triage:resolveAsTask", () => {
  it("rejects non-object payload with InvalidArgs", () => {
    expect(call("triage:resolveAsTask", null)).toEqual({
      ok: false,
      error: "InvalidArgs",
    });
    expect(call("triage:resolveAsTask", "string")).toEqual({
      ok: false,
      error: "InvalidArgs",
    });
  });

  it("rejects missing inboxId or non-string title with InvalidArgs", () => {
    expect(
      call("triage:resolveAsTask", { inboxId: "", title: "ok", dueAt: null }),
    ).toEqual({ ok: false, error: "InvalidArgs" });
    expect(
      call("triage:resolveAsTask", { inboxId: "i1", title: 42, dueAt: null }),
    ).toEqual({ ok: false, error: "InvalidArgs" });
  });

  it("rejects non-finite dueAt with InvalidArgs", () => {
    expect(
      call("triage:resolveAsTask", {
        inboxId: "i1",
        title: "Task",
        dueAt: NaN,
      }),
    ).toEqual({ ok: false, error: "InvalidArgs" });
  });

  it("happy path: delegates with null dueAt and returns store result", () => {
    vi.mocked(store.resolveAsTask).mockReturnValue({ ok: true, taskId: "t1" });
    const r = call("triage:resolveAsTask", {
      inboxId: "i1",
      title: "Buy groceries",
      dueAt: null,
    });
    expect(store.resolveAsTask).toHaveBeenCalledWith({
      db: CTX.db,
      userId: CTX.userId,
      inboxId: "i1",
      title: "Buy groceries",
      dueAt: null,
      now: CTX.now,
    });
    expect(r).toEqual({ ok: true, taskId: "t1" });
  });

  it("happy path: delegates with numeric dueAt", () => {
    vi.mocked(store.resolveAsTask).mockReturnValue({ ok: true, taskId: "t2" });
    call("triage:resolveAsTask", {
      inboxId: "i2",
      title: "Meeting",
      dueAt: 9_000_000,
    });
    expect(store.resolveAsTask).toHaveBeenCalledWith(
      expect.objectContaining({ dueAt: 9_000_000 }),
    );
  });
});

// ── triage:resolveAsEvent ──────────────────────────────────────────────────

describe("triage:resolveAsEvent", () => {
  it("rejects missing startAt or endAt with InvalidArgs", () => {
    expect(
      call("triage:resolveAsEvent", {
        inboxId: "i1",
        title: "Event",
        startAt: "not-a-number",
        endAt: 2_000,
      }),
    ).toEqual({ ok: false, error: "InvalidArgs" });
    expect(
      call("triage:resolveAsEvent", {
        inboxId: "i1",
        title: "Event",
        startAt: 1_000,
      }),
    ).toEqual({ ok: false, error: "InvalidArgs" });
  });

  it("happy path: delegates to resolveAsEvent with correct args", () => {
    vi.mocked(store.resolveAsEvent).mockReturnValue({
      ok: true,
      eventId: "ev1",
    });
    const r = call("triage:resolveAsEvent", {
      inboxId: "i3",
      title: "Standup",
      startAt: 1_000,
      endAt: 2_000,
    });
    expect(store.resolveAsEvent).toHaveBeenCalledWith({
      db: CTX.db,
      userId: CTX.userId,
      inboxId: "i3",
      title: "Standup",
      startAt: 1_000,
      endAt: 2_000,
      now: CTX.now,
    });
    expect(r).toEqual({ ok: true, eventId: "ev1" });
  });
});

// ── triage:discard ─────────────────────────────────────────────────────────

describe("triage:discard", () => {
  it("rejects non-string inboxId with InvalidArgs", () => {
    expect(call("triage:discard", null)).toEqual({
      ok: false,
      error: "InvalidArgs",
    });
    expect(call("triage:discard", "")).toEqual({
      ok: false,
      error: "InvalidArgs",
    });
  });

  it("delegates to discardInboxItem and returns its result", () => {
    vi.mocked(store.discardInboxItem).mockReturnValue({ ok: true });
    const r = call("triage:discard", "inbox-5");
    expect(store.discardInboxItem).toHaveBeenCalledWith({
      db: CTX.db,
      userId: CTX.userId,
      inboxId: "inbox-5",
      now: CTX.now,
    });
    expect(r).toEqual({ ok: true });
  });
});
