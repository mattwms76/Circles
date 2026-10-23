import { defineConfig } from "vitest/config";

/**
 * This config is deliberately separate from normal unit-test discovery. Run it only through
 * scripts/run-circle-home-e2e.py --suite activity, which provides the fresh loopback-only PG17
 * fixture, synthetic identities, and sanitized child environment.
 */
export default defineConfig({
  test: {
    include: ["e2e/activity.e2e.ts"],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 12_000,
    hookTimeout: 12_000,
    reporters: ["default"],
  },
});
