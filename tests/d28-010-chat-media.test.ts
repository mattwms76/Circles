import { describe, expect, it } from "vitest";
import { d28_010ChatAttachmentWidth } from "../lib/d28-010-chat-media";

const attachmentKinds = ["photo", "video"] as const;

describe("D28-010 chat attachment sizing", () => {
  const cases = [
    {
      name: "a 320-point conversation with two points of lateral safe area",
      input: { windowWidth: 320, leftInset: 1, rightInset: 1 },
      expected: 191,
    },
    {
      name: "a 390-point phone conversation",
      input: { windowWidth: 390, leftInset: 0, rightInset: 0 },
      expected: 220,
    },
    {
      name: "a tablet conversation after lateral safe-area reduction",
      input: { windowWidth: 768, leftInset: 24, rightInset: 24 },
      expected: 220,
    },
    {
      name: "a wide conversation capped to the AppShell transcript",
      input: { windowWidth: 1440, leftInset: 0, rightInset: 0 },
      expected: 220,
    },
    {
      name: "an extremely constrained conversation without forcing the preferred minimum",
      input: { windowWidth: 180, leftInset: 20, rightInset: 20 },
      expected: 48,
    },
  ] as const;

  it("budgets the compact photo bubble's padding and both borders within its 80% wrapper", () => {
    const input = { windowWidth: 320, leftInset: 44, rightInset: 0 };
    const wrapperWidth = (320 - 44 - 22 * 2) * 0.8;
    const mediaWidth = d28_010ChatAttachmentWidth(input);
    expect(mediaWidth).toBe(157);
    expect(mediaWidth + 13 * 2 + 1 * 2).toBeLessThanOrEqual(wrapperWidth);
  });

  for (const attachment of attachmentKinds) {
    for (const testCase of cases) {
      it(`keeps a ${attachment} inside the bubble for ${testCase.name}`, () => {
        expect(d28_010ChatAttachmentWidth(testCase.input)).toBe(
          testCase.expected,
        );
      });
    }
  }
});
