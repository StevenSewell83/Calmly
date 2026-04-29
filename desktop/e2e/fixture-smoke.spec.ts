import { test, expect } from "@playwright/test";
import { startServerFixture, type ServerFixture } from "./fixtures/server";
import { pollForMagicLink } from "./fixtures/devMail";
import { isDockerAvailable } from "./fixtures/docker";

// This spec exercises the F-14a server fixture WITHOUT launching Electron.
// It proves: testcontainers Postgres boots → migrations apply → @calmly/server
// starts → /health is 200 → POST /auth/magic-link/request triggers a console-
// mail file → pollForMagicLink parses out a valid token. Once this passes,
// downstream specs (auth/nav/persistence/sync) can layer Electron on top.
//
// Prereq: Docker daemon running. The container boot is the slow path
// (~3-8s); set the test timeout accordingly. On dev machines without Docker
// the spec self-skips so the local test:e2e command still goes green; CI
// (which has Docker) executes it for real.

test.describe("server fixture smoke", () => {
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

  test("/health returns 200", async () => {
    const r = await fetch(`${server!.url}/health`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("magic-link request writes a parseable email to dev-mail dir", async () => {
    const since = new Date();
    const r = await fetch(`${server!.url}/auth/magic-link/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "smoke@calmly.test" }),
    });
    expect(r.status).toBe(200);

    const email = await pollForMagicLink(server!.devMailDir, {
      since,
      timeoutMs: 10_000,
    });
    expect(email.token.length).toBeGreaterThan(16);
    expect(email.link).toContain("/auth/magic-link/redeem?token=");
    // Token should successfully redeem against the same server.
    const redeem = await fetch(`${server!.url}/auth/magic-link/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: email.token }),
    });
    expect(redeem.status).toBe(200);
    const redeemBody = (await redeem.json()) as {
      user: { email: string };
    };
    expect(redeemBody.user.email).toBe("smoke@calmly.test");
  });
});
