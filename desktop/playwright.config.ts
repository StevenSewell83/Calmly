import { defineConfig } from "@playwright/test";

// Hermetic Electron E2E config. Tests launch the prod build (out/main/index.js)
// rather than the dev server so we avoid HMR and renderer-URL races. Set
// CALMLY_E2E_HEADED=1 locally to run with a visible window.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  // e2e/packaged/** is a separate suite (REL-09, playwright.packaged.config.ts)
  // that launches the electron-builder Linux artifact and requires a prior
  // `dist:linux` — exclude it here so `test:e2e` never depends on that build.
  testIgnore: /e2e[\\/]packaged[\\/]/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"]
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  outputDir: "./e2e-results",
  projects: [
    {
      name: "electron",
      testDir: "./e2e",
    },
  ],
});
