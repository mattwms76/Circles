import type { LiveStream } from "@/shared/social";

/** A live-list row may omit the additive fields while an older API is rolling out. */
export type LiveAvatarStream = Pick<LiveStream, "host" | "status"> & {
  liveReady?: boolean;
  liveExpiresAt?: string | null;
};

export type LiveAvatarQueryResult = {
  data?: readonly LiveAvatarStream[];
  isError: boolean;
  isFetchedAfterMount: boolean;
  isFetching: boolean;
  isLoading: boolean;
};

export type LiveAvatarStatusResolution = {
  liveHostIds: ReadonlySet<number>;
  nextExpiryAt: number | null;
};

export const LIVE_AVATAR_HOST_BATCH_SIZE = 64;
export const LIVE_AVATAR_MAX_REGISTERED_USERS = 512;
export const LIVE_AVATAR_MAX_QUERY_BATCHES =
  LIVE_AVATAR_MAX_REGISTERED_USERS / LIVE_AVATAR_HOST_BATCH_SIZE;

export function isPositiveUserId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function liveAvatarViewerScope(userId: unknown): number | null {
  return isPositiveUserId(userId) ? userId : null;
}

export function liveAvatarScopeKey(viewerScope: number | null): string {
  return viewerScope === null ? "guest" : `account:${viewerScope}`;
}

export function boundedLiveAvatarUserIds(userIds: Iterable<unknown>): {
  ids: number[];
  omitted: number;
} {
  const unique = new Set<number>();
  let omitted = 0;

  for (const userId of userIds) {
    if (!isPositiveUserId(userId) || unique.has(userId)) continue;
    if (unique.size >= LIVE_AVATAR_MAX_REGISTERED_USERS) {
      omitted += 1;
      continue;
    }
    unique.add(userId);
  }

  return { ids: [...unique].sort((first, second) => first - second), omitted };
}

export function chunkLiveAvatarUserIds(userIds: readonly number[]): number[][] {
  const chunks: number[][] = [];
  for (
    let start = 0;
    start < userIds.length;
    start += LIVE_AVATAR_HOST_BATCH_SIZE
  ) {
    chunks.push(userIds.slice(start, start + LIVE_AVATAR_HOST_BATCH_SIZE));
  }
  return chunks;
}

export function liveAvatarExpiryMs(stream: LiveAvatarStream): number | null {
  if (typeof stream.liveExpiresAt !== "string") return null;
  const value = Date.parse(stream.liveExpiresAt);
  return Number.isFinite(value) ? value : null;
}

export function isLiveAvatarStream(
  stream: LiveAvatarStream,
  now = Date.now(),
): boolean {
  const expiryAt = liveAvatarExpiryMs(stream);
  return (
    stream.status === "live" &&
    stream.liveReady === true &&
    expiryAt !== null &&
    expiryAt > now &&
    isPositiveUserId(stream.host.id)
  );
}

/**
 * Treat query cache data as display authority only after a mounted request has
 * settled successfully. This deliberately hides the prior account's cache,
 * in-flight cache, and all rows in a failed chunk.
 */
export function resolveLiveAvatarStatus(input: {
  requestedHostIds: readonly number[];
  queryEnabled: boolean;
  now?: number;
  results: readonly LiveAvatarQueryResult[];
}): LiveAvatarStatusResolution {
  if (!input.queryEnabled) {
    return { liveHostIds: new Set<number>(), nextExpiryAt: null };
  }

  const requestedIds = new Set(input.requestedHostIds.filter(isPositiveUserId));
  const now = input.now ?? Date.now();
  const liveHostIds = new Set<number>();
  let nextExpiryAt: number | null = null;

  for (const result of input.results) {
    if (
      result.isError ||
      result.isLoading ||
      result.isFetching ||
      !result.isFetchedAfterMount
    ) {
      continue;
    }

    for (const stream of result.data ?? []) {
      if (
        !requestedIds.has(stream.host.id) ||
        !isLiveAvatarStream(stream, now)
      ) {
        continue;
      }
      liveHostIds.add(stream.host.id);
      const expiryAt = liveAvatarExpiryMs(stream);
      if (
        expiryAt !== null &&
        (nextExpiryAt === null || expiryAt < nextExpiryAt)
      ) {
        nextExpiryAt = expiryAt;
      }
    }
  }

  return { liveHostIds, nextExpiryAt };
}
