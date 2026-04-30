import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServerFixture, type ServerFixture } from "../fixtures/server";
import { isDockerAvailable } from "../fixtures/docker";
import { launchElectronApp, signInAsTestUser } from "./_helpers";
import { seedDesktopDb } from "../fixtures/seedDesktopDb";

// CL-04-e2e: Triage focused mode E2E with seeded queue.
//
// Seeds 3 unresolved inbox items, then walks through the triage flow:
//   Item 1: classify as Task → Today
//   Item 2: classify as Event → fill times → Schedule event
//   Item 3: classify as Discard → confirm
// Asserts "Inbox clear." renders after all three are resolved.

test.describe("CL-04-e2e · Triage focused mode with seeded queue", () => {
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

  test(
    "Task→Today, Event→Schedule, Discard all resolve the queue → Inbox clear",
    async () => {
      const userDataDir = await mkdtemp(join(tmpdir(), "calmly-e2e-triage-"));
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
            email: `triage-e2e-${Date.now()}@calmly.test`,
          });
          userId = result.user.id;
        } finally {
          await firstLaunch.dispose();
        }

        // ── Phase 2: seed 3 unresolved inbox items ─────────────────────────
        seedDesktopDb(userDataDir, {
          inboxItems: [
            { userId, rawText: "Buy project supplies" },
            { userId, rawText: "Kick off planning meeting" },
            { userId, rawText: "Old idea that can be dropped" },
          ],
        });

        // ── Phase 3: relaunch → navigate to /inbox/triage ─────────────────
        const secondLaunch = await launchElectronApp({
          syncUrl: server!.url,
          userDataDir,
        });
        try {
          const win = secondLaunch.window;

          // Boot → Home (session cookie still valid)
          await expect(win.getByText("Peace, friend.")).toBeVisible({
            timeout: 20_000,
          });

          // Navigate via Inbox sidebar link then "Triage all" button
          await win.getByRole("link", { name: "Inbox" }).click();
          await expect(
            win.getByRole("heading", { name: "Inbox." }),
          ).toBeVisible({ timeout: 10_000 });
          await win.getByRole("link", { name: /Triage all/i }).click();

          // Triage page loaded
          await expect(
            win.getByRole("heading", { name: "Triage." }),
          ).toBeVisible({ timeout: 10_000 });

          // ── Item 1: Task → Today ─────────────────────────────────────────
          // Default type is "Task" — confirm it's selected
          const typeGroup = win.getByRole("radiogroup", { name: "Type" });
          await expect(typeGroup.getByRole("radio", { name: "Task" })).toHaveAttribute(
            "aria-checked",
            "true",
          );

          // Fill in the title
          await win.getByLabel("Title").fill("Buy project supplies task");

          // Click the "Today" primary action button
          await win.getByRole("button", { name: "Today" }).click();

          // ── Item 2: Event → Schedule ─────────────────────────────────────
          // After resolving item 1 the queue advances — wait for item 2 text
          await expect(
            win.getByText("Kick off planning meeting"),
          ).toBeVisible({ timeout: 10_000 });

          // Switch to Event type
          await typeGroup.getByRole("radio", { name: "Event" }).click();
          await expect(
            typeGroup.getByRole("radio", { name: "Event" }),
          ).toHaveAttribute("aria-checked", "true");

          await win.getByLabel("Title").fill("Kick off planning meeting event");

          // Fill datetime-local inputs with a fixed future date (format: YYYY-MM-DDTHH:mm)
          const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
          const pad = (n: number) => String(n).padStart(2, "0");
          const dateStr = `${futureDate.getFullYear()}-${pad(futureDate.getMonth() + 1)}-${pad(futureDate.getDate())}`;
          await win.locator("#triage-event-start").fill(`${dateStr}T09:00`);
          await win.locator("#triage-event-end").fill(`${dateStr}T10:00`);

          // Submit with "Schedule event" button
          await win.getByRole("button", { name: "Schedule event" }).click();

          // ── Item 3: Discard ───────────────────────────────────────────────
          await expect(
            win.getByText("Old idea that can be dropped"),
          ).toBeVisible({ timeout: 10_000 });

          // Switch to Discard type
          await typeGroup.getByRole("radio", { name: "Discard" }).click();
          await expect(
            typeGroup.getByRole("radio", { name: "Discard" }),
          ).toHaveAttribute("aria-checked", "true");

          // Confirm discard (no title required for discard)
          await win.getByRole("button", { name: "Discard" }).click();

          // ── Assert: Inbox clear ───────────────────────────────────────────
          await expect(win.getByText("Inbox clear.")).toBeVisible({
            timeout: 15_000,
          });
        } finally {
          await secondLaunch.dispose();
        }
      } finally {
        await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  );
});
