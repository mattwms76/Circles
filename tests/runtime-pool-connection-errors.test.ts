import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { PoolClient, PoolConfig } from "pg";
import {
  RUNTIME_ROLE_RELEASE_CLEANUP_SQL,
  RuntimeRoleClientReleasedError,
  RuntimeRoleInitializationError,
  RuntimeRolePool,
  guardRuntimeRoleClient,
} from "../server/runtime-role-pool";

function eventEmitterClient(query = vi.fn().mockResolvedValue({ rows: [] })): {
  client: PoolClient;
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
} {
  const release = vi.fn();
  return {
    client: Object.assign(new EventEmitter(), {
      query,
      release,
    }) as unknown as PoolClient,
    query,
    release,
  };
}

class SyntheticPgPoolClient extends EventEmitter {
  static instances: SyntheticPgPoolClient[] = [];
  static initializationFailures: Error[] = [];

  readonly initializationFailure =
    SyntheticPgPoolClient.initializationFailures.shift();
  readonly query = vi.fn((query: unknown) => {
    const text =
      typeof query === "string"
        ? query
        : query && typeof query === "object" && "text" in query
          ? String(query.text)
          : "";

    if (text.startsWith("SET ROLE") && this.initializationFailure) {
      this.emit("error", this.initializationFailure);
    }
    if (text.includes("current_user = $1")) {
      return Promise.resolve({
        rows: [
          {
            runtime_role_active: true,
            runtime_role_restricted: true,
          },
        ],
      });
    }
    return Promise.resolve({ rows: [] });
  });
  _queryable = true;
  _ending = false;

  constructor(..._arguments: unknown[]) {
    super();
    SyntheticPgPoolClient.instances.push(this);
  }

  connect(callback?: (error?: Error) => void): Promise<void> | void {
    if (callback) {
      callback();
      return;
    }
    return Promise.resolve();
  }

  end(callback?: () => void): Promise<void> | void {
    this._ending = true;
    callback?.();
    return Promise.resolve();
  }
}

function resetSyntheticPoolClients(): void {
  SyntheticPgPoolClient.instances = [];
  SyntheticPgPoolClient.initializationFailures = [];
}

describe("runtime pool connection error ownership", () => {
  it("retires synchronous initialization disconnects without an unhandled error and permits a fresh restricted checkout", async () => {
    resetSyntheticPoolClients();
    SyntheticPgPoolClient.initializationFailures.push(
      new Error("synthetic initialization disconnect"),
    );
    const pool = new RuntimeRolePool({
      Client: SyntheticPgPoolClient as unknown as PoolConfig["Client"],
      idleTimeoutMillis: 0,
      max: 1,
    });

    try {
      await expect(pool.connect()).rejects.toBeInstanceOf(
        RuntimeRoleInitializationError,
      );
      expect(SyntheticPgPoolClient.instances).toHaveLength(1);
      expect(SyntheticPgPoolClient.instances[0].query).toHaveBeenCalledTimes(1);
      expect(pool.totalCount).toBe(0);

      // The failed client is already destroyed. A subsequent driver error must
      // remain owned by the generic pool idle/destroyed listener.
      expect(() =>
        SyntheticPgPoolClient.instances[0].emit(
          "error",
          new Error("synthetic post-destroy disconnect"),
        ),
      ).not.toThrow();

      const freshClient = await pool.connect();
      expect(SyntheticPgPoolClient.instances).toHaveLength(2);
      expect(SyntheticPgPoolClient.instances[1].query).toHaveBeenCalledTimes(2);
      freshClient.release();
      await vi.waitFor(() => expect(pool.idleCount).toBe(1));

      // pg-pool removes idle sockets before emitting the pool error that this
      // subclass handles generically, so a future checkout creates a new one.
      expect(() =>
        SyntheticPgPoolClient.instances[1].emit(
          "error",
          new Error("synthetic idle disconnect"),
        ),
      ).not.toThrow();
      await vi.waitFor(() => expect(pool.totalCount).toBe(0));

      const replacement = await pool.connect();
      expect(SyntheticPgPoolClient.instances).toHaveLength(3);
      replacement.release();
    } finally {
      await pool.end();
    }
  });

  it("owns errors through active checkout and asynchronous cleanup, retiring each raw client once", async () => {
    const active = eventEmitterClient();
    const activeGuard = guardRuntimeRoleClient(active.client);
    const activeDisconnect = new Error("synthetic active disconnect");

    expect(() => active.client.emit("error", activeDisconnect)).not.toThrow();
    expect(active.release).toHaveBeenCalledExactlyOnceWith(activeDisconnect);
    await expect(activeGuard.query("SELECT 1")).rejects.toBeInstanceOf(
      RuntimeRoleClientReleasedError,
    );
    expect(active.client.listenerCount("error")).toBe(0);

    let finishCleanup: (() => void) | undefined;
    const cleanup = eventEmitterClient(
      vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishCleanup = resolve;
          }),
      ),
    );
    const cleanupGuard = guardRuntimeRoleClient(cleanup.client);
    cleanupGuard.release();
    expect(cleanup.query).toHaveBeenCalledWith(
      RUNTIME_ROLE_RELEASE_CLEANUP_SQL,
    );
    expect(cleanup.client.listenerCount("error")).toBe(1);

    const cleanupDisconnect = new Error("synthetic cleanup disconnect");
    expect(() => cleanup.client.emit("error", cleanupDisconnect)).not.toThrow();
    expect(cleanup.release).toHaveBeenCalledExactlyOnceWith(cleanupDisconnect);
    finishCleanup?.();
    await Promise.resolve();

    expect(cleanup.release).toHaveBeenCalledTimes(1);
    expect(cleanup.client.listenerCount("error")).toBe(0);
    await expect(cleanupGuard.query("SELECT 1")).rejects.toBeInstanceOf(
      RuntimeRoleClientReleasedError,
    );
  });
});
