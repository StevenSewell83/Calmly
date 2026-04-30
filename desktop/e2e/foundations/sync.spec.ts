import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { startServerFixture, type ServerFixture } from "../fixtures/server";
import { isDockerAvailable } from "../fixtures/docker";
import {
  launchElectronApp,
  signInAsTestUser,
  type LaunchedElectron,
} from "./_helpers";

// window.calmly is typed globally via desktop/e2e/window-globals.d.ts.

// Shape of a fastify Cookie returned by Electron's session.cookies.get(). We
// only need name/value; declared narrowly to keep the test clean.
interface ElectronCookie {
  name: string;
  value: string;
}

interface PushResponse {
  results: { status: string; version: number | null }[];
  version: number;
}

// F-14e: cloud-first sync round-trip smoke. Two Electron clients with
// separate user-data-dirs sign in as the same email (server merges to one
// user). A push originates from client A's authenticated session via the
// real /sync/push endpoint, then client B's renderer drives sync.syncNow()
// and we assert the pull cursor advanced past the push version.
//
// Why HTTP from the test process for the push half: the renderer surface is
// (status, syncNow) only — there's no exposed window.calmly.db or
// sync.push. Using A's cookie + a raw POST exercises the same code path the
// main process would, without inventing test-only IPC. The protocol-layer
// assertion ("data written by one session, pulled by another") is identical
// either way.
//
// F-11c (calmly-76j) owns the comprehensive sync coverage (offline mode,
// soft-delete, idempotency cycling); this stays narrowly the smoke
// happy-path so we don't write duplicate coverage.

test.describe("F-14e · multi-client sync round-trip", () => {
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

  test("client A pushes an inbox item, client B pulls it on next syncNow", async () => {
    const sharedEmail = `sync-${Date.now()}@calmly.test`;
    let clientA: LaunchedElectron | null = null;
    let clientB: LaunchedElectron | null = null;

    try {
      clientA = await launchElectronApp({ syncUrl: server!.url });
      await signInAsTestUser({
        app: clientA.electronApp,
        window: clientA.window,
        server: server!,
        email: sharedEmail,
      });

      clientB = await launchElectronApp({ syncUrl: server!.url });
      await signInAsTestUser({
        app: clientB.electronApp,
        window: clientB.window,
        server: server!,
        email: sharedEmail,
      });

      // 1. Pull A's session cookies from Electron's persistent jar. We send
      // all cookies the jar has for the API origin so we don't need to know
      // the auth cookie's name (it's a server-side detail).
      const cookieHeader = await extractCookieHeader(clientA, server!.url);

      // 2. Push a synthetic inbox_items record from the test process using
      // A's cookie. SyncMetaSchema requires id/updated_at/deleted_at/version
      // even though version is overwritten server-side; passing 0 keeps it
      // valid against the schema's nonnegative-int constraint.
      const recordId = randomUUID();
      const now = Date.now();
      const pushBody = {
        ops: [
          {
            table: "inbox_items",
            op: "upsert" as const,
            payload: {
              id: recordId,
              raw_text: "F-14e smoke — written by client A",
              source: "desktop",
              created_at: now,
              resolved_at: null,
              updated_at: now,
              deleted_at: null,
              version: 0,
            },
          },
        ],
      };
      const pushRes = await fetch(`${server!.url}/sync/push`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: cookieHeader,
        },
        body: JSON.stringify(pushBody),
      });
      expect(pushRes.status).toBe(200);
      const pushJson = (await pushRes.json()) as PushResponse;
      expect(pushJson.results[0]?.status).toBe("accepted");
      expect(pushJson.version).toBeGreaterThan(0);
      const serverVersion = pushJson.version;

      // 3. Drive client B's renderer sync. Poll because the production code
      // path runs through fetch + parse + state update, and the bead's
      // acceptance explicitly tolerates LWW timing. In practice this
      // succeeds on the first call once the server has committed (which it
      // already has, since pushRes.ok was 200), but the poll keeps the test
      // robust against any background-loop tick interleaving.
      await expect
        .poll(
          async () => {
            const res = await clientB!.window.evaluate(() =>
              window.calmly.sync.syncNow(),
            );
            return {
              ok: res.ok,
              pulled: res.pulled,
              cursor: res.lastPulledVersion,
            };
          },
          { timeout: 10_000, intervals: [200, 500, 1000] },
        )
        .toMatchObject({ ok: true, cursor: serverVersion });

      // 4. Idempotency check: a second syncNow at the same cursor returns
      // pulled=0 because nothing new arrived. This catches a regression
      // where the cursor isn't being advanced and B re-pulls the same
      // record forever.
      const replay = await clientB.window.evaluate(() =>
        window.calmly.sync.syncNow(),
      );
      expect(replay.ok).toBe(true);
      expect(replay.pulled).toBe(0);
      expect(replay.lastPulledVersion).toBe(serverVersion);
    } finally {
      if (clientB) await clientB.dispose();
      if (clientA) await clientA.dispose();
    }
  });
});

// Reach into Electron's session cookie jar for whichever cookies were set on
// the API origin (the magic-link redeem put a session cookie there). Joins
// them into a single Cookie header so the test can act as the client when
// hitting /sync/push directly.
async function extractCookieHeader(
  client: LaunchedElectron,
  apiUrl: string,
): Promise<string> {
  const cookies = await client.electronApp.evaluate(
    async ({ session }, url) => {
      const list = await session.defaultSession.cookies.get({ url });
      return list.map((c) => ({ name: c.name, value: c.value }));
    },
    apiUrl,
  );
  if (cookies.length === 0) {
    throw new Error(
      `extractCookieHeader: no cookies in jar for ${apiUrl} — did sign-in actually complete?`,
    );
  }
  return cookies.map((c: ElectronCookie) => `${c.name}=${c.value}`).join("; ");
}
