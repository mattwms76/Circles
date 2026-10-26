import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  width: 390,
  fontScale: 1,
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  user: null as { id: number; name: string } | null,
  push: vi.fn(),
  requireAuth: vi.fn(),
  showLogin: vi.fn(),
  profile: vi.fn(() => ({ data: null })),
}));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  View: "View",
  useWindowDimensions: () => ({
    width: runtime.width,
    height: 844,
    scale: 1,
    fontScale: runtime.fontScale,
  }),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => runtime.insets,
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: runtime.push }),
  usePathname: () => "/",
  Tabs: Object.assign(() => null, { Screen: "TabScreen" }),
}));
vi.mock("@/hooks/circles-context", () => ({
  useCircles: () => ({
    user: runtime.user,
    requireAuth: runtime.requireAuth,
    showLogin: runtime.showLogin,
  }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: { social: { profile: { useQuery: runtime.profile } } },
}));
vi.mock(
  "@/lib/app-shell-layout",
  async () => import("../lib/app-shell-layout"),
);
vi.mock(
  "@/lib/app-navigation-state",
  async () => import("../lib/app-navigation-state"),
);
vi.mock("@/components/media-image", () => ({ Image: "Image" }));
vi.mock("../components/activity-badge", () => ({
  ActivityBadge: "ActivityBadge",
}));
vi.mock("../components/user-avatar", () => ({ UserAvatar: "Avatar" }));
vi.mock("../components/circles-ui", () => ({
  Avatar: "Avatar",
  Button: "Button",
  Icon: "Icon",
  IconButton: "IconButton",
  Logo: "Logo",
  T: "T",
  Wordmark: "Wordmark",
  C: {
    bg: "#F9F8F5",
    border: "#E8E9E2",
    muted: "#888B84",
    ink: "#242825",
    coral: "#ED604A",
    secondary: "#686C64",
  },
  photo: {},
  s: { row: { flexDirection: "row", alignItems: "center" } },
}));
vi.mock(
  "@/components/circles-ui",
  async () => import("../components/circles-ui"),
);
const { AppShell } = await import("../components/app-shell");
const { default: TabLayout } = await import("../app/(tabs)/_layout");

type Element = ReactElement<{
  children?: ReactNode;
  style?: unknown;
  testID?: string;
  label?: string;
  accessibilityLabel?: string;
  onPress?: () => void;
  viewerId?: number;
}>;
function elements(node: ReactNode): Element[] {
  const result: Element[] = [];
  Children.forEach(node, (child) => {
    if (isValidElement<Element["props"]>(child)) {
      result.push(child);
      result.push(...elements(child.props.children));
    }
  });
  return result;
}
function byId(node: ReactNode, id: string): Element {
  const found = elements(node).find((element) => element.props.testID === id);
  if (!found) throw new Error(`Missing element: ${id}`);
  return found;
}
function style(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return Object.assign({}, ...value.map(style));
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
function tabBar() {
  const layout = TabLayout();
  const element = layout.props.tabBar({
    state: {
      index: 0,
      routes: ["index", "discover", "circles", "messages", "profile"].map(
        (name) => ({ name, key: name }),
      ),
    },
    navigation: { navigate: vi.fn() },
  }) as ReactNode;
  if (!isValidElement(element) || typeof element.type !== "function")
    throw new Error("Expected the actual TabBar component.");
  // All hooks here are mocked; this evaluates props, not a native layout engine.
  return (element.type as (props: unknown) => ReactNode)(element.props);
}
beforeEach(() => {
  runtime.width = 390;
  runtime.fontScale = 1;
  runtime.insets = { top: 0, left: 0, right: 0, bottom: 0 };
  runtime.user = null;
  vi.clearAllMocks();
});

describe("actual shell elements with mock native primitives, not device/layout rendering", () => {
  it.each([320, 360, 390, 768])(
    "keeps %i-point headers growable and action groups atomic",
    (width) => {
      runtime.width = width;
      const shell = AppShell({ children: "content" });
      const header = style(byId(shell, "app-shell-header").props.style);
      const actions = style(
        byId(shell, "app-shell-header-actions").props.style,
      );
      expect(header.minHeight).toBe(70);
      expect(header.height).toBeUndefined();
      expect(header.maxHeight).toBeUndefined();
      expect(header.flexWrap).toBe("wrap");
      expect(actions.flexWrap).toBe("nowrap");
      expect(actions.flexShrink).toBe(0);
      expect(actions.marginLeft).toBe("auto");
    },
  );
  it.each([1, 1.5, 2, 3])(
    "does not cap text scaling or impose a fixed header at font scale %s",
    (fontScale) => {
      runtime.width = 320;
      runtime.fontScale = fontScale;
      const header = style(
        byId(AppShell({ children: "content" }), "app-shell-header").props.style,
      );
      expect(header.flexWrap).toBe("wrap");
      expect(header.height).toBeUndefined();
      expect(readFileSync("components/app-shell.tsx", "utf8")).not.toContain(
        "allowFontScaling={false}",
      );
      expect(readFileSync("components/circles-ui.tsx", "utf8")).not.toContain(
        "maxFontSizeMultiplier",
      );
    },
  );
  it.each([false, true])(
    "preserves complete narrow actions and account-gated Updates (signed in: %s)",
    (signedIn) => {
      runtime.user = signedIn ? { id: 42, name: "Synthetic viewer" } : null;
      const shell = AppShell({ children: "content" });
      const cluster = byId(shell, "app-shell-header-actions");
      const controls = elements(cluster.props.children);
      const search = controls.find(
        (node) => node.props.label === "Search Circles",
      );
      const messages = controls.find(
        (node) => node.props.label === "Open messages",
      );
      expect(search).toBeDefined();
      expect(messages).toBeDefined();
      search?.props.onPress?.();
      messages?.props.onPress?.();
      expect(runtime.push.mock.calls).toEqual([["/discover"], ["/messages"]]);
      const activity = controls.find((node) => node.type === "ActivityBadge");
      expect(Boolean(activity)).toBe(signedIn);
      if (activity) {
        expect(activity.props.viewerId).toBe(42);
        activity.props.onPress?.();
        expect(runtime.push).toHaveBeenLastCalledWith("/updates");
      }
      expect(runtime.profile).toHaveBeenCalledWith(
        signedIn ? { id: 42 } : undefined,
        { enabled: signedIn },
      );
    },
  );
  it("protects wide top and asymmetric horizontal edges once without changing bottom ownership", () => {
    runtime.width = 1280;
    runtime.insets = { top: 24, left: 47, right: 13, bottom: 34 };
    const shell = AppShell({ children: "content" });
    const frame = style(byId(shell, "app-shell-frame").props.style);
    expect(frame).toMatchObject({
      paddingTop: 24,
      paddingLeft: 47,
      paddingRight: 13,
    });
    expect(frame.paddingBottom).toBeUndefined();
    const header = style(byId(shell, "app-shell-header").props.style);
    expect(header.paddingHorizontal).toBe(32);
    expect(header.paddingLeft).toBeUndefined();
    expect(header.paddingRight).toBeUndefined();
    expect(header.minHeight).toBe(86);
    expect(tabBar()).toBeNull();
  });
  it("uses safe width for both shell mode and the separate tab bar", () => {
    runtime.width = 940;
    runtime.insets = { top: 0, left: 47, right: 13, bottom: 34 };
    const shell = AppShell({ children: "content" });
    const header = style(byId(shell, "app-shell-header").props.style);
    expect(header.minHeight).toBe(70);
    const bar = byId(tabBar(), "app-shell-tab-bar");
    expect(style(bar.props.style)).toMatchObject({
      paddingLeft: 57,
      paddingRight: 23,
      paddingBottom: 34,
    });
    const tabs = elements(bar).filter(
      (element) =>
        element.props.accessibilityLabel === "Create a post or circle",
    );
    expect(tabs).toHaveLength(1);
    expect(
      elements(bar).filter(
        (element) =>
          (element.props as Record<string, unknown>).accessibilityRole ===
          "tab",
      ),
    ).toHaveLength(4);
  });
  it("keeps wide home/search/profile destinations and search text flexible", () => {
    runtime.width = 900;
    const shell = AppShell({ children: "content" });
    const nodes = elements(byId(shell, "app-shell-header"));
    for (const [label, path] of [
      ["Circles home", "/"],
      ["Search Circles", "/discover"],
    ]) {
      const control = nodes.find(
        (node) => node.props.accessibilityLabel === label,
      );
      expect(control).toBeDefined();
      control?.props.onPress?.();
      expect(runtime.push).toHaveBeenLastCalledWith(path);
    }
    const profile = nodes.find(
      (node) => node.props.accessibilityLabel === "Open your profile",
    );
    profile?.props.onPress?.();
    expect(runtime.showLogin).toHaveBeenCalledOnce();
    expect(style(profile?.props.style)).toMatchObject({
      minWidth: 44,
      minHeight: 44,
    });
    const search = nodes.find(
      (node) => node.props.accessibilityLabel === "Search Circles",
    );
    expect(style(search?.props.style).maxWidth).toBe("100%");
    expect(
      elements(search?.props.children).some(
        (node) =>
          style(node.props.style).minWidth === 0 &&
          style(node.props.style).flex === 1,
      ),
    ).toBe(true);
  });
});
