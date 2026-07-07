// TGR-08 — DB integration test for the reminder scheduler + cancel route.
//
// Requires a Docker-accessible PostgreSQL container (via testcontainers).
// Skipped automatically when no Docker daemon is available (this
// container has none — see agent-common.md); runs for real in CI.
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
import { ReminderScheduler } from "../scheduler";
import { ChannelRouter } from "../router";
import { pgReminderStore } from "../store";
import type { Channel } from "../channels/types";

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
  "reminder scheduler + cancel route — DB integration",
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

      // Proves the 0013 migration applies cleanly on a fresh Postgres,
      // alongside every migration before it.
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
        REMINDER_TICK_INTERVAL_MS: "3600000", // the app's own timer must not fire mid-test
      });

      app = await buildApp({ config, pool });
      await app.ready();
    });

    afterAll(async () => {
      await app?.close();
      await pool?.end();
      await stopContainer?.();
    });

    async function makeUserTaskAndRule(now: number) {
      const email = `reminder-test-${randomUUID()}@calmly.test`;
      const userRow = await pool.query<{ id: string }>(
        `INSERT INTO users (email) VALUES ($1) RETURNING id`,
        [email],
      );
      const userId = userRow.rows[0]!.id;

      const taskId = randomUUID();
      await pool.query(
        `INSERT INTO tasks (id, user_id, title, type, status, source, created_at, version, updated_at)
         VALUES ($1, $2, 'Integration task', 'task', 'open', 'desktop', $3, nextval('sync_version'), $3)`,
        [taskId, userId, now],
      );

      const ruleId = randomUUID();
      await pool.query(
        `INSERT INTO reminder_rules
           (id, user_id, task_id, importance, interval_seconds, escalation_json, active, version, updated_at)
         VALUES ($1, $2, $3, 'important', 300, '{}', 1, nextval('sync_version'), $4)`,
        [ruleId, userId, taskId, now],
      );

      return { userId, taskId, ruleId };
    }

    async function makeSessionCookie(userId: string): Promise<string> {
      const raw = generateToken();
      await pool.query(
        `INSERT INTO sessions (token_hash, user_id, expires_at)
         VALUES ($1, $2, now() + interval '30 days')`,
        [hashToken(raw), userId],
      );
      return `${app.appConfig.COOKIE_NAME}=${raw}`;
    }

    it("fires a due rule and persists a sent delivery row", async () => {
      const now = Date.now() - 400_000; // rule "activated" (updated_at) 400s ago
      const { userId, taskId, ruleId } = await makeUserTaskAndRule(now);

      const logChannel: Channel = { name: "desktop", deliver: async () => ({ ok: true }) };
      const scheduler = new ReminderScheduler({
        store: pgReminderStore(pool),
        router: new ChannelRouter({
          isTelegramLinked: async () => false,
          telegram: logChannel,
          desktop: logChannel,
        }),
        now: () => now + 400_000, // interval_seconds=300 -> due
      });

      const summary = await scheduler.tick();
      expect(summary.created).toBeGreaterThanOrEqual(1);

      const rows = await pool.query(
        `SELECT status, channel FROM reminder_deliveries WHERE rule_id = $1`,
        [ruleId],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]).toMatchObject({ status: "sent", channel: "desktop" });

      void taskId;
      void userId;
    });

    it("cancel route: pending -> skipped, requires auth + ownership", async () => {
      const now = Date.now();
      const { userId, ruleId } = await makeUserTaskAndRule(now);
      const cookie = await makeSessionCookie(userId);

      const deliveryId = randomUUID();
      await pool.query(
        `INSERT INTO reminder_deliveries
           (id, rule_id, user_id, task_id, scheduled_for, channel, status, attempt_count, created_at)
         SELECT $1, $2, $3, task_id, $4, 'desktop', 'pending', 0, $4
           FROM reminder_rules WHERE id = $2`,
        [deliveryId, ruleId, userId, now],
      );

      const unauth = await app.inject({
        method: "POST",
        url: `/reminder-deliveries/${deliveryId}/cancel`,
      });
      expect(unauth.statusCode).toBe(401);

      const res = await app.inject({
        method: "POST",
        url: `/reminder-deliveries/${deliveryId}/cancel`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true });

      const row = await pool.query(`SELECT status FROM reminder_deliveries WHERE id = $1`, [
        deliveryId,
      ]);
      expect(row.rows[0]).toMatchObject({ status: "skipped" });

      // Cancelling again (already terminal) is a conflict, not a silent 200.
      const again = await app.inject({
        method: "POST",
        url: `/reminder-deliveries/${deliveryId}/cancel`,
        headers: { cookie },
      });
      expect(again.statusCode).toBe(409);
    });

    it("cancel route: 404 for a delivery owned by someone else", async () => {
      const now = Date.now();
      const owner = await makeUserTaskAndRule(now);
      const stranger = await makeUserTaskAndRule(now);
      const strangerCookie = await makeSessionCookie(stranger.userId);

      const deliveryId = randomUUID();
      await pool.query(
        `INSERT INTO reminder_deliveries
           (id, rule_id, user_id, task_id, scheduled_for, channel, status, attempt_count, created_at)
         VALUES ($1, $2, $3, $4, $5, 'desktop', 'pending', 0, $5)`,
        [deliveryId, owner.ruleId, owner.userId, owner.taskId, now],
      );

      const res = await app.inject({
        method: "POST",
        url: `/reminder-deliveries/${deliveryId}/cancel`,
        headers: { cookie: strangerCookie },
      });
      expect(res.statusCode).toBe(404);
    });

    // TGR-10 — desktop notification fallback's pull endpoints.
    async function makeSentDesktopDelivery(
      ruleId: string,
      userId: string,
      taskId: string,
      firedAt: number,
    ): Promise<string> {
      const deliveryId = randomUUID();
      await pool.query(
        `INSERT INTO reminder_deliveries
           (id, rule_id, user_id, task_id, scheduled_for, fired_at, channel, status, attempt_count, created_at)
         VALUES ($1, $2, $3, $4, $5, $5, 'desktop', 'sent', 1, $5)`,
        [deliveryId, ruleId, userId, taskId, firedAt],
      );
      return deliveryId;
    }

    it("GET pending: requires auth, returns only this user's fresh desktop deliveries with title+importance", async () => {
      const now = Date.now();
      const { userId, ruleId, taskId } = await makeUserTaskAndRule(now);
      const cookie = await makeSessionCookie(userId);
      const deliveryId = await makeSentDesktopDelivery(ruleId, userId, taskId, now);

      const unauth = await app.inject({ method: "GET", url: "/reminder-deliveries/pending" });
      expect(unauth.statusCode).toBe(401);

      const res = await app.inject({
        method: "GET",
        url: "/reminder-deliveries/pending",
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        deliveries: [
          { id: deliveryId, taskId, taskTitle: "Integration task", importance: "important" },
        ],
      });
    });

    it("GET pending: excludes another user's desktop deliveries (ownership)", async () => {
      const now = Date.now();
      const owner = await makeUserTaskAndRule(now);
      await makeSentDesktopDelivery(owner.ruleId, owner.userId, owner.taskId, now);
      const stranger = await makeUserTaskAndRule(now);
      const strangerCookie = await makeSessionCookie(stranger.userId);

      const res = await app.inject({
        method: "GET",
        url: "/reminder-deliveries/pending",
        headers: { cookie: strangerCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ deliveries: [] });
    });

    it("GET pending: a delivery fired over 30 minutes ago is skipped, not returned", async () => {
      const now = Date.now();
      const { userId, ruleId, taskId } = await makeUserTaskAndRule(now);
      const cookie = await makeSessionCookie(userId);
      const staleFiredAt = now - 31 * 60_000;
      const deliveryId = await makeSentDesktopDelivery(ruleId, userId, taskId, staleFiredAt);

      const res = await app.inject({
        method: "GET",
        url: "/reminder-deliveries/pending",
        headers: { cookie },
      });
      expect(res.json()).toMatchObject({ deliveries: [] });

      const row = await pool.query(`SELECT status FROM reminder_deliveries WHERE id = $1`, [
        deliveryId,
      ]);
      expect(row.rows[0]).toMatchObject({ status: "skipped" });
    });

    it("POST desktop-ack: sets desktop_acked_at, removes it from a subsequent pending fetch, and is idempotent", async () => {
      const now = Date.now();
      const { userId, ruleId, taskId } = await makeUserTaskAndRule(now);
      const cookie = await makeSessionCookie(userId);
      const deliveryId = await makeSentDesktopDelivery(ruleId, userId, taskId, now);

      const unauth = await app.inject({
        method: "POST",
        url: `/reminder-deliveries/${deliveryId}/desktop-ack`,
      });
      expect(unauth.statusCode).toBe(401);

      const ack = await app.inject({
        method: "POST",
        url: `/reminder-deliveries/${deliveryId}/desktop-ack`,
        headers: { cookie },
      });
      expect(ack.statusCode).toBe(200);
      expect(ack.json()).toMatchObject({ ok: true });

      const row = await pool.query(
        `SELECT desktop_acked_at FROM reminder_deliveries WHERE id = $1`,
        [deliveryId],
      );
      expect(row.rows[0]?.desktop_acked_at).not.toBeNull();

      const afterAck = await app.inject({
        method: "GET",
        url: "/reminder-deliveries/pending",
        headers: { cookie },
      });
      expect(afterAck.json()).toMatchObject({ deliveries: [] });

      // Second ack on an already-acked delivery is a no-op, not an error.
      const again = await app.inject({
        method: "POST",
        url: `/reminder-deliveries/${deliveryId}/desktop-ack`,
        headers: { cookie },
      });
      expect(again.statusCode).toBe(200);
    });

    it("POST desktop-ack: 404 for a delivery owned by someone else", async () => {
      const now = Date.now();
      const owner = await makeUserTaskAndRule(now);
      const deliveryId = await makeSentDesktopDelivery(
        owner.ruleId,
        owner.userId,
        owner.taskId,
        now,
      );
      const stranger = await makeUserTaskAndRule(now);
      const strangerCookie = await makeSessionCookie(stranger.userId);

      const res = await app.inject({
        method: "POST",
        url: `/reminder-deliveries/${deliveryId}/desktop-ack`,
        headers: { cookie: strangerCookie },
      });
      expect(res.statusCode).toBe(404);
    });

    // TGR-11 — POST /reminder-deliveries/:id/action (Done/Snooze/Reschedule).
    async function makeSentDelivery(
      ruleId: string,
      userId: string,
      taskId: string,
      now: number,
    ): Promise<string> {
      const deliveryId = randomUUID();
      await pool.query(
        `INSERT INTO reminder_deliveries
           (id, rule_id, user_id, task_id, scheduled_for, fired_at, channel, status, attempt_count, created_at)
         VALUES ($1, $2, $3, $4, $5, $5, 'telegram', 'sent', 1, $5)`,
        [deliveryId, ruleId, userId, taskId, now],
      );
      return deliveryId;
    }

    it("POST action (snooze): rejects out-of-range or non-integer minutes with 400", async () => {
      const now = Date.now();
      const { userId, ruleId, taskId } = await makeUserTaskAndRule(now);
      const cookie = await makeSessionCookie(userId);
      const deliveryId = await makeSentDelivery(ruleId, userId, taskId, now);

      for (const minutes of [0, -5, 1441, 2.5, Number.NaN]) {
        const res = await app.inject({
          method: "POST",
          url: `/reminder-deliveries/${deliveryId}/action`,
          headers: { cookie },
          payload: { action: "snooze", minutes },
        });
        expect(res.statusCode, `minutes=${minutes}`).toBe(400);
        expect(res.json()).toMatchObject({ error: "invalid_minutes" });
      }

      // The delivery is untouched by the rejected attempts.
      const row = await pool.query(`SELECT status FROM reminder_deliveries WHERE id = $1`, [
        deliveryId,
      ]);
      expect(row.rows[0]).toMatchObject({ status: "sent" });
    });

    it("POST action (done): requires auth, acks the delivery, deactivates the rule, is idempotent", async () => {
      const now = Date.now();
      const { userId, ruleId, taskId } = await makeUserTaskAndRule(now);
      const cookie = await makeSessionCookie(userId);
      const deliveryId = await makeSentDelivery(ruleId, userId, taskId, now);

      const unauth = await app.inject({
        method: "POST",
        url: `/reminder-deliveries/${deliveryId}/action`,
        payload: { action: "done" },
      });
      expect(unauth.statusCode).toBe(401);

      const res = await app.inject({
        method: "POST",
        url: `/reminder-deliveries/${deliveryId}/action`,
        headers: { cookie },
        payload: { action: "done" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, alreadyActed: false, status: "acked", taskId });

      const row = await pool.query(
        `SELECT status, acted_via FROM reminder_deliveries WHERE id = $1`,
        [deliveryId],
      );
      expect(row.rows[0]).toMatchObject({ status: "acked", acted_via: "desktop" });
      const rule = await pool.query(`SELECT active FROM reminder_rules WHERE id = $1`, [ruleId]);
      expect(rule.rows[0]).toMatchObject({ active: 0 });

      // Double-press (e.g. across surfaces) is a no-op, not an error.
      const again = await app.inject({
        method: "POST",
        url: `/reminder-deliveries/${deliveryId}/action`,
        headers: { cookie },
        payload: { action: "done" },
      });
      expect(again.statusCode).toBe(200);
      expect(again.json()).toMatchObject({ ok: true, alreadyActed: true, status: "acked" });
    });

    it("POST action (snooze): creates a follow-up pending delivery the scheduler later dispatches", async () => {
      const now = Date.now();
      const { userId, ruleId, taskId } = await makeUserTaskAndRule(now);
      const cookie = await makeSessionCookie(userId);
      const deliveryId = await makeSentDelivery(ruleId, userId, taskId, now);

      const res = await app.inject({
        method: "POST",
        url: `/reminder-deliveries/${deliveryId}/action`,
        headers: { cookie },
        payload: { action: "snooze", minutes: 10 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, status: "snoozed" });

      const rows = await pool.query(
        `SELECT status, channel, attempt_count FROM reminder_deliveries WHERE rule_id = $1 ORDER BY created_at`,
        [ruleId],
      );
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows[0]).toMatchObject({ status: "snoozed" });
      expect(rows.rows[1]).toMatchObject({ status: "pending", channel: "telegram", attempt_count: 0 });
    });

    it("POST action (reschedule): acks the delivery and returns taskId for navigation", async () => {
      const now = Date.now();
      const { userId, ruleId, taskId } = await makeUserTaskAndRule(now);
      const cookie = await makeSessionCookie(userId);
      const deliveryId = await makeSentDelivery(ruleId, userId, taskId, now);

      const res = await app.inject({
        method: "POST",
        url: `/reminder-deliveries/${deliveryId}/action`,
        headers: { cookie },
        payload: { action: "reschedule" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, status: "acked", taskId });

      // Reschedule doesn't deactivate the rule (unlike Done).
      const rule = await pool.query(`SELECT active FROM reminder_rules WHERE id = $1`, [ruleId]);
      expect(rule.rows[0]).toMatchObject({ active: 1 });
    });

    it("POST action: 404 for a delivery owned by someone else; 400 for an unknown action", async () => {
      const now = Date.now();
      const owner = await makeUserTaskAndRule(now);
      const deliveryId = await makeSentDelivery(owner.ruleId, owner.userId, owner.taskId, now);
      const stranger = await makeUserTaskAndRule(now);
      const strangerCookie = await makeSessionCookie(stranger.userId);

      const strangerRes = await app.inject({
        method: "POST",
        url: `/reminder-deliveries/${deliveryId}/action`,
        headers: { cookie: strangerCookie },
        payload: { action: "done" },
      });
      expect(strangerRes.statusCode).toBe(404);

      const ownerCookie = await makeSessionCookie(owner.userId);
      const badAction = await app.inject({
        method: "POST",
        url: `/reminder-deliveries/${deliveryId}/action`,
        headers: { cookie: ownerCookie },
        payload: { action: "not-a-real-action" },
      });
      expect(badAction.statusCode).toBe(400);
    });
  },
);
