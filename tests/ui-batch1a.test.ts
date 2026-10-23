import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buttonVisualTokens,
  contrastRatio,
  UI_ACCESSIBLE_COLORS,
} from "../lib/ui-accessibility";

const ui = readFileSync("components/circles-ui.tsx", "utf8");
const tabs = readFileSync("app/(tabs)/_layout.tsx", "utf8");

const normalTextSurfaces = ["#F9F8F5", "#FFFFFF", "#E9EEE5", "#FFF0EB"];

describe("Batch 1A shared UI accessibility seams", () => {
  it("keeps the secondary semantic foreground at or above normal-text contrast on every used surface", () => {
    for (const surface of normalTextSurfaces) {
      expect(
        contrastRatio(UI_ACCESSIBLE_COLORS.secondary, surface),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps primary-action text and loading spinner color contrast without opacity compositing", () => {
    for (const visual of [
      buttonVisualTokens({
        secondary: false,
        disabled: false,
        loading: false,
        pressed: false,
      }),
      buttonVisualTokens({
        secondary: false,
        disabled: false,
        loading: false,
        pressed: true,
      }),
      buttonVisualTokens({
        secondary: false,
        disabled: false,
        loading: true,
        pressed: false,
      }),
    ]) {
      expect(
        contrastRatio(visual.foregroundColor, visual.backgroundColor),
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(ui).not.toContain("opacity: disabled || loading ? 0.6");
    expect(ui).toContain('coral: "#ED604A"');
  });

  it("keeps Button names stable during loading and blocks loading presses in both semantics and handler", () => {
    expect(ui).toContain("accessibilityLabel={accessibilityLabel ?? title}");
    expect(ui).toContain(
      "accessibilityState={{ disabled: isDisabled, busy: loading }}",
    );
    expect(ui).toContain("disabled={isDisabled}");
    expect(ui).toContain("if (!isDisabled) onPress();");
    expect(ui).toContain("{ minHeight: 48 }");
    expect(ui).toContain(
      "<ActivityIndicator color={restingTokens.foregroundColor} />",
    );
  });

  it("gives Input an explicit programmatic name before a visible label or placeholder and forwards native props", () => {
    expect(ui).toContain("accessibilityLabel ?? label ?? placeholder");
    expect(ui).toContain("accessibilityLabel={resolvedAccessibilityLabel}");
    expect(ui).toContain("{...inputProps}");
    expect(ui).toContain(
      'placeholderTextColor={inputProps.placeholderTextColor ?? "#A0A299"}',
    );
  });

  it("uses the same compliant token for inactive tab labels and icons without restoring Chats", () => {
    expect(tabs).toContain("color={selected ? C.coral : C.secondary}");
    expect(tabs).toContain("color: selected ? C.coral : C.secondary");
    expect(tabs).toContain('name="messages"');
    expect(tabs).toContain("href: null");
  });
});
