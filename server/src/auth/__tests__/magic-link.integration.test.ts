import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { runner as runMigrations } from "node-pg-migrate";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { loadConfig } from "../../config";
import { generateToken, hashToken } from "../tokens";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "../../../migrations");

// Skip the entire suite when no Docker runtime is available (CI without Docker
// or dev boxes without it running). Set DOCKER_HOST or ensure Docker Desktop
// is running to enable these tests.
async function detectDockerRuntime(): Promise<boolean> {
  try {
    // testcontainers internal probe — throws when no daemon found
    const mod = (await import(
      "testcontainers/build/container-runtime/clients/client.js"
    )) as unknown as { getContainerRuntimeClient: () => Promise<unknown> };
    const { getContainerRuntimeClient } = mod;
    await getContainerRuntimeClient();
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = await detectDockerRuntime();

describe.skipIf(!dockerAvailable)(
  "magic-link auth — DB integration",
  () => {
    let pool: pg.Pool;
    let stopContainer: () => Promise<void>;
    let app: Awaited<ReturnType<typeof buildApp>>;

    beforeAll(async () => {
      const container = await new PostgreSqlContainer("postgres:16-alpine")
        .withDatabase("calmly_test")
        .withUsername("calmly_test")
        .withPassword("calmly_test")
        .start();

      const connectionString = container.getConnectionUri();
      stopContainer = () => container.stop().then(() => {});

      await runMigrations({
        databaseUrl: connectionString,
        migrationsTable: "pgmigrations",
        dir: MIGRATIONS_DIR,
        direction: "up",
        log: () => {},
      });

      pool = new pg.Pool({ connectionString });

      const config = loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: connectionString,
        COOKIE_SECRET: "test-cookie-secret-for-vitest-32chars",
        MAGIC_LINK_TTL_MIN: "15",
        SESSION_TTL_DAYS: "30",
        APP_URL: "http://localhost:3001",
      });

      app = await buildApp({ config, pool });
      await app.ready();
    });

    afterAll(async () => {
      await app?.close();
      await pool?.end();
      await stopContainer?.();
    });

    async function ensureUser(email: string): Promise<string> {
      const r = await pool.query<{ id: string }>(
        `INSERT INTO users (email) VALUES ($1)
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING id`,
        [email],
      );
      return r.rows[0]!.id;
    }

    async function insertToken(
      userId: string,
      rawToken: string,
      expiresAt: Date,
    ): Promise<void> {
      await pool.query(
        `INSERT INTO magic_link_tokens (token_hash, user_id, expires_at, requested_ip)
         VALUES ($1, $2, $3, $4)`,
        [hashToken(rawToken), userId, expiresAt, "127.0.0.1"],
      );
    }

    it("happy path: request → redeem → /auth/me → logout → /auth/me 401", async () => {
      const email = "happy@example.com";

      // 1. Request (creates user, inserts token row, sends email via console adapter)
      const reqRes = await app.inject({
        method: "POST",
        url: "/auth/magic-link/request",
        payload: { email },
      });
      expect(reqRes.statusCode).toBe(200);
      expect(reqRes.json()).toMatchObject({ ok: true });

      // Insert a fresh known token for this user so we can control the raw value
      const userId = await ensureUser(email);
      const rawToken = generateToken();
      await insertToken(userId, rawToken, new Date(Date.now() + 15 * 60_000));

      // 2. Redeem
      const redeemRes = await app.inject({
        method: "POST",
        url: "/auth/magic-link/redeem",
        payload: { token: rawToken },
      });
      expect(redeemRes.statusCode).toBe(200);
      expect(redeemRes.json()).toMatchObject({
        user: { email },
        session: { expiresAt: expect.any(String) },
      });

      const rawSetCookie = redeemRes.headers["set-cookie"] as
        | string
        | string[];
      const cookiePart = (
        Array.isArray(rawSetCookie) ? rawSetCookie[0] ?? "" : rawSetCookie
      ).split(";")[0];
      expect(cookiePart).toMatch(/^calmly_session=/);

      const setCookieFull = Array.isArray(rawSetCookie)
        ? rawSetCookie[0]
        : rawSetCookie;
      expect(setCookieFull).toMatch(/HttpOnly/i);
      expect(setCookieFull).toMatch(/SameSite=Lax/i);

      // 3. /auth/me OK
      const meRes = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: { cookie: cookiePart },
      });
      expect(meRes.statusCode).toBe(200);
      expect(meRes.json()).toMatchObject({ user: { email } });

      // 4. Logout
      const logoutRes = await app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: { cookie: cookiePart },
      });
      expect(logoutRes.statusCode).toBe(200);

      // 5. /auth/me returns 401 after logout
      const meAfter = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: { cookie: cookiePart },
      });
      expect(meAfter.statusCode).toBe(401);
    });

    it("token expiry: redeem after expires_at returns 410", async () => {
      const userId = await ensureUser("expiry@example.com");
      const rawToken = generateToken();
      // Insert already-expired token
      await pool.query(
        `INSERT INTO magic_link_tokens (token_hash, user_id, expires_at, requested_ip)
         VALUES ($1, $2, now() - interval '1 second', $3)`,
        [hashToken(rawToken), userId, "127.0.0.1"],
      );

      const res = await app.inject({
        method: "POST",
        url: "/auth/magic-link/redeem",
        payload: { token: rawToken },
      });
      expect(res.statusCode).toBe(410);
    });

    it("idempotent redeem: second redeem of same token returns 410", async () => {
      const userId = await ensureUser("idempotent@example.com");
      const rawToken = generateToken();
      await insertToken(userId, rawToken, new Date(Date.now() + 15 * 60_000));

      const first = await app.inject({
        method: "POST",
        url: "/auth/magic-link/redeem",
        payload: { token: rawToken },
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: "POST",
        url: "/auth/magic-link/redeem",
        payload: { token: rawToken },
      });
      expect(second.statusCode).toBe(410);
    });

    it("rate-limit: 6th request within an hour returns 429", async () => {
      const email = "ratelimit@example.com";
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/auth/magic-link/request",
          payload: { email },
        });
        expect(res.statusCode).toBe(200);
      }
      const res = await app.inject({
        method: "POST",
        url: "/auth/magic-link/request",
        payload: { email },
      });
      expect(res.statusCode).toBe(429);
    });

    it("token plaintext never stored in DB (only sha256 hash)", async () => {
      const userId = await ensureUser("hashcheck@example.com");
      const rawToken = generateToken();
      const hash = hashToken(rawToken);
      await insertToken(userId, rawToken, new Date(Date.now() + 15 * 60_000));

      const rows = await pool.query<Record<string, string>>(
        `SELECT token_hash, user_id::text, requested_ip
           FROM magic_link_tokens WHERE token_hash = $1`,
        [hash],
      );
      expect(rows.rows).toHaveLength(1);
      const row = rows.rows[0]!;
      for (const [col, val] of Object.entries(row)) {
        expect(val, `column ${col} must not contain raw token`).not.toBe(
          rawToken,
        );
      }
      expect(row.token_hash).toBe(hash);
    });

    it("cookie flags: HttpOnly, SameSite=Lax; Secure absent in non-prod", async () => {
      const userId = await ensureUser("cookieflags@example.com");
      const rawToken = generateToken();
      await insertToken(userId, rawToken, new Date(Date.now() + 15 * 60_000));

      const res = await app.inject({
        method: "POST",
        url: "/auth/magic-link/redeem",
        payload: { token: rawToken },
      });
      expect(res.statusCode).toBe(200);

      const raw = res.headers["set-cookie"] as string | string[];
      const cookieStr = Array.isArray(raw) ? raw.join("; ") : raw;
      expect(cookieStr).toMatch(/HttpOnly/i);
      expect(cookieStr).toMatch(/SameSite=Lax/i);
      // NODE_ENV=test is not "production" so Secure must be absent
      expect(cookieStr).not.toMatch(/;\s*Secure(?!=)/i);
    });

    it("GET /auth/magic-link/redeem — happy path creates session", async () => {
      const userId = await ensureUser("get-redeem@example.com");
      const rawToken = generateToken();
      await insertToken(userId, rawToken, new Date(Date.now() + 15 * 60_000));

      const res = await app.inject({
        method: "GET",
        url: `/auth/magic-link/redeem?token=${encodeURIComponent(rawToken)}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ user: expect.any(Object), session: { expiresAt: expect.any(String) } });
      const setCookie = res.headers["set-cookie"];
      const cookieStr = Array.isArray(setCookie) ? setCookie[0] ?? "" : (setCookie ?? "");
      expect(cookieStr).toMatch(/^calmly_session=/);
    });

    it("GET /auth/magic-link/redeem — browser Accept header 302s to the calmly:// deep link and leaves the token unconsumed", async () => {
      const userId = await ensureUser("browser-redeem@example.com");
      const rawToken = generateToken();
      await insertToken(userId, rawToken, new Date(Date.now() + 15 * 60_000));

      const res = await app.inject({
        method: "GET",
        url: `/auth/magic-link/redeem?token=${encodeURIComponent(rawToken)}`,
        headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(
        `calmly://auth/callback?token=${encodeURIComponent(rawToken)}`,
      );
      expect(res.headers["set-cookie"]).toBeUndefined();

      // The redirect must not have consumed the token — the desktop app's
      // own POST redeem (what its deeplink handler does next) must still
      // succeed exactly once.
      const postRes = await app.inject({
        method: "POST",
        url: "/auth/magic-link/redeem",
        payload: { token: rawToken },
      });
      expect(postRes.statusCode).toBe(200);
      expect(postRes.json()).toMatchObject({ user: { email: "browser-redeem@example.com" } });

      const secondPostRes = await app.inject({
        method: "POST",
        url: "/auth/magic-link/redeem",
        payload: { token: rawToken },
      });
      expect(secondPostRes.statusCode).toBe(410);
    });

    it("GET /auth/magic-link/redeem — application/json Accept header redeems in place (no redirect)", async () => {
      const userId = await ensureUser("json-redeem@example.com");
      const rawToken = generateToken();
      await insertToken(userId, rawToken, new Date(Date.now() + 15 * 60_000));

      const res = await app.inject({
        method: "GET",
        url: `/auth/magic-link/redeem?token=${encodeURIComponent(rawToken)}`,
        headers: { accept: "application/json" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers.location).toBeUndefined();
      expect(res.json()).toMatchObject({ user: { email: "json-redeem@example.com" } });
      const setCookie = res.headers["set-cookie"];
      const cookieStr = Array.isArray(setCookie) ? setCookie[0] ?? "" : (setCookie ?? "");
      expect(cookieStr).toMatch(/^calmly_session=/);
    });

    // Both redeem endpoints must enforce IP-based rate limiting via the shared
    // redeemMagicLink helper. Pre-seeding 20 token-request rows for the test IP
    // fills the perIpPerHour bucket (default=20); the next redeem → 429.
    it.each(["POST", "GET"] as const)(
      "%s /auth/magic-link/redeem — 429 when IP is over the request rate limit",
      async (method) => {
        const uniqueIp = `10.${method === "POST" ? 1 : 2}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
        const userId = await ensureUser(`ip-rl-${method.toLowerCase()}-${Date.now()}@example.com`);
        const raw = generateToken();
        // Token must exist; the rate-limit fires before the token lookup.
        await pool.query(
          `INSERT INTO magic_link_tokens (token_hash, user_id, expires_at, requested_ip)
           VALUES ($1, $2, now() + interval '15 minutes', $3)`,
          [hashToken(raw), userId, "127.0.0.1"],
        );

        // Fill the IP bucket.
        for (let i = 0; i < 20; i++) {
          await pool.query(
            `INSERT INTO magic_link_tokens (token_hash, user_id, expires_at, requested_ip)
             VALUES ($1, $2, now() + interval '1 hour', $3)`,
            [hashToken(generateToken()), userId, uniqueIp],
          );
        }

        const injectOpts =
          method === "POST"
            ? { method: "POST" as const, url: "/auth/magic-link/redeem", payload: { token: raw }, remoteAddress: uniqueIp }
            : { method: "GET"  as const, url: `/auth/magic-link/redeem?token=${encodeURIComponent(raw)}`, remoteAddress: uniqueIp };

        const res = await app.inject(injectOpts);
        expect(res.statusCode).toBe(429);
        expect(res.json()).toMatchObject({ error: "rate_limited" });
      },
    );
  },
  { timeout: 120_000 },
);
