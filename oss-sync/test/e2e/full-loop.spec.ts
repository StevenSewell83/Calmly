import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

// OSS-07c · Full-loop smoke spec against a live server process.
// Covers: magic-link request → token parse → redeem → /auth/me → /sync/push round-trip.
// Designed to run in CI with the server started as a side-car (no Docker).
// CALMLY_SERVER_URL defaults to http://localhost:3001 via playwright.config.ts.

const MAIL_DIR = process.env.DEV_MAIL_DIR ?? "/tmp/calmly-mail";
const TEST_EMAIL = `e2e-${Date.now()}@calmly.test`;

test.describe("OSS self-host full loop", () => {
  let sessionToken = "";

  test("server is healthy", async ({ request }) => {
    const res = await request.get("/health");
    expect(res.status()).toBe(200);
  });

  test("magic-link request returns 200", async ({ request }) => {
    const res = await request.post("/auth/magic-link/request", {
      data: { email: TEST_EMAIL },
    });
    expect(res.status()).toBe(200);
  });

  test("magic-link token appears in mail dir and can be redeemed", async ({
    request,
  }) => {
    // Poll for the email file written by console mail sender.
    let token = "";
    for (let i = 0; i < 15; i++) {
      try {
        const files = fs
          .readdirSync(MAIL_DIR)
          .filter((f) => f.endsWith(".html"))
          .map((f) => path.join(MAIL_DIR, f))
          .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

        for (const file of files) {
          const content = fs.readFileSync(file, "utf8");
          const match = content.match(/token=([^&"]+)/);
          if (match) {
            token = match[1];
            break;
          }
        }
      } catch {
        // mail dir may not exist yet
      }
      if (token) break;
      await new Promise((r) => setTimeout(r, 2_000));
    }

    expect(token, "magic-link token must appear in mail dir").toBeTruthy();

    const res = await request.post("/auth/magic-link/redeem", {
      data: { token },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.user?.email).toBe(TEST_EMAIL);
    expect(body.token).toBeTruthy();

    sessionToken = body.token as string;
  });

  test("/auth/me returns authenticated user", async ({ request }) => {
    test.skip(!sessionToken, "requires session token from previous test");

    const res = await request.get("/auth/me", {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.user?.email).toBe(TEST_EMAIL);
  });

  test("/sync/push accepts an inbox capture and returns ack", async ({
    request,
  }) => {
    test.skip(!sessionToken, "requires session token from previous test");

    const payload = {
      ops: [
        {
          type: "inbox.add",
          payload: { raw_text: "OSS e2e smoke capture", id: "smoke-01" },
        },
      ],
    };

    const res = await request.post("/sync/push", {
      headers: { authorization: `Bearer ${sessionToken}` },
      data: payload,
    });

    // Accept 200 or 204; server may return { ok: true } or just 204.
    expect([200, 204]).toContain(res.status());
  });
});
