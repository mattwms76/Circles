export type CurrentQueryDisplayStateInput = {
  queryEnabled: boolean;
  isError: boolean;
  isFetchedAfterMount: boolean;
  isFetching: boolean;
  hasCurrentValue: boolean;
  hasForeignValue: boolean;
};

export type CurrentQueryDisplayState = {
  isLoading: boolean;
  isError: boolean;
  isAuthorityAvailable: boolean;
};

/** Resolves the visible query state without exposing stale or foreign cached values. */
export function resolveCurrentQueryDisplayState({
  queryEnabled,
  isError,
  isFetchedAfterMount,
  isFetching,
  hasCurrentValue,
  hasForeignValue,
}: CurrentQueryDisplayStateInput): CurrentQueryDisplayState {
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

/** Keeps the first object for each numeric ID, in input order. */
export function uniqueByNumericId<T extends { id: number }>(
  items: readonly T[],
): T[] {
  const seen = new Set<number>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
