import {
  MODERATION_NOTE_MAX,
  moderationNote,
  moderationTextLength,
  type ModerationCase,
  type ModerationDetail,
  type ModerationPage,
  type ModerationResolution,
  type ModerationScope,
} from "../shared/moderation";

export type ModerationUiScope = ModerationScope;

export type ModerationPagesUiState = {
  pages: ModerationPage[];
  items: ModerationCase[];
  isLoading: boolean;
  isError: boolean;
  /** A fresh matching response is present and is not being refreshed. */
  isAuthorityAvailable: boolean;
};

export type ModerationDetailUiState = {
  detail?: ModerationDetail;
  isLoading: boolean;
  isError: boolean;
  /** A fresh matching response is present and is not being refreshed. */
  isAuthorityAvailable: boolean;
};

/** Viewer scope is only a cache-affinity key; server session identity remains authoritative. */
export function moderationScopeKey(scope: ModerationUiScope): string {
  return `moderation:${scope.circleId}:${scope.viewerScope}`;
}

export function isCurrentModerationPage(
  page: ModerationPage | null | undefined,
  scope: ModerationUiScope,
): page is ModerationPage {
  return !!page && page.circleId === scope.circleId && page.viewerScope === scope.viewerScope;
}

export function isCurrentModerationDetail(
  detail: ModerationDetail | null | undefined,
  scope: ModerationUiScope,
  caseId: number,
): detail is ModerationDetail {
  return (
    !!detail &&
    detail.circleId === scope.circleId &&
    detail.viewerScope === scope.viewerScope &&
    detail.item.id === caseId
  );
}

export function isCurrentModerationResolution(
  resolution: ModerationResolution | null | undefined,
  scope: ModerationUiScope,
  caseId: number,
): resolution is ModerationResolution {
  return (
    !!resolution &&
    resolution.circleId === scope.circleId &&
    resolution.viewerScope === scope.viewerScope &&
    resolution.caseId === caseId
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
}): Pick<ModerationDetailUiState, "isLoading" | "isError" | "isAuthorityAvailable"> {
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
 * Never render an infinite-case cache before this mount receives matching account and circle
 * pages. A matching queue can stay readable while refreshing, but it cannot authorize action.
 */
export function resolveModerationPagesUiState({
  pages,
  scope,
  queryEnabled,
  isError,
  isFetchedAfterMount,
  isFetching,
}: {
  pages: ModerationPage[] | undefined;
  scope: ModerationUiScope;
  queryEnabled: boolean;
  isError: boolean;
  isFetchedAfterMount: boolean;
  isFetching: boolean;
}): ModerationPagesUiState {
  const hasPages = Array.isArray(pages) && pages.length > 0;
  const hasForeignPage = !!pages?.some(
    (page) => !isCurrentModerationPage(page, scope),
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
    items: uniqueModerationCases(currentPages.flatMap((page) => page.items)),
    ...display,
  };
}

/** Error state always wins over cached detail and a mismatched case is never rendered. */
export function resolveModerationDetailUiState({
  detail,
  scope,
  caseId,
  queryEnabled,
  isError,
  isFetchedAfterMount,
  isFetching,
}: {
  detail: ModerationDetail | null | undefined;
  scope: ModerationUiScope;
  caseId: number;
  queryEnabled: boolean;
  isError: boolean;
  isFetchedAfterMount: boolean;
  isFetching: boolean;
}): ModerationDetailUiState {
  const current = isCurrentModerationDetail(detail, scope, caseId);
  const foreign = !!detail && !current;
  const display = queryDisplayState({
    queryEnabled,
    isError,
    isFetchedAfterMount,
    isFetching,
    hasCurrentValue: current,
    hasForeignValue: foreign,
  });

  return {
    detail:
      queryEnabled && isFetchedAfterMount && !display.isError && current
        ? detail
        : undefined,
    ...display,
  };
}

export function uniqueModerationCases(
  items: readonly ModerationCase[],
): ModerationCase[] {
  const seen = new Set<number>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/** Completion effects belong only to the still-mounted account/circle/case scope. */
export function isCurrentModerationScope(
  completionScope: string,
  currentScope: string,
  mounted: boolean,
): boolean {
  return mounted && completionScope === currentScope;
}

/** Bounds a plain-text note by Unicode code points without splitting an astral character. */
export function boundModerationNote(value: string): string {
  return Array.from(value).slice(0, MODERATION_NOTE_MAX).join("");
}

export function validateModerationNote(value: string): string | undefined {
  if (moderationTextLength(value) > MODERATION_NOTE_MAX) {
    return `Keep the resolution note under ${MODERATION_NOTE_MAX} characters.`;
  }
  return undefined;
}

export function serializeModerationNote(value: string): string {
  return moderationNote(value);
}

/** Query or mutation errors with these codes affirm that this mounted authority is gone. */
export function isConfirmedModerationAuthorityLoss(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") return false;
  const code = (data as { code?: unknown }).code;
  return code === "FORBIDDEN" || code === "UNAUTHORIZED";
}

export function moderationDecisionLabel(decision: "keep" | "remove"): string {
  return decision === "keep" ? "Kept" : "Removed";
}
