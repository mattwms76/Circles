import { Pool, type PoolClient, type PoolConfig } from "pg";
import { RUNTIME_ROLE } from "./_core/postgres-config.mjs";
import { withOperationDeadline } from "./_core/bounded-network";

export const SET_RUNTIME_ROLE_SQL = `SET ROLE ${RUNTIME_ROLE}`;
export const RUNTIME_ROLE_INITIALIZATION_TIMEOUT_MS = 8_000;

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
