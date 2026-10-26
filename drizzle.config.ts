import { defineConfig } from "drizzle-kit";

/**
 * Offline schema-artifact configuration. It intentionally has no database
 * credentials: generation is reviewed as an artifact and parent-controlled
 * Supabase apply_migration performs any real DDL execution.
 */
export default defineConfig({
  schema: [
    "./drizzle/schema.ts",
    "./drizzle/live-schema.ts",
    "./drizzle/session-schema.ts",
    "./drizzle/activity-schema.ts",
    "./drizzle/moderation-schema.ts",
  ],
  out: "./drizzle/postgres",
  dialect: "postgresql",
  schemaFilter: "circles_app",
});
