import { getDb } from "../db";
import { loadTurnConfiguration } from "../turn-config";
import { withOperationDeadline } from "./bounded-network";

export const READINESS_DATABASE_DEADLINE_MS = 5_000;

export type ReadinessEvidence = {
  runtime_role: string;
  app_table_count: number;
  oauth_store_ready: boolean;
};

export function readinessFromEvidence(evidence: ReadinessEvidence | null) {
  const database =
    evidence?.runtime_role === "circles_app_runtime" &&
    Number(evidence.app_table_count) === 27;
  const oauthState = database && evidence?.oauth_store_ready === true;
  return { ok: database && oauthState, database, oauthState };
}

/** Catalog/permission aggregates only: no user rows, credentials or host names. */
export const READINESS_SQL = `
  SELECT current_user::text AS runtime_role,
    (SELECT count(*)::integer FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'circles_app' AND c.relkind = 'r'
        AND c.relrowsecurity
        AND pg_catalog.has_schema_privilege(current_user, n.oid, 'USAGE')
        AND pg_catalog.has_table_privilege(current_user, c.oid, 'SELECT')
    ) AS app_table_count,
    EXISTS (SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'circles_auth' AND c.relname = 'oauth_pending_states'
        AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity
        AND pg_catalog.has_schema_privilege(current_user, n.oid, 'USAGE')
        AND pg_catalog.has_table_privilege(current_user, c.oid, 'SELECT')
        AND pg_catalog.has_table_privilege(current_user, c.oid, 'INSERT')
        AND pg_catalog.has_table_privilege(current_user, c.oid, 'DELETE')
        AND NOT pg_catalog.has_table_privilege(current_user, c.oid, 'UPDATE')
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
          WHERE p.polrelid = c.oid AND p.polcmd = '*'
            AND p.polroles = ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)]
            AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) = 'true'
            AND pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) = 'true')
    ) AS oauth_store_ready
  LIMIT 1
`;

export type ReadinessDependencies = {
  getDatabase?: typeof getDb;
  databaseDeadlineMs?: number;
};

export async function checkBackendReadiness(
  dependencies: ReadinessDependencies = {},
) {
  let evidence: ReadinessEvidence | null = null;
  try {
    const deadline =
      dependencies.databaseDeadlineMs ?? READINESS_DATABASE_DEADLINE_MS;
    const db = await withOperationDeadline(
      (dependencies.getDatabase ?? getDb)(),
      deadline,
    );
    if (db) {
      const result = await withOperationDeadline(
        db.$client.query<ReadinessEvidence>(READINESS_SQL),
        deadline,
      );
      evidence = result.rows[0] ?? null;
    }
  } catch {
    // Readiness is fail-closed; raw driver errors never reach the response.
  }
  let liveRelay = false;
  try {
    liveRelay = loadTurnConfiguration() !== null;
  } catch {
    // Missing/unsafe relay disables live, not unrelated auth/feed/DM routes.
  }
  return { ...readinessFromEvidence(evidence), liveRelay };
}
