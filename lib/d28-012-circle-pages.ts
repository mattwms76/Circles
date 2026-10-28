import {
  resolvePagedDisplayState,
  type A26PagedDisplayState,
} from "./a26-paged-display";

type D28012PagedQuery = {
  isLoading: boolean;
  isError: boolean;
  isFetchNextPageError: boolean;
  isRefetchError: boolean;
  error: unknown;
};

type D28012PagedCollection = D28012PagedQuery & {
  itemCount: number;
  hasNextPage: boolean;
};

export type D28012CirclePageDisplayState = A26PagedDisplayState & {
  isAuthorizationDenied: boolean;
};

export type D28012CirclePageDisplayStates = {
  feed: D28012CirclePageDisplayState;
  members: D28012CirclePageDisplayState;
  manageMembers: D28012CirclePageDisplayState;
  managePosts: D28012CirclePageDisplayState;
};

type D28012CirclePageDisplayInput = {
  canReadCurrentCircleContents: boolean;
  feed: D28012PagedCollection;
  members: D28012PagedQuery & {
    visibleItemCount: number;
    manageableItemCount: number;
    hasNextPage: boolean;
  };
};

type ErrorWithCode = {
  code?: unknown;
  data?: unknown;
};

function isD28012AuthorizationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const { code, data } = error as ErrorWithCode;
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN") return true;
  if (!data || typeof data !== "object") return false;

  const nestedCode = (data as { code?: unknown }).code;
  return nestedCode === "UNAUTHORIZED" || nestedCode === "FORBIDDEN";
}

function resolveD28012CurrentCirclePage({
  hasContent,
  ...query
}: D28012PagedQuery & { hasContent: boolean }): D28012CirclePageDisplayState {
  const hasCurrentError =
    query.isError || query.isFetchNextPageError || query.isRefetchError;

  return {
    ...resolvePagedDisplayState({
      ...query,
      hasContent,
    }),
    isAuthorizationDenied:
      hasCurrentError && isD28012AuthorizationError(query.error),
  };
}

/**
 * Resolves the Circle detail’s four paged surfaces from contents that belong to
 * the current readable Circle scope. Pending membership requests stay hidden
 * in Members but remain visible to the authorized Manage surface.
 */
export function resolveD28012CirclePageDisplayStates({
  canReadCurrentCircleContents,
  feed,
  members,
}: D28012CirclePageDisplayInput): D28012CirclePageDisplayStates {
  return {
    feed: resolveD28012CurrentCirclePage({
      ...feed,
      hasContent:
        canReadCurrentCircleContents &&
        (feed.itemCount > 0 || feed.hasNextPage),
    }),
    members: resolveD28012CurrentCirclePage({
      ...members,
      hasContent:
        canReadCurrentCircleContents &&
        (members.visibleItemCount > 0 || members.hasNextPage),
    }),
    manageMembers: resolveD28012CurrentCirclePage({
      ...members,
      hasContent:
        canReadCurrentCircleContents &&
        (members.manageableItemCount > 0 || members.hasNextPage),
    }),
    managePosts: resolveD28012CurrentCirclePage({
      ...feed,
      hasContent:
        canReadCurrentCircleContents &&
        (feed.itemCount > 0 || feed.hasNextPage),
    }),
  };
}
