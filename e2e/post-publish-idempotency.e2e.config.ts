import { defineConfig } from "vitest/config";

/**
 * Deliberately outside normal unit-test discovery. Run only through the fixed local PG17 runner,
 * which provides a fresh loopback fixture, synthetic actors, and a credential-free environment.
 */
export default defineConfig({
  test: {
    include: ["e2e/post-publish-idempotency.e2e.ts"],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 12_000,
    hookTimeout: 12_000,
    reporters: ["default"],
  },
});
