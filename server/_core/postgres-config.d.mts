import type { PoolConfig } from "pg";

export const PRIVATE_SCHEMA: "circles_app";
export const RUNTIME_ROLE: "circles_app_runtime";
export const LEGACY_LOGIN_ROLE: "postgres";
export const DEDICATED_APP_LOGIN_ROLE: "circles_app_login";
export const APPLICATION_LOGIN_MODE_LEGACY: "legacy";
export const APPLICATION_LOGIN_MODE_DEDICATED: "dedicated";

export function getPostgresConnectionOptionsForLogin(
  suppliedUrl: string,
  expectedLoginRole: "postgres" | "circles_app_login",
  projectRoot?: string,
  options?: { requireSessionPooler?: boolean },
): PoolConfig;

export function getPostgresConnectionOptions(
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
  projectRoot?: string,
): PoolConfig;
