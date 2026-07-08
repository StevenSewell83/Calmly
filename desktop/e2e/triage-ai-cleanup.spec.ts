/**
 * E2E: Triage AI cleanup panel
 *
 * These tests require:
 *   - AI enabled in settings (Settings → AI → enable toggle)
 *   - A valid Anthropic API key saved
 *
 * Run with: PLAYWRIGHT_AI=1 pnpm e2e
 * Skipped by default to keep CI fast.
 */
import { test, expect } from "@playwright/test";

const AI_E2E = process.env.PLAYWRIGHT_AI === "1";

test.describe("Triage AI cleanup panel", () => {
  test.skip(!AI_E2E, "Set PLAYWRIGHT_AI=1 to run AI E2E tests");

  test("AI cleanup button visible when AI enabled", async ({ page }) => {
    await page.goto("/inbox/triage");
    await expect(
      page.getByRole("button", { name: /ai cleanup/i }),
    ).toBeVisible();
  });

  test("panel opens and shows loading then suggestion", async ({ page }) => {
    await page.goto("/inbox/triage");
    await page.getByRole("button", { name: /ai cleanup/i }).click();
    await expect(page.getByText("AI Suggestion")).toBeVisible();
    await page.getByRole("button", { name: /get suggestion/i }).click();
    await expect(page.getByText("Thinking…")).toBeVisible();
    // Wait for suggestion (real API call, may take a few seconds)
    await expect(page.getByText(/type/i)).toBeVisible({ timeout: 15_000 });
  });

  test("discard records rejected outcome and closes panel", async ({
    page,
  }) => {
    await page.goto("/inbox/triage");
    await page.getByRole("button", { name: /ai cleanup/i }).click();
    await page.getByRole("button", { name: /get suggestion/i }).click();
    await page.getByRole("button", { name: /discard/i }).click();
    await expect(page.getByText("AI Suggestion")).not.toBeVisible();
  });
});
