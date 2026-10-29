import { defineConfig } from "vitest/config";

/** Runs only through the fixed loopback-only PostgreSQL 17 fixture runner. */
export default defineConfig({
  test: {
    include: ["e2e/cba03-social-pagination.e2e.ts"],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 12_000,
    hookTimeout: 12_000,
    reporters: ["default"],
  },
});
