import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.CALMLY_SERVER_URL ?? "http://localhost:3001",
  },
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
});
