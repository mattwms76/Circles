import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { contrastRatio } from "../lib/ui-accessibility";

const route = vi.hoisted(() => ({
  id: "12",
  canGoBack: true,
  back: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: route.id }),
  useRouter: () => ({
    canGoBack: () => route.canGoBack,
    back: route.back,
    replace: route.replace,
  }),
}));
vi.mock("@/components/profile-screen", () => ({ default: "ProfileScreen" }));
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
const { default: PersonScreen } = await import("../app/person/[id]");
const { C, Empty, Loading, Pill } = await import("../components/circles-ui");

describe("five-batch cross-route integration (mocked native primitives, not device rendering)", () => {
  it("returns a person route to its actual previous screen", () => {
    route.id = "12";
    route.canGoBack = true;
    route.back.mockClear();
    route.replace.mockClear();
    const screen = PersonScreen();
    expect(screen.props.personId).toBe(12);
    screen.props.onBack();
    expect(route.back).toHaveBeenCalledOnce();
    expect(route.replace).not.toHaveBeenCalled();
  });
  it("uses Discover as a no-history fallback and preserves malformed-person denial", () => {
    route.id = "-1";
    route.canGoBack = false;
    route.replace.mockClear();
    const screen = PersonScreen();
    expect(screen.props.invalidPersonRoute).toBe(true);
    expect(screen.props.personId).toBeUndefined();
    screen.props.onBack();
    expect(route.replace).toHaveBeenCalledWith("/discover");
  });
  it("uses measured readable colors in actual Empty and Loading elements", () => {
    const empty = Empty({ title: "Unavailable", text: "Try again." });
    const loading = Loading();
    expect(empty.props.children[2].props.style.color).toBe(C.secondary);
    expect(loading.props.children[1].props.style.color).toBe(C.secondary);
    for (const background of [C.bg, C.paper, C.sage]) {
      expect(contrastRatio(C.secondary, background)).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });
  it("announces filter selection while retaining readable unselected text and full touch height", () => {
    const pill = Pill({ title: "Joined", selected: false, onPress: vi.fn() });
    expect(pill.props.accessibilityRole).toBe("button");
    expect(pill.props.accessibilityState.selected).toBe(false);
    expect(pill.props.children[1].props.style.color).toBe(C.secondary);
    expect(
      pill.props.style({ pressed: false })[0].minHeight,
    ).toBeGreaterThanOrEqual(44);
    expect(contrastRatio(C.secondary, C.paper)).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps full circle names accessible while bounding their visual badge and wires the profile back slot", () => {
    const post = readFileSync("components/post-card.tsx", "utf8");
    expect(post).toContain(
      "accessibilityLabel={`Open ${post.circleName} circle`}",
    );
    expect(post).toContain('maxWidth: "90%"');
    expect(post).toContain('ellipsizeMode="tail"');
    const profile = readFileSync("components/profile-screen.tsx", "utf8");
    expect(profile).toContain('accessibilityLabel="Go back from this profile"');
    expect(profile).toContain("onPress={onBack}");
    expect(profile).toContain("mountedRef.current = true;");
  });
});
