import { describe, expect, it, vi } from "vitest";
import {
  ApiHttpError,
  ApiNetworkError,
  createApiClient,
} from "../client";

function jsonResponse(
  status: number,
  body: unknown,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createApiClient.request", () => {
  it("posts JSON with content-type when body is provided", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { ok: true }),
    ) as unknown as typeof fetch;

    const client = createApiClient({
      baseUrl: "http://api.test",
      fetchImpl,
      sleepImpl: async () => {},
    });

    const r = await client.request("POST", "/auth/magic-link/request", {
      email: "alex@example.com",
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/auth/magic-link/request");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({
      email: "alex@example.com",
    });
  });

  it("omits body + content-type for GET requests", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { user: { id: "u1", email: "a@b.test" } }),
    ) as unknown as typeof fetch;

    const client = createApiClient({
      baseUrl: "http://api.test",
      fetchImpl,
      sleepImpl: async () => {},
    });

    await client.request("GET", "/auth/me");

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
  });

  it("strips trailing slash from baseUrl", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {}),
    ) as unknown as typeof fetch;

    const client = createApiClient({
      baseUrl: "http://api.test/",
      fetchImpl,
      sleepImpl: async () => {},
    });

    await client.request("GET", "/auth/me");
    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/auth/me");
  });

  it("throws ApiHttpError on 4xx with parsed body and does NOT retry", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(429, { error: "rate_limited", reason: "ip" }),
    ) as unknown as typeof fetch;

    const client = createApiClient({
      baseUrl: "http://api.test",
      fetchImpl,
      sleepImpl: async () => {},
      maxRetries: 3,
    });

    let caught: unknown;
    try {
      await client.request("POST", "/auth/magic-link/request", {
        email: "a@b.test",
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiHttpError);
    const err = caught as ApiHttpError;
    expect(err.status).toBe(429);
    expect(err.body).toEqual({ error: "rate_limited", reason: "ip" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries 5xx with backoff up to maxRetries then throws ApiHttpError", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(503, { error: "down" }),
    ) as unknown as typeof fetch;
    const sleepImpl = vi.fn(async () => {});

    const client = createApiClient({
      baseUrl: "http://api.test",
      fetchImpl,
      sleepImpl,
      maxRetries: 2,
    });

    await expect(
      client.request("POST", "/sync/pull", { since: 0 }),
    ).rejects.toBeInstanceOf(ApiHttpError);

    // 1 initial + 2 retries = 3 fetches.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // backoff: attempt=0 → 1000ms, attempt=1 → 2000ms.
    expect(sleepImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenNthCalledWith(1, 1000);
    expect(sleepImpl).toHaveBeenNthCalledWith(2, 2000);
  });

  it("succeeds on retry after a 5xx", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { error: "boom" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { user: { id: "u1", email: "a@b.test" } }),
      ) as unknown as typeof fetch;
    const sleepImpl = vi.fn(async () => {});

    const client = createApiClient({
      baseUrl: "http://api.test",
      fetchImpl,
      sleepImpl,
      maxRetries: 2,
    });

    const r = await client.request<{ user: { id: string; email: string } }>(
      "GET",
      "/auth/me",
    );
    expect(r.status).toBe(200);
    expect(r.body.user.id).toBe("u1");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
  });

  it("throws ApiNetworkError after retries on persistent network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("connection refused");
    }) as unknown as typeof fetch;
    const sleepImpl = vi.fn(async () => {});

    const client = createApiClient({
      baseUrl: "http://api.test",
      fetchImpl,
      sleepImpl,
      maxRetries: 2,
    });

    await expect(
      client.request("POST", "/auth/logout"),
    ).rejects.toBeInstanceOf(ApiNetworkError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleepImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 4xx even when maxRetries is high", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(400, { error: "invalid_request" }),
    ) as unknown as typeof fetch;
    const sleepImpl = vi.fn(async () => {});

    const client = createApiClient({
      baseUrl: "http://api.test",
      fetchImpl,
      sleepImpl,
      maxRetries: 5,
    });

    await expect(
      client.request("POST", "/auth/magic-link/redeem", { token: "x" }),
    ).rejects.toBeInstanceOf(ApiHttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });
});
