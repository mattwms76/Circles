import { Children, isValidElement, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { contrastRatio, UI_ACCESSIBLE_COLORS } from "../lib/ui-accessibility";

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Pressable: "Pressable",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: {
    create: <T>(value: T) => value,
    flatten: (value: unknown) => value ?? {},
  },
}));
vi.mock("@/components/media-image", () => ({ Image: "Image" }));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
vi.mock("react-native-svg", () => ({
  default: "Svg",
  Circle: "SvgCircle",
}));
vi.mock("@/lib/ui-accessibility", () => ({
  UI_ACCESSIBLE_COLORS: {
    secondary: "#4D5948",
    action: "#A53728",
    actionPressed: "#7D2B21",
    actionDisabled: "#7D2B21",
    actionText: "#FFFFFF",
  },
  buttonVisualTokens: () => ({
    backgroundColor: "#A53728",
    foregroundColor: "#FFFFFF",
  }),
}));
vi.mock("@/components/live-avatar-ring", () => ({
  LiveAvatarRing: "LiveAvatarRing",
}));

const { Avatar } = await import("../components/circles-ui");

function childElements(node: ReactNode) {
  return Children.toArray(node).filter(isValidElement);
}

describe("live avatar visual contract", () => {
  it.each([
    { name: "Ari", size: 40, initial: "A" },
    { name: "", size: 28, initial: "C" },
    { name: "matt", size: 64, initial: "M" },
  ])(
    "uses identical missing-image and failed-image fallbacks for $name at $size pixels",
    ({ name, size, initial }) => {
      const withoutImage = Avatar({ name, size });
      const withImage = Avatar({
        name,
        size,
        uri: "https://example.invalid/avatar.jpg",
      });
      const missingFallback = childElements(withoutImage.props.children)[0];
      const image = childElements(withImage.props.children)[0];
      const imageProps = image.props as {
        fallback: ReactNode;
        source: { uri: string };
        contentFit: string;
        transition: number;
      };

      expect(image.type).toBe("Image");
      expect(imageProps).toMatchObject({
        source: { uri: "https://example.invalid/avatar.jpg" },
        contentFit: "cover",
        transition: 180,
      });
      expect(isValidElement(imageProps.fallback)).toBe(true);
      if (!isValidElement(imageProps.fallback)) {
        throw new Error("The failed-image fallback must remain an element");
      }
      // Children.toArray assigns a synthetic key; compare the rendered tree, not that key.
      expect(imageProps.fallback.type).toBe(missingFallback.type);
      expect(imageProps.fallback.props).toEqual(missingFallback.props);
      expect(missingFallback.type).toBe("View");
      expect(missingFallback.props).toMatchObject({
        style: {
          width: size,
          height: size,
          borderRadius: size,
          backgroundColor: "#E9EEE5",
          alignItems: "center",
          justifyContent: "center",
        },
      });
      const initials = childElements(
        (missingFallback.props as { children: ReactNode }).children,
      )[0];
      expect(initials.props).toMatchObject({
        children: initial,
        style: { fontSize: size * 0.34, fontWeight: "700" },
      });
    },
  );

  it("keeps the primitive avatar presentational while passing a noninteractive overlay its existing frame dimensions", () => {
    const node = Avatar({
      uri: null,
      name: "Ari",
      size: 50,
      ring: true,
      live: true,
      livePulse: true,
    });
    const props = node.props as {
      children?: ReactNode;
      style?: Record<string, unknown>;
    };
    expect(props.style).toMatchObject({
      width: 58,
      height: 58,
      borderWidth: 1.7,
      padding: 2.3,
    });
    const overlay = childElements(props.children).find(
      (child) => child.type === "LiveAvatarRing",
    );
    expect(overlay?.props).toMatchObject({
      size: 58,
      live: true,
      animate: true,
      inset: 4,
    });
  });

  it("keeps animation conservative for unknown reduced-motion state and cleans animation work without altering layout", () => {
    const source = readFileSync("components/live-avatar-ring.tsx", "utf8");
    expect(source).toContain("useState(true)");
    expect(source).toContain("AccessibilityInfo.isReduceMotionEnabled()");
    expect(source).toContain('"reduceMotionChanged"');
    expect(source).toContain("PULSE_CYCLE_MS = 1400");
    expect(source).toContain("useNativeDriver: true");
    expect(source).toContain("outputRange: [1, 1.04]");
    expect(source).toContain("animation.stop()");
    expect(source).toContain("pulse.stopAnimation()");
    expect(source).toContain('pointerEvents="none"');
    expect(source).toContain('position: "absolute"');
    expect(source).toContain(">LIVE<");
  });

  it("keeps the small LIVE label on an accessible semantic fill rather than decorative coral", () => {
    const source = readFileSync("components/live-avatar-ring.tsx", "utf8");
    expect(source).toContain("backgroundColor: UI_ACCESSIBLE_COLORS.action");
    expect(source).toContain("color: UI_ACCESSIBLE_COLORS.actionText");
    expect(
      contrastRatio(
        UI_ACCESSIBLE_COLORS.actionText,
        UI_ACCESSIBLE_COLORS.action,
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
