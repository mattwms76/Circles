import type { AuthGateState } from "@/lib/feed-ui-helpers";

export type ModerationRouteAuthGate =
  | "checking"
  | "auth-error"
  | "guest"
  | "workspace";

/**
 * Auth errors must take precedence over both guest UI and protected workspace
 * mounting. A retained user is not enough to establish current authority.
 */
export function resolveModerationRouteAuthGate({
  authState,
  hasUser,
}: {
  authState: AuthGateState;
  hasUser: boolean;
}): ModerationRouteAuthGate {
  if (authState === "error") return "auth-error";
  if (!hasUser && authState === "checking") return "checking";
  return hasUser ? "workspace" : "guest";
}

export type ModerationAuthorityLatch = {
  scopeKey: string;
  /** Timestamp of the last successful list data before authority was lost. */
  listDataUpdatedAt: number;
  /** Timestamp of the selected detail before authority was lost, if one was open. */
  detailDataUpdatedAt: number | null;
  /** An open detail needs a new authorized detail as well as a new authorized list. */
  requiresDetail: boolean;
};

function validTimestamp(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

/** Captures the cache generation that existed when a known authority denial arrived. */
export function createModerationAuthorityLatch({
  scopeKey,
  listDataUpdatedAt,
  detailDataUpdatedAt,
  requiresDetail,
}: {
  scopeKey: string;
  listDataUpdatedAt: number | undefined;
  detailDataUpdatedAt: number | undefined;
  requiresDetail: boolean;
}): ModerationAuthorityLatch {
  return {
    scopeKey,
    listDataUpdatedAt: validTimestamp(listDataUpdatedAt),
    detailDataUpdatedAt: requiresDetail
      ? validTimestamp(detailDataUpdatedAt)
      : null,
    requiresDetail,
  };
}

/**
 * Cached data that pre-dates a FORBIDDEN/UNAUTHORIZED result cannot restore
 * moderation controls. The latch releases only after a newer matching list
 * response, and when a case was open, a newer matching detail response too.
 */
export function canReleaseModerationAuthorityLatch({
  latch,
  scopeKey,
  listAuthorityAvailable,
  listDataUpdatedAt,
  detailAuthorityAvailable,
  detailDataUpdatedAt,
}: {
  latch: ModerationAuthorityLatch | null;
  scopeKey: string;
  listAuthorityAvailable: boolean;
  listDataUpdatedAt: number | undefined;
  detailAuthorityAvailable: boolean;
  detailDataUpdatedAt: number | undefined;
}): boolean {
  if (!latch || latch.scopeKey !== scopeKey || !listAuthorityAvailable) {
    return false;
  }

  if (validTimestamp(listDataUpdatedAt) <= latch.listDataUpdatedAt) {
    return false;
  }

  if (!latch.requiresDetail) return true;

  return (
    detailAuthorityAvailable &&
    validTimestamp(detailDataUpdatedAt) > (latch.detailDataUpdatedAt ?? 0)
  );
}
