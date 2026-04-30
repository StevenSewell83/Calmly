import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { runner as runMigrations } from "node-pg-migrate";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { loadConfig } from "../../config";
import { generateToken, hashToken } from "../../auth/tokens";
import type { PullResponse, PushResponse } from "@calmly/shared";

// F-11c: Multi-client sync protocol integration test.
//
// Proves the LWW sync contract at the HTTP layer without Electron:
//   - Two "clients" (independent sessions for the same user) push and pull
//     via the real Fastify app backed by an ephemeral Postgres.
//   - Write-offline → reconnect: client A pushes a task op; client B pulls
//     and receives it.
//   - Soft-delete round-trip: client B pushes a delete; client A pulls and
//     the record shows deleted_at set.
//   - Idempotent pull: re-pulling at the same since-version yields no new
//     records (version ceiling doesn't move).

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

describe.skipIf(!dockerAvailable)(
  "sync protocol — multi-client integration",
  () => {
    let pool: pg.Pool;
    let stopContainer: () => Promise<void>;
    let app: Awaited<ReturnType<typeof buildApp>>;

    // Session cookies for two independent "client" sessions on the same user.
    let cookieA: string;
    let cookieB: string;

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

      // Create one user and two independent sessions (simulating two clients).
      const email = "sync-test@calmly.test";
      const userRow = await pool.query<{ id: string }>(
        `INSERT INTO users (email) VALUES ($1)
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING id`,
        [email],
      );
      const userId = userRow.rows[0]!.id;

      // Session A
      const rawA = generateToken();
      await pool.query(
        `INSERT INTO magic_link_tokens (token_hash, user_id, expires_at, requested_ip)
         VALUES ($1, $2, now() + interval '5 minutes', '127.0.0.1')`,
        [hashToken(rawA), userId],
      );
      const redeemA = await app.inject({
        method: "POST",
        url: "/auth/magic-link/redeem",
        payload: { token: rawA },
      });
      expect(redeemA.statusCode).toBe(200);
      cookieA = extractSessionCookie(redeemA.headers["set-cookie"]);

      // Session B — same user, independent cookie
      const rawB = generateToken();
      await pool.query(
        `INSERT INTO magic_link_tokens (token_hash, user_id, expires_at, requested_ip)
         VALUES ($1, $2, now() + interval '5 minutes', '127.0.0.1')`,
        [hashToken(rawB), userId],
      );
      const redeemB = await app.inject({
        method: "POST",
        url: "/auth/magic-link/redeem",
        payload: { token: rawB },
      });
      expect(redeemB.statusCode).toBe(200);
      cookieB = extractSessionCookie(redeemB.headers["set-cookie"]);
    });

    afterAll(async () => {
      await app?.close();
      await pool?.end();
      await stopContainer?.();
    });

    // ── Helpers ────────────────────────────────────────────────────────────

    async function push(
      cookie: string,
      ops: object[],
    ): Promise<PushResponse> {
      const res = await app.inject({
        method: "POST",
        url: "/sync/push",
        headers: { cookie },
        payload: { ops },
      });
      expect(res.statusCode, `push failed: ${res.body}`).toBe(200);
      return res.json() as PushResponse;
    }

    async function pull(
      cookie: string,
      since: number,
    ): Promise<PullResponse> {
      const res = await app.inject({
        method: "POST",
        url: "/sync/pull",
        headers: { cookie },
        payload: { since },
      });
      expect(res.statusCode, `pull failed: ${res.body}`).toBe(200);
      return res.json() as PullResponse;
    }

    // ── Tests ──────────────────────────────────────────────────────────────

    it("client A pushes a task; client B pulls and receives it", async () => {
      const taskId = randomUUID();
      const now = Date.now();

      // Client A: push task upsert (simulating "write while offline, then
      // reconnect and drain the op_queue").
      const pushRes = await push(cookieA, [
        {
          table: "tasks",
          op: "upsert",
          payload: {
            id: taskId,
            title: "Task from client A",
            notes: null,
            type: "task",
            status: "open",
            due_at: null,
            parent_task_id: null,
            source: "desktop",
            created_at: now,
            scheduled_start: null,
            scheduled_end: null,
            updated_at: now,
            deleted_at: null,
            version: 0,
          },
        },
      ]);

      expect(pushRes.results).toHaveLength(1);
      expect(pushRes.results[0]!.status).toBe("accepted");
      const serverVersion = pushRes.version;
      expect(serverVersion).toBeGreaterThan(0);

      // Client B: pull from version 0 — should receive the task.
      const pullRes = await pull(cookieB, 0);
      expect(pullRes.version).toBeGreaterThanOrEqual(serverVersion);

      const tasks = (pullRes.records.tasks ?? []) as Record<string, unknown>[];
      const received = tasks.find((t: Record<string, unknown>) => t["id"] === taskId);
      expect(received).toBeTruthy();
      expect(received!["title"]).toBe("Task from client A");
      expect(received!["deleted_at"]).toBeNull();
    });

    it("soft-delete from B propagates to A on next pull", async () => {
      const taskId = randomUUID();
      const now = Date.now();

      // Setup: client A pushes the task.
      await push(cookieA, [
        {
          table: "tasks",
          op: "upsert",
          payload: {
            id: taskId,
            title: "Task to be deleted",
            notes: null,
            type: "task",
            status: "open",
            due_at: null,
            parent_task_id: null,
            source: "desktop",
            created_at: now,
            scheduled_start: null,
            scheduled_end: null,
            updated_at: now,
            deleted_at: null,
            version: 0,
          },
        },
      ]);

      // Get the current version before the delete so client A can pull
      // only the new delta.
      const beforeDeletePull = await pull(cookieA, 0);
      const versionBeforeDelete = beforeDeletePull.version;

      // Client B: push soft-delete.
      const deleteNow = now + 1000;
      const deleteRes = await push(cookieB, [
        {
          table: "tasks",
          op: "delete",
          payload: {
            id: taskId,
            updated_at: deleteNow,
            deleted_at: deleteNow,
            version: 0,
          },
        },
      ]);
      expect(deleteRes.results[0]!.status).toBe("accepted");

      // Client A: pull delta since versionBeforeDelete — should see the
      // task with deleted_at set.
      const afterDeletePull = await pull(cookieA, versionBeforeDelete);
      const tasks = (afterDeletePull.records.tasks ?? []) as Record<string, unknown>[];
      const deleted = tasks.find((t: Record<string, unknown>) => t["id"] === taskId);
      expect(deleted).toBeTruthy();
      expect(deleted!["deleted_at"]).not.toBeNull();
    });

    it("idempotent pull: re-pulling at the same since-version returns no new records", async () => {
      // Pull once to get current version.
      const first = await pull(cookieA, 0);
      const currentVersion = first.version;

      // Pull again at that same version — no newer ops exist, so all
      // record arrays should be empty (or absent).
      const second = await pull(cookieA, currentVersion);
      const totalRecords = (
        Object.values(second.records) as (Record<string, unknown>[] | undefined)[]
      ).reduce((n, rows) => n + (rows?.length ?? 0), 0);
      expect(totalRecords).toBe(0);
    });
  },
  { timeout: 120_000 },
);

function extractSessionCookie(
  header: string | string[] | undefined,
): string {
  const raw = Array.isArray(header) ? header[0] ?? "" : (header ?? "");
  return raw.split(";")[0] ?? "";
}
