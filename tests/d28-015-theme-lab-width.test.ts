import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const themeLab = readFileSync("app/dev/theme-lab.tsx", "utf8");
const scrollContentStyle = themeLab.match(
  /scrollContent:\s*\{([\s\S]*?)\n  \},\n  header:/,
)?.[1];

describe("D28-015 Theme Lab readable content measure", () => {
  it("centers a full-width content well capped at a readable desktop measure while preserving compact gutters", () => {
    expect(scrollContentStyle).toBeDefined();
    expect(scrollContentStyle).toContain('alignSelf: "center"');
    expect(scrollContentStyle).toContain("gap: 16");
    expect(scrollContentStyle).toContain("maxWidth: 960");
    expect(scrollContentStyle).toContain("padding: 20");
    expect(scrollContentStyle).toContain("paddingBottom: 32");
    expect(scrollContentStyle).toContain('width: "100%"');
  });
});
