import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock electron and project modules before importing the module under test.
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock("../auth/currentUser", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

import { ipcMain } from "electron";
import { getCurrentUser } from "../auth/currentUser";
import { getDb } from "../db";
import { authedHandler, isStringId, isObject } from "./handler";

// Re-export registered set between tests by re-importing the module. We
// reset the module registry before each test so the `registered` Set starts
// empty.
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  // Reset module-level `registered` set by re-importing won't work without
  // resetModules. Instead, we use unique channel names per test to avoid
  // conflicts.
});

type HandleCallback = (event: unknown, ...args: unknown[]) => Promise<unknown>;

function captureHandler(): {
  invoke: (...args: unknown[]) => Promise<unknown>;
} {
  let captured: HandleCallback | null = null;
  (ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation(
    (_ch: string, fn: HandleCallback) => {
      captured = fn;
    },
  );
  return {
    invoke: async (...args: unknown[]) => {
      if (!captured) throw new Error("handler not registered");
      return captured({}, ...args);
    },
  };
}

describe("authedHandler", () => {
  it("returns NotSignedIn when getCurrentUser returns null", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const h = captureHandler();
    authedHandler("test:auth-fail", () => ({ ok: true }));
    const result = await h.invoke("anything");
    expect(result).toEqual({ ok: false, error: "NotSignedIn" });
  });

  it("calls fn with ctx and raw payload on happy path", async () => {
    const fakeUser = { id: "user-abc" };
    const fakeDb = {};
    (getCurrentUser as ReturnType<typeof vi.fn>).mockReturnValue(fakeUser);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(fakeDb);

    const h = captureHandler();
    let capturedCtx: unknown;
    let capturedRaw: unknown;
    authedHandler("test:happy", (ctx, raw) => {
      capturedCtx = ctx;
      capturedRaw = raw;
      return { ok: true, value: 42 };
    });

    const result = await h.invoke({ someField: "hello" });
    expect(result).toEqual({ ok: true, value: 42 });
    expect((capturedCtx as { userId: string }).userId).toBe("user-abc");
    expect((capturedCtx as { db: unknown }).db).toBe(fakeDb);
    expect(typeof (capturedCtx as { now: number }).now).toBe("number");
    expect(typeof (capturedCtx as { tz: number }).tz).toBe("number");
    expect(capturedRaw).toEqual({ someField: "hello" });
  });

  it("catches thrown errors and returns InternalError", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockReturnValue({ id: "u1" });
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue({});

    const h = captureHandler();
    authedHandler("test:throws", () => {
      throw new Error("boom");
    });

    const result = await h.invoke();
    expect(result).toEqual({ ok: false, error: "InternalError" });
  });

  it("bundles multiple IPC args into an array for multi-arg calls", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockReturnValue({ id: "u2" });
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue({});

    const h = captureHandler();
    let got: unknown;
    authedHandler("test:multi-arg", (_ctx, raw) => {
      got = raw;
      return { ok: true };
    });
    await h.invoke("id-1", 99999);
    expect(got).toEqual(["id-1", 99999]);
  });

  it("does not double-register the same channel", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockReturnValue({ id: "u3" });
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue({});
    const mockHandle = ipcMain.handle as ReturnType<typeof vi.fn>;
    mockHandle.mockClear();

    authedHandler("test:no-dup", () => ({ ok: true }));
    authedHandler("test:no-dup", () => ({
      ok: false,
      error: "InternalError" as const,
    }));

    expect(mockHandle).toHaveBeenCalledTimes(1);
  });
});

describe("isStringId", () => {
  it("accepts non-empty strings", () => {
    expect(isStringId("abc")).toBe(true);
  });
  it("rejects empty string", () => {
    expect(isStringId("")).toBe(false);
  });
  it("rejects non-strings", () => {
    expect(isStringId(123)).toBe(false);
    expect(isStringId(null)).toBe(false);
  });
});

describe("isObject", () => {
  it("accepts plain objects", () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
  });
  it("rejects null, arrays, primitives", () => {
    expect(isObject(null)).toBe(false);
    expect(isObject([])).toBe(false);
    expect(isObject("str")).toBe(false);
  });
});
