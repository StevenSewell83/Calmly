import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { startServerFixture, type ServerFixture } from "../fixtures/server";
import { isDockerAvailable } from "../fixtures/docker";
import { launchElectronApp, signInAsTestUser } from "./_helpers";
import { seedDesktopDb } from "../fixtures/seedDesktopDb";

// CL-13-e2e: Daily Shutdown — carry forward, drop, mark done, reflection, complete.
//
// Seeds local SQLite with:
//   - 4 tasks already done today
//   - 3 unfinished tasks due today
// Then navigates /review, actions each unfinished row, writes a reflection,
// clicks "Complete shutdown", and verifies side effects in the SQLite DB directly.

test.describe("CL-13-e2e · Daily Shutdown — carry, drop, mark done, reflection", () => {
  test.describe.configure({ timeout: 240_000 });

  let server: ServerFixture | null = null;
  let dockerAvailable = false;

  test.beforeAll(async () => {
    dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) return;
    server = await startServerFixture();
  });

  test.afterAll(async () => {
    if (server) await server.stop();
    server = null;
  });

  test.beforeEach(() => {
    test.skip(
      !dockerAvailable,
      "Docker daemon not reachable — skipping testcontainers fixture",
    );
  });

  test("full ritual: carry, drop, mark done, reflection, complete shutdown", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "calmly-e2e-review-"));
    try {
      // ── Phase 1: sign in ──────────────────────────────────────────────────
      const firstLaunch = await launchElectronApp({ syncUrl: server!.url, userDataDir });
      let userId: string;
      try {
        const result = await signInAsTestUser({
          app: firstLaunch.electronApp,
          window: firstLaunch.window,
          server: server!,
          email: `review-e2e-${Date.now()}@calmly.test`,
        });
        userId = result.user.id;
      } finally {
        await firstLaunch.dispose();
      }

      // ── Phase 2: seed DB ──────────────────────────────────────────────────
      const now = Date.now();
      const todayMidnight = (() => {
        const d = new Date(now);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
      })();
      const dueToday = todayMidnight + 12 * 60 * 60_000;

      // 4 done tasks: seeded as done status, updated_at = now (within today)
      // 3 unfinished tasks due today
      const dbPath = join(userDataDir, "calmly.db");
      const db = new Database(dbPath, { readonly: false });
      db.pragma("foreign_keys = ON");

      // Insert done tasks directly (seedDesktopDb only does open/in_progress)
      const insertDone = db.prepare(
        `INSERT INTO tasks (id, user_id, title, status, due_at, scheduled_start, scheduled_end, created_at, updated_at, source)
         VALUES (?, ?, ?, 'done', ?, NULL, NULL, ?, ?, 'desktop')`,
      );
      const doneIds: string[] = [];
      for (let i = 1; i <= 4; i++) {
        const { randomUUID } = await import("node:crypto");
        const id = randomUUID();
        doneIds.push(id);
        insertDone.run(id, userId, `Done task ${i}`, dueToday, now - 60_000, now);
      }
      db.close();

      // Unfinished tasks via seedDesktopDb
      const seeded = seedDesktopDb(userDataDir, {
        tasks: [
          { userId, title: "Carry forward task", dueAt: dueToday },
          { userId, title: "Drop this task", dueAt: dueToday },
          { userId, title: "Mark done task", dueAt: dueToday },
        ],
      });
      const carryId = seeded.tasks[0]!.id;
      const dropId = seeded.tasks[1]!.id;
      const doneTaskId = seeded.tasks[2]!.id;

      // ── Phase 3: navigate to /review, action rows ─────────────────────────
      const secondLaunch = await launchElectronApp({ syncUrl: server!.url, userDataDir });
      const win = secondLaunch.window;

      try {
        await expect(win.getByText(/Peace,/)).toBeVisible({ timeout: 20_000 });

        // Navigate to Review
        await win.getByRole("link", { name: "Review" }).click();

        // Should see review page with header
        await expect(win.getByRole("region", { name: "Daily shutdown review" })).toBeVisible({
          timeout: 10_000,
        });

        // "4 things done" prominent count
        await expect(win.getByText(/4 things done/)).toBeVisible({ timeout: 8_000 });

        // All 3 unfinished task titles visible
        await expect(win.getByText("Carry forward task")).toBeVisible();
        await expect(win.getByText("Drop this task")).toBeVisible();
        await expect(win.getByText("Mark done task")).toBeVisible();

        // Action row 1: Carry forward
        const carryRow = win.getByText("Carry forward task").locator("..").locator("..");
        await carryRow.getByRole("button", { name: /Carry forward/i }).click();
        await expect(win.getByText("Carried to tomorrow")).toBeVisible({ timeout: 5_000 });

        // Action row 2: Drop
        const dropRow = win.getByText("Drop this task").locator("..").locator("..");
        await dropRow.getByRole("button", { name: /Drop/i }).click();
        await expect(win.getByText("Dropped")).toBeVisible({ timeout: 5_000 });

        // Action row 3: Mark done
        const doneRow = win.getByText("Mark done task").locator("..").locator("..");
        await doneRow.getByRole("button", { name: /Mark done/i }).click();
        await expect(win.getByText("Marked done")).toBeVisible({ timeout: 5_000 });

        // Write reflection
        await win.getByPlaceholder(/One word/).fill("long day");

        // Complete shutdown
        await win.getByRole("button", { name: /Complete shutdown/i }).click();

        // Should navigate back to Home
        await expect(win.getByText(/Peace,/)).toBeVisible({ timeout: 10_000 });

        // ── Phase 4: verify side-effects in SQLite ────────────────────────
        const verifyDb = new Database(dbPath, { readonly: true });
        try {
          const tomorrowMidnight = todayMidnight + 24 * 60 * 60_000;

          // Carry forward: due_at = tomorrow, scheduled cleared
          const carried = verifyDb
            .prepare("SELECT due_at, scheduled_start FROM tasks WHERE id = ?")
            .get(carryId) as { due_at: number; scheduled_start: number | null };
          expect(carried.due_at).toBeGreaterThan(tomorrowMidnight);
          expect(carried.scheduled_start).toBeNull();

          // Drop: status = dropped
          const dropped = verifyDb
            .prepare("SELECT status FROM tasks WHERE id = ?")
            .get(dropId) as { status: string };
          expect(dropped.status).toBe("dropped");

          // Mark done: status = done
          const done = verifyDb
            .prepare("SELECT status FROM tasks WHERE id = ?")
            .get(doneTaskId) as { status: string };
          expect(done.status).toBe("done");

          // Reflection saved
          const reflection = verifyDb
            .prepare("SELECT text FROM daily_reflections WHERE user_id = ?")
            .get(userId) as { text: string } | undefined;
          expect(reflection?.text).toBe("long day");

          // last_shutdown_date written to settings
          const settings = verifyDb
            .prepare("SELECT settings_json FROM user_settings WHERE user_id = ?")
            .get(userId) as { settings_json: string } | undefined;
          const parsed = JSON.parse(settings?.settings_json ?? "{}") as Record<string, unknown>;
          expect(typeof parsed.last_shutdown_date).toBe("string");
        } finally {
          verifyDb.close();
        }
      } catch (e) {
        await secondLaunch.dispose();
        throw e;
      }

      await secondLaunch.dispose();
    } finally {
      await rm(userDataDir, { recursive: true, force: true });
    }
  });
});
