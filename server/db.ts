import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as coreSchema from "../drizzle/schema";
import * as liveSchema from "../drizzle/live-schema";
import * as sessionSchema from "../drizzle/session-schema";
import * as activitySchema from "../drizzle/activity-schema";
import * as moderationSchema from "../drizzle/moderation-schema";
import { type InsertUser, users } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { getPostgresConnectionOptions } from "./_core/postgres-config.mjs";
import {
  createRuntimeRolePool,
  type RuntimeRolePool,
} from "./runtime-role-pool";
import { assertPlatformFeature } from "./platform-settings";

const databaseSchema = {
  ...coreSchema,
  ...liveSchema,
  ...sessionSchema,
  ...activitySchema,
  ...moderationSchema,
};

export type CirclesDatabase = NodePgDatabase<typeof databaseSchema> & {
  /** Drizzle's client is always RuntimeRolePool, never a privileged raw Pool. */
  $client: RuntimeRolePool;
};
export type CirclesTransaction = Parameters<
  Parameters<CirclesDatabase["transaction"]>[0]
>[0];

let pool: RuntimeRolePool | null = null;
let database: CirclesDatabase | null = null;

/** Database errors are intentionally generic so connection material cannot reach API logs or clients. */
export class PostgreSqlDatabaseUnavailableError extends Error {
  constructor() {
    super("PostgreSQL database is unavailable");
    this.name = "PostgreSqlDatabaseUnavailableError";
  }
}

/**
 * Lazily creates the PostgreSQL-only application database. There is deliberately
 * no DATABASE_URL/MySQL fallback: callers either use the private Supabase schema
 * through the runtime role or receive null and fail closed at their boundary.
 */
export async function getDb(): Promise<CirclesDatabase | null> {
  if (database) return database;

  try {
    const options = getPostgresConnectionOptions(process.env, process.cwd());
    const runtimePool = createRuntimeRolePool(options);
    const runtimeDatabase = drizzle(runtimePool, { schema: databaseSchema });
    pool = runtimePool;
    database = runtimeDatabase;
    return database;
  } catch {
    return null;
  }
}

/**
 * Normalizes the advisory-lock identity only. Stored email values retain their
 * established provider/Manus representation; collision SQL compares lower(email)
 * with this same value.
 */
export function normalizedUserEmail(email: string): string {
  return email.toLowerCase();
}

/**
 * Serializes all new user allocations that carry the same normalized email.
 * Source identity allocation holds this after its subject lock; generic OAuth
 * allocation takes it before its per-openId registration lock.
 */
export async function lockUserEmailAllocation(
  transaction: Pick<CirclesTransaction, "execute">,
  email: string | null | undefined,
): Promise<void> {
  if (typeof email !== "string") return;
  await transaction.execute(
    sql`SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('circles.user-email:' || ${normalizedUserEmail(email)}, 0))`,
  );
}

function userUpsertValues(user: InsertUser): {
  values: InsertUser;
  updateSet: Partial<Omit<InsertUser, "id" | "openId">>;
} {
  const now = new Date();
  const values: InsertUser = {
    openId: user.openId,
    lastSignedIn: user.lastSignedIn ?? now,
  };
  const updateSet: Partial<Omit<InsertUser, "id" | "openId">> = {
    lastSignedIn: user.lastSignedIn ?? now,
    updatedAt: now,
  };

  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    if (user[field] === undefined) continue;
    values[field] = user[field];
    updateSet[field] = user[field];
  }

  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  return { values, updateSet };
}

/**
 * Performs the established registration-gated user upsert inside a caller-owned
 * transaction. The caller must not open a detached transaction while holding
 * identity locks: source allocation uses this helper with the same transaction.
 */
export async function upsertUserInTransaction(
  transaction: CirclesTransaction,
  user: InsertUser,
): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const { values, updateSet } = userUpsertValues(user);
  await lockUserEmailAllocation(transaction, user.email);
  // Existing OAuth identities remain able to sign in even if registrations
  // close or the optional settings reader is unavailable. Serialize every
  // source identity before looking it up: a row lock alone cannot lock an
  // absent identity. The lookup and first insert then share a transaction
  // so a newly admitted identity is gated before any user row is written.
  await transaction.execute(
    sql`SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('circles.registration:' || ${user.openId}, 0))`,
  );
  const [existing] = await transaction
    .select({ id: users.id })
    .from(users)
    .where(eq(users.openId, user.openId))
    .for("update")
    .limit(1);
  if (!existing) {
    await assertPlatformFeature(transaction, "registrationsOpen");
  }

  await transaction.insert(users).values(values).onConflictDoUpdate({
    target: users.openId,
    set: updateSet,
  });
}

/**
 * Retain existing Manus OAuth user-upsert semantics using PostgreSQL's explicit
 * unique conflict target. The OAuth provider, session signing, and user IDs are
 * otherwise untouched.
 */
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) throw new PostgreSqlDatabaseUnavailableError();

  try {
    await db.transaction(async (transaction) => {
      await upsertUserInTransaction(transaction, user);
    });
  } catch (error) {
    // Feature-reader failures and explicitly disabled registrations are already
    // safe public tRPC errors; do not turn them into an opaque database error.
    if (error instanceof TRPCError) throw error;
    throw new PostgreSqlDatabaseUnavailableError();
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;

  try {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.openId, openId))
      .limit(1);
    return result[0];
  } catch {
    throw new PostgreSqlDatabaseUnavailableError();
  }
}

/** Visible for graceful server shutdown only; the privileged Pool is never exported. */
export async function closePostgresPool(): Promise<void> {
  const activePool = pool;
  pool = null;
  database = null;
  if (activePool) await activePool.end();
}
