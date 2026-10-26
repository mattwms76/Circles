export type A26PagedDisplayKind = "loading" | "error" | "empty" | "content";

export type A26PagedDisplayRetryMode = "next" | "refresh" | null;

export type A26PagedDisplayInput = {
  isLoading: boolean;
  isError: boolean;
  hasContent: boolean;
  isFetchingNextPage?: boolean;
  isFetchNextPageError?: boolean;
  isRefetchError?: boolean;
  error?: unknown;
};

export type A26PagedDisplayState = {
  kind: A26PagedDisplayKind;
  showRetainedError: boolean;
  retryMode: A26PagedDisplayRetryMode;
};

type ErrorWithCode = {
  code?: unknown;
  data?: unknown;
};

/**
 * Explicit authorization denials are an authority boundary, not a recoverable
 * paging failure. Support both plain error codes and the tRPC data.code shape.
 */
function isExplicitAuthorizationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const { code, data } = error as ErrorWithCode;
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN") return true;
  if (!data || typeof data !== "object") return false;

  const nestedCode = (data as { code?: unknown }).code;
  return nestedCode === "UNAUTHORIZED" || nestedCode === "FORBIDDEN";
}

/**
 * Resolves collection display without replacing usable cached pages when a
 * continuation or refresh fails. Callers must establish current
 * account/resource affinity before reporting cached content as `hasContent`.
 */
export function resolvePagedDisplayState({
  isLoading,
  isError,
  hasContent,
  isFetchNextPageError = false,
  isRefetchError = false,
  error,
}: A26PagedDisplayInput): A26PagedDisplayState {
  const hasCurrentError = isError || isFetchNextPageError || isRefetchError;

  if (hasCurrentError && isExplicitAuthorizationError(error)) {
    return { kind: "error", showRetainedError: false, retryMode: "refresh" };
  }

  if (isLoading) {
    return { kind: "loading", showRetainedError: false, retryMode: null };
  }

  if (!hasContent) {
    return hasCurrentError
      ? { kind: "error", showRetainedError: false, retryMode: "refresh" }
      : { kind: "empty", showRetainedError: false, retryMode: null };
  }

  if (hasCurrentError) {
    return {
      kind: "content",
      showRetainedError: true,
      retryMode: isFetchNextPageError ? "next" : "refresh",
    };
  }

  return { kind: "content", showRetainedError: false, retryMode: null };
}
