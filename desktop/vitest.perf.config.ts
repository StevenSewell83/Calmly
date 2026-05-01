import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/perf/**/*.perf.test.ts", "test/integration/**/*.spec.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 120_000,
    reporters: ["verbose"],
  },
});
