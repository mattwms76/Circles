import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canPrefillIntroduction } from "../lib/onboarding-introduction";

const valid = {
  requested: true,
  accountId: 1,
  target: { userId: 1, circleId: 7, eligible: true },
  circleId: 7,
  confirmed: true,
};
describe("verified editable onboarding introduction", () => {
  it("requires fresh matching server completed/public/approved proof", () => {
    expect(canPrefillIntroduction(valid)).toBe(true);
    for (const change of [
      { requested: false },
      { confirmed: false },
      { accountId: null },
      { accountId: 9 },
      { target: null },
      { target: { ...valid.target, eligible: false } },
      { target: { ...valid.target, circleId: 9 } },
      { circleId: 9 },
    ])
      expect(canPrefillIntroduction({ ...valid, ...change })).toBe(false);
  });
  it("persists forward/back progress and refreshes interest-scoped recommendations", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../app/onboarding.tsx"),
      "utf8",
    );
    expect(source).toContain('step: "first-post"');
    expect(source).toContain("backToSuggestions");
    expect(source).toContain(
      "utils.onboarding.recommendations.reset({ limit: 6 })",
    );
    expect(source).toContain(
      "recommendations.data.interests.length === selected.length",
    );
    expect(source).toContain("operationLock.current");
    expect(source).toContain("utils.social.circle.fetch({ id: circleId })");
  });
  it("keeps URL-prefill proof read-only and actor/target bound on the server", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../server/onboarding-service.ts"),
      "utf8",
    );
    const body = source.slice(
      source.indexOf("export async function getIntroductionTarget"),
    );
    expect(body).toContain("eq(memberships.userId, userId)");
    expect(body).toContain('eq(profiles.onboardingStep, "complete")');
    expect(body).toContain('eq(circles.privacy, "public")');
    expect(body).toContain("inArray(memberships.role, APPROVED_MEMBER_ROLES)");
    expect(body).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
  });
});
