import { defineConfig } from "vitest/config";

/** This suite is intentionally outside default discovery and runs only through its fixed PG17 runner. */
export default defineConfig({
  test: {
    include: ["e2e/cba04-live-chat-bounds.e2e.ts"],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    reporters: ["default"],
  },
});
