import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  themeLabPreviewActions,
  themeLabPreviewPalettes,
  themeLabPreviewSchemes,
} from "../lib/batch5-theme-lab";
import { contrastRatio } from "../lib/ui-accessibility";

const themeLab = readFileSync("app/dev/theme-lab.tsx", "utf8");

describe("Batch 5 Theme Lab scoped preview", () => {
  it("offers distinct, local light and dark preview token sets", () => {
    expect(themeLabPreviewSchemes).toEqual(["light", "dark"]);
    expect(themeLabPreviewPalettes.dark).not.toEqual(
      themeLabPreviewPalettes.light,
    );
    expect(themeLabPreviewPalettes.dark.background).not.toBe(
      themeLabPreviewPalettes.light.background,
    );
    expect(themeLab).toContain(
      'const [previewScheme, setPreviewScheme] =\n    useState<ThemeLabPreviewScheme>("light");',
    );
    expect(themeLab).toContain(
      "Preview palettes only within Theme Lab. Choosing a palette does",
    );
    expect(themeLab).not.toContain("useThemeContext");
    expect(themeLab).not.toContain("setColorScheme");
    expect(themeLab).not.toContain("SchemeColors");
  });

  it("keeps every actual scoped normal-text and action-label token pair at or above 4.5:1", () => {
    for (const scheme of themeLabPreviewSchemes) {
      const palette = themeLabPreviewPalettes[scheme];

      for (const foreground of [palette.foreground, palette.muted]) {
        for (const surface of [palette.background, palette.surface]) {
          expect(contrastRatio(foreground, surface)).toBeGreaterThanOrEqual(
            4.5,
          );
        }
      }

      for (const action of themeLabPreviewActions) {
        expect(
          contrastRatio(palette[action.foreground], palette[action.background]),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("names and announces the locally selected preview choices and token controls", () => {
    expect(themeLab).toContain('accessibilityRole="radiogroup"');
    expect(themeLab).toContain(
      'accessibilityLabel="Theme Lab preview palette"',
    );
    expect(themeLab).toContain('accessibilityRole="radio"');
    expect(themeLab).toContain(
      "accessibilityLabel={`${displayName} preview palette`}",
    );
    expect(themeLab).toContain("checked: toggleColors.isSelected");
    expect(themeLab).toContain("selected: toggleColors.isSelected");
    expect(themeLab).toContain('accessibilityRole="button"');
    expect(themeLab).toContain(
      "accessibilityLabel={`Preview ${action.label} token`}",
    );
  });

  it("provides 48-point controls and a safe-area, keyboard-aware, wrapping layout", () => {
    expect(themeLab).toContain('edges={["top", "bottom", "left", "right"]}');
    expect(themeLab).toContain("<KeyboardAvoidingView");
    expect(themeLab).toContain(
      'behavior={Platform.OS === "ios" ? "padding" : undefined}',
    );
    expect(themeLab).toContain('keyboardShouldPersistTaps="handled"');
    expect(themeLab).toContain('keyboardDismissMode="on-drag"');
    expect(themeLab).toContain("minHeight: 48");
    expect(themeLab).toContain('flexWrap: "wrap"');
    expect(themeLab).toContain("flexShrink: 1");
  });
});
