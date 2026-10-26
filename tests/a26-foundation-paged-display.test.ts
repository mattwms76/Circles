import { describe, expect, it } from "vitest";
import { resolvePagedDisplayState } from "../lib/a26-paged-display";

const settledWithoutContent = {
  isLoading: false,
  isError: false,
  hasContent: false,
};

describe("A26-003 paged display state", () => {
  it("keeps initial loading separate from failed and successful empty collections", () => {
    expect(
      resolvePagedDisplayState({
        ...settledWithoutContent,
        isLoading: true,
      }),
    ).toStrictEqual({
      kind: "loading",
      showRetainedError: false,
      retryMode: null,
    });
    expect(
      resolvePagedDisplayState({
        ...settledWithoutContent,
        isError: true,
      }),
    ).toStrictEqual({
      kind: "error",
      showRetainedError: false,
      retryMode: "refresh",
    });
    expect(resolvePagedDisplayState(settledWithoutContent)).toStrictEqual({
      kind: "empty",
      showRetainedError: false,
      retryMode: null,
    });
  });

  it("keeps successful content visible without an inline recovery control", () => {
    expect(
      resolvePagedDisplayState({
        isLoading: false,
        isError: false,
        hasContent: true,
        isFetchingNextPage: true,
      }),
    ).toStrictEqual({
      kind: "content",
      showRetainedError: false,
      retryMode: null,
    });
  });

  it("retains cached pages and supplies a local next-page retry after continuation failure", () => {
    expect(
      resolvePagedDisplayState({
        isLoading: false,
        isError: true,
        hasContent: true,
        isFetchNextPageError: true,
      }),
    ).toStrictEqual({
      kind: "content",
      showRetainedError: true,
      retryMode: "next",
    });
  });

  it("retains cached pages and supplies refresh recovery after a refetch failure", () => {
    expect(
      resolvePagedDisplayState({
        isLoading: false,
        isError: true,
        hasContent: true,
        isRefetchError: true,
      }),
    ).toStrictEqual({
      kind: "content",
      showRetainedError: true,
      retryMode: "refresh",
    });
  });

  it("treats an otherwise unspecified cached query failure as refreshable retained content", () => {
    expect(
      resolvePagedDisplayState({
        isLoading: false,
        isError: true,
        hasContent: true,
      }),
    ).toStrictEqual({
      kind: "content",
      showRetainedError: true,
      retryMode: "refresh",
    });
  });

  it("prefers the continuation retry when both recoverable paged errors are reported", () => {
    expect(
      resolvePagedDisplayState({
        isLoading: false,
        isError: true,
        hasContent: true,
        isFetchNextPageError: true,
        isRefetchError: true,
      }),
    ).toStrictEqual({
      kind: "content",
      showRetainedError: true,
      retryMode: "next",
    });
  });

  it.each([{ data: { code: "UNAUTHORIZED" } }, { code: "FORBIDDEN" }])(
    "fails closed instead of retaining cached content after explicit authorization loss",
    (error) => {
      expect(
        resolvePagedDisplayState({
          isLoading: false,
          isError: true,
          hasContent: true,
          isFetchNextPageError: true,
          error,
        }),
      ).toStrictEqual({
        kind: "error",
        showRetainedError: false,
        retryMode: "refresh",
      });
    },
  );

  it("does not treat non-authority errors as authorization loss", () => {
    expect(
      resolvePagedDisplayState({
        isLoading: false,
        isError: true,
        hasContent: true,
        error: new Error("Network request failed"),
      }),
    ).toStrictEqual({
      kind: "content",
      showRetainedError: true,
      retryMode: "refresh",
    });
  });
});
