import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { contrastRatio, UI_ACCESSIBLE_COLORS } from "../lib/ui-accessibility";

type StateUpdater<T> = T | ((previous: T) => T);
type Cleanup = (() => void) | void;

const runtime = vi.hoisted(() => {
  let stateValues: unknown[] = [];
  let refValues: { current: unknown }[] = [];
  let effectDependencies: (readonly unknown[] | undefined)[] = [];
  let effectCleanups: ((() => void) | undefined)[] = [];
  let pendingEffects: { index: number; effect: () => Cleanup }[] = [];
  let stateIndex = 0;
  let refIndex = 0;
  let effectIndex = 0;

  const people = [
    {
      id: 11,
      name: "Ari River",
      handle: "ari",
      bio: "Makes small adventures close to home.",
      avatar: "https://example.test/ari.jpg",
      isFollowing: false,
    },
    {
      id: 12,
      name: "Mina Rao",
      handle: "mina",
      bio: "Shares favorite places to read.",
      avatar: "https://example.test/mina.jpg",
      isFollowing: true,
    },
  ];
  const live = {
    id: 31,
    title: "Sunset trail check-in",
    thumbnail: "https://example.test/sunset.jpg",
    host: { name: "Ari River" },
    viewers: 8,
  };
  const emptyPage = { pages: [{ items: [] }] };
  const query = (data: unknown) => ({
    data,
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  });

  function dependencyListChanged(
    previous: readonly unknown[] | undefined,
    next: readonly unknown[] | undefined,
  ) {
    if (!previous || !next || previous.length !== next.length) return true;
    return next.some((value, index) => value !== previous[index]);
  }

  function useState<T>(
    initialValue: T | (() => T),
  ): [T, (update: StateUpdater<T>) => void] {
    const index = stateIndex++;
    if (!(index in stateValues)) {
      stateValues[index] =
        typeof initialValue === "function"
          ? (initialValue as () => T)()
          : initialValue;
    }
    const setState = (update: StateUpdater<T>) => {
      const previous = stateValues[index] as T;
      stateValues[index] =
        typeof update === "function"
          ? (update as (current: T) => T)(previous)
          : update;
    };
    return [stateValues[index] as T, setState];
  }

  function useRef<T>(initialValue: T): { current: T } {
    const index = refIndex++;
    refValues[index] ??= { current: initialValue };
    return refValues[index] as { current: T };
  }

  function useEffect(
    effect: () => Cleanup,
    dependencies?: readonly unknown[],
  ): void {
    const index = effectIndex++;
    if (dependencyListChanged(effectDependencies[index], dependencies)) {
      effectDependencies[index] = dependencies;
      pendingEffects.push({ index, effect });
    }
  }

  function beginRender(): void {
    stateIndex = 0;
    refIndex = 0;
    effectIndex = 0;
  }

  function flushEffects(): void {
    const effects = pendingEffects;
    pendingEffects = [];
    for (const { index, effect } of effects) {
      effectCleanups[index]?.();
      const cleanup = effect();
      effectCleanups[index] =
        typeof cleanup === "function" ? cleanup : undefined;
    }
  }

  const followMutate = vi.fn();
  const push = vi.fn();
  const notify = vi.fn();
  const requireAuth = vi.fn((callback: () => void) => callback());

  return {
    beginRender,
    circlesQuery: query(emptyPage),
    feedQuery: query(emptyPage),
    flushEffects,
    followMutate,
    livesQuery: query([live]),
    notify,
    peopleQuery: query({ pages: [{ items: people }] }),
    push,
    requireAuth,
    reset: () => {
      for (const cleanup of effectCleanups) cleanup?.();
      stateValues = [];
      refValues = [];
      effectDependencies = [];
      effectCleanups = [];
      pendingEffects = [];
      stateIndex = 0;
      refIndex = 0;
      effectIndex = 0;
      followMutate.mockClear();
      notify.mockClear();
      push.mockClear();
      requireAuth.mockClear();
    },
    useEffect,
    useRef,
    useState,
  };
});

vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useEffect: runtime.useEffect,
  useRef: runtime.useRef,
  useState: runtime.useState,
}));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  View: "View",
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: runtime.push }),
}));
vi.mock("@/hooks/circles-context", () => ({
  useCircles: () => ({
    user: { id: 7 },
    notify: runtime.notify,
    requireAuth: runtime.requireAuth,
  }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    social: {
      circlesPage: { useInfiniteQuery: () => runtime.circlesQuery },
      feedPage: { useInfiniteQuery: () => runtime.feedQuery },
      follow: { useMutation: () => ({ mutate: runtime.followMutate }) },
      profilesPage: { useInfiniteQuery: () => runtime.peopleQuery },
    },
    live: { list: { useQuery: () => runtime.livesQuery } },
    useUtils: () => ({}),
  },
}));
vi.mock("@/lib/source-query-invalidation", () => ({
  invalidateProfileViews: vi.fn(),
}));
vi.mock("@/lib/batch3-account-resource-scope", () => ({
  batch3AccountResourceScope: (
    accountId: number | undefined,
    resource: string,
  ) => (typeof accountId === "number" ? `${accountId}:${resource}` : null),
  createBatch3AccountResourceSingleFlight: () => {
    const activeOperations = new Set<string>();
    return {
      finish: ({
        generation,
        scope,
      }: {
        generation: number;
        scope: string;
      }) => {
        activeOperations.delete(`${scope}:${generation}`);
      },
      start: ({ generation, scope }: { generation: number; scope: string }) => {
        const operation = `${scope}:${generation}`;
        if (activeOperations.has(operation)) return false;
        activeOperations.add(operation);
        return true;
      },
    };
  },
  isCurrentBatch3AccountResourceOperation: (
    current: { generation: number; scope: string } | null,
    completed: { generation: number; scope: string },
  ) =>
    current?.generation === completed.generation &&
    current.scope === completed.scope,
}));
vi.mock("@/lib/fnd001-query-display-state", () => ({
  resolveFnd001QueryDisplayState: ({
    hasContent,
    isError,
    isLoading,
  }: {
    hasContent: boolean;
    isError: boolean;
    isLoading: boolean;
  }) =>
    isLoading
      ? "loading"
      : isError
        ? "error"
        : hasContent
          ? "content"
          : "empty",
}));
vi.mock("@/lib/feed-ui-helpers", () => ({
  getBoundedLoadedCollection: <T>(
    items: T[] | undefined,
    visibleCount: number,
  ) => {
    const loadedItems = items ?? [];
    return {
      canAppend: loadedItems.length > visibleCount,
      endState: loadedItems.length > visibleCount ? "more-loaded" : "end",
      items: loadedItems.slice(0, visibleCount),
      nextVisibleCount: visibleCount + 20,
    };
  },
  UI_COLLECTION_PAGE_SIZE: 20,
}));
vi.mock("@/components/app-shell", () => ({ AppShell: "AppShell" }));
vi.mock("@/components/circle-card", () => ({ CircleCard: "CircleCard" }));
vi.mock("@/components/post-card", () => ({ PostCard: "PostCard" }));
vi.mock("@/components/status-message", () => ({
  StatusMessage: "StatusMessage",
}));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: "UserAvatar" }));
vi.mock("@/components/media-image", () => ({ Image: "Image" }));
vi.mock("@/components/circles-ui", () => ({
  Button: "Button",
  C: {
    bg: "#F9F8F5",
    border: "#E8E9E2",
    ink: "#242825",
    paper: "#FFFFFF",
    secondary: UI_ACCESSIBLE_COLORS.secondary,
    soft: "#FFF0EB",
  },
  Empty: "Empty",
  Icon: "Icon",
  IconButton: "IconButton",
  Loading: "Loading",
  Pill: "Pill",
  s: {
    between: { justifyContent: "space-between" },
    card: { backgroundColor: "#FFFFFF", borderRadius: 18 },
    eyebrow: { color: UI_ACCESSIBLE_COLORS.secondary },
    row: { alignItems: "center", flexDirection: "row" },
    title: { fontSize: 29 },
  },
  T: "T",
}));

const { default: DiscoverScreen } = await import("../app/(tabs)/discover");

type Element = ReactElement<Record<string, unknown>>;

function elements(node: ReactNode): Element[] {
  const result: Element[] = [];
  Children.forEach(node, (child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return;
    result.push(child);
    result.push(...elements(child.props.children as ReactNode));
  });
  return result;
}

function oneElement(
  node: ReactNode,
  predicate: (element: Element) => boolean,
  description: string,
): Element {
  const element = elements(node).find(predicate);
  if (!element) throw new Error(`Missing ${description}`);
  return element;
}

function style(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return Object.assign({}, ...value.map(style));
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function renderDiscover(): ReactNode {
  runtime.beginRender();
  const root = DiscoverScreen();
  if (!isValidElement(root) || typeof root.type !== "function") {
    throw new Error("DiscoverScreen must retain its keyed route instance.");
  }
  const renderRouteInstance = root.type as (
    props: typeof root.props,
  ) => ReactNode;
  const rendered = renderRouteInstance(root.props);
  runtime.flushEffects();
  return rendered;
}

beforeEach(() => {
  runtime.reset();
});

describe("D26 Discover follow flight, semantic colors, and Live controls", () => {
  it("visibly disables and explains every conflicting Follow action during the existing route-wide flight", () => {
    const initial = renderDiscover();
    const ariFollow = oneElement(
      initial,
      (element) =>
        element.type === "Button" && element.props.title === "Follow",
      "Ari Follow control",
    );

    expect(ariFollow.props.accessibilityLabel).toBe("Follow Ari River");
    expect(ariFollow.props.disabled).toBe(false);
    (ariFollow.props.onPress as () => void)();
    expect(runtime.followMutate).toHaveBeenCalledWith(
      { userId: 11, following: true },
      expect.any(Object),
    );

    const duringFlight = renderDiscover();
    const updatingAri = oneElement(
      duringFlight,
      (element) =>
        element.type === "Button" &&
        element.props.accessibilityLabel ===
          "Updating connection with Ari River",
      "busy Ari Follow control",
    );
    const blockedMina = oneElement(
      duringFlight,
      (element) =>
        element.type === "Button" &&
        element.props.accessibilityLabel ===
          "Unfollow Mina Rao unavailable while another connection is updating",
      "disabled Mina Follow control",
    );
    const explanation = oneElement(
      duringFlight,
      (element) => element.type === "StatusMessage",
      "route-wide follow-flight explanation",
    );

    expect(updatingAri.props).toMatchObject({
      disabled: true,
      loading: true,
      title: "Updating",
    });
    expect(blockedMina.props).toMatchObject({
      disabled: true,
      loading: false,
      title: "Please wait",
    });
    expect(explanation.props).toMatchObject({
      message:
        "Updating a connection. Other Follow actions are temporarily unavailable.",
      testID: "discover-follow-flight-status",
      tone: "info",
    });

    (blockedMina.props.onPress as () => void)();
    expect(runtime.followMutate).toHaveBeenCalledTimes(1);
  });

  it("uses semantic secondary foregrounds and exposes one named, minimum-size Live route target", () => {
    const initial = renderDiscover();
    const search = oneElement(
      initial,
      (element) => element.type === "TextInput",
      "Discover search input",
    );

    expect(search.props.placeholderTextColor).toBe(
      UI_ACCESSIBLE_COLORS.secondary,
    );
    expect(
      contrastRatio(UI_ACCESSIBLE_COLORS.secondary, "#F9F8F5"),
    ).toBeGreaterThanOrEqual(4.5);

    const liveTab = oneElement(
      initial,
      (element) => element.type === "Pill" && element.props.title === "Live",
      "Live tab",
    );
    (liveTab.props.onPress as () => void)();

    const liveContent = renderDiscover();
    const liveCard = oneElement(
      liveContent,
      (element) =>
        element.type === "Pressable" &&
        element.props.accessibilityLabel ===
          "Open live moment: Sunset trail check-in by Ari River, 8 watching",
      "named Live card",
    );
    const thumbnail = oneElement(
      liveCard.props.children as ReactNode,
      (element) => element.type === "Image",
      "decorative Live thumbnail within the named card",
    );

    expect(liveCard.props).toMatchObject({
      accessibilityHint: "Open this live moment",
      accessibilityRole: "button",
    });
    expect(style(liveCard.props.style)).toMatchObject({ minHeight: 44 });
    expect(thumbnail.props.accessible).toBe(false);

    (liveCard.props.onPress as () => void)();
    expect(runtime.push).toHaveBeenCalledWith("/live/31");
  });
});
