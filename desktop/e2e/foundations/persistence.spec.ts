import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServerFixture, type ServerFixture } from "../fixtures/server";
import { isDockerAvailable } from "../fixtures/docker";
import { launchElectronApp, signInAsTestUser } from "./_helpers";

// window.calmly is typed globally via desktop/e2e/window-globals.d.ts.

// F-14d: prove the encrypted session cookie survives a full Electron
// restart. The threat being guarded: an accidental clear of the cookie jar
// on quit (e.g. someone wires session.defaultSession.clearStorageData into a
// teardown path). If that regresses, every user has to magic-link in again
// after every restart.
//
// Approach:
//   1. Launch Electron with a fresh user-data-dir.
//   2. Sign in via the F-14c helper.
//   3. Close the app cleanly.
//   4. Launch again with the SAME user-data-dir.
//   5. On cold boot, AuthProvider's status() probe should hit /auth/me with
//      the persisted session cookie, the server should recognize it, and
//      AuthGate should skip SignIn entirely — Home renders directly.
//
// The user-data-dir is owned by the spec (not the helper) because we need
// to share it across two launches; launchElectronApp's dispose only deletes
// dirs it created itself.

test.describe("F-14d · session persistence", () => {
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

  test("signed-in session survives Electron restart with same user-data-dir", async () => {
    const userDataDir = await mkdtemp(
      join(tmpdir(), "calmly-e2e-persistence-"),
    );
    const email = `persistence-${Date.now()}@calmly.test`;

    try {
      // First launch: cold profile, must sign in.
      const first = await launchElectronApp({
        syncUrl: server!.url,
        userDataDir,
      });
      let signedInUserId: string;
      try {
        const result = await signInAsTestUser({
          app: first.electronApp,
          window: first.window,
          server: server!,
          email,
        });
        signedInUserId = result.user.id;
        expect(result.user.email).toBe(email);
      } finally {
        await first.dispose();
      }

      // Second launch: SAME profile dir. The session cookie set by the
      // server during redeem should still be in Electron's persistent
      // cookie jar under userDataDir/Network/Cookies. AuthProvider's
      // status() probe should resolve directly to signed_in and the
      // SignIn screen should never render.
      const second = await launchElectronApp({
        syncUrl: server!.url,
        userDataDir,
      });
      try {
        // Watchdog: if SignIn ever shows, fail fast with a clearer message
        // than a 10s timeout on the Home assertion. Use a short cap because
        // on a healthy run the renderer goes straight to Home; on a broken
        // run SignIn appears within a couple hundred ms.
        await Promise.race([
          expect(second.window.getByText("Peace, friend.")).toBeVisible({
            timeout: 15_000,
          }),
          (async () => {
            const seen = await second.window
              .getByText("Welcome to Calmly.")
              .waitFor({ state: "visible", timeout: 5_000 })
              .then(() => true)
              .catch(() => false);
            if (seen) {
              throw new Error(
                "persistence regression: SignIn rendered on second launch — session cookie did not survive restart",
              );
            }
          })(),
        ]);

        const status = await second.window.evaluate(() =>
          window.calmly.auth.status(),
        );
        expect(status.signedIn).toBe(true);
        if (status.signedIn) {
          expect(status.user.email).toBe(email);
          // The server should hand back the SAME user row, not provision a
          // new one. Catches a broken cookie that's still sent but matches
          // a different session.
          expect(status.user.id).toBe(signedInUserId);
        }
      } finally {
        await second.dispose();
      }
    } finally {
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
