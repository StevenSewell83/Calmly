import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../net/client";

// secretStore + localStore are Electron / sqlite-coupled. Mock them.
const secretCalls: { key: string; value?: string }[] = [];

vi.mock("../../security/secretStore", () => ({
  secretStore: {
    set: vi.fn((key: string, value: string) => {
      secretCalls.push({ key, value });
    }),
    get: vi.fn(() => null),
    has: vi.fn(() => false),
    delete: vi.fn(),
  },
}));

vi.mock("../localStore", () => ({
  upsertLocalCalendarAccount: vi.fn((args: unknown) => args),
  listLocalCalendarAccounts: vi.fn(() => []),
}));

import { createConnectMicrosoft } from "../microsoftOAuth";

function makeClient(
  impl: (
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<{ status: number; body: unknown }>,
): ApiClient {
  return { request: vi.fn(impl) as unknown as ApiClient["request"] };
}

beforeEach(() => {
  secretCalls.length = 0;
});

const successAccount = {
  id: "ms-acct-uuid-1",
  provider: "microsoft" as const,
  external_account_id: "ms-graph-id-1",
  email: "alex@contoso.com",
  status: "connected" as const,
};

describe("createConnectMicrosoft", () => {
  it("happy path: opens browser, redeems ticket, persists refresh under microsoft key", async () => {
    let deepLinkHandler:
      | ((p: { provider: "google" | "microsoft"; ticket: string }) => void)
      | null = null;
    const openExternal = vi.fn(async (_url: string) => {
      setImmediate(() =>
        deepLinkHandler?.({ provider: "microsoft", ticket: "ms.tick" }),
      );
    });

    const client = makeClient(async (_m, path, body) => {
      expect(path).toBe("/oauth/microsoft/redeem");
      expect(body).toEqual({ ticket: "ms.tick" });
      return {
        status: 200,
        body: {
          ok: true,
          account: successAccount,
          refresh_token: "rt-ms",
          access_token: "at-ms",
          expires_in: 3599,
        },
      };
    });

    const connect = createConnectMicrosoft({
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

    expect(openExternal).toHaveBeenCalledWith(
      "https://api.example.com/oauth/microsoft/start",
    );
    expect(secretCalls).toEqual([
      { key: "calendar.microsoft.refresh_token:ms-acct-uuid-1", value: "rt-ms" },
    ]);
  });

  it("ignores google deep-link payloads while waiting for microsoft", async () => {
    let deepLinkHandler:
      | ((p: { provider: "google" | "microsoft"; ticket: string }) => void)
      | null = null;
    const openExternal = vi.fn(async () => {
      setImmediate(() => {
        deepLinkHandler?.({ provider: "google", ticket: "wrong" });
        setImmediate(() =>
          deepLinkHandler?.({ provider: "microsoft", ticket: "right" }),
        );
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

    const connect = createConnectMicrosoft({
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
    if (r.ok) expect(r.account.provider).toBe("microsoft");
  });
});
