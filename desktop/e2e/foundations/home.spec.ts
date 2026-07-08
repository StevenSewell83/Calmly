import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServerFixture, type ServerFixture } from "../fixtures/server";
import { isDockerAvailable } from "../fixtures/docker";
import { launchElectronApp, signInAsTestUser } from "./_helpers";
import { seedDesktopDb } from "../fixtures/seedDesktopDb";

// CL-01-e2e: Home screen E2E with seeded tasks/events.
//
// Signs in via the real server fixture, then injects canned rows directly into
// the desktop's SQLite (simulating tasks created before the test opens Home).
// After seeding, the app is relaunched with the same user-data-dir so the main
// process re-runs its DB queries and the renderer sees the seed data on mount.
//
// The seed is inserted via a second launch cycle (same userDataDir) so that:
//   - The users row already exists (FK constraint satisfied).
//   - The Electron main process closes its DB handle cleanly before we open
//     the DB file with better-sqlite3 from the test process.

test.describe("CL-01-e2e · Home screen with seeded tasks/events", () => {
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

  test("Now card shows in_progress task, Next card shows upcoming task, Today list shows event", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "calmly-e2e-home-"));
    try {
      // ── Phase 1: sign in so the user row exists in SQLite ─────────────
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
          email: `home-e2e-${Date.now()}@calmly.test`,
        });
        userId = result.user.id;
      } finally {
        // Close the app cleanly so it flushes WAL and releases the DB lock.
        await firstLaunch.dispose();
      }

      // ── Phase 2: seed the SQLite directly now that the lock is released ─
      const now = Date.now();
      const todayInProgress = "Write the weekly retrospective";
      const todayNext = "Review pull requests";
      const todayEvent = "Team standup";

      // In 30 minutes — lands in the "Next" slot (future, today)
      const nextDueAt = now + 30 * 60_000;
      // Event: +1 hour to +2 hours — within today's window
      const eventStartAt = now + 60 * 60_000;
      const eventEndAt = now + 2 * 60 * 60_000;

      seedDesktopDb(userDataDir, {
        tasks: [
          {
            userId,
            title: todayInProgress,
            status: "in_progress",
          },
          {
            userId,
            title: todayNext,
            status: "open",
            dueAt: nextDueAt,
          },
        ],
        events: [
          {
            userId,
            title: todayEvent,
            startAt: eventStartAt,
            endAt: eventEndAt,
          },
        ],
      });

      // ── Phase 3: relaunch with the same userDataDir and assert ─────────
      const secondLaunch = await launchElectronApp({
        syncUrl: server!.url,
        userDataDir,
      });
      try {
        // App boots, finds the persisted session cookie, skips SignIn,
        // and navigates directly to Home.
        const win = secondLaunch.window;
        await expect(win.getByText("Peace, friend.")).toBeVisible({
          timeout: 20_000,
        });

        // Now card: in_progress task title visible inside the Now article
        const nowCard = win.getByRole("article", { name: "Now" });
        await expect(nowCard).toBeVisible({ timeout: 10_000 });
        await expect(nowCard.getByText(todayInProgress)).toBeVisible();

        // Next card: upcoming task title visible inside the Next article
        const nextCard = win.getByRole("article", { name: "Next" });
        await expect(nextCard).toBeVisible({ timeout: 5_000 });
        await expect(nextCard.getByText(todayNext)).toBeVisible();

        // Today list: event title visible somewhere on the page
        await expect(win.getByText(todayEvent)).toBeVisible({
          timeout: 5_000,
        });
      } finally {
        await secondLaunch.dispose();
      }
    } finally {
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
