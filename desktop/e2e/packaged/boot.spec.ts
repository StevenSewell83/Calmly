import { test, expect } from "@playwright/test";
import { launchPackagedApp } from "./_helpers";

// REL-09 item 1 (boot): the packaged artifact must reach the REAL sign-in
// screen — including a regression guard that CALMLY_DEV_AUTH=stub (the
// dev-only fast-launch affordance, calmly-f6o) is dead once packaged.
// env-config.ts's resolveEnvConfig hard-codes `!isPackaged` into the gate
// (see calmly-y5z.9's REL-10 audit), so this asserts the packaged binary
// ignores the stub env var entirely rather than trusting that unit test
// alone — a future refactor that reads `app.isPackaged` in a different place
// could regress this without the unit test noticing.
test.describe("packaged boot", () => {
  test("reaches the real sign-in screen; CALMLY_DEV_AUTH=stub is inert when packaged", async () => {
    const launched = await launchPackagedApp({
      extraEnv: { CALMLY_DEV_AUTH: "stub" },
    });
    try {
      await expect(launched.window.getByText("Welcome to Calmly.")).toBeVisible(
        { timeout: 20_000 },
      );

      // Never signed in as the dev stub user (Home's greeting) — proves
      // isPackaged won over CALMLY_DEV_AUTH=stub rather than the sign-in
      // screen merely being slow to render.
      await expect(
        launched.window.getByText("Peace, friend."),
      ).not.toBeVisible();

      expect(launched.logs.join("")).not.toContain("DEV STUB ENABLED");

      // contextBridge surface intact under asar — catches preload
      // path/packaging regressions dev-mode E2E structurally can't see.
      const apiShape = await launched.window.evaluate(() => {
        const api = (window as unknown as { calmly?: Record<string, unknown> })
          .calmly;
        return api
          ? { present: true, keys: Object.keys(api).sort() }
          : { present: false, keys: [] };
      });
      expect(apiShape.present).toBe(true);
      expect(apiShape.keys).toEqual(
        expect.arrayContaining(["auth", "db", "log", "secrets", "sync"]),
      );
    } finally {
      await launched.dispose();
    }
  });
});
