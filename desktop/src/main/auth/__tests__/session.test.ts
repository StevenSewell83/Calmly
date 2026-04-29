import { describe, expect, it, vi } from "vitest";
import {
  ApiHttpError,
  ApiNetworkError,
  type ApiClient,
} from "../../net/client";
import {
  createAuthOrchestrator,
  isPlausibleEmail,
  isWellFormedToken,
} from "../session";

function makeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    request: vi.fn(async () => ({ status: 200, body: {} })),
    ...overrides,
  } as ApiClient;
}

const VALID_TOKEN = "a".repeat(32) + "_-_AB"; // 37 chars, base64url-safe

describe("isPlausibleEmail", () => {
  it("accepts well-formed addresses", () => {
    expect(isPlausibleEmail("alex@example.com")).toBe(true);
    expect(isPlausibleEmail("  alex@example.com  ")).toBe(true);
  });

  it("rejects malformed inputs", () => {
    expect(isPlausibleEmail("alex")).toBe(false);
    expect(isPlausibleEmail("@example.com")).toBe(false);
    expect(isPlausibleEmail("alex@")).toBe(false);
    expect(isPlausibleEmail("alex@example")).toBe(false);
    expect(isPlausibleEmail("")).toBe(false);
    expect(isPlausibleEmail(null)).toBe(false);
    expect(isPlausibleEmail(undefined)).toBe(false);
  });

  it("rejects addresses longer than 254 characters", () => {
    const huge = `${"a".repeat(250)}@b.test`;
    expect(isPlausibleEmail(huge)).toBe(false);
  });
});

describe("isWellFormedToken", () => {
  it("accepts 32–128 base64url chars", () => {
    expect(isWellFormedToken("a".repeat(32))).toBe(true);
    expect(isWellFormedToken("a".repeat(128))).toBe(true);
    expect(isWellFormedToken(VALID_TOKEN)).toBe(true);
  });

  it("rejects too short / too long / invalid chars", () => {
    expect(isWellFormedToken("a".repeat(31))).toBe(false);
    expect(isWellFormedToken("a".repeat(129))).toBe(false);
    expect(isWellFormedToken("a".repeat(32) + "+")).toBe(false);
    expect(isWellFormedToken("a".repeat(32) + " ")).toBe(false);
    expect(isWellFormedToken(null)).toBe(false);
  });
});

describe("createAuthOrchestrator.requestLink", () => {
  it("returns invalid_email without calling the network for malformed input", async () => {
    const client = makeClient();
    const o = createAuthOrchestrator({ client });
    const r = await o.requestLink("not-an-email");
    expect(r).toEqual({ ok: false, error: "invalid_email" });
    expect(client.request).not.toHaveBeenCalled();
  });

  it("posts trimmed email to /auth/magic-link/request and returns ok on 200", async () => {
    const requestFn = vi.fn(async () => ({ status: 200, body: { ok: true } }));
    const o = createAuthOrchestrator({
      client: { request: requestFn as unknown as ApiClient["request"] },
    });
    const r = await o.requestLink("  alex@example.com  ");
    expect(r).toEqual({ ok: true });
    expect(requestFn).toHaveBeenCalledWith("POST", "/auth/magic-link/request", {
      email: "alex@example.com",
    });
  });

  it("maps 429 to rate_limited", async () => {
    const requestFn = vi.fn(async () => {
      throw new ApiHttpError("rate_limited", 429, {
        error: "rate_limited",
        reason: "ip",
      });
    });
    const o = createAuthOrchestrator({
      client: { request: requestFn as unknown as ApiClient["request"] },
    });
    const r = await o.requestLink("alex@example.com");
    expect(r).toEqual({ ok: false, error: "rate_limited" });
  });

  it("maps 400 to invalid_email", async () => {
    const requestFn = vi.fn(async () => {
      throw new ApiHttpError("bad", 400, { error: "invalid_request" });
    });
    const o = createAuthOrchestrator({
      client: { request: requestFn as unknown as ApiClient["request"] },
    });
    const r = await o.requestLink("alex@example.com");
    expect(r).toEqual({ ok: false, error: "invalid_email" });
  });

  it("maps network errors to network", async () => {
    const requestFn = vi.fn(async () => {
      throw new ApiNetworkError("offline");
    });
    const o = createAuthOrchestrator({
      client: { request: requestFn as unknown as ApiClient["request"] },
    });
    const r = await o.requestLink("alex@example.com");
    expect(r).toEqual({ ok: false, error: "network" });
  });

  it("maps other 5xx to server", async () => {
    const requestFn = vi.fn(async () => {
      throw new ApiHttpError("boom", 500, null);
    });
    const o = createAuthOrchestrator({
      client: { request: requestFn as unknown as ApiClient["request"] },
    });
    const r = await o.requestLink("alex@example.com");
    expect(r).toEqual({ ok: false, error: "server" });
  });
});

describe("createAuthOrchestrator.redeem", () => {
  it("rejects malformed token without calling the network", async () => {
    const client = makeClient();
    const o = createAuthOrchestrator({ client });
    const r = await o.redeem("nope");
    expect(r).toEqual({ ok: false, error: "invalid_request" });
    expect(client.request).not.toHaveBeenCalled();
  });

  it("returns parsed user + expiresAt on success", async () => {
    const requestFn = vi.fn(async () => ({
      status: 200,
      body: {
        user: { id: "u-1", email: "alex@example.com" },
        session: { expiresAt: "2026-05-30T00:00:00.000Z" },
      },
    }));
    const o = createAuthOrchestrator({
      client: { request: requestFn as unknown as ApiClient["request"] },
    });
    const r = await o.redeem(VALID_TOKEN);
    expect(r).toEqual({
      ok: true,
      user: { id: "u-1", email: "alex@example.com" },
      expiresAt: "2026-05-30T00:00:00.000Z",
    });
    expect(requestFn).toHaveBeenCalledWith("POST", "/auth/magic-link/redeem", {
      token: VALID_TOKEN,
    });
  });

  it("maps 410 to invalid_or_expired", async () => {
    const requestFn = vi.fn(async () => {
      throw new ApiHttpError("gone", 410, {
        error: "token_invalid_or_expired",
      });
    });
    const o = createAuthOrchestrator({
      client: { request: requestFn as unknown as ApiClient["request"] },
    });
    const r = await o.redeem(VALID_TOKEN);
    expect(r).toEqual({ ok: false, error: "invalid_or_expired" });
  });

  it("maps network errors to network", async () => {
    const requestFn = vi.fn(async () => {
      throw new ApiNetworkError("offline");
    });
    const o = createAuthOrchestrator({
      client: { request: requestFn as unknown as ApiClient["request"] },
    });
    const r = await o.redeem(VALID_TOKEN);
    expect(r).toEqual({ ok: false, error: "network" });
  });
});

describe("createAuthOrchestrator.status", () => {
  it("returns signedIn=true with user on 200", async () => {
    const requestFn = vi.fn(async () => ({
      status: 200,
      body: { user: { id: "u-1", email: "alex@example.com" } },
    }));
    const o = createAuthOrchestrator({
      client: { request: requestFn as unknown as ApiClient["request"] },
    });
    const r = await o.status();
    expect(r).toEqual({
      signedIn: true,
      user: { id: "u-1", email: "alex@example.com" },
    });
    expect(requestFn).toHaveBeenCalledWith("GET", "/auth/me");
  });

  it("returns signedIn=false on 401", async () => {
    const requestFn = vi.fn(async () => {
      throw new ApiHttpError("unauthorized", 401, {});
    });
    const o = createAuthOrchestrator({
      client: { request: requestFn as unknown as ApiClient["request"] },
    });
    const r = await o.status();
    expect(r).toEqual({ signedIn: false });
  });

  it("returns signedIn=false on network error (offline-first)", async () => {
    const requestFn = vi.fn(async () => {
      throw new ApiNetworkError("offline");
    });
    const o = createAuthOrchestrator({
      client: { request: requestFn as unknown as ApiClient["request"] },
    });
    const r = await o.status();
    expect(r).toEqual({ signedIn: false });
  });
});

describe("createAuthOrchestrator.signOut", () => {
  it("returns ok=true even when network call fails (best-effort)", async () => {
    const requestFn = vi.fn(async () => {
      throw new ApiNetworkError("offline");
    });
    const o = createAuthOrchestrator({
      client: { request: requestFn as unknown as ApiClient["request"] },
    });
    const r = await o.signOut();
    expect(r).toEqual({ ok: true });
    expect(requestFn).toHaveBeenCalledWith("POST", "/auth/logout");
  });

  it("returns ok=true on 200", async () => {
    const requestFn = vi.fn(async () => ({ status: 200, body: { ok: true } }));
    const o = createAuthOrchestrator({
      client: { request: requestFn as unknown as ApiClient["request"] },
    });
    const r = await o.signOut();
    expect(r).toEqual({ ok: true });
  });
});
