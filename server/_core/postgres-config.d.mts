import type { PoolConfig } from "pg";

export const PRIVATE_SCHEMA: "circles_app";
export const RUNTIME_ROLE: "circles_app_runtime";

export function getPostgresConnectionOptions(
  env?: NodeJS.ProcessEnv | { SUPABASE_DATABASE_URL?: string | undefined },
  projectRoot?: string,
): PoolConfig;
