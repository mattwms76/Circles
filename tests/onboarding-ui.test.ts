import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_INTERESTS, type OnboardingStatus } from "../shared/onboarding";
import {
  hydrateOnboardingForAccount,
  isCurrentOnboardingAccount,
  isIntroductionEligible,
  normalizeInterestSelection,
  toggleInterestSelection,
} from "../lib/onboarding-ui";

const onboardingRoute = readFileSync(
  new URL("../app/onboarding.tsx", import.meta.url),
  "utf8",
);

describe("onboarding UI helpers", () => {
  it("keeps selections explicit, allowlisted, unique, and bounded to six", () => {
    expect(
      normalizeInterestSelection([
        "music",
        "not-allowlisted",
        "music",
        "food",
        "travel",
        "books",
        "gaming",
        "technology",
        "art",
      ]),
    ).toEqual(["music", "food", "travel", "books", "gaming", "technology"]);

    const firstSix = [
      "lifestyle",
      "outdoors",
      "design",
      "photography",
      "fitness",
      "music",
    ] as const;
    expect(toggleInterestSelection(firstSix, "food")).toEqual(firstSix);
    expect(toggleInterestSelection(firstSix, "music")).toEqual([
      "lifestyle",
      "outdoors",
      "design",
      "photography",
      "fitness",
    ]);
    expect(MAX_INTERESTS).toBe(6);
  });

  it("hydrates only the matching account and re-normalizes server values", () => {
    const status: OnboardingStatus = {
      userId: 41,
      interests: ["music", "music", "not-allowlisted" as never],
      step: "circles",
      completedAt: null,
    };
    expect(hydrateOnboardingForAccount(status, 40)).toBeNull();
    expect(hydrateOnboardingForAccount(status, 41)).toEqual({
      ...status,
      interests: ["music"],
    });
  });

  it("keeps callback effects inside their captured account boundary", () => {
    expect(isCurrentOnboardingAccount(41, 41)).toBe(true);
    expect(isCurrentOnboardingAccount(41, 42)).toBe(false);
    expect(isCurrentOnboardingAccount(41, null)).toBe(false);
  });

  it("permits introductions only for approved public memberships", () => {
    expect(
      isIntroductionEligible({
        privacy: "public",
        joined: true,
        role: "member",
      }),
    ).toBe(true);
    expect(
      isIntroductionEligible(
        { privacy: "public", joined: false, role: "pending" },
        true,
      ),
    ).toBe(false);
    expect(
      isIntroductionEligible({
        privacy: "private",
        joined: true,
        role: "member",
      }),
    ).toBe(false);
  });
});

describe("onboarding source contract", () => {
  it("uses explicit membership, finishes before navigation, and never auto-joins", () => {
    expect(onboardingRoute).toContain("trpc.social.setMembership.useMutation");
    expect(onboardingRoute).toContain("await finish.mutateAsync()");
    expect(onboardingRoute).toContain(
      "router.replace(`/create?mode=post&circleId=${circleId}&intro=1`)",
    );
    expect(onboardingRoute).toContain("utils.social.circlesPage.invalidate()");
    expect(onboardingRoute).not.toContain("joinCircle.useMutation");
  });
});
