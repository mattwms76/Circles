import { defineConfig } from "vitest/config";

/** This suite is intentionally outside default discovery and runs only through its fixed PG17 runner. */
export default defineConfig({
  test: {
    include: ["e2e/cba06-media-upload-budget.e2e.ts"],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    reporters: ["default"],
  },
});
