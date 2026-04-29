import { test, expect } from "@playwright/test";
import { startServerFixture, type ServerFixture } from "../fixtures/server";
import { isDockerAvailable } from "../fixtures/docker";
import { launchElectronApp, signInAsTestUser } from "./_helpers";
import type { InboxAddResult, SyncResult } from "../../src/preload/api-types";

declare const window: {
  calmly: {
    inbox: {
      add: (rawText: string) => Promise<InboxAddResult>;
    };
    sync: {
      syncNow: () => Promise<SyncResult>;
    };
  };
};

// CL-02 quick-capture e2e. Signs in, types into the CaptureBar, asserts
// the inline confirmation, then forces a sync.syncNow and asserts pushed
// >= 1 — the cleanest end-to-end proof that the row both committed to
// local SQLite (via the inbox.add IPC) and was queued for the server (via
// addInboxItem's enqueueOp inside the same transaction). Self-skips
// without Docker.

test.describe("CL-02 · quick capture", () => {
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

  test("CaptureBar typing + Enter persists, confirms, and syncs", async () => {
    const launched = await launchElectronApp({ syncUrl: server!.url });
    try {
      await signInAsTestUser({
        app: launched.electronApp,
        window: launched.window,
        server: server!,
        email: `capture-${Date.now()}@calmly.test`,
      });

      const captureInput = launched.window.getByLabel("Capture a thought");
      await expect(captureInput).toBeVisible();

      // 1. Empty submit is a no-op: Add button is disabled, Enter on empty
      // input does not flash a confirmation. We verify the Add button is
      // disabled and skip the Enter check (Playwright won't let us fill
      // an empty string anyway — emptiness is the default).
      await expect(
        launched.window.getByRole("button", { name: "Add" }),
      ).toBeDisabled();

      // 2. Real capture: type, submit, assert confirmation.
      await captureInput.fill("buy milk");
      await captureInput.press("Enter");
      await expect(launched.window.getByText("Added to Inbox")).toBeVisible({
        timeout: 5_000,
      });
      // The optimistic clear means the input goes empty after submit.
      await expect(captureInput).toHaveValue("");

      // 3. Force a sync. The captured item should now be on the server
      // (op_queue → /sync/push). pushed >= 1 proves the row both
      // committed locally and queued in op_queue inside the same tx.
      const syncResult = await launched.window.evaluate(() =>
        window.calmly.sync.syncNow(),
      );
      expect(syncResult.ok).toBe(true);
      expect(syncResult.pushed).toBeGreaterThanOrEqual(1);
      expect(syncResult.pendingAfter).toBe(0);

      // 4. Truncation path: 4500 chars → server clips to 4000 + flags it.
      // Use the IPC directly so we don't have to type 4500 characters into
      // the DOM input (Playwright's fill() works but the visible UI bits
      // are already covered above).
      const longResult = await launched.window.evaluate(
        (oversize) => window.calmly.inbox.add(oversize),
        "x".repeat(4500),
      );
      expect(longResult.ok).toBe(true);
      if (longResult.ok) {
        expect(longResult.truncated).toBe(true);
      }
    } finally {
      await launched.dispose();
    }
  });
});
