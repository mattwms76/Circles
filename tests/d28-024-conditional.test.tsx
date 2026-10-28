import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vitest";
import { d28024TabCaptionMode } from "../lib/d28-024-tab-presentation";

const runtime = vi.hoisted(() => ({
  dimensions: { width: 320, fontScale: 2 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  push: vi.fn(),
  requireAuth: vi.fn((action: () => void) => action()),
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
  useRouter: () => ({ push: runtime.push }),
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
  useCircles: () => ({ requireAuth: runtime.requireAuth }),
}));
vi.mock(
  "@/lib/app-shell-layout",
  async () => import("../lib/app-shell-layout"),
);
vi.mock(
  "@/lib/d28-024-tab-presentation",
  async () => import("../lib/d28-024-tab-presentation"),
);

const { TabBar, default: TabLayout } = await import("../app/(tabs)/_layout");

type ElementProps = Record<string, unknown>;
type Element = ReactElement<ElementProps>;

function matchingElements(
  node: ReactNode,
  predicate: (element: Element) => boolean,
): Element[] {
  const matches: Element[] = [];

  function visit(value: ReactNode): void {
    for (const child of Children.toArray(value)) {
      if (!isValidElement<ElementProps>(child)) continue;
      if (predicate(child)) matches.push(child);
      visit(child.props.children as ReactNode);
    }
  }

  visit(node);
  return matches;
}

function readableStyle(style: unknown): ElementProps {
  return Array.isArray(style)
    ? Object.assign({}, ...style.filter(Boolean))
    : ((style as ElementProps | undefined) ?? {});
}

function compactTabBar(selectedIndex = 1): Element {
  return TabBar({
    state: {
      index: selectedIndex,
      routes: [
        { key: "index-1", name: "index" },
        { key: "discover-1", name: "discover" },
        { key: "circles-1", name: "circles" },
        { key: "profile-1", name: "profile" },
      ],
    },
    navigation: { navigate: vi.fn() },
  }) as Element;
}

describe("D28-024 compact enlarged-text tab presentation", () => {
  it("switches to the selected-label treatment only under compact enlarged-text pressure", () => {
    expect(d28024TabCaptionMode(320, 2)).toBe("selected");
    expect(d28024TabCaptionMode(360, 1.5)).toBe("selected");
    expect(d28024TabCaptionMode(361, 2)).toBe("all");
    expect(d28024TabCaptionMode(320, 1.49)).toBe("all");
    expect(d28024TabCaptionMode(Number.NaN, 2)).toBe("all");
  });

  it("keeps all four named, selected tabs and the central Create target while showing one bounded caption", () => {
    runtime.dimensions = { width: 320, fontScale: 2 };
    runtime.insets = { top: 0, left: 0, right: 0, bottom: 0 };
    const bar = compactTabBar();
    const tabs = matchingElements(
      bar,
      (element) =>
        element.type === "Pressable" &&
        element.props.accessibilityRole === "tab",
    );
    const captions = matchingElements(bar, (element) => element.type === "T");
    const create = matchingElements(
      bar,
      (element) =>
        element.type === "Pressable" &&
        element.props.accessibilityLabel ===
          "Share a moment or create a circle",
    )[0];

    expect(tabs).toHaveLength(4);
    expect(tabs.map((tab) => tab.props.accessibilityLabel)).toEqual([
      "Home",
      "Discover",
      "Circles",
      "Profile",
    ]);
    expect(tabs.map((tab) => tab.props.accessibilityState)).toEqual([
      { selected: false },
      { selected: true },
      { selected: false },
      { selected: false },
    ]);
    expect(captions.map((caption) => caption.props.children)).toEqual([
      "Discover",
    ]);
    expect(captions[0]?.props.numberOfLines).toBe(2);
    for (const tab of tabs) {
      expect(readableStyle(tab.props.style)).toMatchObject({
        minWidth: 44,
        minHeight: 44,
      });
    }
    expect(readableStyle(create?.props.style)).toMatchObject({
      width: 44,
      height: 44,
    });
  });

  it("retains all standard captions away from the compact enlarged-text condition and keeps Chats hidden", () => {
    runtime.dimensions = { width: 390, fontScale: 2 };
    runtime.insets = { top: 0, left: 0, right: 0, bottom: 0 };
    const bar = compactTabBar(3);
    const captions = matchingElements(bar, (element) => element.type === "T");
    const layout = TabLayout() as Element;
    const screens = matchingElements(
      layout,
      (element) => element.type === "Tabs.Screen",
    );

    expect(captions.map((caption) => caption.props.children)).toEqual([
      "Home",
      "Discover",
      "Circles",
      "You",
    ]);
    expect(screens.map((screen) => screen.props.name)).toEqual([
      "index",
      "discover",
      "circles",
      "messages",
      "profile",
    ]);
    expect(
      screens.find((screen) => screen.props.name === "messages")?.props.options,
    ).toMatchObject({ href: null });
    expect(screens.some((screen) => screen.props.name === "chats")).toBe(false);
  });
});
