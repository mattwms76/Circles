import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { d28005PeopleRowActionLayout } from "../lib/d28-005-people-row";

const source = readFileSync(
  new URL("../app/(tabs)/discover.tsx", import.meta.url),
  "utf8",
);

describe("D28-005 compact enlarged-text People rows", () => {
  it("moves the action below identity at the measured compact card threshold", () => {
    expect(d28005PeopleRowActionLayout(272)).toBe("full-width");
    expect(d28005PeopleRowActionLayout(320)).toBe("full-width");
  });

  it("retains the inline layout outside the measured compact-card condition", () => {
    expect(d28005PeopleRowActionLayout(321)).toBe("inline");
    expect(d28005PeopleRowActionLayout(null)).toBe("inline");
    expect(d28005PeopleRowActionLayout(Number.NaN)).toBe("inline");
  });

  it("uses the actual People-card layout width to give the existing action its own full-width line", () => {
    expect(source).toContain("onLayout={(event) => {");
    expect(source).toContain("setPeopleRowWidth((current) =>");
    expect(source).toContain("d28005PeopleRowActionLayout(peopleRowWidth)");
    expect(source).toMatch(
      /flexDirection:\s*peopleActionLayout === "full-width" \? "column" : "row"/,
    );
    expect(source).toMatch(
      /width:\s*peopleActionLayout === "full-width"\s*\? "100%"\s*:\s*undefined/,
    );
    expect(source).toMatch(
      /alignSelf:\s*peopleActionLayout === "full-width"\s*\? "stretch"\s*:\s*undefined/,
    );
  });

  it("retains the existing profile target, complete action labels, and follow operation", () => {
    expect(source).toContain(
      "accessibilityLabel={`View ${person.name}'s profile`}",
    );
    expect(source).toContain("minHeight: 48");
    expect(source).toContain('title="Your profile"');
    expect(source).toContain('accessibilityLabel="Open your profile"');
    expect(source).toContain("title={followTitle}");
    expect(source).toContain("accessibilityLabel={followAccessibilityLabel}");
    expect(source).toContain(
      "onPress={() => requestFollow(person.id, !!isFollowing)}",
    );
    expect(source).not.toContain("allowFontScaling={false}");
    expect(source).not.toContain("maxFontSizeMultiplier");
  });
});
