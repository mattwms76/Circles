import { Pool, type PoolClient, type PoolConfig } from "pg";
import {
  PROPOSED_RUNTIME_BOOTSTRAP_PRINCIPAL,
  RUNTIME_ROLE,
} from "./_core/postgres-config.mjs";
import { withOperationDeadline } from "./_core/bounded-network";

export const SET_RUNTIME_ROLE_SQL = `SET ROLE ${RUNTIME_ROLE}`;
/**
 * Prepared owner-run readiness probe. Execute only after SET ROLE through a
 * separately provisioned, exact bootstrap connection; never accept a caller
 * supplied role name or infer a provider-specific pooler username.
 */
export const RUNTIME_PRINCIPAL_READINESS_SQL = `
  SELECT session_user::text AS session_principal,
    current_user::text AS runtime_role,
    pg_catalog.pg_has_role(session_user, current_user, 'SET ROLE') AS may_set_runtime_role
  LIMIT 1
`;
export const RUNTIME_ROLE_INITIALIZATION_TIMEOUT_MS = 8_000;

export type RuntimePrincipalReadinessEvidence = {
  session_principal: string;
  runtime_role: string;
  may_set_runtime_role: boolean;
};

/**
 * Pure fail-closed evaluator for the proposed dedicated LOGIN principal.
 * It is intentionally not connected to the active postgres DSN: parent-owned
 * configuration and the owner-provisioned role must be reviewed together.
 */
export function hasExpectedRuntimePrincipal(
  evidence: unknown,
  expectedSessionPrincipal = PROPOSED_RUNTIME_BOOTSTRAP_PRINCIPAL,
): evidence is RuntimePrincipalReadinessEvidence {
  if (!evidence || typeof evidence !== "object") return false;
  const candidate = evidence as Partial<RuntimePrincipalReadinessEvidence>;
  return (
    candidate.session_principal === expectedSessionPrincipal &&
    candidate.runtime_role === RUNTIME_ROLE &&
    candidate.may_set_runtime_role === true
  );
}

type PoolConnectCallback = (
  error: Error | undefined,
  client: PoolClient | undefined,
  done: (releaseError?: Error | boolean) => void,
) => void;

/** Returned instead of a driver error so source URLs or credentials cannot escape through logs. */
export class RuntimeRoleInitializationError extends Error {
  constructor() {
    super("PostgreSQL runtime role initialization failed");
    this.name = "RuntimeRoleInitializationError";
  }
}

/**
 * Executes before application code sees a checked-out connection. Failure
 * destroys the client rather than returning it to the pool as postgres.
 */
export async function initializeRuntimeRole(
  client: PoolClient,
): Promise<PoolClient> {
  try {
    await withOperationDeadline(
      client.query(SET_RUNTIME_ROLE_SQL),
      RUNTIME_ROLE_INITIALIZATION_TIMEOUT_MS,
    );
    return client;
  } catch {
    client.release(true);
    throw new RuntimeRoleInitializationError();
  }
}

/**
 * A node-postgres Pool subclass, not a query wrapper. Parent `pool.query()`
 * internally calls this overridden `connect()`, while Drizzle transactions use
 * the Promise overload; both paths therefore pin only role-initialized clients.
 */
export class RuntimeRolePool extends Pool {
  private async acquireRuntimeClient(): Promise<PoolClient> {
    let client: PoolClient | undefined;
    try {
      client = await super.connect();
      return await initializeRuntimeRole(client);
    } catch (error) {
      // initializeRuntimeRole already destroys a client whose SET ROLE failed.
      // A pre-initialization acquire failure has no client to release.
      if (error instanceof RuntimeRoleInitializationError) throw error;
      if (client) client.release(true);
      throw new RuntimeRoleInitializationError();
    }
  }

  override connect(): Promise<PoolClient>;
  override connect(callback: PoolConnectCallback): void;
  override connect(callback?: PoolConnectCallback): Promise<PoolClient> | void {
    const acquisition = this.acquireRuntimeClient();
    if (!callback) return acquisition;

    void acquisition.then(
      (client) =>
        callback(undefined, client, (releaseError) =>
          client.release(releaseError),
        ),
      () =>
        callback(
          new RuntimeRoleInitializationError(),
          undefined,
          () => undefined,
        ),
    );
  }
}

export function createRuntimeRolePool(options: PoolConfig): RuntimeRolePool {
  return new RuntimeRolePool(options);
}
