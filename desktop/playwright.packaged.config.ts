import { defineConfig } from "@playwright/test";
import { assertPackagedBuildExists } from "./e2e/packaged/paths";

// REL-09 packaged-build smoke suite (calmly-y5z.8). Deliberately a SEPARATE
// Playwright project/config from playwright.config.ts (which launches the
// electron-vite dev build via out/main/index.js) so the default `test:e2e`
// command never accidentally tries to launch a packaged artifact that may
// not exist. This config requires a prior
// `pnpm --filter @calmly/desktop dist:linux` — fail fast with a clear error
// at config-load time (before Playwright even starts a worker) rather than a
// cryptic ENOENT/spawn failure from _electron.launch() deep inside a test.
assertPackagedBuildExists();

export default defineConfig({
  testDir: "./e2e/packaged",
  testMatch: /.*\.spec\.ts$/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"]
    ? [
        ["list"],
        ["html", { open: "never", outputFolder: "playwright-report-packaged" }],
      ]
    : [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  outputDir: "./e2e-results-packaged",
  projects: [
    {
      name: "electron-packaged",
      testDir: "./e2e/packaged",
    },
  ],
});
