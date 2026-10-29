import { describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  dimensions: { width: 390, fontScale: 1 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}));

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  View: "View",
  useWindowDimensions: () => runtime.dimensions,
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => runtime.insets,
}));
vi.mock("expo-router", () => ({
  Tabs: Object.assign("Tabs", { Screen: "Tabs.Screen" }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/circles-ui", () => ({
  C: {
    action: "#A53728",
    bg: "#F9F8F5",
    border: "#E8E9E2",
    secondary: "#4D5948",
  },
  Icon: "Icon",
  T: "T",
}));
vi.mock("@/hooks/circles-context", () => ({
  useCircles: () => ({ requireAuth: vi.fn() }),
}));
vi.mock(
  "@/lib/app-shell-layout",
  async () => import("../lib/app-shell-layout"),
);
vi.mock(
  "@/lib/d28-024-tab-presentation",
  async () => import("../lib/d28-024-tab-presentation"),
);

const { TabBar } = await import("../app/(tabs)/_layout");

const routes = ["index", "discover", "circles", "messages", "profile"].map(
  (name) => ({ key: `${name}-route`, name }),
);

describe("CBA-13 hidden Messages bottom-tab policy", () => {
  it("hides the narrow custom bar for active Messages in the actual five-route state", () => {
    const bar = TabBar({
      state: { index: 3, routes },
      navigation: { navigate: vi.fn() },
    });

    expect(routes).toHaveLength(5);
    expect(routes[3]).toMatchObject({ name: "messages" });
    expect(bar).toBeNull();
  });
});
