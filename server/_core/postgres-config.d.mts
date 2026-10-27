import type { PoolConfig } from "pg";

export const PRIVATE_SCHEMA: "circles_app";
export const RUNTIME_ROLE: "circles_app_runtime";
export const CURRENT_CONNECTION_PRINCIPAL: "postgres";
export const PROPOSED_RUNTIME_BOOTSTRAP_PRINCIPAL: "circles_app_bootstrap";

export function getPostgresConnectionOptions(
  env?: NodeJS.ProcessEnv | { SUPABASE_DATABASE_URL?: string | undefined },
  projectRoot?: string,
): PoolConfig;
