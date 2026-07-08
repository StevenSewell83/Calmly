import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServerFixture, type ServerFixture } from "../fixtures/server";
import { isDockerAvailable } from "../fixtures/docker";
import { launchElectronApp, signInAsTestUser } from "./_helpers";
import { seedDesktopDb } from "../fixtures/seedDesktopDb";

// CL-09-e2e: Focus mode — start session, mark done, session ends.
//
// Seeds local SQLite with 2 tasks due today:
//   - "Focus task alpha" (scheduled at 9am)
//   - "Focus task beta"  (backlog)
// Then launches Electron, navigates to /focus, clicks alpha to start a session,
// asserts ActiveSession renders, clicks Mark done, asserts the session is ended.

test.describe("CL-09-e2e · Focus mode — start, mark done", () => {
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

  test("chooser shows tasks; starting a session renders ActiveSession; mark done ends it", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "calmly-e2e-focus-"));
    try {
      // ── Phase 1: sign in ──────────────────────────────────────────────────
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
          email: `focus-e2e-${Date.now()}@calmly.test`,
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
      const nineAmMs = todayMidnight + 9 * 60 * 60_000;
      const tenAmMs = nineAmMs + 60 * 60_000;
      const dueToday = todayMidnight + 12 * 60 * 60_000;

      const ALPHA = "Focus task alpha";
      const BETA = "Focus task beta";

      seedDesktopDb(userDataDir, {
        tasks: [
          {
            userId,
            title: ALPHA,
            dueAt: dueToday,
            scheduledStart: nineAmMs,
            scheduledEnd: tenAmMs,
          },
          { userId, title: BETA, dueAt: dueToday },
        ],
      });

      // ── Phase 3: launch, navigate to Focus, start session ────────────────
      const secondLaunch = await launchElectronApp({
        syncUrl: server!.url,
        userDataDir,
      });
      const win = secondLaunch.window;

      try {
        await expect(win.getByText(/Peace,/)).toBeVisible({ timeout: 20_000 });

        // Navigate to Focus via sidebar.
        await win.getByRole("link", { name: "Focus" }).click();

        // Chooser should show today's tasks.
        const chooser = win.getByRole("region", { name: "Focus chooser" });
        await expect(chooser).toBeVisible({ timeout: 10_000 });
        await expect(win.getByText(ALPHA)).toBeVisible();
        await expect(win.getByText(BETA)).toBeVisible();

        // Click alpha to start a session.
        await win.getByRole("button", { name: new RegExp(ALPHA) }).click();

        // ActiveSession should render with the task title.
        const activeSection = win.getByRole("region", {
          name: "Active focus session",
        });
        await expect(activeSection).toBeVisible({ timeout: 10_000 });
        await expect(win.getByText(ALPHA)).toBeVisible();

        // Click Mark done.
        await win.getByRole("button", { name: "Mark done" }).click();

        // After mark done the chooser (or home state) should reappear — session is gone.
        await expect(activeSection).not.toBeVisible({ timeout: 10_000 });

        // ── Phase 4: reload and verify session is cleared ──────────────────
        await secondLaunch.dispose();
        const thirdLaunch = await launchElectronApp({
          syncUrl: server!.url,
          userDataDir,
        });
        const win2 = thirdLaunch.window;
        try {
          await expect(win2.getByText(/Peace,/)).toBeVisible({
            timeout: 20_000,
          });
          await win2.getByRole("link", { name: "Focus" }).click();
          // Should be back to chooser (no active session).
          await expect(
            win2.getByRole("region", { name: "Focus chooser" }),
          ).toBeVisible({
            timeout: 10_000,
          });
        } finally {
          await thirdLaunch.dispose();
        }
      } catch (e) {
        await secondLaunch.dispose();
        throw e;
      }
    } finally {
      await rm(userDataDir, { recursive: true, force: true });
    }
  });
});
