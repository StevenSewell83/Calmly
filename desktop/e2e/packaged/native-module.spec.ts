import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { launchPackagedApp } from "./_helpers";

// REL-09 item 3 (native module): the sign-in screen rendering already
// exercises better-sqlite3's READ path (SELECT version FROM _meta_migrations
// in runMigrations); this proves the WRITE path. initDb() runs the full
// migration sweep inside a transaction before the window is created, so a
// fresh profile's main-process log line names every version it just wrote —
// that INSERT can only have succeeded if the packaged app.asar.unpacked
// native binary (asarUnpack: ["**/*.node"] in electron-builder.yml) actually
// loaded and linked against the packaged Electron's Node ABI.
test.describe("packaged native module", () => {
  test("better-sqlite3 write path succeeds on a fresh profile", async () => {
    const launched = await launchPackagedApp();
    try {
      await expect(launched.window.getByText("Welcome to Calmly.")).toBeVisible(
        { timeout: 20_000 },
      );

      const combined = launched.logs.join("");
      const match = combined.match(
        /\[calmly:db] open path=(\S+) version=(\d+) appliedNow=\[([\d,]*)]/,
      );
      expect(match).not.toBeNull();
      const dbPath = match?.[1] ?? "";
      const versionStr = match?.[2] ?? "";
      const appliedNowStr = match?.[3] ?? "";

      expect(dbPath).toBe(join(launched.userDataDir, "calmly.db"));

      const appliedNow = appliedNowStr.length
        ? appliedNowStr.split(",").map(Number)
        : [];
      // Fresh profile: every migration is a first-time write.
      expect(appliedNow.length).toBeGreaterThan(0);
      expect(Number(versionStr)).toBe(Math.max(...appliedNow));
    } finally {
      await launched.dispose();
    }
  });
});
