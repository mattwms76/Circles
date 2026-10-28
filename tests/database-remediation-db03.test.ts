import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { RUNTIME_ROLE } from "../server/_core/postgres-config.mjs";
import {
  RUNTIME_ROLE_INITIALIZATION_TIMEOUT_MS,
  RUNTIME_ROLE_RELEASE_CLEANUP_SQL,
  RUNTIME_ROLE_RELEASE_CLEANUP_TIMEOUT_MS,
  RuntimeRoleClientReleasedError,
  RuntimeRoleInitializationError,
  RuntimeRoleSessionControlError,
  SET_RUNTIME_ROLE_SQL,
  VERIFY_RUNTIME_ROLE_SQL,
  assertRuntimeRoleSessionControlSafe,
  guardRuntimeRoleClient,
  initializeRuntimeRole,
} from "../server/runtime-role-pool";

function syntheticClient(query = vi.fn()): {
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

describe("DB-03 trusted-server runtime role boundary", () => {
  it("sets and proves a NOLOGIN non-superuser non-BYPASSRLS role before checkout", async () => {
    const { client, query, release } = syntheticClient(
      vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              runtime_role_active: true,
              runtime_role_restricted: true,
            },
          ],
        }),
    );

    await expect(initializeRuntimeRole(client)).resolves.toBe(client);
    expect(query).toHaveBeenNthCalledWith(1, SET_RUNTIME_ROLE_SQL);
    expect(query).toHaveBeenNthCalledWith(2, VERIFY_RUNTIME_ROLE_SQL, [
      RUNTIME_ROLE,
    ]);
    expect(release).not.toHaveBeenCalled();
    expect(RUNTIME_ROLE_INITIALIZATION_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("destroys the checkout when effective authority cannot be proven restricted", async () => {
    const { client, query, release } = syntheticClient(
      vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              runtime_role_active: true,
              runtime_role_restricted: false,
            },
          ],
        }),
    );

    await expect(initializeRuntimeRole(client)).rejects.toBeInstanceOf(
      RuntimeRoleInitializationError,
    );
    expect(query).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledWith(true);
  });

  it("lexes executable SQL while ignoring nested comments, ordinary/E strings, quoted identifiers, and dollar quotes", () => {
    const harmlessSql = [
      "SELECT '; SET ROLE postgres' AS note",
      String.raw`SELECT E'escaped \' SET ROLE postgres' AS note`,
      'SELECT "RESET ALL" AS "DISCARD ALL"',
      'SELECT 1 AS "trusted""app_column"',
      "SELECT $$SET SESSION AUTHORIZATION postgres; DISCARD ALL$$ AS note",
      "SELECT $role_note$pg_catalog.set_config('role', 'postgres', false)$role_note$ AS note",
      "/* outer /* nested RESET ALL */ still comment */ SELECT 1",
      "-- SET ROLE postgres\nSELECT 1",
      "SELECT 'pg_catalog.set_config(''role'', ''postgres'', false)' AS note",
    ];

    for (const sql of harmlessSql) {
      expect(() => assertRuntimeRoleSessionControlSafe(sql), sql).not.toThrow();
    }
  });

  it("rejects real, quoted, and dynamic role/session control before they reach PostgreSQL", async () => {
    const { client, query } = syntheticClient(vi.fn().mockResolvedValue({}));
    const guarded = guardRuntimeRoleClient(client);

    for (const sql of [
      "RESET ROLE",
      "SET LOCAL ROLE circles_app_runtime",
      "SET SESSION AUTHORIZATION DEFAULT",
      "SET session_authorization TO DEFAULT",
      "RESET ALL",
      "DISCARD ALL",
      "DISCARD PLANS",
      "/* no bypass */ RESET /* still no bypass */ ALL",
      "SELECT pg_catalog /* path */ . set_config('role', 'postgres', false)",
      "SELECT set_config /* call */ ('application_name', 'dirty', false)",
      "SELECT pg_catalog.\"set_config\"('role', 'postgres', false)",
      'SET"role" TO postgres',
      'RESET"role"',
      'SET"session_authorization" TO postgres',
      'RESET"session_authorization"',
      "DO $$BEGIN EXECUTE 'SET ROLE postgres'; END$$",
      "EXECUTE prepared_unsafe_sql",
      'SELECT U&"trusted_app_column"',
    ]) {
      const rawCallCount = query.mock.calls.length;
      await expect(guarded.query(sql)).rejects.toBeInstanceOf(
        RuntimeRoleSessionControlError,
      );
      expect(query).toHaveBeenCalledTimes(rawCallCount);
    }

    expect(query).not.toHaveBeenCalled();
  });

  it("rejects config-form set_config role elevation and reports it through the callback overload", async () => {
    const { client, query } = syntheticClient(vi.fn().mockResolvedValue({}));
    const guarded = guardRuntimeRoleClient(client);
    const callback = vi.fn();

    const returned = guarded.query(
      {
        text: "SELECT pg_catalog.set_config('role', $1, false)",
        values: ["postgres"],
      },
      callback,
    );

    expect(returned).toBeUndefined();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(callback).toHaveBeenCalledWith(
      expect.any(RuntimeRoleSessionControlError),
      undefined,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("preserves ordinary text and config query delegation but blocks the internal connection escape hatch", async () => {
    const rawQuery = vi.fn().mockResolvedValue({ rows: [{ value: 1 }] });
    const { client, query } = syntheticClient(rawQuery);
    const guarded = guardRuntimeRoleClient(client);
    const config = { text: "SELECT $1::int AS value", values: [1] };

    await expect(guarded.query("SELECT 1")).resolves.toEqual({
      rows: [{ value: 1 }],
    });
    await expect(guarded.query(config)).resolves.toEqual({
      rows: [{ value: 1 }],
    });
    expect(query).toHaveBeenNthCalledWith(1, "SELECT 1");
    expect(query).toHaveBeenNthCalledWith(2, config);
    expect(
      () => (guarded as unknown as { connection: unknown }).connection,
    ).toThrow(RuntimeRoleSessionControlError);
  });

  it("keeps a released proxy terminal until bounded DISCARD ALL cleanup returns the raw session", async () => {
    const rawQuery = vi.fn().mockResolvedValue({ rows: [] });
    const { client, query, release } = syntheticClient(rawQuery);
    const guarded = guardRuntimeRoleClient(client);

    guarded.release();

    await expect(guarded.query("SELECT 1")).rejects.toBeInstanceOf(
      RuntimeRoleClientReleasedError,
    );
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    expect(query).toHaveBeenCalledWith(RUNTIME_ROLE_RELEASE_CLEANUP_SQL);
    expect(release).toHaveBeenCalledWith();
  });

  it("destroys instead of returning a raw client when DISCARD ALL fails", async () => {
    const rawQuery = vi.fn((sql: unknown) =>
      sql === RUNTIME_ROLE_RELEASE_CLEANUP_SQL
        ? Promise.reject(new Error("synthetic cleanup failure"))
        : Promise.resolve({ rows: [] }),
    );
    const { client, release } = syntheticClient(rawQuery);
    const guarded = guardRuntimeRoleClient(client);

    guarded.release();

    await vi.waitFor(() => expect(release).toHaveBeenCalledWith(true));
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("retires a disconnected checked-out socket without an unhandled error or reusable proxy", async () => {
    const { client, query, release } = syntheticClient(
      vi.fn().mockResolvedValue({ rows: [] }),
    );
    const guarded = guardRuntimeRoleClient(client);
    const cause = new Error("synthetic administrator disconnect");
    expect(() => client.emit("error", cause)).not.toThrow();
    expect(release).toHaveBeenCalledExactlyOnceWith(cause);
    await expect(guarded.query("SELECT 1")).rejects.toBeInstanceOf(
      RuntimeRoleClientReleasedError,
    );
    guarded.release();
    expect(release).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
    expect(client.listenerCount("error")).toBe(0);
  });

  it("destroys instead of returning a raw client when bounded cleanup times out", async () => {
    vi.useFakeTimers();
    try {
      const rawQuery = vi.fn(() => new Promise(() => undefined));
      const { client, release } = syntheticClient(rawQuery);
      const guarded = guardRuntimeRoleClient(client);

      guarded.release();
      await vi.advanceTimersByTimeAsync(
        RUNTIME_ROLE_RELEASE_CLEANUP_TIMEOUT_MS,
      );

      expect(release).toHaveBeenCalledWith(true);
      expect(release).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves explicit release-error destruction without starting cleanup", () => {
    const rawQuery = vi.fn().mockResolvedValue({ rows: [] });
    const { client, query, release } = syntheticClient(rawQuery);
    const guarded = guardRuntimeRoleClient(client);
    const cause = new Error("application query failed");

    guarded.release(cause);

    expect(release).toHaveBeenCalledWith(cause);
    expect(query).not.toHaveBeenCalled();
  });

  it("reports use-after-release through callback overloads instead of racing cleanup", async () => {
    const rawQuery = vi.fn().mockResolvedValue({ rows: [] });
    const { client, release } = syntheticClient(rawQuery);
    const guarded = guardRuntimeRoleClient(client);
    const callback = vi.fn();

    guarded.release();
    const returned = guarded.query("SELECT 1", callback);

    expect(returned).toBeUndefined();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(callback).toHaveBeenCalledWith(
      expect.any(RuntimeRoleClientReleasedError),
      undefined,
    );
    await vi.waitFor(() => expect(release).toHaveBeenCalledWith());
  });
});
