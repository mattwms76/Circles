import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  INTERESTS,
  INTRODUCTION_DRAFT,
  interestMatches,
  recommendationReason,
} from "../shared/onboarding";

const root = path.resolve(import.meta.dirname, "..");
describe("circle-first onboarding integration contracts", () => {
  it("offers only settled authenticated home navigation and rejects stale account results", () => {
    const source = fs.readFileSync(
      path.join(root, "components/onboarding-navigation.tsx"),
      "utf8",
    );
    expect(source).toContain('pathname === "/"');
    expect(source).toContain('authState === "authenticated"');
    expect(source).toContain("status.data.userId !== user?.id");
    expect(source).toContain("status.isFetchedAfterMount");
    expect(source).toContain("status.isFetching");
    expect(source).toContain("status.isError");
    expect(source).toContain("status.data.completedAt !== null");
  });
  it("uses an explicit bounded constant editable introduction and no publishing side effect", () => {
    const source = fs.readFileSync(path.join(root, "app/create.tsx"), "utf8");
    expect(source).toContain('params.intro === "1"');
    expect(source).toContain("parsePositiveSafeId(params.circleId)");
    expect(source).toContain("INTRODUCTION_DRAFT");
    expect(INTRODUCTION_DRAFT.length).toBeLessThan(300);
    expect(INTRODUCTION_DRAFT).not.toMatch(/https?:|<script/i);
  });
  it("matches only explicit categories and makes fallback reasons truthful", () => {
    expect(new Set(INTERESTS.map((item) => item.id)).size).toBe(
      INTERESTS.length,
    );
    expect(interestMatches(" Photography ", ["music", "photography"])).toEqual([
      "photography",
    ]);
    expect(interestMatches("Secret travel messages", ["travel"])).toEqual([]);
    expect(recommendationReason(["photography"])).toBe(
      "Because you chose Photography.",
    );
    expect(recommendationReason([])).toContain("not an interest match");
  });
});
