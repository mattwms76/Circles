import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveD28012CirclePageDisplayStates } from "../lib/d28-012-circle-pages";

const settledQuery = {
  isLoading: false,
  isError: false,
  isFetchNextPageError: false,
  isRefetchError: false,
  error: undefined,
};

function resolvePages(
  overrides: Partial<
    Parameters<typeof resolveD28012CirclePageDisplayStates>[0]
  > = {},
) {
  return resolveD28012CirclePageDisplayStates({
    canReadCurrentCircleContents: true,
    feed: {
      ...settledQuery,
      itemCount: 2,
      hasNextPage: false,
    },
    members: {
      ...settledQuery,
      visibleItemCount: 2,
      manageableItemCount: 3,
      hasNextPage: false,
    },
    ...overrides,
  });
}

describe("D28-012 Circle retained page display", () => {
  it("retains Feed and Manage Posts after a continuation failure and selects next-page recovery", () => {
    const pages = resolvePages({
      feed: {
        ...settledQuery,
        isError: true,
        isFetchNextPageError: true,
        itemCount: 2,
        hasNextPage: true,
      },
    });

    expect(pages.feed).toMatchObject({
      kind: "content",
      showRetainedError: true,
      retryMode: "next",
    });
    expect(pages.managePosts).toMatchObject({
      kind: "content",
      showRetainedError: true,
      retryMode: "next",
    });
  });

  it("retains Members and Manage Members after a refetch failure and selects refresh recovery", () => {
    const pages = resolvePages({
      members: {
        ...settledQuery,
        isError: true,
        isRefetchError: true,
        visibleItemCount: 2,
        manageableItemCount: 3,
        hasNextPage: false,
      },
    });

    expect(pages.members).toMatchObject({
      kind: "content",
      showRetainedError: true,
      retryMode: "refresh",
    });
    expect(pages.manageMembers).toMatchObject({
      kind: "content",
      showRetainedError: true,
      retryMode: "refresh",
    });
  });

  it("keeps each successful empty surface distinct from its genuine no-content error", () => {
    const empty = resolveD28012CirclePageDisplayStates({
      canReadCurrentCircleContents: true,
      feed: {
        ...settledQuery,
        itemCount: 0,
        hasNextPage: false,
      },
      members: {
        ...settledQuery,
        visibleItemCount: 0,
        manageableItemCount: 0,
        hasNextPage: false,
      },
    });
    const failed = resolveD28012CirclePageDisplayStates({
      canReadCurrentCircleContents: true,
      feed: {
        ...settledQuery,
        isError: true,
        itemCount: 0,
        hasNextPage: false,
      },
      members: {
        ...settledQuery,
        isError: true,
        visibleItemCount: 0,
        manageableItemCount: 0,
        hasNextPage: false,
      },
    });

    expect(empty.feed.kind).toBe("empty");
    expect(empty.members.kind).toBe("empty");
    expect(empty.manageMembers.kind).toBe("empty");
    expect(empty.managePosts.kind).toBe("empty");
    expect(failed.feed).toMatchObject({
      kind: "error",
      showRetainedError: false,
      retryMode: "refresh",
    });
    expect(failed.members).toMatchObject({
      kind: "error",
      showRetainedError: false,
      retryMode: "refresh",
    });
  });

  it("does not promote cached rows from a non-current or unreadable Circle scope", () => {
    const pages = resolvePages({ canReadCurrentCircleContents: false });

    expect(pages.feed.kind).toBe("empty");
    expect(pages.members.kind).toBe("empty");
    expect(pages.manageMembers.kind).toBe("empty");
    expect(pages.managePosts.kind).toBe("empty");
  });

  it("fails closed for authorization loss rather than retaining protected feed or member rows", () => {
    const pages = resolvePages({
      feed: {
        ...settledQuery,
        isError: true,
        isFetchNextPageError: true,
        error: { data: { code: "FORBIDDEN" } },
        itemCount: 2,
        hasNextPage: true,
      },
      members: {
        ...settledQuery,
        isError: true,
        isRefetchError: true,
        error: { code: "UNAUTHORIZED" },
        visibleItemCount: 2,
        manageableItemCount: 3,
        hasNextPage: true,
      },
    });

    expect(pages.feed).toMatchObject({
      kind: "error",
      showRetainedError: false,
      isAuthorizationDenied: true,
    });
    expect(pages.managePosts).toMatchObject({
      kind: "error",
      showRetainedError: false,
      isAuthorizationDenied: true,
    });
    expect(pages.members).toMatchObject({
      kind: "error",
      showRetainedError: false,
      isAuthorizationDenied: true,
    });
    expect(pages.manageMembers).toMatchObject({
      kind: "error",
      showRetainedError: false,
      isAuthorizationDenied: true,
    });
  });

  it("wires each Circle surface to the scoped resolver and matching next-page or refresh retry", () => {
    const source = readFileSync(
      new URL("../app/circle/[id].tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("resolveD28012CirclePageDisplayStates({");
    expect(source).toContain("isFetchNextPageError: feed.isFetchNextPageError");
    expect(source).toContain("isRefetchError: feed.isRefetchError");
    expect(source).toContain(
      "isFetchNextPageError: members.isFetchNextPageError",
    );
    expect(source).toContain("isRefetchError: members.isRefetchError");
    expect(source).toContain("feedDisplayState.showRetainedError");
    expect(source).toContain("membersDisplayState.showRetainedError");
    expect(source).toContain("manageMembersDisplayState.showRetainedError");
    expect(source).toContain("managePostsDisplayState.showRetainedError");
    expect(source).toContain("!membersDisplayState.isAuthorizationDenied");
    expect(source).toContain("!feedDisplayState.isAuthorizationDenied");
    expect(source).toContain("!canManageCircleContents");
    expect(source).toContain(
      "onRetryNextPage={() => void feed.fetchNextPage()}",
    );
    expect(source).toContain("onRefresh={() => void feed.refetch()}");
    expect(source).toContain(
      "onRetryNextPage={() => void members.fetchNextPage()}",
    );
    expect(source).toContain("onRefresh={() => void members.refetch()}");
  });
});
