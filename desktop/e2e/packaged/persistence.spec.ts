import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchPackagedApp } from "./_helpers";

// REL-09 item 4 (persistence): relaunch with the SAME --user-data-dir and
// confirm the profile is still "past first-run":
//   - window bounds saved by electron-window-state (desktop/src/main/
//     bootstrap/window.ts) survive the restart;
//   - the SQLite profile is reused, not recreated — the second boot's
//     migration-sweep log line reports nothing new applied.
// No real sync server is available to this suite (see _helpers.ts), so this
// intentionally does not cover signed-in session persistence — that's
// desktop/e2e/foundations/persistence.spec.ts's job against the dev build.
test.describe("packaged persistence", () => {
  test.describe.configure({ timeout: 60_000 });

  test("window state and SQLite profile survive an Electron restart", async () => {
    const userDataDir = await mkdtemp(
      join(tmpdir(), "calmly-e2e-packaged-persistence-"),
    );
    const distinctBounds = { x: 40, y: 60, width: 1200, height: 800 };

    try {
      const first = await launchPackagedApp({ userDataDir });
      let firstVersion: string;
      try {
        await expect(first.window.getByText("Welcome to Calmly.")).toBeVisible({
          timeout: 20_000,
        });

        await first.electronApp.evaluate(({ BrowserWindow }, bounds) => {
          const win = BrowserWindow.getAllWindows()[0];
          if (!win) throw new Error("no BrowserWindow to resize");
          win.setBounds(bounds);
        }, distinctBounds);

        // electron-window-state debounces its 'resize' listener; give it a
        // moment before quitting even though its 'close' handler also
        // force-flushes the final bounds.
        await first.window.waitForTimeout(500);

        const bootMatch = first.logs
          .join("")
          .match(/\[calmly:db] open path=\S+ version=(\d+)/);
        expect(bootMatch).not.toBeNull();
        firstVersion = bootMatch?.[1] ?? "";

        // Quit (not just disconnect) so the BrowserWindow's 'close' event
        // fires and electron-window-state persists the final bounds.
        await first.electronApp.evaluate(({ app }) => app.quit());
      } finally {
        await first.dispose();
      }

      const second = await launchPackagedApp({ userDataDir });
      try {
        await expect(second.window.getByText("Welcome to Calmly.")).toBeVisible(
          { timeout: 20_000 },
        );

        const restoredBounds = await second.electronApp.evaluate(
          ({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()[0];
            return win?.getBounds();
          },
        );
        expect(restoredBounds).toMatchObject({
          width: distinctBounds.width,
          height: distinctBounds.height,
        });

        // Same DB file reused, not recreated: second boot's migration sweep
        // has nothing new to apply, and the tip version is unchanged.
        const bootMatch = second.logs
          .join("")
          .match(
            /\[calmly:db] open path=\S+ version=(\d+) appliedNow=\[([\d,]*)]/,
          );
        expect(bootMatch).not.toBeNull();
        const versionStr = bootMatch?.[1] ?? "";
        const appliedNowStr = bootMatch?.[2] ?? "";
        expect(versionStr).toBe(firstVersion);
        expect(appliedNowStr).toBe("");
      } finally {
        await second.dispose();
      }
    } finally {
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {
        /* best effort */
      });
    }
  });
});
