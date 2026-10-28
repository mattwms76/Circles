import type { QueryFilters, QueryKey } from "@tanstack/react-query";
import type { AuthGateState } from "@/lib/feed-ui-helpers";

/** A resolved authenticated actor or the resolved guest boundary. */
export type ResolvedActor = number | null;

/** `undefined` means that auth is still checking or has an authority error. */
export type ObservedActor = ResolvedActor | undefined;

type AuthAuthorityQuery = {
  queryKey: QueryKey;
};

type ActorBoundaryQueryClient = {
  cancelQueries: (filters?: QueryFilters) => Promise<void>;
  removeQueries: (filters?: QueryFilters) => void;
  getMutationCache: () => {
    clear: () => void;
  };
};

function isPositiveSafeId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Auth loading and errors do not establish a new actor. Holding the last
 * admitted actor through those states preserves the existing auth gate while a
 * successful auth.me response is still authoritative.
 */
export function observedActorForAuth(
  authState: AuthGateState,
  user: { id: number } | null | undefined,
): ObservedActor {
  if (authState === "checking" || authState === "error") return undefined;
  if (authState === "guest") return null;
  return isPositiveSafeId(user?.id) ? user.id : null;
}

/**
 * The initial resolved actor has no predecessor to evict. Later resolved
 * changes, including actor-to-guest and guest-to-actor, must cross the cache
 * and subtree boundary before children can render again.
 */
export function actorBoundaryResetRequired(
  admittedActor: ObservedActor,
  observedActor: ObservedActor,
): boolean {
  return (
    admittedActor !== undefined &&
    observedActor !== undefined &&
    admittedActor !== observedActor
  );
}

/** Stable React key for remounting account-bound state and observers. */
export function actorBoundaryKey(actor: ObservedActor): string {
  if (actor === undefined) return "actor:unresolved";
  return actor === null ? "actor:guest" : `actor:${actor}`;
}

/**
 * The current auth.me result is the authority that identified the replacement
 * actor, so it must survive this reset. Every other query can carry a prior
 * viewer projection and is deliberately removed rather than invalidated.
 */
export function isAuthAuthorityQueryKey(queryKey: QueryKey): boolean {
  const path = queryKey[0];
  return (
    Array.isArray(path) &&
    path.length === 2 &&
    path[0] === "auth" &&
    path[1] === "me"
  );
}

const protectedCacheFilter: QueryFilters = {
  predicate: (query: AuthAuthorityQuery) =>
    !isAuthAuthorityQueryKey(query.queryKey),
};

/**
 * Starts cancellation before synchronously removing retained account-derived
 * query and mutation state. Cancellation failures are intentionally contained:
 * detaching stale state takes precedence, and a late result has no cache entry
 * to update. The caller may admit the replacement actor immediately after this
 * function returns because the removal happens before its first await.
 */
export async function resetActorScopedClientState(
  queryClient: ActorBoundaryQueryClient,
): Promise<void> {
  let cancellation: Promise<void> | undefined;
  try {
    cancellation = queryClient.cancelQueries(protectedCacheFilter);
  } catch {
    // Continue fail-closed with synchronous cache removal below.
  }

  try {
    queryClient.removeQueries(protectedCacheFilter);
  } catch {
    // An unexpected cache implementation must not preserve former actor data.
  }

  try {
    queryClient.getMutationCache().clear();
  } catch {
    // Removed query state and the remount boundary still protect descendants.
  }

  try {
    await cancellation;
  } catch {
    // Aborted requests commonly reject once detached from the removed cache.
  }
}
