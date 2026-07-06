import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import { join } from "node:path";
import { launchPackagedApp } from "./_helpers";

// REL-09 item 2 (migrations): packaged-side enforcement of calmly-wv9
// (migration version-number collisions — per-worker unit tests passed while
// the assembled app couldn't boot). This queries `_meta_migrations` directly
// against the on-disk SQLite file the packaged app just wrote, from the test
// runner's own better-sqlite3 — a black-box check with no dependency on the
// Vite-glob migration loader (which only exists inside the Electron main
// bundle). The invariant: every version 1..N present exactly once, no gaps.
test.describe("packaged migrations", () => {
  test("fresh profile applies the full migration sweep with no gaps or collisions", async () => {
    const launched = await launchPackagedApp();
    const dbPath = join(launched.userDataDir, "calmly.db");
    try {
      await expect(launched.window.getByText("Welcome to Calmly.")).toBeVisible(
        { timeout: 20_000 },
      );
    } finally {
      // Close before opening our own connection. WAL mode permits concurrent
      // readers, but closing first sidesteps checkpoint/lock timing entirely
      // and matches the real "quit, then inspect the profile" flow.
      await launched.dispose();
    }

    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db
        .prepare("SELECT version FROM _meta_migrations ORDER BY version ASC")
        .all() as { version: number }[];
      const versions = rows.map((r) => r.version);

      expect(versions.length).toBeGreaterThan(0);
      // The PRIMARY KEY on `version` already forbids literal duplicate rows.
      // The collision class calmly-wv9 guards against is two migration files
      // independently claiming the same version number, which — once
      // renumbered by the fix — must not leave a gap or an out-of-order tip.
      // A contiguous 1..N run is the observable, black-box form of that
      // invariant.
      const expected = Array.from({ length: versions.length }, (_, i) => i + 1);
      expect(versions).toEqual(expected);
    } finally {
      db.close();
    }
  });
});
