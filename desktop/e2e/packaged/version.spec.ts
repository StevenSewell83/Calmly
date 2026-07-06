import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { desktopRoot } from "./paths";
import { launchPackagedApp } from "./_helpers";

// REL-09 item 5 (version): electron-builder stamps the packaged app's
// version from desktop/package.json at build time, and REL-08's release
// pipeline is meant to write the git tag into that same file before building
// (single source: the tag). Asserting app.getVersion() against the on-disk
// package.json here is a build-time-stamping regression guard — if a future
// change patches the wrong file, or the checkout is stale when dist:linux
// runs, this catches it instead of shipping a mislabeled build silently.
test.describe("packaged version", () => {
  test("app.getVersion() matches desktop/package.json", async () => {
    const pkg = JSON.parse(
      readFileSync(join(desktopRoot, "package.json"), "utf8"),
    ) as { version: string };

    const launched = await launchPackagedApp();
    try {
      await expect(launched.window.getByText("Welcome to Calmly.")).toBeVisible(
        { timeout: 20_000 },
      );

      const runningVersion = await launched.electronApp.evaluate(({ app }) =>
        app.getVersion(),
      );
      expect(runningVersion).toBe(pkg.version);
    } finally {
      await launched.dispose();
    }
  });
});
