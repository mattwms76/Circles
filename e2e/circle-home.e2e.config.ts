import { defineConfig } from "vitest/config";

/**
 * This config is deliberately separate from the normal unit-test discovery.
 * Run it only through scripts/run-circle-home-e2e.py, which provides a fresh,
 * loopback-only PostgreSQL 17 fixture and a sanitized child environment.
 */
export default defineConfig({
  test: {
    include: ["e2e/circle-home.e2e.ts"],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 12_000,
    hookTimeout: 12_000,
    reporters: ["default"],
  },
});
