import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upsertUser, withTrustedSystemDatabaseTransaction } from "../server/db";

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

function transactionForExistingUser(existing: boolean) {
  const execute = vi.fn().mockResolvedValue(undefined);
  const limit = vi.fn().mockResolvedValue(existing ? [{ id: 71 }] : []);
  const lock = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ for: lock }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));
  const transaction = vi.fn();
  const tx = {
    execute,
    insert,
    select,
    transaction,
    onConflictDoUpdate,
    values,
  };
  transaction.mockImplementation(async (work) => work(tx));
  return tx;
}

beforeEach(() => {
  mocks.assertPlatformFeature.mockReset();
  mocks.transaction.mockReset();
  mocks.drizzle.mockReturnValue(mocks.database);
});

afterEach(() => vi.clearAllMocks());

describe("platform registration admission", () => {
  it("allows an existing verified OAuth identity to retain the prior upsert path when settings are unavailable", async () => {
    const tx = transactionForExistingUser(true);
    mocks.transaction.mockImplementation(async (work) => work(tx));
    mocks.assertPlatformFeature.mockRejectedValue(
      new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "synthetic reader failure",
      }),
    );

    await expect(
      withTrustedSystemDatabaseTransaction("verified-oauth-user-sync", () =>
        upsertUser({
          openId: "existing-verified-oauth",
          name: "Existing user",
        }),
      ),
    ).resolves.toBeUndefined();

    expect(mocks.assertPlatformFeature).not.toHaveBeenCalled();
    expect(tx.insert).toHaveBeenCalledTimes(1);
    expect(tx.values).toHaveBeenCalledWith(
      expect.objectContaining({
        openId: "existing-verified-oauth",
        name: "Existing user",
      }),
    );
    expect(tx.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ name: "Existing user" }),
      }),
    );
  });

  it("denies a first user before the users insert when registrations are closed", async () => {
    const tx = transactionForExistingUser(false);
    mocks.transaction.mockImplementation(async (work) => work(tx));
    const denied = new TRPCError({
      code: "FORBIDDEN",
      message: "This feature is not available.",
    });
    mocks.assertPlatformFeature.mockRejectedValue(denied);

    await expect(
      withTrustedSystemDatabaseTransaction("verified-oauth-user-sync", () =>
        upsertUser({
          openId: "new-verified-oauth",
          email: "new@example.test",
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mocks.assertPlatformFeature).toHaveBeenCalledWith(
      tx,
      "registrationsOpen",
    );
    expect(tx.insert).not.toHaveBeenCalled();
  });
});
