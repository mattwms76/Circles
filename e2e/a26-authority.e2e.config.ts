import { defineConfig } from "vitest/config";

/**
 * Deliberately outside normal unit-test discovery. Parent runner integration must provide the
 * fresh loopback-only PostgreSQL 17 fixture, synthetic identities, and sanitized child env.
 */
export default defineConfig({
  test: {
    include: ["e2e/a26-authority.e2e.ts"],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    reporters: ["default"],
  },
});
