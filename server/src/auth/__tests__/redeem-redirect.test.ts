import type pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app";
import { loadConfig } from "../../config";
import { generateToken } from "../tokens";

// Unit-level coverage for the browser-vs-programmatic branch in GET
// /auth/magic-link/redeem. Deliberately DB-free (unlike
// magic-link.integration.test.ts, which needs a real Postgres via
// testcontainers): the browser-redirect branch never touches app.pool, and
// the programmatic branch only needs to observe that it *did* reach the
// pool, not what the DB actually returns. A mock pool lets both be asserted
// without Docker.
function buildMockPool(): { pool: pg.Pool; query: ReturnType<typeof vi.fn> } {
  // Call 1 (if reached) is the rate-limit count query; call 2 is the
  // token-consume UPDATE...RETURNING. Returning an empty row-set from call 2
  // makes redeemMagicLink report "token_invalid_or_expired" (410) — a
  // deterministic, DB-free stand-in for "the redeem path actually ran."
  let calls = 0;
  const query = vi.fn(async () => {
    calls += 1;
    if (calls === 1) return { rows: [{ count: "0" }] };
    return { rows: [] };
  });
  return { pool: { query } as unknown as pg.Pool, query };
}

async function buildTestApp(pool: pg.Pool) {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgres://unused/unused",
    COOKIE_SECRET: "test-cookie-secret-for-vitest-32chars",
    APP_URL: "http://localhost:3001",
  });
  const app = await buildApp({ config, pool });
  await app.ready();
  return app;
}

describe("GET /auth/magic-link/redeem — browser vs. programmatic branch", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("browser navigation (Accept: text/html) 302s to the calmly:// deep link without touching the DB", async () => {
    const { pool, query } = buildMockPool();
    app = await buildTestApp(pool);
    const raw = generateToken();

    const res = await app.inject({
      method: "GET",
      url: `/auth/magic-link/redeem?token=${encodeURIComponent(raw)}`,
      headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(
      `calmly://auth/callback?token=${encodeURIComponent(raw)}`,
    );
    expect(res.headers["set-cookie"]).toBeUndefined();
    // The whole point of the redirect is to leave the single-use token
    // unconsumed for the desktop app's own POST redeem — assert no DB call
    // was made at all.
    expect(query).not.toHaveBeenCalled();
  });

  it("programmatic client (Accept: application/json) redeems here and never redirects", async () => {
    const { pool, query } = buildMockPool();
    app = await buildTestApp(pool);
    const raw = generateToken();

    const res = await app.inject({
      method: "GET",
      url: `/auth/magic-link/redeem?token=${encodeURIComponent(raw)}`,
      headers: { accept: "application/json" },
    });

    expect(res.statusCode).not.toBe(302);
    expect(res.statusCode).toBe(410); // mock pool reports "not found"
    expect(res.json()).toMatchObject({ error: "token_invalid_or_expired" });
    expect(query).toHaveBeenCalled();
  });

  it("no Accept header at all falls back to the programmatic (JSON) branch", async () => {
    const { pool, query } = buildMockPool();
    app = await buildTestApp(pool);
    const raw = generateToken();

    const res = await app.inject({
      method: "GET",
      url: `/auth/magic-link/redeem?token=${encodeURIComponent(raw)}`,
    });

    expect(res.statusCode).toBe(410);
    expect(query).toHaveBeenCalled();
  });

  it("X-Requested-With wins over an Accept: text/html header — stays JSON", async () => {
    const { pool, query } = buildMockPool();
    app = await buildTestApp(pool);
    const raw = generateToken();

    const res = await app.inject({
      method: "GET",
      url: `/auth/magic-link/redeem?token=${encodeURIComponent(raw)}`,
      headers: {
        accept: "text/html",
        "x-requested-with": "XMLHttpRequest",
      },
    });

    expect(res.statusCode).toBe(410);
    expect(res.headers.location).toBeUndefined();
    expect(query).toHaveBeenCalled();
  });

  it("malformed token still 400s before either branch touches the DB, even for a browser Accept header", async () => {
    const { pool, query } = buildMockPool();
    app = await buildTestApp(pool);

    const res = await app.inject({
      method: "GET",
      url: "/auth/magic-link/redeem?token=not-well-formed",
      headers: { accept: "text/html" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_request" });
    expect(query).not.toHaveBeenCalled();
  });

  it("missing token query param 400s for a browser Accept header too", async () => {
    const { pool, query } = buildMockPool();
    app = await buildTestApp(pool);

    const res = await app.inject({
      method: "GET",
      url: "/auth/magic-link/redeem",
      headers: { accept: "text/html" },
    });

    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
});
