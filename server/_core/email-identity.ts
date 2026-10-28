import { sql, type SQL } from "drizzle-orm";
import {
  getDb,
  lockUserEmailAllocation,
  normalizedUserEmail,
  type CirclesTransaction,
  upsertUserInTransaction,
  type TrustedSystemDatabaseOperation,
  withTrustedSystemDatabaseTransaction,
} from "../db";
import type { InsertUser } from "../../drizzle/schema";
import { EMAIL_IDENTITY_READINESS_SQL } from "./database-contracts";

const SUPABASE_OPEN_ID_PREFIX = "supabase:";

export type VerifiedEmailIdentity = {
  subject: string;
  email: string;
  name?: string | null;
};

export type LinkedEmailIdentity = {
  userId: number;
  openId: string;
  name: string | null;
};

type QueryResult = { rows: unknown[] };
type SqlExecutor = {
  execute(query: SQL): Promise<QueryResult>;
};
type IdentityTransaction = CirclesTransaction & SqlExecutor;
type IdentityDatabase = SqlExecutor & {
  transaction<T>(
    work: (transaction: IdentityTransaction) => Promise<T>,
  ): Promise<T>;
};
type SourceUserUpsert = (
  transaction: CirclesTransaction,
  user: InsertUser,
) => Promise<void>;

type EmailIdentityDependencies = {
  getDatabase?: () => Promise<IdentityDatabase | null>;
  upsertSourceUserInTransaction?: SourceUserUpsert;
  /** Explicit isolated-fixture seam; production uses the default scoped runner. */
  runTrustedDatabaseTransaction?: <T>(
    operation: TrustedSystemDatabaseOperation,
    work: () => Promise<T>,
  ) => Promise<T>;
};

type MappingRow = {
  userId: number;
  openId: string;
  name: string | null;
};

type UserRow = {
  id: number;
  openId: string;
  name: string | null;
};

/** Database/schema failures must not become a best-effort login fallback. */
export class EmailIdentityUnavailableError extends Error {
  constructor() {
    super("Email identity mapping is unavailable");
    this.name = "EmailIdentityUnavailableError";
  }
}

/** A valid provider identity belongs to a different Circles account. */
export class EmailIdentityLinkRequiredError extends Error {
  constructor() {
    super("Email identity requires explicit account linking");
    this.name = "EmailIdentityLinkRequiredError";
  }
}

function providerOpenId(subject: string): string {
  return `${SUPABASE_OPEN_ID_PREFIX}${subject}`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function unavailableUnlessKnown(error: unknown): never {
  if (
    error instanceof EmailIdentityUnavailableError ||
    error instanceof EmailIdentityLinkRequiredError
  ) {
    throw error;
  }
  throw new EmailIdentityUnavailableError();
}

async function rows<Row>(
  executor: SqlExecutor,
  statement: SQL,
): Promise<Row[]> {
  const result = await executor.execute(statement);
  return result.rows as Row[];
}

async function lockScope(executor: SqlExecutor, scope: string): Promise<void> {
  // Transaction-scoped locks serialize absent mapping rows too; no broad table lock
  // or privileged mapping mutation is necessary.
  await executor.execute(
    sql`SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${scope}, 0))`,
  );
}

async function linkedBySubject(
  executor: SqlExecutor,
  subject: string,
): Promise<LinkedEmailIdentity | null> {
  const result = await rows<MappingRow>(
    executor,
    sql`SELECT
          provider_links.user_id AS "userId",
          users."openId" AS "openId",
          users.name AS name
        FROM circles_identity.provider_links AS provider_links
        JOIN circles_app.users AS users
          ON users.id = provider_links.user_id
        WHERE provider_links.provider_subject = ${subject}::uuid
        LIMIT 1`,
  );
  const linked = result[0];
  if (!linked || !Number.isSafeInteger(linked.userId) || !linked.openId) {
    return null;
  }
  return {
    userId: linked.userId,
    openId: linked.openId,
    name: linked.name ?? null,
  };
}

async function linkedByUser(
  executor: SqlExecutor,
  userId: number,
): Promise<string | null> {
  const result = await rows<{ subject: string }>(
    executor,
    sql`SELECT provider_subject::text AS subject
        FROM circles_identity.provider_links
        WHERE user_id = ${userId}
        LIMIT 1`,
  );
  return result[0]?.subject ?? null;
}

async function sourceUserByOpenId(
  executor: SqlExecutor,
  openId: string,
): Promise<UserRow | null> {
  // circles_app_runtime already has the scoped user-row lock privilege. The
  // identity table deliberately does not grant UPDATE merely to obtain a lock.
  const result = await rows<UserRow>(
    executor,
    sql`SELECT id, "openId" AS "openId", name
        FROM circles_app.users
        WHERE "openId" = ${openId}
        LIMIT 1
        FOR UPDATE`,
  );
  const source = result[0];
  if (!source || !Number.isSafeInteger(source.id) || !source.openId)
    return null;
  return { id: source.id, openId: source.openId, name: source.name ?? null };
}

async function sourceEmailCollision(
  executor: SqlExecutor,
  normalizedEmail: string,
  exceptUserId: number | null,
): Promise<boolean> {
  const result = await rows<{ id: number }>(
    executor,
    sql`SELECT id
        FROM circles_app.users
        WHERE lower("email") = ${normalizedEmail}
          AND (${exceptUserId}::integer IS NULL OR id <> ${exceptUserId}::integer)
        LIMIT 1
        FOR UPDATE`,
  );
  return result.length > 0;
}

async function insertMapping(
  executor: SqlExecutor,
  subject: string,
  userId: number,
): Promise<void> {
  await executor.execute(
    sql`INSERT INTO circles_identity.provider_links (provider_subject, user_id)
        VALUES (${subject}::uuid, ${userId})`,
  );
}

/**
 * Stores the immutable Supabase subject → existing Circles numeric-user binding.
 * It has no user-ID input from HTTP callers: route code passes either a verified
 * SDK actor or the namespaced provider source resolved in this module.
 */
export class EmailIdentityStore {
  private readonly getDatabase: () => Promise<IdentityDatabase | null>;
  private readonly upsertSourceUserInTransaction: SourceUserUpsert;
  private readonly runTrustedDatabaseTransaction: <T>(
    operation: TrustedSystemDatabaseOperation,
    work: () => Promise<T>,
  ) => Promise<T>;

  constructor(dependencies: EmailIdentityDependencies = {}) {
    this.getDatabase = dependencies.getDatabase ?? getDb;
    this.upsertSourceUserInTransaction =
      dependencies.upsertSourceUserInTransaction ??
      ((transaction, input) => upsertUserInTransaction(transaction, input));
    this.runTrustedDatabaseTransaction =
      dependencies.runTrustedDatabaseTransaction ??
      withTrustedSystemDatabaseTransaction;
  }

  async isReady(): Promise<boolean> {
    try {
      return await this.runTrustedDatabaseTransaction(
        "email-identity-readiness",
        async () => {
          const database = await this.getDatabase();
          if (!database) return false;
          const result = await database.execute(
            sql.raw(EMAIL_IDENTITY_READINESS_SQL),
          );
          return (
            (result.rows[0] as { ready?: unknown } | undefined)?.ready === true
          );
        },
      );
    } catch {
      return false;
    }
  }

  /**
   * Finds a durable binding or atomically creates a gated namespaced source user.
   * Lock order is subject → normalized email → registration/openId → source row.
   */
  async resolveForSignIn(
    identity: VerifiedEmailIdentity,
  ): Promise<LinkedEmailIdentity> {
    const sourceOpenId = providerOpenId(identity.subject);
    const normalizedEmail = normalizedUserEmail(identity.email);
    try {
      return await this.runTrustedDatabaseTransaction(
        "verified-email-identity",
        async () => {
          const database = await this.requireDatabase();
          try {
            return await database.transaction(async (transaction) => {
              await lockScope(
                transaction,
                `circles.email-identity.subject:${identity.subject}`,
              );
              await lockUserEmailAllocation(transaction, normalizedEmail);

              const linked = await linkedBySubject(
                transaction,
                identity.subject,
              );
              if (linked) {
                if (linked.openId !== sourceOpenId) {
                  throw new EmailIdentityLinkRequiredError();
                }
                return linked;
              }

              let source = await sourceUserByOpenId(transaction, sourceOpenId);
              if (
                await sourceEmailCollision(
                  transaction,
                  normalizedEmail,
                  source?.id ?? null,
                )
              ) {
                // This branch executes only after the provider token and /user identity
                // validation completed. Anonymous sign-in requests cannot probe it.
                throw new EmailIdentityLinkRequiredError();
              }

              if (!source) {
                // This is the established registration/default-role upsert authority,
                // invoked in this same transaction while the subject/email locks remain
                // held. It never receives role metadata from the email route.
                await this.upsertSourceUserInTransaction(transaction, {
                  openId: sourceOpenId,
                  name: identity.name ?? null,
                  email: identity.email,
                  loginMethod: "email",
                });
                source = await sourceUserByOpenId(transaction, sourceOpenId);
              }
              if (!source) throw new EmailIdentityUnavailableError();

              if (
                await sourceEmailCollision(
                  transaction,
                  normalizedEmail,
                  source.id,
                )
              ) {
                throw new EmailIdentityLinkRequiredError();
              }

              const userSubject = await linkedByUser(transaction, source.id);
              if (userSubject && userSubject !== identity.subject) {
                throw new EmailIdentityLinkRequiredError();
              }

              await insertMapping(transaction, identity.subject, source.id);
              return {
                userId: source.id,
                openId: source.openId,
                name: source.name,
              };
            });
          } catch (error) {
            if (!isUniqueViolation(error)) throw error;
            // PostgreSQL marks the allocation transaction aborted on 23505. It has
            // rolled back (including a just-created source) before this fresh read
            // transaction reacquires the same subject → email lock order.
            return await database.transaction(async (transaction) => {
              await lockScope(
                transaction,
                `circles.email-identity.subject:${identity.subject}`,
              );
              await lockUserEmailAllocation(transaction, normalizedEmail);
              const concurrent = await linkedBySubject(
                transaction,
                identity.subject,
              );
              if (concurrent?.openId === sourceOpenId) return concurrent;
              throw new EmailIdentityLinkRequiredError();
            });
          }
        },
      );
    } catch (error) {
      return unavailableUnlessKnown(error);
    }
  }

  /** Binds a verified provider subject to the actual SDK-authenticated Circles actor. */
  async linkToExistingUser(
    identity: VerifiedEmailIdentity,
    actorUserId: number,
  ): Promise<LinkedEmailIdentity> {
    if (!Number.isSafeInteger(actorUserId) || actorUserId < 1) {
      throw new EmailIdentityUnavailableError();
    }

    try {
      return await this.runTrustedDatabaseTransaction(
        "verified-email-identity",
        async () => {
          const database = await this.requireDatabase();
          return database.transaction(async (transaction) => {
            await lockScope(
              transaction,
              `circles.email-identity.subject:${identity.subject}`,
            );
            await lockScope(
              transaction,
              `circles.email-identity.user:${actorUserId}`,
            );

            const subjectLink = await linkedBySubject(
              transaction,
              identity.subject,
            );
            if (subjectLink) {
              if (subjectLink.userId !== actorUserId) {
                throw new EmailIdentityLinkRequiredError();
              }
              return subjectLink;
            }

            const userSubject = await linkedByUser(transaction, actorUserId);
            if (userSubject && userSubject !== identity.subject) {
              throw new EmailIdentityLinkRequiredError();
            }

            const actor = await sourceUserById(transaction, actorUserId);
            if (!actor) throw new EmailIdentityUnavailableError();

            try {
              await insertMapping(transaction, identity.subject, actor.userId);
            } catch (error) {
              if (!isUniqueViolation(error)) throw error;
              throw new EmailIdentityLinkRequiredError();
            }
            return actor;
          });
        },
      );
    } catch (error) {
      return unavailableUnlessKnown(error);
    }
  }

  private async requireDatabase(): Promise<IdentityDatabase> {
    const database = await this.getDatabase();
    if (!database) throw new EmailIdentityUnavailableError();
    return database;
  }
}

async function sourceUserById(
  executor: SqlExecutor,
  userId: number,
): Promise<LinkedEmailIdentity | null> {
  const result = await rows<UserRow>(
    executor,
    sql`SELECT id, "openId" AS "openId", name
        FROM circles_app.users
        WHERE id = ${userId}
        LIMIT 1
        FOR UPDATE`,
  );
  const actor = result[0];
  if (!actor || !Number.isSafeInteger(actor.id) || !actor.openId) return null;
  return { userId: actor.id, openId: actor.openId, name: actor.name ?? null };
}

export const emailIdentityStore = new EmailIdentityStore();
export const emailIdentityInternals = {
  SUPABASE_OPEN_ID_PREFIX,
  providerOpenId,
};
