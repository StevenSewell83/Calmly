// Tests for the calendar:refresh IPC handler (CAL-04).
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  handlers: new Map<string, (e: unknown, ...args: unknown[]) => Promise<unknown>>(),
  signedIn: true,
  mockUser: { id: "user-1", email: "alex@example.com" },
  triggerImport: vi.fn((_id?: string) => Promise.resolve()),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (ch: string, cb: (e: unknown, ...args: unknown[]) => Promise<unknown>) =>
      hoisted.handlers.set(ch, cb),
  },
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock("../../auth/currentUser", () => ({
  getCurrentUser: () => (hoisted.signedIn ? hoisted.mockUser : null),
}));

vi.mock("../../calendar/localStore", () => ({
  listLocalCalendarAccounts: () => [],
  getLocalCalendarAccount: () => null,
  deleteLocalCalendarAccount: () => false,
}));

vi.mock("../../calendar/tokens", () => ({
  calendarTokens: { set: vi.fn(), get: vi.fn(), has: vi.fn(), delete: vi.fn() },
}));

vi.mock("../../calendar/statusEvents", () => ({
  calendarStatusEvents: { subscribe: () => () => {}, notify: vi.fn() },
}));

vi.mock("../../calendar/importWorker", () => ({
  triggerImport: (id?: string) => hoisted.triggerImport(id),
}));

import { __resetCalendarIpcForTests, registerCalendarIpc } from "../calendar";
import type { ApiClient } from "../../net/client";

const noopClient: ApiClient = {
  request: vi.fn(async () => ({ status: 200, body: {} })) as unknown as ApiClient["request"],
};

function setup(): void {
  __resetCalendarIpcForTests();
  registerCalendarIpc({
    apiClient: noopClient,
    connectGoogle: vi.fn(),
    connectMicrosoft: vi.fn(),
  });
}

const call = (ch: string, ...args: unknown[]): Promise<unknown> => {
  const h = hoisted.handlers.get(ch);
  if (!h) throw new Error(`no handler for ${ch}`);
  return h(null, ...args);
};

describe("calendar:refresh", () => {
  beforeEach(() => {
    hoisted.signedIn = true;
    hoisted.triggerImport.mockReset().mockResolvedValue(undefined);
    setup();
  });

  it("returns {ok:false} when not signed in", async () => {
    hoisted.signedIn = false;
    setup();
    const r = await call("calendar:refresh");
    expect(r).toEqual({ ok: false });
    expect(hoisted.triggerImport).not.toHaveBeenCalled();
  });

  it("calls triggerImport with no accountId when called with no args", async () => {
    const r = await call("calendar:refresh");
    expect(r).toEqual({ ok: true });
    expect(hoisted.triggerImport).toHaveBeenCalledWith(undefined);
  });

  it("calls triggerImport with accountId when a string is passed", async () => {
    const r = await call("calendar:refresh", "acct-7");
    expect(r).toEqual({ ok: true });
    expect(hoisted.triggerImport).toHaveBeenCalledWith("acct-7");
  });

  it("treats empty-string accountId as absent (passes undefined)", async () => {
    const r = await call("calendar:refresh", "");
    expect(r).toEqual({ ok: true });
    expect(hoisted.triggerImport).toHaveBeenCalledWith(undefined);
  });

  it("treats non-string payload as absent", async () => {
    const r = await call("calendar:refresh", 42);
    expect(r).toEqual({ ok: true });
    expect(hoisted.triggerImport).toHaveBeenCalledWith(undefined);
  });
});
