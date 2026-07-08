import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../net/client";
import { ApiHttpError, ApiNetworkError } from "../../net/client";

// In-test state shared with the mocks below.
const tokenStore = new Map<string, string>();
const localAccounts = new Map<
  string,
  {
    id: string;
    provider: "google" | "microsoft";
    external_account_id: string;
    email: string;
    status: "connected" | "disconnected" | "error" | "reauth_required";
  }
>();

vi.mock("../tokens", () => ({
  calendarTokens: {
    set: vi.fn((provider: string, accountId: string, value: string) => {
      tokenStore.set(`${provider}:${accountId}`, value);
    }),
    get: vi.fn(
      (provider: string, accountId: string) =>
        tokenStore.get(`${provider}:${accountId}`) ?? null,
    ),
    has: vi.fn((provider: string, accountId: string) =>
      tokenStore.has(`${provider}:${accountId}`),
    ),
    delete: vi.fn((provider: string, accountId: string) =>
      tokenStore.delete(`${provider}:${accountId}`),
    ),
  },
}));

vi.mock("../localStore", () => ({
  getLocalCalendarAccount: vi.fn((accountId: string) => {
    return localAccounts.get(accountId) ?? null;
  }),
  markLocalCalendarAccountStatus: vi.fn(
    (
      accountId: string,
      status: "connected" | "disconnected" | "error" | "reauth_required",
    ) => {
      const row = localAccounts.get(accountId);
      if (!row || row.status === status) return false;
      row.status = status;
      return true;
    },
  ),
}));

import { calendarStatusEvents } from "../statusEvents";
import { createCalendarRefresh } from "../refresh";

function makeClient(
  impl: (path: string, body: unknown) => Promise<unknown>,
): ApiClient {
  return {
    request: vi.fn(async (_method: string, path: string, body?: unknown) => ({
      status: 200,
      body: await impl(path, body),
    })) as unknown as ApiClient["request"],
  };
}

beforeEach(() => {
  tokenStore.clear();
  localAccounts.clear();
  calendarStatusEvents.__resetForTests();
});

const ACCT = "acct-uuid-1";
function seedConnected(): void {
  localAccounts.set(ACCT, {
    id: ACCT,
    provider: "google",
    external_account_id: "google-1",
    email: "alex@example.com",
    status: "connected",
  });
  tokenStore.set(`google:${ACCT}`, "rt-original");
}

describe("createCalendarRefresh", () => {
  it("calls the server when no cached token is present", async () => {
    seedConnected();
    const now = 1_000_000;
    const client = makeClient(async (path, body) => {
      expect(path).toBe("/oauth/google/refresh");
      expect(body).toEqual({ account_id: ACCT, refresh_token: "rt-original" });
      return { ok: true, access_token: "at-1", expires_in: 3600 };
    });

    const refresh = createCalendarRefresh({
      apiClient: client,
      now: () => now,
    });
    const r = await refresh.getAccessToken("google", ACCT);
    expect(r).toEqual({
      ok: true,
      accessToken: "at-1",
      expiresAtMs: now + 3600 * 1000,
    });
  });

  it("returns the cached access token while fresh", async () => {
    seedConnected();
    let now = 1_000_000;
    const client = makeClient(async () => ({
      ok: true,
      access_token: "at-1",
      expires_in: 3600,
    }));

    const refresh = createCalendarRefresh({
      apiClient: client,
      now: () => now,
    });
    await refresh.getAccessToken("google", ACCT);
    // Advance well within the safety margin.
    now += 60_000;
    const r = await refresh.getAccessToken("google", ACCT);
    expect(r.ok).toBe(true);
    // Server only called once.
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("refreshes when the cached token is past expiry minus safety margin", async () => {
    seedConnected();
    let now = 1_000_000;
    let issued = 0;
    const client = makeClient(async () => {
      issued += 1;
      return { ok: true, access_token: `at-${issued}`, expires_in: 3600 };
    });

    const refresh = createCalendarRefresh({
      apiClient: client,
      now: () => now,
    });
    const a = await refresh.getAccessToken("google", ACCT);
    expect(a.ok && a.accessToken).toBe("at-1");
    // Jump near expiry — still inside the 30s margin so we should refresh.
    now += 3_600 * 1000 - 10_000;
    const b = await refresh.getAccessToken("google", ACCT);
    expect(b.ok && b.accessToken).toBe("at-2");
    expect(issued).toBe(2);
  });

  it("persists a rotated refresh_token (Microsoft case)", async () => {
    localAccounts.set(ACCT, {
      id: ACCT,
      provider: "microsoft",
      external_account_id: "ms-1",
      email: "alex@contoso.com",
      status: "connected",
    });
    tokenStore.set(`microsoft:${ACCT}`, "rt-original");

    const client = makeClient(async () => ({
      ok: true,
      access_token: "at-1",
      expires_in: 3600,
      refresh_token: "rt-rotated",
    }));
    const refresh = createCalendarRefresh({
      apiClient: client,
      now: () => 1_000_000,
    });
    const r = await refresh.getAccessToken("microsoft", ACCT);
    expect(r.ok).toBe(true);
    expect(tokenStore.get(`microsoft:${ACCT}`)).toBe("rt-rotated");
  });

  it("marks reauth_required and emits status on 410 invalid_grant", async () => {
    seedConnected();
    const events: { accountId: string; status: string }[] = [];
    calendarStatusEvents.subscribe((e) => events.push(e));

    const client: ApiClient = {
      request: vi.fn(async () => {
        throw new ApiHttpError("invalid_grant", 410, {
          error: "invalid_grant",
        });
      }) as unknown as ApiClient["request"],
    };

    const refresh = createCalendarRefresh({
      apiClient: client,
      now: () => 1_000_000,
    });
    const r = await refresh.getAccessToken("google", ACCT);
    expect(r).toEqual({ ok: false, error: "reauth_required" });
    expect(localAccounts.get(ACCT)?.status).toBe("reauth_required");
    expect(events).toEqual([{ accountId: ACCT, status: "reauth_required" }]);
  });

  it("returns transient_failure on 5xx and applies backoff to subsequent calls", async () => {
    seedConnected();
    let now = 1_000_000;
    const client: ApiClient = {
      request: vi.fn(async () => {
        throw new ApiHttpError("server fail", 502, null);
      }) as unknown as ApiClient["request"],
    };

    const refresh = createCalendarRefresh({
      apiClient: client,
      now: () => now,
    });
    const r1 = await refresh.getAccessToken("google", ACCT);
    expect(r1).toEqual({ ok: false, error: "transient_failure" });
    expect(client.request).toHaveBeenCalledTimes(1);

    // Second call within the backoff window must short-circuit (no extra
    // request fired).
    const r2 = await refresh.getAccessToken("google", ACCT);
    expect(r2).toEqual({ ok: false, error: "transient_failure" });
    expect(client.request).toHaveBeenCalledTimes(1);

    // After enough wall-clock has passed, the call retries.
    now += 10 * 60_000;
    await refresh.getAccessToken("google", ACCT);
    expect(client.request).toHaveBeenCalledTimes(2);
  });

  it("escalates to reauth_required after 5 consecutive transient failures", async () => {
    seedConnected();
    let now = 1_000_000;
    const client: ApiClient = {
      request: vi.fn(async () => {
        throw new ApiHttpError("server fail", 502, null);
      }) as unknown as ApiClient["request"],
    };

    const refresh = createCalendarRefresh({
      apiClient: client,
      now: () => now,
    });

    // Fire the first 4 attempts past their backoffs.
    for (let i = 0; i < 4; i++) {
      const r = await refresh.getAccessToken("google", ACCT);
      expect(r).toEqual({ ok: false, error: "transient_failure" });
      now += 10 * 60_000; // hop past any backoff
    }
    // 5th attempt trips the consecutive-failure escalation.
    const last = await refresh.getAccessToken("google", ACCT);
    expect(last).toEqual({ ok: false, error: "reauth_required" });
    expect(localAccounts.get(ACCT)?.status).toBe("reauth_required");
  });

  it("returns no_account when the account row is missing", async () => {
    const client = makeClient(async () => ({
      ok: true,
      access_token: "x",
      expires_in: 3600,
    }));
    const refresh = createCalendarRefresh({
      apiClient: client,
      now: () => 1_000_000,
    });
    const r = await refresh.getAccessToken("google", "missing-id");
    expect(r).toEqual({ ok: false, error: "no_account" });
  });

  it("short-circuits to reauth_required when the local row already says so", async () => {
    seedConnected();
    const account = localAccounts.get(ACCT);
    if (account) account.status = "reauth_required";

    const client: ApiClient = {
      request: vi.fn(async () => ({
        status: 200,
        body: {},
      })) as unknown as ApiClient["request"],
    };
    const refresh = createCalendarRefresh({
      apiClient: client,
      now: () => 1_000_000,
    });
    const r = await refresh.getAccessToken("google", ACCT);
    expect(r).toEqual({ ok: false, error: "reauth_required" });
    expect(client.request).not.toHaveBeenCalled();
  });

  it("flips back to connected after a successful refresh on a previously-errored account", async () => {
    seedConnected();
    const account = localAccounts.get(ACCT);
    if (account) account.status = "error";

    const events: { accountId: string; status: string }[] = [];
    calendarStatusEvents.subscribe((e) => events.push(e));

    const client = makeClient(async () => ({
      ok: true,
      access_token: "at-1",
      expires_in: 3600,
    }));
    const refresh = createCalendarRefresh({
      apiClient: client,
      now: () => 1_000_000,
    });
    const r = await refresh.getAccessToken("google", ACCT);
    expect(r.ok).toBe(true);
    expect(localAccounts.get(ACCT)?.status).toBe("connected");
    expect(events).toEqual([{ accountId: ACCT, status: "connected" }]);
  });

  it("treats network errors as transient_failure", async () => {
    seedConnected();
    const client: ApiClient = {
      request: vi.fn(async () => {
        throw new ApiNetworkError("offline");
      }) as unknown as ApiClient["request"],
    };
    const refresh = createCalendarRefresh({
      apiClient: client,
      now: () => 1_000_000,
    });
    const r = await refresh.getAccessToken("google", ACCT);
    expect(r).toEqual({ ok: false, error: "transient_failure" });
  });
});
