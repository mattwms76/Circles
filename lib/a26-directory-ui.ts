export type A26ProfileResponse = {
  id: number;
  avatar?: string | null;
};

export type A26MomentsRailState = "loading" | "error" | "empty" | "content";

export const A26_CIRCLE_HERO_BACKPLATE_COLOR = "#26351E";

/**
 * A profile query for the signed-in actor must have an actor-specific cache
 * key. Returning undefined leaves the optional profile input unbound for a
 * confirmed guest, where the query remains disabled by the caller.
 */
export function getA26OwnProfileQueryInput(
  actorId: number | null | undefined,
): { id: number } | undefined {
  return typeof actorId === "number" && Number.isSafeInteger(actorId)
    ? { id: actorId }
    : undefined;
}

/**
 * Cached profile data is presentation-safe only when its response identity is
 * the current actor. This makes an observer-driven account transition fail
 * closed until the actor-bound query resolves.
 */
export function getA26CurrentAvatar(
  actorId: number | null | undefined,
  profile: A26ProfileResponse | null | undefined,
): string | null | undefined {
  if (
    typeof actorId !== "number" ||
    !Number.isSafeInteger(actorId) ||
    profile?.id !== actorId
  ) {
    return undefined;
  }

  return profile.avatar;
}

export function isA26CurrentActorProfile(
  actorId: number | null | undefined,
  profileId: number,
): boolean {
  return (
    typeof actorId === "number" &&
    Number.isSafeInteger(actorId) &&
    actorId === profileId
  );
}

export function getA26MomentsRailState({
  isError,
  isLoading,
  itemCount,
}: {
  isError: boolean;
  isLoading: boolean;
  itemCount: number;
}): A26MomentsRailState {
  if (isLoading) return "loading";
  if (isError) return "error";
  return itemCount > 0 ? "content" : "empty";
}

export function getA26LiveControlCopy({
  count,
  isError,
  isLoading,
}: {
  count: number | undefined;
  isError: boolean;
  isLoading: boolean;
}): { accessibilityLabel: string; visibleText: string } {
  if (isLoading) {
    return {
      accessibilityLabel: "Open Live now, checking live sessions",
      visibleText: "Live now · checking",
    };
  }

  if (isError) {
    return {
      accessibilityLabel: "Open Live now, live sessions unavailable",
      visibleText: "Live now · unavailable",
    };
  }

  const liveCount = count ?? 0;
  const sessionLabel = liveCount === 1 ? "live session" : "live sessions";
  return {
    accessibilityLabel: `Open Live now, ${liveCount} ${sessionLabel}`,
    visibleText: `Live now · ${liveCount}`,
  };
}
