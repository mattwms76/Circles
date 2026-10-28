import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const circlesScreenSource = readFileSync(
  resolve(process.cwd(), "app/(tabs)/circles.tsx"),
  "utf8",
);

function contrastRatio(foreground: string, background: string) {
  const relativeLuminance = (hex: string) => {
    const channels = hex
      .replace("#", "")
      .match(/.{2}/g)
      ?.map((channel) => Number.parseInt(channel, 16) / 255);
    if (!channels || channels.length !== 3) {
      throw new Error(
        `Expected an opaque six-digit hex color, received ${hex}`,
      );
    }

    const linear = channels.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };

  const [lighter, darker] = [
    relativeLuminance(foreground),
    relativeLuminance(background),
  ].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("D28-001 Create circle glyph contrast", () => {
  it("uses the approved action token for the functional header create glyph while retaining the soft decorative surface", () => {
    const createIconButton = circlesScreenSource.match(
      /<IconButton\s+icon="add"[\s\S]*?label="Create a circle"[\s\S]*?\/>/,
    )?.[0];

    expect(createIconButton).toContain("color={C.action}");
    expect(createIconButton).toContain("backgroundColor: C.soft");
  });

  it("keeps the approved opaque action-on-soft token pair above the icon contrast threshold", () => {
    expect(contrastRatio("#A53728", "#FFF0EB")).toBeGreaterThanOrEqual(3);
  });
});
