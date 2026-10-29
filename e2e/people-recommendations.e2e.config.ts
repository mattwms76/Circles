import { defineConfig } from "vitest/config";

/**
 * Deliberately outside ordinary unit discovery. Run only through the fixed local PG17 runner,
 * which creates a fresh loopback fixture and passes synthetic identities in a scrubbed env.
 */
export default defineConfig({
  test: {
    include: ["e2e/people-recommendations.e2e.ts"],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    reporters: ["default"],
  },
});
