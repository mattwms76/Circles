import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countLabel } from "../lib/count-copy";

const circlesScreen = readFileSync("app/(tabs)/circles.tsx", "utf8");

describe("D28-003 Circles result summary", () => {
  it("inflects the existing loaded circle count for zero, one, and multiple results", () => {
    expect([0, 1, 2].map((count) => countLabel(count, "circle"))).toEqual([
      "0 circles",
      "1 circle",
      "2 circles",
    ]);
  });

  it("binds the visible summary to the existing loaded items count", () => {
    expect(circlesScreen).toContain(
      'import { countLabel } from "../../lib/count-copy";',
    );
    expect(circlesScreen).toContain('{countLabel(items.length, "circle")}');
  });
});
