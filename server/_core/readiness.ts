import { getDb } from "../db";
import { loadTurnConfiguration } from "../turn-config";
import { withOperationDeadline } from "./bounded-network";
import {
  DATABASE_READINESS_SQL,
  type DatabaseReadinessEvidence,
} from "./database-contracts";
import { getEmailAuthStatus, isEmailAuthEnabled } from "./email-auth";

export const READINESS_DATABASE_DEADLINE_MS = 5_000;

export type ReadinessEvidence = DatabaseReadinessEvidence;

export function readinessFromEvidence(evidence: ReadinessEvidence | null) {
  const database =
    evidence?.runtime_role === "circles_app_runtime" &&
    Number(evidence.app_table_count) === 27 &&
    evidence.critical_contract_ready === true;
  const oauthState = database && evidence?.oauth_store_ready === true;
  return { ok: database && oauthState, database, oauthState };
}

/** Catalog/permission aggregates only: no user rows, credentials or host names. */
export const READINESS_SQL = DATABASE_READINESS_SQL;

export type ReadinessDependencies = {
  getDatabase?: typeof getDb;
  databaseDeadlineMs?: number;
  emailAuthEnabled?: boolean;
  getEmailStatus?: typeof getEmailAuthStatus;
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
  const baseline = readinessFromEvidence(evidence);
  if (!(dependencies.emailAuthEnabled ?? isEmailAuthEnabled())) {
    return { ...baseline, liveRelay };
  }
  let emailAuth = false;
  try {
    const status = await withOperationDeadline(
      (dependencies.getEmailStatus ?? getEmailAuthStatus)(),
      dependencies.databaseDeadlineMs ?? READINESS_DATABASE_DEADLINE_MS,
    );
    emailAuth = status.enabled && status.ready && status.emailEnabled;
  } catch {
    // Never expose provider/configuration/driver details or mark missing identity storage ready.
  }
  return { ...baseline, ok: baseline.ok && emailAuth, liveRelay, emailAuth };
}
