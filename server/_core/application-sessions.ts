import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { applicationSessions } from "../../drizzle/session-schema";
import {
  getDb,
  type TrustedSystemDatabaseOperation,
  withTrustedSystemDatabaseTransaction,
} from "../db";

export type ApplicationSessionBinding = {
  sessionId: string;
  openId: string;
  appId: string;
};

export type NewApplicationSession = ApplicationSessionBinding & {
  expiresAt: Date;
};

export type ActiveApplicationSession = ApplicationSessionBinding & {
  expiresAt: Date;
  revokedAt: Date | null;
};

/** Raised when persistent session authority cannot be consulted. */
export class ApplicationSessionStoreUnavailableError extends Error {
  constructor() {
    super("Application session store is unavailable");
    this.name = "ApplicationSessionStoreUnavailableError";
  }
}

/**
 * Hashes a random JWT jti before it reaches storage. Callers must never log the
 * raw session id or the resulting fingerprint.
 */
export function fingerprintApplicationSession(sessionId: string): string {
  return createHash("sha256").update(sessionId, "utf8").digest("hex");
}

export interface ApplicationSessionStore {
  create(session: NewApplicationSession): Promise<void>;
  findActive(
    binding: ApplicationSessionBinding,
    now: Date,
  ): Promise<ActiveApplicationSession | null>;
  revoke(binding: ApplicationSessionBinding, revokedAt: Date): Promise<void>;
}

type ApplicationSessionStoreDependencies = {
  getDatabase?: typeof getDb;
  /** Explicit isolated-fixture seam; production uses the default scoped runner. */
  runTrustedDatabaseTransaction?: <T>(
    operation: TrustedSystemDatabaseOperation,
    work: () => Promise<T>,
  ) => Promise<T>;
};

/**
 * Durable, fail-closed authority for application JWTs. Every query binds the
 * random session id fingerprint to the JWT's OAuth identity and this app id.
 */
export class DrizzleApplicationSessionStore implements ApplicationSessionStore {
  private readonly getDatabase: typeof getDb;
  private readonly runTrustedDatabaseTransaction: <T>(
    operation: TrustedSystemDatabaseOperation,
    work: () => Promise<T>,
  ) => Promise<T>;

  constructor(dependencies: ApplicationSessionStoreDependencies = {}) {
    this.getDatabase = dependencies.getDatabase ?? getDb;
    this.runTrustedDatabaseTransaction =
      dependencies.runTrustedDatabaseTransaction ??
      withTrustedSystemDatabaseTransaction;
  }

  private async requireDb() {
    const db = await this.getDatabase();
    if (!db) throw new ApplicationSessionStoreUnavailableError();
    return db;
  }

  /**
   * App-session rows are touched only while issuing, validating, or revoking a
   * signed application credential. These direct SDK paths exist before tRPC
   * context construction, so they use the reviewed system bootstrap scope.
   */
  private async withSessionStoreTransaction<T>(
    work: () => Promise<T>,
  ): Promise<T> {
    return this.runTrustedDatabaseTransaction(
      "application-session-persistence",
      work,
    );
  }

  async create(session: NewApplicationSession): Promise<void> {
    await this.withSessionStoreTransaction(async () => {
      const db = await this.requireDb();
      await db.insert(applicationSessions).values({
        sessionFingerprint: fingerprintApplicationSession(session.sessionId),
        userOpenId: session.openId,
        appId: session.appId,
        expiresAt: session.expiresAt,
      });
    });
  }

  async findActive(
    binding: ApplicationSessionBinding,
    now: Date,
  ): Promise<ActiveApplicationSession | null> {
    return this.withSessionStoreTransaction(async () => {
      const db = await this.requireDb();
      const rows = await db
        .select({
          userOpenId: applicationSessions.userOpenId,
          appId: applicationSessions.appId,
          expiresAt: applicationSessions.expiresAt,
          revokedAt: applicationSessions.revokedAt,
        })
        .from(applicationSessions)
        .where(
          and(
            eq(
              applicationSessions.sessionFingerprint,
              fingerprintApplicationSession(binding.sessionId),
            ),
            eq(applicationSessions.userOpenId, binding.openId),
            eq(applicationSessions.appId, binding.appId),
            isNull(applicationSessions.revokedAt),
            gt(applicationSessions.expiresAt, now),
          ),
        )
        .limit(1);

      const row = rows[0];
      if (!row) return null;
      return {
        ...binding,
        openId: row.userOpenId,
        appId: row.appId,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
      };
    });
  }

  async revoke(
    binding: ApplicationSessionBinding,
    revokedAt: Date,
  ): Promise<void> {
    await this.withSessionStoreTransaction(async () => {
      const db = await this.requireDb();
      await db
        .update(applicationSessions)
        .set({ revokedAt })
        .where(
          and(
            eq(
              applicationSessions.sessionFingerprint,
              fingerprintApplicationSession(binding.sessionId),
            ),
            eq(applicationSessions.userOpenId, binding.openId),
            eq(applicationSessions.appId, binding.appId),
            isNull(applicationSessions.revokedAt),
          ),
        );
    });
  }
}

export const applicationSessionStore = new DrizzleApplicationSessionStore();
