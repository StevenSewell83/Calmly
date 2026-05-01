import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../net/client";
import { ApiHttpError, ApiNetworkError } from "../../net/client";

// secretStore depends on the Electron-coupled safeStorage + sqlite. Replace
// with a thin in-test mock so the orchestration logic is exercised in
// isolation.
const secretCalls: { key: string; value?: string }[] = [];
let secretStoreShouldThrow = false;

vi.mock("../../security/secretStore", () => ({
  secretStore: {
    set: vi.fn((key: string, value: string) => {
      if (secretStoreShouldThrow) throw new Error("encryption unavailable");
      secretCalls.push({ key, value });
    }),
    get: vi.fn(() => null),
    has: vi.fn(() => false),
    delete: vi.fn(),
  },
}));

const mirrorCalls: unknown[] = [];

vi.mock("../localStore", () => ({
  upsertLocalCalendarAccount: vi.fn((args: unknown) => {
    mirrorCalls.push(args);
    return args;
  }),
  listLocalCalendarAccounts: vi.fn(() => []),
}));

import { createConnectGoogle } from "../googleOAuth";

function makeClient(
  impl: (
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<{ status: number; body: unknown }>,
): ApiClient {
  return {
    request: vi.fn(impl) as unknown as ApiClient["request"],
  };
}

beforeEach(() => {
  secretCalls.length = 0;
  mirrorCalls.length = 0;
  secretStoreShouldThrow = false;
});

const successAccount = {
  id: "acct-uuid-1",
  provider: "google" as const,
  external_account_id: "google-sub-1",
  email: "alex@example.com",
  status: "connected" as const,
};

describe("createConnectGoogle", () => {
  it("happy path: opens browser, redeems ticket, persists refresh, mirrors row", async () => {
    let deepLinkHandler: ((p: { provider: "google" | "microsoft"; ticket: string }) => void) | null = null;
    const openExternal = vi.fn(async (_url: string) => {
      // Simulate the user finishing OAuth and the OS firing a deep-link.
      setImmediate(() => deepLinkHandler?.({ provider: "google", ticket: "abc.def" }));
    });

    const client = makeClient(async (_m, path, body) => {
      expect(path).toBe("/oauth/google/redeem");
      expect(body).toEqual({ ticket: "abc.def" });
      return {
        status: 200,
        body: {
          ok: true,
          account: successAccount,
          refresh_token: "rt-xxx",
          access_token: "at-xxx",
          expires_in: 3599,
        },
      };
    });

    const connect = createConnectGoogle({
      apiBaseUrl: "https://api.example.com",
      apiClient: client,
      openExternal,
      subscribeDeepLink: (h) => {
        deepLinkHandler = h;
        return () => {
          deepLinkHandler = null;
        };
      },
      timeoutMs: 5_000,
    });

    const r = await connect();
    expect(r).toEqual({ ok: true, account: successAccount });

    // Browser opened to the right URL.
    expect(openExternal).toHaveBeenCalledWith(
      "https://api.example.com/oauth/google/start",
    );
    // Refresh token persisted under the contracted F-12 key.
    expect(secretCalls).toEqual([
      { key: "calendar.google.refresh_token:acct-uuid-1", value: "rt-xxx" },
    ]);
    // Local mirror row was upserted.
    expect(mirrorCalls).toHaveLength(1);
  });

  it("ignores microsoft deep-link payloads while waiting for google", async () => {
    let deepLinkHandler: ((p: { provider: "google" | "microsoft"; ticket: string }) => void) | null = null;
    const openExternal = vi.fn(async () => {
      setImmediate(() => {
        deepLinkHandler?.({ provider: "microsoft", ticket: "wrong" });
        setImmediate(() => deepLinkHandler?.({ provider: "google", ticket: "right.sig" }));
      });
    });

    const client = makeClient(async () => ({
      status: 200,
      body: {
        ok: true,
        account: successAccount,
        refresh_token: "rt",
        access_token: "at",
        expires_in: 3599,
      },
    }));

    const connect = createConnectGoogle({
      apiBaseUrl: "https://api.example.com",
      apiClient: client,
      openExternal,
      subscribeDeepLink: (h) => {
        deepLinkHandler = h;
        return () => {};
      },
      timeoutMs: 5_000,
    });

    const r = await connect();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.account.provider).toBe("google");
    }
  });

  it("times out cleanly when no deep-link arrives", async () => {
    const openExternal = vi.fn(async () => {
      // never deliver a deep-link
    });
    const client = makeClient(async () => ({ status: 200, body: {} }));

    let scheduledCb: (() => void) | null = null;
    const schedule = (cb: () => void): (() => void) => {
      scheduledCb = cb;
      return () => {};
    };

    const connect = createConnectGoogle({
      apiBaseUrl: "https://api.example.com",
      apiClient: client,
      openExternal,
      subscribeDeepLink: () => () => {},
      schedule,
    });

    const promise = connect();
    // Fire the timer synchronously; the promise resolves with deeplink_timeout.
    const fire = scheduledCb as (() => void) | null;
    if (!fire) throw new Error("schedule was never called");
    fire();
    const r = await promise;
    expect(r).toEqual({ ok: false, error: "deeplink_timeout" });
  });

  it("returns browser_open_failed if shell.openExternal throws", async () => {
    const openExternal = vi.fn(async () => {
      throw new Error("user has no default browser");
    });

    const connect = createConnectGoogle({
      apiBaseUrl: "https://api.example.com",
      apiClient: makeClient(async () => ({ status: 200, body: {} })),
      openExternal,
      subscribeDeepLink: () => () => {},
      timeoutMs: 30_000,
    });

    const r = await connect();
    expect(r).toEqual({ ok: false, error: "browser_open_failed" });
  });

  it("maps 401 from /oauth/google/redeem to not_signed_in", async () => {
    let deepLinkHandler: ((p: { provider: "google" | "microsoft"; ticket: string }) => void) | null = null;
    const openExternal = vi.fn(async () => {
      setImmediate(() => deepLinkHandler?.({ provider: "google", ticket: "t" }));
    });
    const client = makeClient(async () => {
      throw new ApiHttpError("redeem failed", 401, { error: "unauthorized" });
    });
    const connect = createConnectGoogle({
      apiBaseUrl: "https://api.example.com",
      apiClient: client,
      openExternal,
      subscribeDeepLink: (h) => {
        deepLinkHandler = h;
        return () => {};
      },
      timeoutMs: 5_000,
    });
    const r = await connect();
    expect(r).toEqual({ ok: false, error: "not_signed_in" });
  });

  it("maps redeem network errors to redeem_failed", async () => {
    let deepLinkHandler: ((p: { provider: "google" | "microsoft"; ticket: string }) => void) | null = null;
    const openExternal = vi.fn(async () => {
      setImmediate(() => deepLinkHandler?.({ provider: "google", ticket: "t" }));
    });
    const client = makeClient(async () => {
      throw new ApiNetworkError("network down");
    });
    const connect = createConnectGoogle({
      apiBaseUrl: "https://api.example.com",
      apiClient: client,
      openExternal,
      subscribeDeepLink: (h) => {
        deepLinkHandler = h;
        return () => {};
      },
      timeoutMs: 5_000,
    });
    expect(await connect()).toEqual({ ok: false, error: "redeem_failed" });
  });

  it("returns secret_store_failed when secretStore.set throws", async () => {
    secretStoreShouldThrow = true;
    let deepLinkHandler: ((p: { provider: "google" | "microsoft"; ticket: string }) => void) | null = null;
    const openExternal = vi.fn(async () => {
      setImmediate(() => deepLinkHandler?.({ provider: "google", ticket: "t" }));
    });
    const client = makeClient(async () => ({
      status: 200,
      body: {
        ok: true,
        account: successAccount,
        refresh_token: "rt",
        access_token: "at",
        expires_in: 3599,
      },
    }));
    const connect = createConnectGoogle({
      apiBaseUrl: "https://api.example.com",
      apiClient: client,
      openExternal,
      subscribeDeepLink: (h) => {
        deepLinkHandler = h;
        return () => {};
      },
      timeoutMs: 5_000,
    });
    expect(await connect()).toEqual({ ok: false, error: "secret_store_failed" });
  });
});
