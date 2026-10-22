import { readFileSync } from "node:fs";
import { resolveFnd001QueryDisplayState } from "../lib/fnd001-query-display-state";
import { describe, expect, it } from "vitest";

const profileRoute = readFileSync(
  new URL("../components/profile-screen.tsx", import.meta.url),
  "utf8",
);
const liveRoute = readFileSync(
  new URL("../app/live/[id].tsx", import.meta.url),
  "utf8",
);

describe("FND-001 rejected route queries", () => {
  it("renders the profile retry branch before successful not-found handling", () => {
    const loadingIndex = profileRoute.indexOf("profile.isLoading");
    const errorIndex = profileRoute.indexOf("profile.isError");
    const notFoundIndex = profileRoute.indexOf(") : !p ?");

    expect(loadingIndex).toBeGreaterThan(-1);
    expect(errorIndex).toBeGreaterThan(loadingIndex);
    expect(notFoundIndex).toBeGreaterThan(errorIndex);
    expect(profileRoute).toContain("We couldn’t load this profile.");
    expect(profileRoute).toContain("onAction={() => void profile.refetch()}");
  });

  it("renders a rejected loaded live-chat query as retryable, not successful empty", () => {
    const rejectedChat = resolveFnd001QueryDisplayState({
      isLoading: false,
      isError: true,
      hasContent: false,
    });
    const errorIndex = liveRoute.indexOf('chatDisplayState === "error"');
    const emptyCopyIndex = liveRoute.indexOf(
      "Say hello. You’re part of this moment.",
    );

    expect(rejectedChat).toBe("error");
    expect(errorIndex).toBeGreaterThan(-1);
    expect(emptyCopyIndex).toBeGreaterThan(errorIndex);
    expect(liveRoute).toContain("We couldn’t load the conversation.");
    expect(liveRoute).toContain("onAction={() => void chat.refetch()}");
  });
});
