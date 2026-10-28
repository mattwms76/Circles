import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vitest";
import { resolveAppNavigationSection } from "../lib/app-navigation-state";
vi.mock("../components/screen-metadata", () => ({
  ScreenMetadata: "ScreenMetadata",
}));
vi.mock("@/components/screen-metadata", () => ({
  ScreenMetadata: "ScreenMetadata",
}));

type SidebarCircle = {
  id: number;
  name: string;
  image: string;
  memberCount: number;
  category: string;
  privacy: "public" | "private";
  joined?: boolean;
  role?: string | null;
};

type CircleQuery = {
  data: SidebarCircle[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

const runtime = vi.hoisted(() => ({
  pathname: "/",
  width: 1200,
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  push: vi.fn(),
  requireAuth: (action: () => void) => action(),
  notify: vi.fn(),
  circlesQuery: {
    data: [] as SidebarCircle[] | undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as CircleQuery,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const useEffect = (setup: () => void | (() => void)) => {
    void setup();
  };
  const useMemo = <T>(factory: () => T) => factory();
  const useRef = <T>(initialValue: T) => ({ current: initialValue });
  const useState = <T>(initialValue: T | (() => T)) => [
    typeof initialValue === "function"
      ? (initialValue as () => T)()
      : initialValue,
    vi.fn(),
  ];
  return {
    ...actual,
    default: { ...actual, useEffect, useMemo, useRef, useState },
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => string) =>
      getSnapshot(),
  };
});

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: <T>(value: T) => value },
  View: "View",
  useWindowDimensions: () => ({ width: runtime.width }),
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => runtime.insets,
}));

vi.mock(
  "@/lib/app-shell-layout",
  async () => import("../lib/app-shell-layout"),
);
vi.mock(
  "@/lib/app-navigation-state",
  async () => import("../lib/app-navigation-state"),
);
vi.mock(
  "@/lib/fnd001-query-display-state",
  async () => import("../lib/fnd001-query-display-state"),
);
vi.mock("@/lib/activity-ui", async () => import("../lib/activity-ui"));
vi.mock(
  "@/lib/ui-accessibility",
  async () => import("../lib/ui-accessibility"),
);

const Tabs = Object.assign(
  ({ children }: { children?: ReactNode }) => children,
  { Screen: "Tabs.Screen" },
);

vi.mock("expo-router", () => ({
  Tabs,
  usePathname: () => runtime.pathname,
  useRouter: () => ({ push: runtime.push }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    social: {
      profile: { useQuery: () => ({ data: { avatar: null } }) },
      circles: { useQuery: () => runtime.circlesQuery },
      joinCircle: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      feedPage: {
        useInfiniteQuery: () => ({
          data: { pages: [] },
          isLoading: false,
          isError: false,
          hasNextPage: false,
          isFetchingNextPage: false,
          refetch: vi.fn(),
          fetchNextPage: vi.fn(),
        }),
      },
      profilesPage: {
        useQuery: () => ({
          data: {
            items: [
              {
                id: 7,
                name: "Ada Lovelace",
                avatar: null,
              },
            ],
          },
        }),
      },
    },
    live: { list: { useQuery: () => ({ data: [] }) } },
    activity: {
      unreadCount: {
        useQuery: () => ({
          data: { count: 3, viewerId: 42 },
          isError: false,
          isFetchedAfterMount: true,
          isFetching: false,
        }),
      },
    },
    useUtils: () => ({}),
  },
}));

vi.mock("@/hooks/circles-context", () => ({
  useCircles: () => ({
    user: { id: 42, name: "Ari" },
    requireAuth: runtime.requireAuth,
    showLogin: vi.fn(),
    notify: runtime.notify,
  }),
}));

vi.mock("@/components/circles-ui", () => ({
  Button: "Button",
  C: {
    bg: "#F9F8F5",
    paper: "#FFFFFF",
    ink: "#242825",
    muted: "#4D5948",
    secondary: "#4D5948",
    border: "#E8E9E2",
    coral: "#ED604A",
    action: "#A53728",
    soft: "#FFF0EB",
    sage: "#E9EEE5",
    green: "#718569",
  },
  Empty: "Empty",
  Heading: "Heading",
  Icon: "Icon",
  IconButton: "IconButton",
  Loading: "Loading",
  Logo: "Logo",
  Pill: "Pill",
  T: "T",
  Wordmark: "Wordmark",
  photo: { coffee: "https://example.test/coffee.jpg" },
  s: {
    row: { flexDirection: "row" },
    between: { justifyContent: "space-between" },
    divider: { height: 1 },
    eyebrow: { fontSize: 12 },
  },
}));

vi.mock("@/components/media-image", () => ({ Image: "Image" }));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: "UserAvatar" }));
vi.mock("@/components/activity-badge", () => ({
  ActivityBadge: "ActivityBadge",
}));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
vi.mock("react-native-svg", () => ({
  default: "Svg",
  Circle: "SvgCircle",
}));
vi.mock("@/components/live-avatar-ring", () => ({
  LiveAvatarRing: "LiveAvatarRing",
}));
vi.mock("@/components/app-shell", () => ({ AppShell: "AppShell" }));
vi.mock("@/components/post-card", () => ({ PostCard: "PostCard" }));
vi.mock("@/components/onboarding-entry", () => ({
  OnboardingEntry: "OnboardingEntry",
}));
vi.mock("../components/activity-badge", () => ({
  ActivityBadge: "ActivityBadge",
}));
vi.mock("../components/user-avatar", () => ({ UserAvatar: "UserAvatar" }));

const { AppShell, CommunitySidebar } = await import("../components/app-shell");
const { default: HomeScreen } = await import("../app/(tabs)/index");
const { default: TabLayout } = await import("../app/(tabs)/_layout");

type ElementProps = Record<string, unknown>;
type InspectableElement = ReactElement<ElementProps>;

function matchingElements(
  node: ReactNode,
  predicate: (element: InspectableElement) => boolean,
): InspectableElement[] {
  const matches: InspectableElement[] = [];

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

function byTestId(
  node: ReactNode,
  testID: string,
): InspectableElement | undefined {
  return matchingElements(
    node,
    (element) => element.props.testID === testID,
  )[0];
}

function byAccessibilityLabel(
  node: ReactNode,
  label: string,
): InspectableElement | undefined {
  return matchingElements(
    node,
    (element) => element.props.accessibilityLabel === label,
  )[0];
}

function hasComponentType(element: InspectableElement, name: string): boolean {
  return (
    element.type === name ||
    (typeof element.type === "function" && element.type.name === name)
  );
}

function flattenedStyle(style: unknown): ElementProps {
  if (Array.isArray(style)) {
    return style.reduce<ElementProps>(
      (resolved, item) => ({ ...resolved, ...flattenedStyle(item) }),
      {},
    );
  }
  return style && typeof style === "object" ? (style as ElementProps) : {};
}

function setCirclesQuery({
  data,
  isLoading = false,
  isError = false,
}: Pick<CircleQuery, "data"> &
  Partial<Pick<CircleQuery, "isLoading" | "isError">>): ReturnType<
  typeof vi.fn
> {
  const refetch = vi.fn();
  runtime.circlesQuery = { data, isLoading, isError, refetch };
  return refetch;
}

describe("D26 Shell navigation and sidebar accessibility", () => {
  it("resolves only route-boundary-matched current sections, including child routes", () => {
    expect(resolveAppNavigationSection("/")).toBe("home");
    expect(resolveAppNavigationSection("/discover?query=people")).toBe(
      "discover",
    );
    expect(resolveAppNavigationSection("/circle/9")).toBe("circles");
    expect(resolveAppNavigationSection("/updates/preferences")).toBe("updates");
    expect(resolveAppNavigationSection("/chat/conversation-9")).toBe(
      "messages",
    );
    expect(resolveAppNavigationSection("/live/host-9")).toBe("live");
    expect(resolveAppNavigationSection("/account/email")).toBe("profile");
    expect(resolveAppNavigationSection("/person/7/")).toBe("profile");
    expect(resolveAppNavigationSection("/chatty")).toBeNull();
    expect(resolveAppNavigationSection("/lively")).toBeNull();
    expect(resolveAppNavigationSection("/account/emailing")).toBeNull();
  });

  it("exposes selected wide-rail state for chat, live, and account-email routes", () => {
    runtime.width = 1000;
    runtime.insets = { top: 0, left: 0, right: 0, bottom: 0 };

    runtime.pathname = "/chat/conversation-9";
    const chatShell = AppShell({ children: null });
    expect(
      byAccessibilityLabel(chatShell, "Open Messages")?.props,
    ).toMatchObject({
      accessibilityRole: "button",
      accessibilityState: { selected: true },
    });

    runtime.pathname = "/live/host-9";
    const liveShell = AppShell({ children: null });
    const liveControl = byAccessibilityLabel(liveShell, "Open Live now");
    expect(liveControl?.props).toMatchObject({
      accessibilityRole: "button",
      accessibilityState: { selected: true },
    });
    expect(
      matchingElements(
        liveControl?.props.children as ReactNode,
        (element) =>
          hasComponentType(element, "Icon") &&
          element.props.name === "radio-outline",
      )[0]?.props.color,
    ).toBe("#A53728");

    runtime.pathname = "/account/email";
    const emailShell = AppShell({ children: null });
    expect(
      byAccessibilityLabel(emailShell, "Open Profile")?.props,
    ).toMatchObject({
      accessibilityState: { selected: true },
    });
  });

  it("retains the compact tab contract and keeps Messages out of the compact tab bar", () => {
    const layout = TabLayout();
    expect(typeof layout.props.tabBar).toBe("function");
    expect(
      matchingElements(layout, (element) => element.props.name === "index"),
    ).toHaveLength(1);
    expect(
      matchingElements(layout, (element) => element.props.name === "discover"),
    ).toHaveLength(1);
    expect(
      matchingElements(layout, (element) => element.props.name === "circles"),
    ).toHaveLength(1);
    expect(
      matchingElements(layout, (element) => element.props.name === "profile"),
    ).toHaveLength(1);
    expect(
      matchingElements(layout, (element) =>
        element.props.name === "messages"
          ? (element.props.options as ElementProps | undefined)?.href === null
          : false,
      ),
    ).toHaveLength(1);
    expect(
      matchingElements(layout, (element) => element.props.name === "chats"),
    ).toHaveLength(0);
  });

  it("names and sizes Home moment, person, and Live route targets", () => {
    const home = HomeScreen();

    const createMoment = byAccessibilityLabel(home, "Create your moment");
    expect(createMoment?.props.accessibilityRole).toBe("button");
    expect(flattenedStyle(createMoment?.props.style)).toMatchObject({
      minWidth: 54,
      minHeight: 75,
    });

    const person = byAccessibilityLabel(home, "Open profile for Ada Lovelace");
    expect(person?.props.accessibilityRole).toBe("button");
    expect(flattenedStyle(person?.props.style)).toMatchObject({
      minWidth: 50,
      minHeight: 72,
    });

    const live = byAccessibilityLabel(home, "Open Live now, 0 live sessions");
    expect(live?.props.accessibilityRole).toBe("button");
    expect(flattenedStyle(live?.props.style).minHeight).toBe(44);
  });

  it("renders distinct loading, error/retry, empty, and content recommendation branches", () => {
    setCirclesQuery({ data: undefined, isLoading: true });
    const loading = CommunitySidebar();
    expect(byTestId(loading, "sidebar-circles-loading")?.props.children).toBe(
      "Loading circle recommendations…",
    );

    const refetch = setCirclesQuery({ data: undefined, isError: true });
    const errored = CommunitySidebar();
    expect(byTestId(errored, "sidebar-circles-error")).toBeDefined();
    const retry = matchingElements(
      errored,
      (element) =>
        hasComponentType(element, "Button") &&
        element.props.title === "Try again",
    )[0];
    expect(typeof retry?.props.onPress).toBe("function");
    if (typeof retry?.props.onPress !== "function") {
      throw new Error("Sidebar retry must remain callable.");
    }
    retry.props.onPress();
    expect(refetch).toHaveBeenCalledTimes(1);

    setCirclesQuery({ data: [] });
    const empty = CommunitySidebar();
    expect(byTestId(empty, "sidebar-circles-empty")?.props.children).toBe(
      "No circle recommendations right now.",
    );

    const circle: SidebarCircle = {
      id: 7,
      name: "Poetry Circle",
      image: "https://example.test/poetry.jpg",
      memberCount: 28,
      category: "Writing",
      privacy: "public",
    };
    setCirclesQuery({ data: [circle] });
    const content = CommunitySidebar();
    const row = matchingElements(
      content,
      (element) => element.props.circle === circle,
    )[0];
    if (typeof row?.type !== "function") {
      throw new Error("Sidebar content must render its circle row component.");
    }
    const renderRow = row.type as (props: ElementProps) => ReactNode;
    const renderedRow = renderRow(row.props);
    const openControls = matchingElements(
      renderedRow,
      (element) =>
        hasComponentType(element, "Pressable") &&
        element.props.accessibilityLabel === "Open Poetry Circle",
    );
    expect(openControls).toHaveLength(1);
    expect(openControls[0]?.props.accessibilityRole).toBe("button");
    expect(flattenedStyle(openControls[0]?.props.style)).toMatchObject({
      minHeight: 46,
    });
    expect(
      matchingElements(
        openControls[0]?.props.children as ReactNode,
        (element) => hasComponentType(element, "Image"),
      )[0]?.props.accessible,
    ).toBe(false);
  });

  it("reserves a wide bottom inset on both rails and uses C.action for unread badge fill", async () => {
    runtime.width = 1200;
    runtime.pathname = "/live";
    runtime.insets = { top: 0, left: 0, right: 0, bottom: 34 };
    const shell = AppShell({ children: null });

    expect(
      flattenedStyle(byTestId(shell, "app-shell-wide-rail")?.props.style)
        .paddingBottom,
    ).toBe(50);
    expect(
      (
        byTestId(shell, "app-shell-community-sidebar")?.props
          .contentContainerStyle as ElementProps
      ).paddingBottom,
    ).toBe(50);

    const { ActivityBadge } = await vi.importActual<
      typeof import("../components/activity-badge")
    >("../components/activity-badge");
    const badge = ActivityBadge({ viewerId: 42, onPress: vi.fn() });
    const unreadFill = matchingElements(
      badge,
      (element) =>
        element.type === "View" &&
        flattenedStyle(element.props.style).backgroundColor === "#A53728",
    )[0];
    expect(unreadFill).toBeDefined();
  });
});
