import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServerFixture, type ServerFixture } from "../fixtures/server";
import { isDockerAvailable } from "../fixtures/docker";
import { launchElectronApp, signInAsTestUser } from "./_helpers";
import { seedDesktopDb } from "../fixtures/seedDesktopDb";
import type { PlanScheduleResult } from "../../src/preload/api-types";

// Drag-drop fallback (calmly-kwy risk clause): dnd-kit pointer drag is
// unreliable in Playwright/Electron; keyboard sensor slot order is fragile.
// We use plan.schedule IPC to simulate drag outcome and verify the TimeBlock.
declare const window: {
  calmly: {
    plan: {
      schedule: (args: {
        taskId: string;
        startAt: number;
        endAt: number;
      }) => Promise<PlanScheduleResult>;
    };
  };
};

// CL-06-e2e: Plan view — place, reload, persist.
//
// Seeds local SQLite with:
//   - 3 backlog tasks (due today, no scheduled_start)
//   - 1 already-placed block (scheduled_start = 9am today)
// Then launches Electron, navigates to /plan, asserts:
//   - Backlog shows 3 items
//   - Day grid shows the placed block
// Reloads the app (same userDataDir) and asserts the same state persists.

test.describe("CL-06-e2e · Plan view — place, reload, persist", () => {
  test.describe.configure({ timeout: 180_000 });

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

  test(
    "backlog shows unseeded tasks; placed block persists across reload",
    async () => {
      const userDataDir = await mkdtemp(join(tmpdir(), "calmly-e2e-plan-"));
      try {
        // ── Phase 1: sign in so the user row exists ────────────────────────
        const firstLaunch = await launchElectronApp({
          syncUrl: server!.url,
          userDataDir,
        });
        let userId: string;
        try {
          const result = await signInAsTestUser({
            app: firstLaunch.electronApp,
            window: firstLaunch.window,
            server: server!,
            email: `plan-e2e-${Date.now()}@calmly.test`,
          });
          userId = result.user.id;
        } finally {
          await firstLaunch.dispose();
        }

        // ── Phase 2: seed the DB with backlog tasks + one placed block ─────
        const now = Date.now();

        // Midnight of today (local) as unix-ms — used as due_at so the Plan
        // view picks them up as "due today".
        const todayMidnight = (() => {
          const d = new Date(now);
          d.setHours(0, 0, 0, 0);
          return d.getTime();
        })();

        // 9am today as unix-ms for the placed block.
        const nineAmMs = todayMidnight + 9 * 60 * 60_000;
        const tenAmMs = todayMidnight + 10 * 60 * 60_000;

        const dueToday = todayMidnight + 12 * 60 * 60_000; // noon — safely within today

        const BACKLOG_TASKS = ["Plan backlog alpha", "Plan backlog beta", "Plan backlog gamma"];
        const PLACED_TITLE = "Morning deep work block";

        seedDesktopDb(userDataDir, {
          tasks: [
            // 3 backlog items — due today but NOT scheduled
            ...BACKLOG_TASKS.map((title) => ({
              userId,
              title,
              dueAt: dueToday,
            })),
            // 1 pre-placed block at 9am–10am
            {
              userId,
              title: PLACED_TITLE,
              dueAt: dueToday,
              scheduledStart: nineAmMs,
              scheduledEnd: tenAmMs,
            },
          ],
        });

        // ── Phase 3: relaunch, navigate to Plan, assert initial state ──────
        const secondLaunch = await launchElectronApp({
          syncUrl: server!.url,
          userDataDir,
        });
        const win = secondLaunch.window;

        try {
          // Wait for the app to be ready (home screen heading).
          await expect(win.getByText(/Peace,/)).toBeVisible({ timeout: 20_000 });

          // Navigate to Plan via sidebar.
          await win.getByRole("link", { name: "Plan" }).click();
          await expect(win.getByRole("heading", { name: /Plan/i })).toBeVisible({
            timeout: 10_000,
          });

          // Backlog should show 3 items (the placed block is in the grid, not backlog).
          const backlog = win.getByRole("complementary", { name: "Backlog" });
          await expect(backlog).toBeVisible();
          for (const title of BACKLOG_TASKS) {
            await expect(backlog.getByText(title)).toBeVisible();
          }

          // Day grid should contain the placed block.
          const grid = win.getByRole("grid", { name: "Day schedule" });
          await expect(grid).toBeVisible();
          await expect(
            win.getByRole("button", { name: new RegExp(PLACED_TITLE) }),
          ).toBeVisible({ timeout: 5_000 });

          // ── Phase 4: reload app (dispose + relaunch same userDataDir) ──────
          await secondLaunch.dispose();

          const thirdLaunch = await launchElectronApp({
            syncUrl: server!.url,
            userDataDir,
          });
          const win2 = thirdLaunch.window;

          try {
            await expect(win2.getByText(/Peace,/)).toBeVisible({ timeout: 20_000 });
            await win2.getByRole("link", { name: "Plan" }).click();
            await expect(win2.getByRole("heading", { name: /Plan/i })).toBeVisible({
              timeout: 10_000,
            });

            // Placed block still in grid after reload.
            await expect(
              win2.getByRole("article").filter({ hasText: PLACED_TITLE }),
            ).toBeVisible({ timeout: 5_000 });

            // Backlog still shows all 3 unplaced tasks.
            const backlog2 = win2.getByRole("complementary", { name: "Backlog" });
            for (const title of BACKLOG_TASKS) {
              await expect(backlog2.getByText(title)).toBeVisible();
            }
          } finally {
            await thirdLaunch.dispose();
          }
        } catch (err) {
          try {
            await secondLaunch.dispose();
          } catch {
            // ignore secondary dispose error
          }
          throw err;
        }
      } finally {
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
  );

  test(
    "schedule via IPC: backlog task moves to grid at 09:00, persists on reload",
    async () => {
      const userDataDir = await mkdtemp(
        join(tmpdir(), "calmly-e2e-plan-schedule-"),
      );
      try {
        // ── Phase 1: sign in ───────────────────────────────────────────────
        const firstLaunch = await launchElectronApp({
          syncUrl: server!.url,
          userDataDir,
        });
        let userId: string;
        try {
          const result = await signInAsTestUser({
            app: firstLaunch.electronApp,
            window: firstLaunch.window,
            server: server!,
            email: `plan-schedule-${Date.now()}@calmly.test`,
          });
          userId = result.user.id;
        } finally {
          await firstLaunch.dispose();
        }

        const now = Date.now();
        const todayMidnight = (() => {
          const d = new Date(now);
          d.setHours(0, 0, 0, 0);
          return d.getTime();
        })();
        const dueAt = todayMidnight + 12 * 60 * 60_000; // noon
        const nineAmMs = todayMidnight + 9 * 60 * 60_000;
        const tenAmMs = todayMidnight + 10 * 60 * 60_000;
        const TASK_TITLE = "Deep work session";

        const { tasks: seededTasks } = seedDesktopDb(userDataDir, {
          tasks: [{ userId, title: TASK_TITLE, dueAt }],
        });
        const taskId = seededTasks[0]!.id;

        // ── Phase 3: verify Backlog, schedule via IPC, assert grid ───────
        const secondLaunch = await launchElectronApp({
          syncUrl: server!.url,
          userDataDir,
        });
        try {
          const win = secondLaunch.window;

          await expect(win.getByText(/Peace,/)).toBeVisible({ timeout: 20_000 });
          await win.getByRole("link", { name: "Plan" }).click();
          await expect(
            win.getByRole("heading", { name: /Plan/i }),
          ).toBeVisible({ timeout: 10_000 });

          const backlog = win.getByRole("complementary", { name: "Backlog" });
          await expect(backlog.getByText(TASK_TITLE)).toBeVisible({ timeout: 5_000 });

          // Place via IPC (simulates drag outcome — see NOTE above)
          const schedResult = await win.evaluate(
            ([id, start, end]) =>
              window.calmly.plan.schedule({ taskId: id, startAt: start, endAt: end }),
            [taskId, nineAmMs, tenAmMs] as [string, number, number],
          );
          expect(schedResult.ok).toBe(true);

          // Re-render should show the TimeBlock as a button in the grid.
          const grid = win.getByRole("grid", { name: "Day schedule" });
          await expect(grid).toBeVisible();
          await expect(
            win.getByRole("button", { name: new RegExp(TASK_TITLE) }),
          ).toBeVisible({ timeout: 10_000 });

          await expect(backlog.getByText(TASK_TITLE)).not.toBeVisible({ timeout: 5_000 });
        } finally {
          await secondLaunch.dispose();
        }

        const thirdLaunch = await launchElectronApp({
          syncUrl: server!.url,
          userDataDir,
        });
        try {
          const win = thirdLaunch.window;

          await expect(win.getByText(/Peace,/)).toBeVisible({ timeout: 20_000 });
          await win.getByRole("link", { name: "Plan" }).click();
          await expect(
            win.getByRole("heading", { name: /Plan/i }),
          ).toBeVisible({ timeout: 10_000 });

          await expect(
            win.getByRole("button", { name: new RegExp(TASK_TITLE) }),
          ).toBeVisible({ timeout: 10_000 });
        } finally {
          await thirdLaunch.dispose();
        }
      } finally {
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
  );
});
