import {
  ACTIVITY_ID_MAX,
  type ActivityItem,
  type ActivityPage,
  type ActivityPreferences,
  type ActivityTarget,
  type ActivityUnread,
} from "../shared/activity";

export type ActivityViewerScope = { viewerId: number | null };

export type ActivityPageUiState = {
  pages: ActivityPage[];
  items: ActivityItem[];
  isLoading: boolean;
  isError: boolean;
  /** A current response is visible, but writes still stop while it refreshes. */
  isAuthorityAvailable: boolean;
};

export type ActivityResponseUiState<T> = {
  value?: T;
  isLoading: boolean;
  isError: boolean;
  isAuthorityAvailable: boolean;
};

/** Account scope is a cache affinity key only; identity remains server-derived. */
export function activityScopeKey(scope: ActivityViewerScope): string {
  return `activity:${scope.viewerId ?? "guest"}`;
}

export function isCurrentActivityViewerResponse<T extends { viewerId: number }>(
  value: T | null | undefined,
  scope: ActivityViewerScope,
): value is T {
  return (
    !!value &&
    Number.isSafeInteger(scope.viewerId) &&
    scope.viewerId !== null &&
    value.viewerId === scope.viewerId
  );
}

export function isCurrentActivityPage(
  page: ActivityPage | null | undefined,
  scope: ActivityViewerScope,
): page is ActivityPage {
  return isCurrentActivityViewerResponse(page, scope);
}

export function isCurrentActivityUnread(
  unread: ActivityUnread | null | undefined,
  scope: ActivityViewerScope,
): unread is ActivityUnread {
  return isCurrentActivityViewerResponse(unread, scope);
}

export function isCurrentActivityPreferences(
  preferences: ActivityPreferences | null | undefined,
  scope: ActivityViewerScope,
  circleId?: number,
): preferences is ActivityPreferences {
  if (!isCurrentActivityViewerResponse(preferences, scope)) return false;
  return circleId === undefined || preferences.circle?.id === circleId;
}

export function isCurrentActivityTarget(
  target: ActivityTarget | null | undefined,
  scope: ActivityViewerScope,
  activityId: number,
): target is ActivityTarget {
  return (
    isCurrentActivityViewerResponse(target, scope) &&
    target.activityId === activityId
  );
}

function queryDisplayState({
  queryEnabled,
  isError,
  isFetchedAfterMount,
  isFetching,
  hasCurrentValue,
  hasForeignValue,
}: {
  queryEnabled: boolean;
  isError: boolean;
  isFetchedAfterMount: boolean;
  isFetching: boolean;
  hasCurrentValue: boolean;
  hasForeignValue: boolean;
}): Pick<
  ActivityResponseUiState<never>,
  "isLoading" | "isError" | "isAuthorityAvailable"
> {
  const mismatchSettled =
    queryEnabled && isFetchedAfterMount && hasForeignValue && !isFetching;
  const displayError = queryEnabled && (isError || mismatchSettled);
  const displayLoading =
    queryEnabled &&
    !displayError &&
    (!isFetchedAfterMount || (hasForeignValue && isFetching));

  return {
    isLoading: displayLoading,
    isError: displayError,
    isAuthorityAvailable:
      queryEnabled &&
      isFetchedAfterMount &&
      !isError &&
      hasCurrentValue &&
      !hasForeignValue &&
      !isFetching,
  };
}

/**
 * Never render an infinite-query cache until every page belongs to this mounted account.
 * During a normal refresh matching items remain readable, but write/navigation authority is
 * deliberately disabled until the refresh settles.
 */
export function resolveActivityPagesUiState({
  pages,
  scope,
  queryEnabled,
  isError,
  isFetchedAfterMount,
  isFetching,
}: {
  pages: ActivityPage[] | undefined;
  scope: ActivityViewerScope;
  queryEnabled: boolean;
  isError: boolean;
  isFetchedAfterMount: boolean;
  isFetching: boolean;
}): ActivityPageUiState {
  const hasPages = Array.isArray(pages) && pages.length > 0;
  const hasForeignPage = !!pages?.some(
    (page) => !isCurrentActivityPage(page, scope),
  );
  const hasCurrentPages = hasPages && !hasForeignPage;
  const display = queryDisplayState({
    queryEnabled,
    isError,
    isFetchedAfterMount,
    isFetching,
    hasCurrentValue: hasCurrentPages,
    hasForeignValue: hasForeignPage,
  });
  const currentPages =
    queryEnabled && isFetchedAfterMount && !display.isError && hasCurrentPages
      ? pages
      : [];

  return {
    pages: currentPages,
    items: uniqueActivityItems(currentPages.flatMap((page) => page.items)),
    ...display,
  };
}

export function resolveActivityResponseUiState<T extends { viewerId: number }>({
  value,
  scope,
  queryEnabled,
  isError,
  isFetchedAfterMount,
  isFetching,
  isCurrent = isCurrentActivityViewerResponse,
}: {
  value: T | null | undefined;
  scope: ActivityViewerScope;
  queryEnabled: boolean;
  isError: boolean;
  isFetchedAfterMount: boolean;
  isFetching: boolean;
  isCurrent?: (
    value: T | null | undefined,
    scope: ActivityViewerScope,
  ) => boolean;
}): ActivityResponseUiState<T> {
  const current = isCurrent(value, scope);
  const foreign = !!value && !current;
  const display = queryDisplayState({
    queryEnabled,
    isError,
    isFetchedAfterMount,
    isFetching,
    hasCurrentValue: current,
    hasForeignValue: foreign,
  });

  return {
    value:
      queryEnabled && isFetchedAfterMount && !display.isError && current
        ? (value ?? undefined)
        : undefined,
    ...display,
  };
}

export function uniqueActivityItems(
  items: readonly ActivityItem[],
): ActivityItem[] {
  const seen = new Set<number>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/** A badge never reports a negative/non-finite value and deliberately caps visual noise. */
export function activityBadgeLabel(
  count: number | null | undefined,
): string | null {
  if (!Number.isFinite(count) || !count || count < 1) return null;
  return count > 99 ? "99+" : String(Math.floor(count));
}

/** Only a server-supplied unread watermark may be used for mark-all. */
export function capturedUnreadThroughId(
  unread: ActivityUnread | null | undefined,
  scope: ActivityViewerScope,
): number | undefined {
  if (!isCurrentActivityUnread(unread, scope) || unread.count < 1)
    return undefined;
  return Number.isSafeInteger(unread.throughId) && unread.throughId > 0
    ? unread.throughId
    : undefined;
}

export function parseActivityRouteId(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= ACTIVITY_ID_MAX
    ? parsed
    : undefined;
}

export function isCurrentActivityScope(
  completionScope: string,
  currentScope: string,
  mounted: boolean,
): boolean {
  return mounted && completionScope === currentScope;
}

/** Pending requesters as well as approved members may ask to mute their own circle updates. */
export function canUseCircleActivityPreferences(
  role: string | null | undefined,
): boolean {
  return (
    role === "owner" ||
    role === "moderator" ||
    role === "member" ||
    role === "pending"
  );
}

export function activityCopy(item: ActivityItem): {
  title: string;
  detail: string;
} {
  if (!item.available) {
    return {
      title: "This update is no longer available.",
      detail: "It may have been removed or your access may have changed.",
    };
  }

  if (item.kind === "comment_on_your_post") {
    return {
      title: item.actorName
        ? `${item.actorName} commented on your moment.`
        : "Someone commented on your moment.",
      detail: item.circleName
        ? `In ${item.circleName}`
        : "Open to see the moment.",
    };
  }

  return {
    title: item.circleName
      ? `Your request to join ${item.circleName} was approved.`
      : "Your membership request was approved.",
    detail: item.actorName
      ? `Approved by ${item.actorName}`
      : "Open to visit the circle.",
  };
}
