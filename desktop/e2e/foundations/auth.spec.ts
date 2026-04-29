import { test, expect } from "@playwright/test";
import { startServerFixture, type ServerFixture } from "../fixtures/server";
import { isDockerAvailable } from "../fixtures/docker";
import { launchElectronApp, signInAsTestUser } from "./_helpers";
import type { RedeemResult } from "../../src/preload/api-types";

// Same DOM-shim trick as _helpers.ts — node tsconfig has no DOM lib so the
// renderer-side `window.calmly.*` surface needs a hand-rolled declaration
// for the evaluate callbacks below.
declare const window: {
  calmly: {
    auth: {
      redeem: (token: string) => Promise<RedeemResult>;
    };
  };
};

// F-14c: end-to-end magic-link auth through the real server fixture.
//
// Boots a single ephemeral Postgres + @calmly/server for the whole file so we
// only pay the testcontainer/migration cost once. Each test launches its own
// Electron instance against that server and tears it down afterward, keeping
// per-test isolation on the renderer/cookie-jar side.
//
// The container start is the slow path (~3-8s on warm Docker, ~30s cold), so
// we extend the per-spec timeout. On dev machines without Docker the suite
// self-skips so `pnpm test:e2e` stays green locally; CI (which has Docker)
// runs it for real.

test.describe("F-14c · magic-link auth", () => {
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

  test("requestLink → dev-mail poll → deep-link redeem → /auth/me returns user", async () => {
    const launched = await launchElectronApp({ syncUrl: server!.url });
    try {
      const email = `auth-spec-${Date.now()}@calmly.test`;
      const result = await signInAsTestUser({
        app: launched.electronApp,
        window: launched.window,
        server: server!,
        email,
      });

      expect(result.user.email).toBe(email);
      expect(result.user.id.length).toBeGreaterThan(0);
      expect(result.token.length).toBeGreaterThan(16);
    } finally {
      await launched.dispose();
    }
  });

  test("redeeming the same token a second time fails (single-use)", async () => {
    const launched = await launchElectronApp({ syncUrl: server!.url });
    try {
      const { token } = await signInAsTestUser({
        app: launched.electronApp,
        window: launched.window,
        server: server!,
        email: `single-use-${Date.now()}@calmly.test`,
      });

      // Replay the same token through the renderer's redeem IPC. Magic-link
      // tokens are single-use; the server should reject the second attempt
      // and the renderer's bridge should surface invalid_or_expired.
      const replay = await launched.window.evaluate(
        (t) => window.calmly.auth.redeem(t),
        token,
      );
      expect(replay.ok).toBe(false);
      if (!replay.ok) {
        expect(replay.error).toBe("invalid_or_expired");
      }
    } finally {
      await launched.dispose();
    }
  });
});
