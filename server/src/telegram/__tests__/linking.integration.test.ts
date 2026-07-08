// TG-02b: Integration tests for Telegram linking HTTP routes + /start handler.
//
// Requires a Docker-accessible PostgreSQL container (via testcontainers).
// Skipped automatically when no Docker daemon is available.
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { runner as runMigrations } from "node-pg-migrate";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app";
import { loadConfig } from "../../config";
import { generateToken, hashToken } from "../../auth/tokens";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "../../../migrations");

async function detectDockerRuntime(): Promise<boolean> {
  try {
    const mod = (await import(
      "testcontainers/build/container-runtime/clients/client.js"
    )) as unknown as { getContainerRuntimeClient: () => Promise<unknown> };
    await mod.getContainerRuntimeClient();
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = await detectDockerRuntime();

// Mock grammy Bot so /start dispatch doesn't try to call Telegram API.
vi.mock("../bot", () => ({
  getBot: () => ({ api: { sendMessage: vi.fn().mockResolvedValue({}) } }),
  initBot: vi.fn(),
}));

describe.skipIf(!dockerAvailable)(
  "telegram linking routes — DB integration",
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

    async function makeSession(userId: string): Promise<string> {
      const raw = generateToken();
      await pool.query(
        `INSERT INTO sessions (token_hash, user_id, expires_at)
         VALUES ($1, $2, now() + interval '30 days')`,
        [hashToken(raw), userId],
      );
      return raw;
    }

    it("unauthenticated /code → 401", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/telegram/linking/code",
      });
      expect(res.statusCode).toBe(401);
    });

    it("unauthenticated /status → 401", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/telegram/linking/status",
      });
      expect(res.statusCode).toBe(401);
    });

    it("unauthenticated /unlink → 401", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/telegram/linking/unlink",
      });
      expect(res.statusCode).toBe(401);
    });

    it("happy path: generate code → status unlinked → redeem via /start → status linked → unlink", async () => {
      const userId = await ensureUser("tg-happy@example.com");
      const token = await makeSession(userId);
      const cookieName = app.appConfig.COOKIE_NAME;
      const cookieHeader = `${cookieName}=${token}`;

      // 1. Generate a linking code.
      const codeRes = await app.inject({
        method: "POST",
        url: "/telegram/linking/code",
        headers: { cookie: cookieHeader },
      });
      expect(codeRes.statusCode).toBe(200);
      const { code, expiresAt } = codeRes.json<{
        code: string;
        expiresAt: number;
      }>();
      expect(code).toMatch(/^[A-Z0-9]{8}$/);
      expect(expiresAt).toBeGreaterThan(Date.now());

      // 2. Status is unlinked before redemption.
      const statusBefore = await app.inject({
        method: "GET",
        url: "/telegram/linking/status",
        headers: { cookie: cookieHeader },
      });
      expect(statusBefore.statusCode).toBe(200);
      expect(statusBefore.json()).toMatchObject({ linked: false });

      // 3. Redeem code directly via the linking service (simulates /start handler).
      const { redeemLinkingCode } = await import("../linking");
      const redeemResult = await redeemLinkingCode(
        pool,
        code,
        "123456789",
        "testuser",
        Date.now(),
      );
      expect(redeemResult.ok).toBe(true);

      // 4. Status is now linked.
      const statusAfter = await app.inject({
        method: "GET",
        url: "/telegram/linking/status",
        headers: { cookie: cookieHeader },
      });
      expect(statusAfter.statusCode).toBe(200);
      expect(statusAfter.json()).toMatchObject({
        linked: true,
        chatId: "123456789",
      });

      // 5. Unlink.
      const unlinkRes = await app.inject({
        method: "POST",
        url: "/telegram/linking/unlink",
        headers: { cookie: cookieHeader },
      });
      expect(unlinkRes.statusCode).toBe(200);
      expect(unlinkRes.json()).toMatchObject({ ok: true });

      // 6. Status is unlinked again.
      const statusFinal = await app.inject({
        method: "GET",
        url: "/telegram/linking/status",
        headers: { cookie: cookieHeader },
      });
      expect(statusFinal.json()).toMatchObject({ linked: false });
    });

    it("rate-limits after 5 codes", async () => {
      const userId = await ensureUser("tg-ratelimit@example.com");
      const token = await makeSession(userId);
      const cookieName = app.appConfig.COOKIE_NAME;
      const cookieHeader = `${cookieName}=${token}`;

      // Generate 5 codes (max allowed active).
      for (let i = 0; i < 5; i++) {
        const r = await app.inject({
          method: "POST",
          url: "/telegram/linking/code",
          headers: { cookie: cookieHeader },
        });
        expect(r.statusCode).toBe(200);
      }

      // 6th should be rate-limited.
      const r6 = await app.inject({
        method: "POST",
        url: "/telegram/linking/code",
        headers: { cookie: cookieHeader },
      });
      expect(r6.statusCode).toBe(429);
      expect(r6.json()).toMatchObject({ error: "rate_limited" });
    });
  },
);
