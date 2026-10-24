import { TRPCError } from "@trpc/server";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upsertUser } from "../server/db";

const mocks = vi.hoisted(() => {
  const transaction = vi.fn();
  const database = { transaction };
  return {
    assertPlatformFeature: vi.fn(),
    createRuntimeRolePool: vi.fn(() => ({})),
    database,
    drizzle: vi.fn(() => database),
    getPostgresConnectionOptions: vi.fn(() => ({})),
    transaction,
  };
});

vi.mock("../server/platform-settings", () => ({
  assertPlatformFeature: mocks.assertPlatformFeature,
}));
vi.mock("../server/runtime-role-pool", () => ({
  createRuntimeRolePool: mocks.createRuntimeRolePool,
}));
vi.mock("../server/_core/postgres-config.mjs", () => ({
  getPostgresConnectionOptions: mocks.getPostgresConnectionOptions,
}));
vi.mock("drizzle-orm/node-postgres", async () => {
  const actual = await vi.importActual<
    typeof import("drizzle-orm/node-postgres")
  >("drizzle-orm/node-postgres");
  return { ...actual, drizzle: mocks.drizzle };
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("platform registration same-identity serialization", () => {
  beforeEach(() => {
    mocks.assertPlatformFeature.mockReset();
    mocks.drizzle.mockReturnValue(mocks.database);
    mocks.transaction.mockReset();
  });

  afterEach(() => vi.clearAllMocks());

  it("admits one first callback, then makes a concurrent callback recheck the committed user without reading a later-unavailable setting", async () => {
    const sourceOpenId = "same-source-identity";
    const events: string[] = [];
    const executedLocks: { sql: string; params: unknown[] }[] = [];
    const firstAdmissionStarted = deferred<void>();
    const releaseFirstAdmission = deferred<void>();
    const secondLockWaiting = deferred<void>();
    const releaseSecondLock = deferred<void>();
    const users = new Set<string>();
    const transactions: { execute: ReturnType<typeof vi.fn> }[] = [];
    let nextTransaction = 0;
    let advisoryLockHolder: number | null = null;

    mocks.transaction.mockImplementation(async (work) => {
      const transactionNumber = ++nextTransaction;
      const transactionName = `tx${transactionNumber}`;
      const execute = vi.fn(async (query: SQL) => {
        const compiled = new PgDialect().sqlToQuery(query);
        executedLocks.push({ sql: compiled.sql, params: compiled.params });

        if (advisoryLockHolder !== null) {
          events.push(`${transactionName}:advisory-lock-wait`);
          secondLockWaiting.resolve();
          await releaseSecondLock.promise;
        }
        advisoryLockHolder = transactionNumber;
        events.push(`${transactionName}:advisory-lock`);
      });
      const limit = vi.fn(async () => {
        events.push(`${transactionName}:select-for-update`);
        return users.has(sourceOpenId) ? [{ id: 71 }] : [];
      });
      const rowLock = vi.fn(() => ({ limit }));
      const where = vi.fn(() => ({ for: rowLock }));
      const from = vi.fn(() => ({ where }));
      const select = vi.fn(() => ({ from }));
      const onConflictDoUpdate = vi.fn(async () => {
        events.push(`${transactionName}:upsert`);
        users.add(sourceOpenId);
      });
      const values = vi.fn(() => ({ onConflictDoUpdate }));
      const insert = vi.fn(() => ({ values }));
      const tx = { execute, insert, select };
      transactions.push(tx);

      await work(tx);
      events.push(`${transactionName}:commit`);
      if (transactionNumber === 1) releaseSecondLock.resolve();
      advisoryLockHolder = null;
    });

    mocks.assertPlatformFeature.mockImplementationOnce(async () => {
      events.push("tx1:registrations-reader");
      firstAdmissionStarted.resolve();
      await releaseFirstAdmission.promise;
    });

    const first = upsertUser({ openId: sourceOpenId, name: "First callback" });
    await firstAdmissionStarted.promise;

    mocks.assertPlatformFeature.mockRejectedValue(
      new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "synthetic later reader failure",
      }),
    );
    const second = upsertUser({
      openId: sourceOpenId,
      name: "Second callback",
    });
    await secondLockWaiting.promise;

    expect(events).toEqual([
      "tx1:advisory-lock",
      "tx1:select-for-update",
      "tx1:registrations-reader",
      "tx2:advisory-lock-wait",
    ]);
    expect(executedLocks).toEqual([
      {
        sql: "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('circles.registration:' || $1, 0))",
        params: [sourceOpenId],
      },
      {
        sql: "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('circles.registration:' || $1, 0))",
        params: [sourceOpenId],
      },
    ]);

    releaseFirstAdmission.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);

    expect(mocks.assertPlatformFeature).toHaveBeenCalledTimes(1);
    expect(mocks.assertPlatformFeature).toHaveBeenCalledWith(
      transactions[0],
      "registrationsOpen",
    );
    expect(events).toEqual([
      "tx1:advisory-lock",
      "tx1:select-for-update",
      "tx1:registrations-reader",
      "tx2:advisory-lock-wait",
      "tx1:upsert",
      "tx1:commit",
      "tx2:advisory-lock",
      "tx2:select-for-update",
      "tx2:upsert",
      "tx2:commit",
    ]);
  });
});
