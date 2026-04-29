import {
  test as base,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// e2e/fixtures/electronApp.ts → desktop/
const desktopRoot = resolve(__dirname, "..", "..");
const mainEntry = join(desktopRoot, "out", "main", "index.js");

interface ElectronFixtures {
  electronApp: ElectronApplication;
  window: Page;
}

export const test = base.extend<ElectronFixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixture signature
  electronApp: async ({}, use) => {
    // Each test gets an isolated --user-data-dir so the SQLite cache,
    // cookie jar, and electron-window-state file from one test never leak
    // into another (or into the developer's real Calmly profile).
    const userDataDir = await mkdtemp(join(tmpdir(), "calmly-e2e-"));

    // Linux CI sandboxing: GitHub-hosted runners can't run Electron's setuid
    // sandbox helper, so we drop it. Local macOS/Windows are unaffected.
    const launchArgs = [
      mainEntry,
      `--user-data-dir=${userDataDir}`,
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    ];

    const app = await electron.launch({
      args: launchArgs,
      env: {
        ...process.env,
        NODE_ENV: "test",
        // Point sync at 127.0.0.1:1 so the connection fails fast with
        // ECONNREFUSED (no DNS round-trip and no slow timeout). The renderer
        // then settles on SignIn deterministically within a few hundred ms.
        CALMLY_SYNC_URL: "http://127.0.0.1:1",
        // Don't show DevTools during tests even if isDev resolves true.
        CALMLY_DISABLE_DEVTOOLS: "1",
      },
    });

    // Surface main-process stdout/stderr in the test reporter so a crashed
    // launch produces actionable output instead of a bare firstWindow timeout.
    app.process().stdout?.on("data", (d: Buffer) => {
      process.stdout.write(`[electron-main] ${d.toString()}`);
    });
    app.process().stderr?.on("data", (d: Buffer) => {
      process.stderr.write(`[electron-main] ${d.toString()}`);
    });

    try {
      await use(app);
    } finally {
      await app.close().catch(() => {
        /* already exited */
      });
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {
        /* best effort */
      });
    }
  },

  window: async ({ electronApp }, use) => {
    const win = await electronApp.firstWindow();
    win.on("pageerror", (e) =>
      process.stderr.write(`[renderer-pageerror] ${e.message}\n`),
    );
    win.on("console", (m) =>
      process.stdout.write(`[renderer-${m.type()}] ${m.text()}\n`),
    );
    await win.waitForLoadState("domcontentloaded");
    await use(win);
  },
});

export { expect } from "@playwright/test";
