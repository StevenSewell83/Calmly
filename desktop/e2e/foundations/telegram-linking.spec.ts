import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { launchElectronApp } from "./_helpers";

// TGR-06: proves the Settings -> Telegram page's Unlinked -> Linked
// transition end-to-end, driven by live 3s polling. Unlike the other
// foundations specs, this one does NOT boot the real @calmly/server +
// Postgres fixture (fixtures/server.ts) — there's nothing here that needs a
// database, and stubbing keeps the spec fast and Docker-free. Sign-in is
// bypassed via CALMLY_DEV_AUTH=stub (see CLAUDE.md "Fast dev launch"; gated
// on !app.isPackaged so this only works in dev/test builds) so the only
// thing under test is the Telegram linking flow itself.

interface StubServerState {
  linked: boolean;
  chatId: string;
  linkedAt: number;
}

interface StubServer {
  url: string;
  state: StubServerState;
  close: () => Promise<void>;
}

const STUB_BOT_USERNAME = "CalmlyStubBot";
const STUB_CODE = "ABCD1234";

// Minimal hand-rolled HTTP stub for the three TG-02b linking routes plus
// /telegram/health (bot username). Runs in-process (not a child process)
// so the spec can flip `state.linked` directly to simulate the user
// messaging the bot from their phone, without needing a real Telegram
// round trip.
function startStubServer(): Promise<StubServer> {
  const state: StubServerState = { linked: false, chatId: "stub-chat-1", linkedAt: 0 };

  const server: Server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");

    if (req.method === "GET" && req.url === "/telegram/linking/status") {
      if (state.linked) {
        res.end(JSON.stringify({ linked: true, chatId: state.chatId, linkedAt: state.linkedAt }));
      } else {
        res.end(JSON.stringify({ linked: false }));
      }
      return;
    }

    if (req.method === "POST" && req.url === "/telegram/linking/code") {
      res.end(JSON.stringify({ code: STUB_CODE, expiresAt: Date.now() + 15 * 60 * 1000 }));
      return;
    }

    if (req.method === "GET" && req.url === "/telegram/health") {
      res.end(JSON.stringify({ ok: true, botUsername: STUB_BOT_USERNAME, webhookSet: false, webhookUrl: null }));
      return;
    }

    if (req.method === "POST" && req.url === "/telegram/linking/unlink") {
      state.linked = false;
      res.end(JSON.stringify({ ok: true, deleted: 1 }));
      return;
    }

    // Anything else (sync, calendar refresh, telemetry probes from the rest
    // of the app booting up) — a bare 404 the callers already handle as a
    // non-fatal network blip.
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not_found" }));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr !== "object" || addr === null) {
        reject(new Error("stub server: could not determine bound port"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        state,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

test.describe("TGR-06 · Telegram linking", () => {
  test.describe.configure({ timeout: 60_000 });

  let stub: StubServer;

  test.beforeEach(async () => {
    stub = await startStubServer();
  });

  test.afterEach(async () => {
    await stub.close();
  });

  test("Unlinked -> code + deep link -> Linked on status flip", async () => {
    const launched = await launchElectronApp({
      syncUrl: stub.url,
      extraEnv: { CALMLY_DEV_AUTH: "stub" },
    });
    try {
      await launched.window.getByRole("link", { name: "Settings" }).click();
      await launched.window.getByRole("link", { name: "Telegram" }).click();

      await expect(launched.window.getByText("Not linked yet")).toBeVisible({
        timeout: 10_000,
      });

      await launched.window.getByRole("button", { name: "Get code" }).click();
      await expect(launched.window.getByText(STUB_CODE)).toBeVisible({ timeout: 10_000 });

      const deepLink = launched.window.getByRole("link", { name: "Open in Telegram" });
      await expect(deepLink).toHaveAttribute(
        "href",
        `https://t.me/${STUB_BOT_USERNAME}?start=${STUB_CODE}`,
      );

      // Simulate the user messaging the bot on their phone: flip the stub's
      // status. The page's 3s poll (see Telegram.tsx) should pick this up
      // without any further interaction.
      stub.state.linked = true;
      stub.state.linkedAt = Date.now();

      await expect(launched.window.getByText("Telegram connected")).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        launched.window.getByRole("button", { name: "Unlink Telegram" }),
      ).toBeVisible();
    } finally {
      await launched.dispose();
    }
  });
});
