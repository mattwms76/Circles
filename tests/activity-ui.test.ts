import { describe, expect, it } from "vitest";
import type {
  ActivityItem,
  ActivityPage,
  ActivityPreferences,
  ActivityUnread,
} from "../shared/activity";
import {
  activityBadgeLabel,
  activityCopy,
  activityScopeKey,
  canUseCircleActivityPreferences,
  capturedUnreadThroughId,
  isCurrentActivityScope,
  isCurrentActivityTarget,
  parseActivityRouteId,
  resolveActivityPagesUiState,
  resolveActivityResponseUiState,
  uniqueActivityItems,
} from "../lib/activity-ui";

const item = (id: number, readAt: string | null = null): ActivityItem => ({
  id,
  kind: "comment_on_your_post",
  createdAt: "2026-10-23T00:00:00.000Z",
  readAt,
  available: true,
  actorName: "Ari",
  circleName: "Writers",
});

const page = (viewerId: number, items: ActivityItem[]): ActivityPage => ({
  viewerId,
  items,
  nextCursor: items.length ? { beforeId: items.at(-1)!.id } : null,
});

const preferences: ActivityPreferences = {
  viewerId: 7,
  commentsEnabled: true,
  membershipApprovalsEnabled: false,
  circle: null,
};

const unread: ActivityUnread = { viewerId: 7, count: 3, throughId: 21 };

describe("Activity UI account and freshness contracts", () => {
  it("uses the account only as a scoped cache affinity and hides another account response", () => {
    expect(activityScopeKey({ viewerId: 7 })).toBe("activity:7");
    expect(activityScopeKey({ viewerId: null })).toBe("activity:guest");

    const foreign = resolveActivityResponseUiState({
      value: { ...preferences, viewerId: 8 },
      scope: { viewerId: 7 },
      queryEnabled: true,
      isFetchedAfterMount: true,
      isFetching: false,
      isError: false,
    });
    expect(foreign).toMatchObject({
      value: undefined,
      isLoading: false,
      isError: true,
      isAuthorityAvailable: false,
    });
  });

  it("does not render pre-mount cache or query-error cache and removes write authority while refreshing", () => {
    const cached = page(7, [item(20)]);
    expect(
      resolveActivityPagesUiState({
        pages: [cached],
        scope: { viewerId: 7 },
        queryEnabled: true,
        isFetchedAfterMount: false,
        isFetching: true,
        isError: false,
      }),
    ).toMatchObject({
      items: [],
      isLoading: true,
      isAuthorityAvailable: false,
    });

    const refreshing = resolveActivityPagesUiState({
      pages: [cached],
      scope: { viewerId: 7 },
      queryEnabled: true,
      isFetchedAfterMount: true,
      isFetching: true,
      isError: false,
    });
    expect(refreshing.items.map((entry) => entry.id)).toEqual([20]);
    expect(refreshing.isAuthorityAvailable).toBe(false);

    expect(
      resolveActivityPagesUiState({
        pages: [cached],
        scope: { viewerId: 7 },
        queryEnabled: true,
        isFetchedAfterMount: true,
        isFetching: false,
        isError: true,
      }),
    ).toMatchObject({ items: [], isError: true, isAuthorityAvailable: false });
  });

  it("keeps keyset pages newest-first without duplicated boundary records", () => {
    const first = page(7, [item(30), item(29), item(28)]);
    const second = page(7, [item(28), item(27), item(26)]);
    const state = resolveActivityPagesUiState({
      pages: [first, second],
      scope: { viewerId: 7 },
      queryEnabled: true,
      isFetchedAfterMount: true,
      isFetching: false,
      isError: false,
    });
    expect(state.items.map((entry) => entry.id)).toEqual([30, 29, 28, 27, 26]);
    expect(
      uniqueActivityItems([item(5), item(5), item(4)]).map((entry) => entry.id),
    ).toEqual([5, 4]);
  });

  it("uses only the matching server unread watermark for mark-all and caps the durable badge", () => {
    expect(capturedUnreadThroughId(unread, { viewerId: 7 })).toBe(21);
    expect(capturedUnreadThroughId(unread, { viewerId: 8 })).toBeUndefined();
    expect(
      capturedUnreadThroughId({ ...unread, count: 0 }, { viewerId: 7 }),
    ).toBeUndefined();
    expect(activityBadgeLabel(0)).toBeNull();
    expect(activityBadgeLabel(99)).toBe("99");
    expect(activityBadgeLabel(100)).toBe("99+");
  });

  it("rejects invalid route IDs and only accepts targets resolved for the active recipient", () => {
    expect(parseActivityRouteId("21")).toBe(21);
    expect(parseActivityRouteId("021")).toBeUndefined();
    expect(parseActivityRouteId("0")).toBeUndefined();
    expect(parseActivityRouteId("2147483648")).toBeUndefined();

    expect(
      isCurrentActivityTarget(
        {
          viewerId: 7,
          activityId: 21,
          target: { type: "circle", circleId: 4 },
        },
        { viewerId: 7 },
        21,
      ),
    ).toBe(true);
    expect(
      isCurrentActivityTarget(
        { viewerId: 8, activityId: 21, target: null },
        { viewerId: 7 },
        21,
      ),
    ).toBe(false);
  });

  it("drops late completions after an account or route-scope change", () => {
    const initial = "activity:7:detail:21";
    expect(isCurrentActivityScope(initial, initial, true)).toBe(true);
    expect(isCurrentActivityScope(initial, "activity:8:detail:21", true)).toBe(
      false,
    );
    expect(isCurrentActivityScope(initial, initial, false)).toBe(false);
  });

  it("allows the current pending requester to configure only their own circle update preference", () => {
    expect(canUseCircleActivityPreferences("pending")).toBe(true);
    expect(canUseCircleActivityPreferences("member")).toBe(true);
    expect(canUseCircleActivityPreferences(null)).toBe(false);

    expect(
      activityCopy({
        ...item(8),
        available: false,
        actorName: "Private",
        circleName: "Secret",
      }),
    ).toEqual({
      title: "This update is no longer available.",
      detail: "It may have been removed or your access may have changed.",
    });
  });
});
