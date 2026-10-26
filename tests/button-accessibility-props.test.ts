import { describe, expect, it, vi } from "vitest";
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Pressable: "Pressable",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: {
    create: <T>(value: T) => value,
    flatten: (value: unknown) => value,
  },
}));
vi.mock("@/components/media-image", () => ({ Image: "Image" }));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
vi.mock("react-native-svg", () => ({ default: "Svg", Circle: "SvgCircle" }));
vi.mock("@/components/live-avatar-ring", () => ({
  LiveAvatarRing: "LiveAvatarRing",
}));
vi.mock(
  "@/lib/ui-accessibility",
  async () => import("../lib/ui-accessibility"),
);
const { Button } = await import("../components/circles-ui");
describe("actual Button accessibility element props (mock native primitives, not device rendering)", () => {
  it("retains its explicit action name while visible copy changes and blocks a busy handler", () => {
    const onPress = vi.fn();
    const resting = Button({
      title: "Remove moment",
      accessibilityLabel: "Remove moment",
      onPress,
    });
    const busy = Button({
      title: "Removing…",
      accessibilityLabel: "Remove moment",
      loading: true,
      onPress,
    });
    expect(resting.props.accessibilityLabel).toBe("Remove moment");
    expect(busy.props.accessibilityLabel).toBe(
      resting.props.accessibilityLabel,
    );
    expect(busy.props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
    expect(busy.props.disabled).toBe(true);
    busy.props.onPress();
    expect(onPress).not.toHaveBeenCalled();
    resting.props.onPress();
    expect(onPress).toHaveBeenCalledTimes(1);
  });
  it("defaults to its title and blocks an explicitly disabled non-busy handler", () => {
    const onPress = vi.fn();
    const button = Button({ title: "Keep moment", disabled: true, onPress });
    expect(button.props.accessibilityLabel).toBe("Keep moment");
    expect(button.props.accessibilityState).toEqual({
      disabled: true,
      busy: false,
    });
    button.props.onPress();
    expect(onPress).not.toHaveBeenCalled();
  });
});
