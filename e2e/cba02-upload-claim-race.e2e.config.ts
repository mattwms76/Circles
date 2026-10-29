import { defineConfig } from "vitest/config";

/** This suite is intentionally outside default discovery and runs only through its fixed PG17 runner. */
export default defineConfig({
  test: {
    include: ["e2e/cba02-upload-claim-race.e2e.ts"],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 12_000,
    hookTimeout: 12_000,
    reporters: ["default"],
  },
});
