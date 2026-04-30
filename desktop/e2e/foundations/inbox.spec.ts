import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServerFixture, type ServerFixture } from "../fixtures/server";
import { isDockerAvailable } from "../fixtures/docker";
import { launchElectronApp, signInAsTestUser } from "./_helpers";
import { seedDesktopDb } from "../fixtures/seedDesktopDb";

// CL-03-e2e: Inbox list E2E with seeded items + snooze/skip flow.
//
// Seeds 3 unresolved + 1 snoozed-future + 1 resolved inbox items into the
// desktop SQLite, then verifies that the Inbox page shows exactly 3 rows
// (the snoozed-future and resolved items are hidden by the store's predicate).
// Then snoozes one row and skips another, asserting the visible count drops.

test.describe("CL-03-e2e · Inbox list with seeded items + snooze/skip", () => {
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
    "shows 3 unresolved rows; snooze reduces to 2; skip reduces to 1",
    async () => {
      const userDataDir = await mkdtemp(join(tmpdir(), "calmly-e2e-inbox-"));
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
            email: `inbox-e2e-${Date.now()}@calmly.test`,
          });
          userId = result.user.id;
        } finally {
          await firstLaunch.dispose();
        }

        // ── Phase 2: seed the SQLite with inbox items ──────────────────────
        const now = Date.now();

        seedDesktopDb(userDataDir, {
          inboxItems: [
            // 3 unresolved, visible items
            { userId, rawText: "Inbox item alpha" },
            { userId, rawText: "Inbox item beta" },
            { userId, rawText: "Inbox item gamma" },
            // 1 snoozed until future — hidden from inbox list
            { userId, rawText: "Snoozed item delta", snoozedUntil: now + 60 * 60_000 },
            // 1 already resolved — hidden from inbox list
            { userId, rawText: "Resolved item epsilon", resolvedAt: now - 1000 },
          ],
        });

        // ── Phase 3: relaunch, navigate to inbox, assert 3 rows ───────────
        const secondLaunch = await launchElectronApp({
          syncUrl: server!.url,
          userDataDir,
        });
        try {
          const win = secondLaunch.window;

          // App boots, finds the persisted session cookie, skips SignIn → Home.
          await expect(win.getByText("Peace, friend.")).toBeVisible({
            timeout: 20_000,
          });

          // Navigate to /inbox via the sidebar nav link
          await win.getByRole("link", { name: "Inbox" }).click();
          await expect(
            win.getByRole("heading", { name: "Inbox." }),
          ).toBeVisible({ timeout: 10_000 });

          // The listbox contains exactly 3 items
          const listbox = win.getByRole("listbox", { name: "Inbox items" });
          await expect(listbox).toBeVisible({ timeout: 10_000 });
          const rows = listbox.getByRole("option");
          await expect(rows).toHaveCount(3, { timeout: 10_000 });

          // Verify the 3 seeded texts are present
          await expect(win.getByText("Inbox item alpha")).toBeVisible();
          await expect(win.getByText("Inbox item beta")).toBeVisible();
          await expect(win.getByText("Inbox item gamma")).toBeVisible();

          // Verify snoozed/resolved items are NOT visible
          await expect(win.getByText("Snoozed item delta")).not.toBeVisible();
          await expect(win.getByText("Resolved item epsilon")).not.toBeVisible();

          // ── Snooze the first row ─────────────────────────────────────────
          // Click into the first row to select it, then open its snooze menu
          const firstRow = rows.first();
          await firstRow.getByRole("button", { name: "Snooze" }).click();

          // The snooze popover should appear
          const snoozeMenu = win.getByRole("menu");
          await expect(snoozeMenu).toBeVisible({ timeout: 5_000 });

          // Pick "In 1 hour"
          await snoozeMenu.getByRole("menuitem", { name: "In 1 hour" }).click();

          // Popover closes, row disappears — now 2 rows visible
          await expect(rows).toHaveCount(2, { timeout: 10_000 });

          // ── Skip the next first row ──────────────────────────────────────
          const nextFirstRow = rows.first();
          await nextFirstRow.getByRole("button", { name: "Skip" }).click();

          // Now 1 row visible (gamma only)
          await expect(rows).toHaveCount(1, { timeout: 10_000 });
          await expect(win.getByText("Inbox item gamma")).toBeVisible();
        } finally {
          await secondLaunch.dispose();
        }

        // ── Phase 4: reload — verify snooze/skip state persisted ──────────
        const thirdLaunch = await launchElectronApp({
          syncUrl: server!.url,
          userDataDir,
        });
        try {
          const win = thirdLaunch.window;

          await expect(win.getByText("Peace, friend.")).toBeVisible({
            timeout: 20_000,
          });

          await win.getByRole("link", { name: "Inbox" }).click();
          await expect(
            win.getByRole("heading", { name: "Inbox." }),
          ).toBeVisible({ timeout: 10_000 });

          const listbox = win.getByRole("listbox", { name: "Inbox items" });
          const rows = listbox.getByRole("option");

          // Only gamma survives — alpha was snoozed, beta was skipped
          await expect(rows).toHaveCount(1, { timeout: 10_000 });
          await expect(win.getByText("Inbox item gamma")).toBeVisible();
          await expect(win.getByText("Inbox item alpha")).not.toBeVisible();
          await expect(win.getByText("Inbox item beta")).not.toBeVisible();
        } finally {
          await thirdLaunch.dispose();
        }
      } finally {
        await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  );
});
