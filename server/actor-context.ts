import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Identity that may be copied into a PostgreSQL transaction-local setting.
 * It is constructed only from the validated server request context, never from
 * a router input, viewer affinity parameter, or client-visible DTO.
 */
export type DatabaseActor =
  | { kind: "guest" }
  | { kind: "user"; userId: number }
  /** A verified scheduler identity is distinct from an ordinary end user. */
  | { kind: "system" };

export const GUEST_DATABASE_ACTOR: DatabaseActor = { kind: "guest" };

export class InvalidDatabaseActorError extends Error {
  constructor() {
    super("Validated request actor is unavailable");
    this.name = "InvalidDatabaseActorError";
  }
}

type AuthenticatedActorCandidate = {
  id: unknown;
  isCron?: unknown;
  taskUid?: unknown;
};

type DatabaseActorScope = {
  actor: DatabaseActor;
  /** The caller-owned outer transaction, intentionally opaque outside db.ts. */
  database: unknown;
};

const databaseActorScope = new AsyncLocalStorage<DatabaseActorScope>();

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Converts only the existing authenticated server principal into a DB actor.
 * `sdk.authenticateRequest` has already verified durable session authority
 * before this is called. Invalid identities are not downgraded to a user ID.
 */
export function databaseActorFromAuthenticatedUser(
  user: AuthenticatedActorCandidate | null,
): DatabaseActor {
  if (user === null) return GUEST_DATABASE_ACTOR;
  if (isPositiveSafeInteger(user.id)) return { kind: "user", userId: user.id };
  if (
    user.id === -1 &&
    user.isCron === true &&
    typeof user.taskUid === "string" &&
    user.taskUid.length > 0
  ) {
    return { kind: "system" };
  }
  throw new InvalidDatabaseActorError();
}

/** Converts the actor into the two closed values accepted by DB-03 helpers. */
export function databaseActorSettings(actor: DatabaseActor): {
  actorId: string;
  actorKind: "guest" | "user" | "system";
} {
  switch (actor.kind) {
    case "user":
      if (!isPositiveSafeInteger(actor.userId)) {
        throw new InvalidDatabaseActorError();
      }
      return { actorId: String(actor.userId), actorKind: "user" };
    case "system":
      return { actorId: "0", actorKind: "system" };
    case "guest":
      return { actorId: "0", actorKind: "guest" };
  }
}

/** Runs work with a transaction already initialized for exactly this actor. */
export function runWithDatabaseActorScope<T>(
  scope: DatabaseActorScope,
  callback: () => T,
): T {
  return databaseActorScope.run(scope, callback);
}

export function getDatabaseActorScope(): DatabaseActorScope | undefined {
  return databaseActorScope.getStore();
}
