import { getDb, type CirclesDatabase } from "../db";
import { loadTurnConfiguration } from "../turn-config";
import { getMediaUploadBudgetStatus } from "../media-upload-budget-contract";
import { withOperationDeadline } from "./bounded-network";
import {
  DATABASE_READINESS_SQL,
  type DatabaseReadinessEvidence,
} from "./database-contracts";
import { getEmailAuthStatus, isEmailAuthEnabled } from "./email-auth";

export const READINESS_DATABASE_DEADLINE_MS = 5_000;

export type ReadinessEvidence = DatabaseReadinessEvidence;

export type BackendReadinessStatus = {
  ok: boolean;
  database: boolean;
  oauthState: boolean;
  liveRelay: boolean;
  mediaUploadBudget: boolean;
  emailAuth?: boolean;
};

export type PublicReadinessStatus = {
  ok: boolean;
  liveRelay: boolean;
  liveReady: boolean;
  mediaUploadBudget: boolean;
  mediaUploadReady: boolean;
};

export function readinessFromEvidence(evidence: ReadinessEvidence | null) {
  const database =
    evidence?.runtime_role === "circles_app_runtime" &&
    Number(evidence.app_table_count) === 27 &&
    evidence.critical_contract_ready === true;
  const oauthState = database && evidence?.oauth_store_ready === true;
  return { ok: database && oauthState, database, oauthState };
}

/**
 * Safe public deployment signal. Core readiness intentionally remains independent from the
 * optional live relay, while a live-enabled deployment must require this composite boolean.
 */
export function publicReadinessFromStatus(
  status: Pick<
    BackendReadinessStatus,
    "ok" | "liveRelay" | "mediaUploadBudget"
  >,
): PublicReadinessStatus {
  return {
    ok: status.ok,
    liveRelay: status.liveRelay,
    liveReady: status.ok && status.liveRelay,
    mediaUploadBudget: status.mediaUploadBudget,
    mediaUploadReady: status.ok && status.mediaUploadBudget,
  };
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
): Promise<BackendReadinessStatus> {
  let evidence: ReadinessEvidence | null = null;
  let database: CirclesDatabase | null = null;
  try {
    const deadline =
      dependencies.databaseDeadlineMs ?? READINESS_DATABASE_DEADLINE_MS;
    database = await withOperationDeadline(
      (dependencies.getDatabase ?? getDb)(),
      deadline,
    );
    if (database) {
      const result = await withOperationDeadline(
        database.$client.query<ReadinessEvidence>(READINESS_SQL),
        deadline,
      );
      evidence = result.rows[0] ?? null;
    }
  } catch {
    // Readiness is fail-closed; raw driver errors never reach the response.
  }
  const mediaUploadBudget = (
    await getMediaUploadBudgetStatus({
      database,
      deadlineMs:
        dependencies.databaseDeadlineMs ?? READINESS_DATABASE_DEADLINE_MS,
    })
  ).ready;
  let liveRelay = false;
  try {
    liveRelay = loadTurnConfiguration() !== null;
  } catch {
    // Missing/unsafe relay disables live, not unrelated auth/feed/DM routes.
  }
  const baseline = readinessFromEvidence(evidence);
  if (!(dependencies.emailAuthEnabled ?? isEmailAuthEnabled())) {
    return { ...baseline, liveRelay, mediaUploadBudget };
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
  return {
    ...baseline,
    ok: baseline.ok && emailAuth,
    liveRelay,
    mediaUploadBudget,
    emailAuth,
  };
}
