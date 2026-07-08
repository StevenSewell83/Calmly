import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  return {
    handlers: new Map<
      string,
      (e: unknown, ...args: unknown[]) => Promise<unknown>
    >(),
    broadcastedEvents: [] as { channel: string; payload: unknown }[],
    state: { signedIn: true },
    mockUser: { id: "user-1", email: "alex@example.com" },
    localStoreMocks: {
      list: vi.fn(() => [] as unknown[]),
      get: vi.fn(
        (
          _id: string,
        ): {
          id: string;
          provider: "google" | "microsoft";
          email: string;
        } | null => null,
      ),
      delete: vi.fn((_id: string) => true),
    },
    calendarTokensDelete: vi.fn(),
  };
});

const fakeWindow = {
  isDestroyed: () => false,
  webContents: {
    send: vi.fn((channel: string, payload: unknown) =>
      hoisted.broadcastedEvents.push({ channel, payload }),
    ),
  },
};

vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      channel: string,
      cb: (e: unknown, ...args: unknown[]) => Promise<unknown>,
    ) => hoisted.handlers.set(channel, cb),
  },
  BrowserWindow: {
    getAllWindows: () => [fakeWindow],
  },
}));

vi.mock("../../auth/currentUser", () => ({
  getCurrentUser: () => (hoisted.state.signedIn ? hoisted.mockUser : null),
}));

vi.mock("../../calendar/localStore", () => ({
  listLocalCalendarAccounts: () => hoisted.localStoreMocks.list(),
  getLocalCalendarAccount: (id: string) => hoisted.localStoreMocks.get(id),
  deleteLocalCalendarAccount: (id: string) =>
    hoisted.localStoreMocks.delete(id),
}));

vi.mock("../../calendar/tokens", () => ({
  calendarTokens: {
    set: vi.fn(),
    get: vi.fn(() => null),
    has: vi.fn(() => false),
    delete: hoisted.calendarTokensDelete,
  },
}));

const handlers = hoisted.handlers;
const broadcastedEvents = hoisted.broadcastedEvents;
const localStoreMocks = hoisted.localStoreMocks;
const calendarTokensDelete = hoisted.calendarTokensDelete;

import { __resetCalendarIpcForTests, registerCalendarIpc } from "../calendar";
import type { ApiClient } from "../../net/client";
import { ApiHttpError, ApiNetworkError } from "../../net/client";
import { calendarStatusEvents } from "../../calendar/statusEvents";

function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`no handler for ${channel}`);
  return fn({}, ...args);
}

beforeEach(() => {
  hoisted.state.signedIn = true;
  handlers.clear();
  broadcastedEvents.length = 0;
  vi.clearAllMocks();
  // Re-apply default impls — vi.clearAllMocks resets implementations.
  localStoreMocks.list.mockReturnValue([]);
  localStoreMocks.get.mockReturnValue(null);
  localStoreMocks.delete.mockReturnValue(true);
  __resetCalendarIpcForTests();
  calendarStatusEvents.__resetForTests();
});

function setup(args: {
  apiClient: ApiClient;
  connectGoogle?: () => Promise<unknown>;
  connectMicrosoft?: () => Promise<unknown>;
}): void {
  registerCalendarIpc({
    apiClient: args.apiClient,
    connectGoogle: (args.connectGoogle ??
      (async () => ({ ok: false, error: "internal_error" }))) as () => Promise<{
      ok: false;
      error: "internal_error";
    }>,
    connectMicrosoft: (args.connectMicrosoft ??
      (async () => ({ ok: false, error: "internal_error" }))) as () => Promise<{
      ok: false;
      error: "internal_error";
    }>,
  });
}

const noopClient: ApiClient = {
  request: vi.fn(async () => ({
    status: 200,
    body: {},
  })) as unknown as ApiClient["request"],
};

describe("calendar:disconnect", () => {
  it("returns NotSignedIn when no current user", async () => {
    hoisted.state.signedIn = false;
    setup({ apiClient: noopClient });
    const r = await call("calendar:disconnect", "acct-1");
    expect(r).toEqual({ ok: false, error: "NotSignedIn" });
  });

  it("rejects non-string accountId with InvalidArgs", async () => {
    setup({ apiClient: noopClient });
    expect(await call("calendar:disconnect", 42)).toEqual({
      ok: false,
      error: "InvalidArgs",
    });
    expect(await call("calendar:disconnect", "")).toEqual({
      ok: false,
      error: "InvalidArgs",
    });
    expect(await call("calendar:disconnect", null)).toEqual({
      ok: false,
      error: "InvalidArgs",
    });
  });

  it("returns NotFound when the local row is missing", async () => {
    localStoreMocks.get.mockReturnValue(null);
    setup({ apiClient: noopClient });
    const r = await call("calendar:disconnect", "missing-id");
    expect(r).toEqual({ ok: false, error: "NotFound" });
  });

  it("happy path: server delete + token delete + local delete + status event", async () => {
    localStoreMocks.get.mockReturnValue({
      id: "acct-1",
      provider: "google",
      email: "alex@example.com",
    });
    localStoreMocks.delete.mockReturnValue(true);

    const apiClient: ApiClient = {
      request: vi.fn(async (_m: string, path: string, body: unknown) => {
        expect(path).toBe("/oauth/google/disconnect");
        expect(body).toEqual({ account_id: "acct-1" });
        return { status: 200, body: { ok: true, deleted: true } };
      }) as unknown as ApiClient["request"],
    };

    const events: { accountId: string; status: string }[] = [];
    calendarStatusEvents.subscribe((e) => events.push(e));

    setup({ apiClient });
    const r = await call("calendar:disconnect", "acct-1");
    expect(r).toEqual({ ok: true });
    expect(apiClient.request).toHaveBeenCalledTimes(1);
    expect(calendarTokensDelete).toHaveBeenCalledWith("google", "acct-1");
    expect(localStoreMocks.delete).toHaveBeenCalledWith("acct-1");
    expect(events).toEqual([{ accountId: "acct-1", status: "disconnected" }]);
  });

  it("returns InternalError when the server returns a non-401 HTTP error", async () => {
    localStoreMocks.get.mockReturnValue({
      id: "acct-1",
      provider: "google",
      email: "alex@example.com",
    });

    const apiClient: ApiClient = {
      request: vi.fn(async () => {
        throw new ApiHttpError("server fail", 500, null);
      }) as unknown as ApiClient["request"],
    };

    setup({ apiClient });
    const r = await call("calendar:disconnect", "acct-1");
    expect(r).toEqual({ ok: false, error: "InternalError" });
    // Local delete was NOT performed since server delete failed hard.
    expect(localStoreMocks.delete).not.toHaveBeenCalled();
  });

  it("falls through to local cleanup when the server returns 401 (stale session)", async () => {
    localStoreMocks.get.mockReturnValue({
      id: "acct-1",
      provider: "microsoft",
      email: "alex@contoso.com",
    });
    localStoreMocks.delete.mockReturnValue(true);

    const apiClient: ApiClient = {
      request: vi.fn(async () => {
        throw new ApiHttpError("unauthorized", 401, null);
      }) as unknown as ApiClient["request"],
    };

    setup({ apiClient });
    const r = await call("calendar:disconnect", "acct-1");
    expect(r).toEqual({ ok: true });
    expect(calendarTokensDelete).toHaveBeenCalledWith("microsoft", "acct-1");
  });

  it("falls through to local cleanup on network error so the user isn't stuck", async () => {
    localStoreMocks.get.mockReturnValue({
      id: "acct-1",
      provider: "google",
      email: "alex@example.com",
    });
    localStoreMocks.delete.mockReturnValue(true);

    const apiClient: ApiClient = {
      request: vi.fn(async () => {
        throw new ApiNetworkError("offline");
      }) as unknown as ApiClient["request"],
    };

    setup({ apiClient });
    const r = await call("calendar:disconnect", "acct-1");
    expect(r).toEqual({ ok: true });
  });
});

describe("calendar:listAccounts", () => {
  it("returns NotSignedIn when not authed", async () => {
    hoisted.state.signedIn = false;
    setup({ apiClient: noopClient });
    expect(await call("calendar:listAccounts")).toEqual({
      ok: false,
      error: "NotSignedIn",
    });
  });

  it("returns the local account list", async () => {
    const fakeAccounts = [
      {
        id: "a1",
        provider: "google",
        email: "a@x.com",
        external_account_id: "g1",
        status: "connected",
      },
    ];
    localStoreMocks.list.mockReturnValue(fakeAccounts);
    setup({ apiClient: noopClient });
    expect(await call("calendar:listAccounts")).toEqual({
      ok: true,
      accounts: fakeAccounts,
    });
  });
});

describe("calendar:connectGoogle / connectMicrosoft auth gating", () => {
  it("connectGoogle returns not_signed_in when no user", async () => {
    hoisted.state.signedIn = false;
    const connectGoogle = vi.fn();
    setup({ apiClient: noopClient, connectGoogle });
    expect(await call("calendar:connectGoogle")).toEqual({
      ok: false,
      error: "not_signed_in",
    });
    expect(connectGoogle).not.toHaveBeenCalled();
  });

  it("connectMicrosoft returns not_signed_in when no user", async () => {
    hoisted.state.signedIn = false;
    const connectMicrosoft = vi.fn();
    setup({ apiClient: noopClient, connectMicrosoft });
    expect(await call("calendar:connectMicrosoft")).toEqual({
      ok: false,
      error: "not_signed_in",
    });
    expect(connectMicrosoft).not.toHaveBeenCalled();
  });
});

describe("status event broadcast", () => {
  it("forwards calendarStatusEvents.notify to BrowserWindow.webContents", async () => {
    setup({ apiClient: noopClient });
    calendarStatusEvents.notify({ accountId: "x", status: "reauth_required" });
    expect(broadcastedEvents).toEqual([
      {
        channel: "calendar:account-status-changed",
        payload: { accountId: "x", status: "reauth_required" },
      },
    ]);
  });
});
