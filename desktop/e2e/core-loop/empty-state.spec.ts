import { test, expect } from "@playwright/test";
import { startServerFixture, type ServerFixture } from "../fixtures/server";
import { isDockerAvailable } from "../fixtures/docker";
import { launchElectronApp, signInAsTestUser } from "../foundations/_helpers";

// CL-15c: empty-state spec — first-open flow.
//
// A freshly signed-in user with no data should see the "home-first-open"
// EmptyState. The CTA ("Capture a thought") focuses the CaptureBar.
// After one capture the row appears in Inbox and the inbox-clear EmptyState
// is replaced by real content.
//
// Self-skips without Docker (same pattern as all core-loop specs).

test.describe("CL-15c · empty-state first-open flow", () => {
  test.describe.configure({ timeout: 120_000 });

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
    "fresh user sees home-first-open EmptyState; CTA focuses CaptureBar; capture replaces inbox EmptyState",
    async () => {
      const launched = await launchElectronApp({ syncUrl: server!.url });
      try {
        // 1. Sign in (no seed data — brand-new user/DB).
        await signInAsTestUser({
          app: launched.electronApp,
          window: launched.window,
          server: server!,
          email: `empty-state-${Date.now()}@calmly.test`,
        });

        const win = launched.window;

        // 2. Home shows the first-open empty state (no tasks / events seeded).
        const homeEmptyState = win.locator('[data-empty-state="home-first-open"]');
        await expect(homeEmptyState).toBeVisible({ timeout: 10_000 });
        await expect(homeEmptyState.getByText("Welcome to Calmly.")).toBeVisible();

        // 3. CTA "Capture a thought" focuses the CaptureBar input.
        await win.getByRole("button", { name: "Capture a thought" }).click();
        const captureInput = win.getByLabel("Capture a thought");
        await expect(captureInput).toBeFocused({ timeout: 3_000 });

        // 4. Capture an item and confirm the toast.
        const captureText = "First thought ever";
        await captureInput.fill(captureText);
        await captureInput.press("Enter");
        await expect(win.getByText("Added to Inbox")).toBeVisible({
          timeout: 5_000,
        });

        // 5. Navigate to Inbox — the captured row is visible and the
        //    inbox-clear EmptyState is gone.
        await win.getByRole("link", { name: /inbox/i }).click();
        await expect(win.getByText(captureText)).toBeVisible({ timeout: 10_000 });
        await expect(
          win.locator('[data-empty-state="inbox-clear"]'),
        ).not.toBeVisible();
      } finally {
        await launched.dispose();
      }
    },
  );
});
