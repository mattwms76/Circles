import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  A26_PROFILE_BIO_MAX_LENGTH,
  A26_PROFILE_HANDLE_MAX_LENGTH,
  A26_PROFILE_NAME_MAX_LENGTH,
  a26ProfileMomentStat,
  a26ProfileStatsLayout,
  a26ProfileUpdateErrorMessage,
  flattenA26ProfilePages,
  formatA26ProfileStatCount,
  hasA26ProfileDraftErrors,
  normalizeA26ProfileDraft,
  validateA26ProfileDraft,
} from "../lib/a26-profile";
import { createStatusAnnouncementDedupe } from "../lib/status-announcement";

const profileScreenSource = readFileSync(
  new URL("../components/profile-screen.tsx", import.meta.url),
  "utf8",
);

describe("A26-017 profile Moments and Saved continuation", () => {
  function posts(count: number, offset = 0) {
    return Array.from({ length: count }, (_, index) => ({
      id: offset + index + 1,
    }));
  }

  it("retains all 101 loaded Moments across feedPage pages and marks the count as loaded until the end", () => {
    const pages = [
      posts(20),
      posts(20, 20),
      posts(20, 40),
      posts(20, 60),
      posts(20, 80),
      posts(1, 100),
    ].map((items) => ({ items }));
    const loaded = flattenA26ProfilePages(pages);

    expect(loaded).toHaveLength(101);
    expect(loaded.at(-1)).toEqual({ id: 101 });
    expect(
      a26ProfileMomentStat({
        tab: "Moments",
        loadedCount: loaded.length,
        hasNextPage: true,
        isInitialLoading: false,
        hasInitialError: false,
      }),
    ).toMatchObject({
      displayValue: "101",
      label: "moments loaded",
      accessibilityLabel: "101 moments loaded",
    });
  });

  it("retains all 101 Saved moments and reports a truthful complete count only at the end", () => {
    const pages = [posts(50), posts(50, 50), posts(1, 100)].map((items) => ({
      items,
    }));
    const loaded = flattenA26ProfilePages(pages);

    expect(loaded).toHaveLength(101);
    expect(
      a26ProfileMomentStat({
        tab: "Saved",
        loadedCount: loaded.length,
        hasNextPage: false,
        isInitialLoading: false,
        hasInitialError: false,
      }),
    ).toMatchObject({
      displayValue: "101",
      label: "saved moments",
      accessibilityLabel: "101 saved moments",
    });
  });

  it("uses feedPage with cursor continuation, retained-error policy, local retry, and an end state in the owned screen", () => {
    expect(profileScreenSource).toContain("feedPage.useInfiniteQuery");
    expect(profileScreenSource).toContain("getNextPageParam: (lastPage)");
    expect(profileScreenSource).toContain("resolvePagedDisplayState");
    expect(profileScreenSource).toContain("fetchNextPage()");
    expect(profileScreenSource).toContain("profile-feed-end");
  });
});

describe("A26-024 profile editor validation", () => {
  it("normalizes exactly as the server-facing profile schema does before a valid save", () => {
    const draft = normalizeA26ProfileDraft({
      name: "  Pat Lee  ",
      handle: "  @pat.lee-7  ",
      bio: "  A little about Pat.  ",
    });

    expect(draft).toEqual({
      name: "Pat Lee",
      handle: "@pat.lee-7",
      bio: "A little about Pat.",
    });
    expect(validateA26ProfileDraft(draft)).toEqual({});
  });

  it("blocks empty, over-limit, and pattern-invalid drafts with field-specific recovery", () => {
    const errors = validateA26ProfileDraft({
      name: " ",
      handle: "not allowed!",
      bio: "x".repeat(A26_PROFILE_BIO_MAX_LENGTH + 1),
    });

    expect(errors).toMatchObject({
      name: "Enter your name.",
      handle:
        "Use letters, numbers, underscores, periods, or hyphens in your handle.",
      bio: `Your bio must be ${A26_PROFILE_BIO_MAX_LENGTH} characters or fewer.`,
    });
    expect(hasA26ProfileDraftErrors(errors)).toBe(true);
  });

  it("enforces the router's name and handle boundaries without calling a transport path", () => {
    expect(
      validateA26ProfileDraft({
        name: "n".repeat(A26_PROFILE_NAME_MAX_LENGTH + 1),
        handle: "a",
        bio: "",
      }),
    ).toMatchObject({
      name: `Your name must be ${A26_PROFILE_NAME_MAX_LENGTH} characters or fewer.`,
      handle: "Your handle must be at least 2 characters.",
    });
    expect(
      validateA26ProfileDraft({
        name: "Pat",
        handle: "p".repeat(A26_PROFILE_HANDLE_MAX_LENGTH + 1),
        bio: "",
      }).handle,
    ).toBe(
      `Your handle must be ${A26_PROFILE_HANDLE_MAX_LENGTH} characters or fewer.`,
    );
  });

  it("does not misclassify an explicit server validation rejection as a connection failure", () => {
    expect(
      a26ProfileUpdateErrorMessage({ data: { code: "BAD_REQUEST" } }),
    ).toBe(
      "These profile details need another look. Review the fields and try again.",
    );
    expect(a26ProfileUpdateErrorMessage(new Error("offline"))).toBe(
      "We couldn’t update your profile. Check your connection and try again.",
    );
  });
});

describe("A26-025 responsive profile metrics", () => {
  it("keeps regular metrics compact while retaining the exact numeric accessible value", () => {
    expect(a26ProfileStatsLayout(390, 1)).toMatchObject({
      container: { flexWrap: "nowrap" },
      item: { flexBasis: "0%", minWidth: 0 },
    });
    expect(formatA26ProfileStatCount(12_345)).toBe("12.3K");
    expect(
      a26ProfileMomentStat({
        tab: "Moments",
        loadedCount: 12_345,
        hasNextPage: true,
        isInitialLoading: false,
        hasInitialError: false,
      }).accessibilityLabel,
    ).toBe("12345 moments loaded");
  });

  it.each([
    { width: 320, fontScale: 1, label: "320-point width" },
    { width: 390, fontScale: 2, label: "2x text scale" },
  ])(
    "uses wrapping bounded metric columns at $label",
    ({ width, fontScale }) => {
      expect(a26ProfileStatsLayout(width, fontScale)).toMatchObject({
        container: { flexWrap: "wrap", columnGap: 12, rowGap: 12 },
        item: { flexBasis: "44%", flexGrow: 1, flexShrink: 1, minWidth: 0 },
      });
    },
  );
});

describe("A26-033 follow failure announcement ownership", () => {
  it("announces a repeated iOS follow error only once through the shared adapter", () => {
    const announceForAccessibilityWithOptions = vi.fn();
    const announcer = createStatusAnnouncementDedupe();
    const input = {
      platform: "ios",
      message: "Couldn’t follow Pat. Check your connection and try again.",
      tone: "error" as const,
      announcer: { announceForAccessibilityWithOptions },
    };

    expect(announcer.announce(input)).toBe(true);
    expect(announcer.announce(input)).toBe(false);
    expect(announceForAccessibilityWithOptions).toHaveBeenCalledTimes(1);
    expect(announceForAccessibilityWithOptions).toHaveBeenCalledWith(
      input.message,
      { priority: "high" },
    );
  });

  it("keeps web and Android on their platform live-region path rather than sending a native iOS announcement", () => {
    const announceForAccessibility = vi.fn();
    const announcer = createStatusAnnouncementDedupe();

    expect(
      announcer.announce({
        platform: "android",
        message: "Couldn’t unfollow Pat. Check your connection and try again.",
        tone: "error",
        announcer: { announceForAccessibility },
      }),
    ).toBe(false);
    expect(announceForAccessibility).not.toHaveBeenCalled();
    expect(profileScreenSource).toContain(
      "<StatusMessage\n          message={visibleFollowError}",
    );
    expect(profileScreenSource).not.toContain(
      'accessibilityLiveRegion="polite"\n          style={{ color: C.secondary, fontSize: 12, lineHeight: 18 }}',
    );
  });
});
