import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  databaseActorFromAuthenticatedUser,
  databaseActorSettings,
  GUEST_DATABASE_ACTOR,
  InvalidDatabaseActorError,
  runWithDatabaseActorScope,
  getDatabaseActorScope,
} from "../server/actor-context";

const root = resolve(import.meta.dirname, "..");

const user = {
  id: 41,
  openId: "synthetic-user",
  name: null,
  email: null,
  loginMethod: null,
  role: "user" as const,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastSignedIn: new Date(0),
};

describe("DB-03 validated actor transaction contract", () => {
  it("derives only closed database actors from a validated user, guest, or scheduler principal", () => {
    expect(databaseActorFromAuthenticatedUser(null)).toEqual(
      GUEST_DATABASE_ACTOR,
    );
    expect(databaseActorFromAuthenticatedUser(user)).toEqual({
      kind: "user",
      userId: 41,
    });
    expect(
      databaseActorFromAuthenticatedUser({
        id: -1,
        isCron: true,
        taskUid: "synthetic-task",
      }),
    ).toEqual({ kind: "system" });
    expect(() => databaseActorFromAuthenticatedUser({ id: 0 })).toThrow(
      InvalidDatabaseActorError,
    );
    expect(() => databaseActorFromAuthenticatedUser({ id: 1.5 })).toThrow(
      InvalidDatabaseActorError,
    );
  });

  it("encodes only closed transaction-local GUC values and keeps actor scope async-local", async () => {
    expect(databaseActorSettings({ kind: "user", userId: 41 })).toEqual({
      actorId: "41",
      actorKind: "user",
    });
    expect(databaseActorSettings({ kind: "guest" })).toEqual({
      actorId: "0",
      actorKind: "guest",
    });
    expect(getDatabaseActorScope()).toBeUndefined();

    await runWithDatabaseActorScope(
      { actor: { kind: "user", userId: 41 }, database: { synthetic: true } },
      async () => {
        await Promise.resolve();
        expect(getDatabaseActorScope()).toMatchObject({
          actor: { kind: "user", userId: 41 },
          database: { synthetic: true },
        });
      },
    );

    expect(getDatabaseActorScope()).toBeUndefined();
  });

  it("keeps the real HTTP path request-derived and installs actor settings inside an outer transaction", () => {
    const context = readFileSync(
      resolve(root, "server/_core/context.ts"),
      "utf8",
    );
    const trpc = readFileSync(resolve(root, "server/_core/trpc.ts"), "utf8");
    const database = readFileSync(resolve(root, "server/db.ts"), "utf8");

    expect(context).toContain("sdk.authenticateRequest(opts.req)");
    expect(context).toContain("databaseActorFromAuthenticatedUser");
    expect(trpc).toContain("withDatabaseActorTransaction(ctx.databaseActor");
    expect(trpc).toContain("router.createCaller unit fixtures");
    expect(database).toContain("SET LOCAL circles.actor_id");
    expect(database).toContain("SET LOCAL circles.actor_kind");
    expect(database).toContain("db.transaction(async (transaction)");
    expect(database).toContain("getDatabaseActorScope()");
    expect(database).toContain("getRuntimeDatabaseForScopedTransaction");
    expect(database).not.toContain("getUnscopedDb");
    expect(database).toContain("return null;");
    expect(database).toContain("TRUSTED_SYSTEM_DATABASE_OPERATIONS");
    expect(database).toContain("withTrustedSystemDatabaseTransaction");
    expect(trpc).toContain("if (!result.ok) throw result.error");
  });

  it("ships a gated concrete policy bundle rather than a helper-only switch", () => {
    const migration = readFileSync(
      resolve(root, "operations/remediation/remaining_db03_actor_rls.sql"),
      "utf8",
    );
    const policies = migration.match(/^CREATE POLICY db03_/gm) ?? [];

    expect(migration).toContain("DB03_ACTOR_RLS_APPROVED_V1");
    expect(migration).toContain("SET LOCAL circles.db03_actor_rls_contract");
    expect(migration).toContain("CREATE POLICY db03_messages_select");
    expect(migration).toContain("CREATE POLICY db03_social_uploads_select");
    expect(migration).toContain(
      "CREATE POLICY db03_post_publish_receipts_select",
    );
    expect(migration).not.toContain("GRANT EXECUTE ON ALL FUNCTIONS");
    expect(migration).not.toMatch(/CREATE\s+(?:ROLE|SCHEMA)\b/i);
    expect(policies).toHaveLength(72);
  });
});
