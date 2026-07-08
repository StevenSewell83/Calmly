// One-shot smoke test for CALMLY_DEV_AUTH=stub. Launches a fresh Electron
// instance with an isolated userData dir, waits for the signed-in shell to
// render ("Peace, friend."), then exits. Intended to be run after touching
// the main-process auth wiring; not part of the regular test suite.
import { _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const mainEntry = join(desktopRoot, "out", "main", "index.js");

const userDataDir = await mkdtemp(join(tmpdir(), "calmly-stub-verify-"));
const app = await electron.launch({
  args: [
    mainEntry,
    `--user-data-dir=${userDataDir}`,
    ...(process.platform === "linux" ? ["--no-sandbox"] : []),
  ],
  env: {
    ...process.env,
    CALMLY_DEV_AUTH: "stub",
    CALMLY_DISABLE_DEVTOOLS: "1",
  },
});

let stubLogSeen = false;
app.process().stdout?.on("data", (d) => {
  const s = d.toString();
  if (s.includes("DEV STUB ENABLED")) stubLogSeen = true;
  process.stdout.write(`[main] ${s}`);
});
app
  .process()
  .stderr?.on("data", (d) =>
    process.stderr.write(`[main:err] ${d.toString()}`),
  );

const win = await app.firstWindow();
await win.waitForLoadState("domcontentloaded");

const ok = await win
  .getByText("Peace, friend.")
  .isVisible({ timeout: 15_000 })
  .catch(() => false);

await app.close().catch(() => {});
await rm(userDataDir, { recursive: true, force: true }).catch(() => {});

if (!ok) {
  console.error(
    "FAIL: home screen ('Peace, friend.') did not render within 15s",
  );
  process.exit(1);
}
if (!stubLogSeen) {
  console.error("FAIL: '[calmly:auth] DEV STUB ENABLED' was never logged");
  process.exit(1);
}
console.log("PASS: dev stub auth → home screen rendered");
