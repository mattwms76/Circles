import { defineConfig } from "vitest/config";

/**
 * Deliberately separate from ordinary test discovery. Run only through the fixed-suite local PG17
 * runner, which creates a fresh loopback fixture and passes a credential-free child environment.
 */
export default defineConfig({
  test: {
    include: ["e2e/sec27-security.e2e.ts"],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    reporters: ["default"],
  },
});
