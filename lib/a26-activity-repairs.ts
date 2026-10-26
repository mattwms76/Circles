import type { AuthGateState } from "./feed-ui-helpers";

export type ActivityRouteGate = "checking" | "auth-error" | "guest" | "ready";

/**
 * Protected Activity routes must not treat an explicit auth failure as a guest
 * state, even if React Query still exposes a retained user from an older result.
 */
export function resolveActivityRouteGate({
  authState,
  viewerId,
}: {
  authState: AuthGateState;
  viewerId: number | null | undefined;
}): ActivityRouteGate {
  if (authState === "checking") return "checking";
  if (authState === "error") return "auth-error";
  if (
    authState !== "authenticated" ||
    typeof viewerId !== "number" ||
    !Number.isSafeInteger(viewerId) ||
    viewerId <= 0
  ) {
    return "guest";
  }
  return "ready";
}

/**
 * Mark-all depends on a fresh recipient watermark. A populated inbox keeps its
 * rows when the separate unread query fails, but surfaces local recovery rather
 * than presenting stale or missing bulk-read authority as a successful zero.
 */
export function resolveActivityUnreadControls({
  hasItems,
  unreadIsError,
  unreadAuthorityAvailable,
  throughId,
}: {
  hasItems: boolean;
  unreadIsError: boolean;
  unreadAuthorityAvailable: boolean;
  throughId: number | undefined;
}): {
  showRecovery: boolean;
  showMarkAll: boolean;
} {
  return {
    showRecovery: hasItems && unreadIsError,
    showMarkAll:
      hasItems &&
      !unreadIsError &&
      unreadAuthorityAvailable &&
      Number.isSafeInteger(throughId) &&
      (throughId ?? 0) > 0,
  };
}

/**
 * A retained activity target stays readable during a foreground refresh, but
 * PostCard actions must remain unavailable until that exact target is current.
 */
export function activityPostCardActionsAvailable(
  isTargetAuthorityAvailable: boolean,
): boolean {
  return isTargetAuthorityAvailable;
}

export const ACTIVITY_PREFERENCES_LOAD_ERROR =
  "Update preferences are unavailable. Try again.";
