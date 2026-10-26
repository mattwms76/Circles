import { describe, expect, it } from "vitest";
import type { LiveAvatarStream } from "../lib/live-avatar-status";
import {
  LIVE_AVATAR_HOST_BATCH_SIZE,
  LIVE_AVATAR_MAX_QUERY_BATCHES,
  LIVE_AVATAR_MAX_REGISTERED_USERS,
  boundedLiveAvatarUserIds,
  chunkLiveAvatarUserIds,
  isLiveAvatarStream,
  liveAvatarScopeKey,
  liveAvatarViewerScope,
  resolveLiveAvatarStatus,
} from "../lib/live-avatar-status";

const now = Date.parse("2026-10-26T12:00:00.000Z");

function stream(overrides: Partial<LiveAvatarStream> = {}): LiveAvatarStream {
  return {
    host: {
      id: 41,
      name: "Ari",
      handle: "ari",
      bio: "",
      avatar: "",
      followers: 0,
      following: 0,
    },
    status: "live",
    liveReady: true,
    liveExpiresAt: new Date(now + 45_000).toISOString(),
    ...overrides,
  };
}

const settledResult = (data: readonly LiveAvatarStream[]) => ({
  data,
  isError: false,
  isFetchedAfterMount: true,
  isFetching: false,
  isLoading: false,
});

describe("live avatar status policy", () => {
  it("accepts only a ready live stream with a valid future lease expiry", () => {
    expect(isLiveAvatarStream(stream(), now)).toBe(true);
    expect(
      isLiveAvatarStream(
        stream({ liveExpiresAt: new Date(now).toISOString() }),
        now,
      ),
    ).toBe(false);
    expect(
      isLiveAvatarStream(
        stream({
          liveReady: false,
          liveExpiresAt: new Date(now + 1).toISOString(),
        }),
        now,
      ),
    ).toBe(false);
    expect(
      isLiveAvatarStream(stream({ liveExpiresAt: "not-a-date" }), now),
    ).toBe(false);
    expect(isLiveAvatarStream(stream({ status: "ended" }), now)).toBe(false);
  });

  it("uses the exact account or guest scope in its cache affinity key", () => {
    expect(liveAvatarViewerScope(7)).toBe(7);
    expect(liveAvatarViewerScope(0)).toBeNull();
    expect(liveAvatarViewerScope("7")).toBeNull();
    expect(liveAvatarScopeKey(7)).toBe("account:7");
    expect(liveAvatarScopeKey(null)).toBe("guest");
  });

  it("bounds deduplicated users into at most eight 64-host query batches", () => {
    const source = [
      1,
      1,
      0,
      -1,
      ...Array.from({ length: 512 }, (_, i) => i + 2),
    ];
    const bounded = boundedLiveAvatarUserIds(source);
    expect(bounded.ids).toHaveLength(LIVE_AVATAR_MAX_REGISTERED_USERS);
    expect(bounded.omitted).toBe(1);
    const chunks = chunkLiveAvatarUserIds(bounded.ids);
    expect(chunks).toHaveLength(LIVE_AVATAR_MAX_QUERY_BATCHES);
    expect(
      chunks.every((chunk) => chunk.length <= LIVE_AVATAR_HOST_BATCH_SIZE),
    ).toBe(true);
    expect(chunks.flat()).toEqual(bounded.ids);
  });

  it("renders only a settled mounted response for a requested host and clears it at expiry", () => {
    const response = settledResult([stream()]);
    expect(
      resolveLiveAvatarStatus({
        requestedHostIds: [41],
        queryEnabled: true,
        now,
        results: [response],
      }),
    ).toMatchObject({
      liveHostIds: new Set([41]),
      nextExpiryAt: now + 45_000,
    });
    expect(
      resolveLiveAvatarStatus({
        requestedHostIds: [41],
        queryEnabled: true,
        now: now + 45_000,
        results: [response],
      }).liveHostIds,
    ).toEqual(new Set());
  });

  it("fails closed for pre-mount cache, refreshing cache, query failures, disabled auth, and unrequested hosts", () => {
    const cached = settledResult([stream()]);
    const preMount = {
      ...cached,
      isFetchedAfterMount: false,
      isFetching: true,
    };
    const failed = { ...cached, isError: true };
    const foreign = settledResult([
      stream({ host: { ...stream().host, id: 99 } }),
    ]);

    for (const results of [[preMount], [failed], [foreign]]) {
      expect(
        resolveLiveAvatarStatus({
          requestedHostIds: [41],
          queryEnabled: true,
          now,
          results,
        }).liveHostIds,
      ).toEqual(new Set());
    }
    expect(
      resolveLiveAvatarStatus({
        requestedHostIds: [41],
        queryEnabled: false,
        now,
        results: [cached],
      }).liveHostIds,
    ).toEqual(new Set());
  });
});
