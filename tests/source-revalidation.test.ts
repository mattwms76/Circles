import {
  QueryClient,
  QueryObserver,
  type QueryKey,
} from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSourceRevalidationController,
  isCurrentSourceQueryForPath,
  SOURCE_REVALIDATION_INTERVAL_MS,
  type SourceRevalidationQueryClient,
} from "../lib/source-query-invalidation";

type QueryInput = Readonly<Record<string, unknown>>;

type ActiveQuery = {
  calls: () => number;
  stop: () => void;
};

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function sourceKey(
  router: string,
  procedure: string,
  input?: QueryInput,
  type: "query" | "infinite" = "query",
): QueryKey {
  return [
    [router, procedure],
    {
      ...(input === undefined ? {} : { input }),
      type,
    },
  ];
}

async function observeActiveQuery(
  queryClient: QueryClient,
  queryKey: QueryKey,
): Promise<ActiveQuery> {
  let callCount = 0;
  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn: async () => {
      callCount += 1;
      return callCount;
    },
    retry: false,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  await observer.refetch();
  return {
    calls: () => callCount,
    stop: unsubscribe,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("source query revalidation policy", () => {
  it("accepts only the current normal-app route/resource and public platform status keys", () => {
    const circleFeed = sourceKey(
      "social",
      "feedPage",
      { filter: "for-you", circleId: 12, limit: 20 },
      "infinite",
    );
    const wrongCircleFeed = sourceKey(
      "social",
      "feedPage",
      { filter: "for-you", circleId: 13, limit: 20 },
      "infinite",
    );
    const matchingModeration = sourceKey("moderation", "list", {
      circleId: 12,
      viewerScope: 7,
      filter: "open",
    });
    const foreignModeration = sourceKey("moderation", "list", {
      circleId: 12,
      viewerScope: 8,
      filter: "open",
    });
    const platformStatus = sourceKey("platform", "status");

    expect(isCurrentSourceQueryForPath(circleFeed, "/circle/12", 7)).toBe(true);
    expect(isCurrentSourceQueryForPath(wrongCircleFeed, "/circle/12", 7)).toBe(
      false,
    );
    expect(
      isCurrentSourceQueryForPath(matchingModeration, "/moderation/12", 7),
    ).toBe(true);
    expect(
      isCurrentSourceQueryForPath(foreignModeration, "/moderation/12", 7),
    ).toBe(false);
    expect(isCurrentSourceQueryForPath(platformStatus, "/create", null)).toBe(
      true,
    );
    expect(
      isCurrentSourceQueryForPath(
        sourceKey("platform", "status", { claim: "operator" }),
        "/create",
        null,
      ),
    ).toBe(false);
    expect(
      isCurrentSourceQueryForPath(
        sourceKey("admin", "analytics", { claim: "operator" }),
        "/",
        7,
      ),
    ).toBe(false);
    expect(
      isCurrentSourceQueryForPath(
        sourceKey("onboarding", "status"),
        "/onboarding",
        7,
      ),
    ).toBe(false);
    expect(
      isCurrentSourceQueryForPath(
        sourceKey("activity", "preferences", { viewerScope: 7 }),
        "/updates",
        7,
      ),
    ).toBe(false);
  });

  it("refetches only matching active observers, never inactive, off-route, or foreign-scope cache entries", async () => {
    const queryClient = makeQueryClient();
    const current = await observeActiveQuery(
      queryClient,
      sourceKey("circleHome", "get", { circleId: 12, viewerScope: 7 }),
    );
    const offRoute = await observeActiveQuery(
      queryClient,
      sourceKey("social", "feedPage", { circleId: 13, filter: "for-you" }),
    );
    const foreignScope = await observeActiveQuery(
      queryClient,
      sourceKey("activity", "unreadCount", { viewerScope: 8 }),
    );
    const inactiveKey = sourceKey("social", "membersPage", {
      circleId: 12,
      limit: 20,
    });
    queryClient.setQueryData(inactiveKey, ["inactive member"]);

    const currentBefore = current.calls();
    const offRouteBefore = offRoute.calls();
    const foreignScopeBefore = foreignScope.calls();
    const controller = createSourceRevalidationController({
      queryClient,
      pathname: "/circle/12",
      accountId: 7,
    });
    controller.setForeground(true);
    await controller.refresh();

    expect(current.calls()).toBeGreaterThan(currentBefore);
    expect(offRoute.calls()).toBe(offRouteBefore);
    expect(foreignScope.calls()).toBe(foreignScopeBefore);
    expect(queryClient.getQueryState(inactiveKey)?.isInvalidated).toBe(false);

    controller.dispose();
    current.stop();
    offRoute.stop();
    foreignScope.stop();
    queryClient.clear();
  });

  it("runs at most one foreground interval, pauses while hidden, and clears it on disposal", async () => {
    vi.useFakeTimers();
    const queryClient = makeQueryClient();
    const profile = await observeActiveQuery(
      queryClient,
      sourceKey("social", "profile", {}),
    );
    const controller = createSourceRevalidationController({
      queryClient,
      pathname: "/",
      accountId: 7,
    });
    controller.setForeground(true);

    const beforeForegroundTick = profile.calls();
    await vi.advanceTimersByTimeAsync(SOURCE_REVALIDATION_INTERVAL_MS);
    expect(profile.calls()).toBeGreaterThan(beforeForegroundTick);

    controller.setForeground(false);
    const beforeBackgroundTick = profile.calls();
    await vi.advanceTimersByTimeAsync(SOURCE_REVALIDATION_INTERVAL_MS * 2);
    expect(profile.calls()).toBe(beforeBackgroundTick);

    controller.setForeground(true);
    await vi.advanceTimersByTimeAsync(SOURCE_REVALIDATION_INTERVAL_MS);
    expect(profile.calls()).toBeGreaterThan(beforeBackgroundTick);

    controller.dispose();
    const beforeDisposedTick = profile.calls();
    await vi.advanceTimersByTimeAsync(SOURCE_REVALIDATION_INTERVAL_MS * 2);
    expect(profile.calls()).toBe(beforeDisposedTick);

    profile.stop();
    queryClient.clear();
  });

  it("refreshes the bounded public platform status key for a foreground guest", async () => {
    vi.useFakeTimers();
    const queryClient = makeQueryClient();
    const status = await observeActiveQuery(
      queryClient,
      sourceKey("platform", "status"),
    );
    const controller = createSourceRevalidationController({
      queryClient,
      pathname: "/create",
      accountId: null,
    });
    controller.setForeground(true);
    const beforeTick = status.calls();

    await vi.advanceTimersByTimeAsync(SOURCE_REVALIDATION_INTERVAL_MS);

    expect(status.calls()).toBeGreaterThan(beforeTick);
    controller.dispose();
    status.stop();
    queryClient.clear();
  });

  it("contains lifecycle invalidation failures without exposing an unhandled refresh rejection", async () => {
    const failingClient: SourceRevalidationQueryClient = {
      invalidateQueries: async () => {
        throw new Error("synthetic observer failure");
      },
    };
    const controller = createSourceRevalidationController({
      queryClient: failingClient,
      pathname: "/",
      accountId: 7,
    });
    controller.setForeground(true);

    await expect(controller.refresh()).resolves.toBeUndefined();

    controller.dispose();
  });

  it("drops the former account controller before a new account refresh can run", async () => {
    const queryClient = makeQueryClient();
    const accountSeven = await observeActiveQuery(
      queryClient,
      sourceKey("activity", "unreadCount", { viewerScope: 7 }),
    );
    const accountEight = await observeActiveQuery(
      queryClient,
      sourceKey("activity", "unreadCount", { viewerScope: 8 }),
    );

    const formerController = createSourceRevalidationController({
      queryClient,
      pathname: "/updates",
      accountId: 7,
    });
    formerController.setForeground(true);
    const sevenBefore = accountSeven.calls();
    const eightBefore = accountEight.calls();
    await formerController.refresh();
    expect(accountSeven.calls()).toBeGreaterThan(sevenBefore);
    expect(accountEight.calls()).toBe(eightBefore);

    formerController.dispose();
    const nextController = createSourceRevalidationController({
      queryClient,
      pathname: "/updates",
      accountId: 8,
    });
    nextController.setForeground(true);
    const sevenAfterTransition = accountSeven.calls();
    const eightAfterTransition = accountEight.calls();
    await nextController.refresh();

    expect(accountSeven.calls()).toBe(sevenAfterTransition);
    expect(accountEight.calls()).toBeGreaterThan(eightAfterTransition);

    nextController.dispose();
    accountSeven.stop();
    accountEight.stop();
    queryClient.clear();
  });
});
