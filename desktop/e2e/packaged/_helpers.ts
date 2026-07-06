import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPackagedBuildExists, packagedExecutablePath } from "./paths";

export interface LaunchedPackagedApp {
  electronApp: ElectronApplication;
  window: Page;
  userDataDir: string;
  // Combined main-process stdout+stderr captured so far, in emission order.
  // Used to assert on log lines (e.g. the `[calmly:db]` boot line) without a
  // separate IPC probe — see native-module.spec.ts.
  logs: string[];
  dispose: () => Promise<void>;
}

export interface LaunchPackagedAppOptions {
  // Reuse a profile dir across launches for the persistence spec; defaults
  // to a fresh mkdtemp per call so every other spec gets a hermetic profile.
  userDataDir?: string;
  extraEnv?: NodeJS.ProcessEnv;
}

// Launches the REAL packaged binary (release/linux-unpacked/calmly) rather
// than the electron-vite dev build — the entire point of this suite
// (calmly-y5z.8 / REL-09). Mirrors desktop/e2e/fixtures/electronApp.ts and
// desktop/e2e/foundations/_helpers.ts's launchElectronApp, adapted to
// `executablePath` launch instead of a script entrypoint.
export async function launchPackagedApp(
  opts: LaunchPackagedAppOptions = {},
): Promise<LaunchedPackagedApp> {
  assertPackagedBuildExists();

  const userDataDir =
    opts.userDataDir ?? (await mkdtemp(join(tmpdir(), "calmly-e2e-packaged-")));

  const app = await electron.launch({
    executablePath: packagedExecutablePath,
    args: [
      `--user-data-dir=${userDataDir}`,
      // Linux CI runners can't run Electron's setuid sandbox helper.
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    ],
    env: {
      ...process.env,
      NODE_ENV: "test",
      // Point sync at an unreachable host so /auth/me fails fast (no DNS
      // round-trip, no slow timeout) and the renderer settles on the real
      // SignIn screen deterministically — matching the dev-build fixture.
      // Packaged builds have no CALMLY_DEV_AUTH gate to defeat (env-config.ts
      // makes `isPackaged` win unconditionally — see boot.spec.ts), but this
      // suite still shouldn't depend on a live sync server.
      CALMLY_SYNC_URL: "http://127.0.0.1:1",
      CALMLY_DISABLE_DEVTOOLS: "1",
      ...(opts.extraEnv ?? {}),
    },
  });

  const logs: string[] = [];
  const capture = (d: Buffer): void => {
    const text = d.toString();
    logs.push(text);
    process.stdout.write(`[packaged-main] ${text}`);
  };
  app.process().stdout?.on("data", capture);
  app.process().stderr?.on("data", capture);

  const window = await app.firstWindow();
  window.on("pageerror", (e) =>
    process.stderr.write(`[packaged-renderer-pageerror] ${e.message}\n`),
  );
  window.on("console", (m) =>
    process.stdout.write(`[packaged-renderer-${m.type()}] ${m.text()}\n`),
  );
  await window.waitForLoadState("domcontentloaded");

  let disposed = false;
  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    await app.close().catch(() => {
      /* already exited */
    });
    // Only delete the dir we created ourselves; a caller-supplied dir is
    // owned by the caller (persistence.spec.ts chains a second launch onto
    // the same dir before removing it).
    if (!opts.userDataDir) {
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {
        /* best effort */
      });
    }
  };

  return { electronApp: app, window, userDataDir, logs, dispose };
}
