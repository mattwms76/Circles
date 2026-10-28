import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Post } from "../shared/social";

const runtime = vi.hoisted(() => ({
  authState: "authenticated" as
    | "checking"
    | "authenticated"
    | "guest"
    | "error",
  user: { id: 7, name: "Avery" } as { id: number; name: string | null } | null,
  refresh: vi.fn(),
  showLogin: vi.fn(),
  requireAuth: vi.fn(),
  notify: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  params: { id: "55" } as { id?: string | string[] },
  stateCursor: 0,
  stateValues: [] as unknown[],
  listRefetch: vi.fn(),
  unreadRefetch: vi.fn(),
  preferenceRefetch: vi.fn(),
  list: null as Record<string, unknown> | null,
  unread: null as Record<string, unknown> | null,
  target: null as Record<string, unknown> | null,
  preferences: null as Record<string, unknown> | null,
  mutation: { isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() },
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: <Value>(callback: Value) => callback,
    useEffect: () => undefined,
    useMemo: <Value>(factory: () => Value) => factory(),
    useRef: <Value>(initialValue: Value) => ({ current: initialValue }),
    useState: <Value>(initialValue: Value | (() => Value)) => {
      const index = runtime.stateCursor++;
      const value =
        index < runtime.stateValues.length
          ? (runtime.stateValues[index] as Value)
          : typeof initialValue === "function"
            ? (initialValue as () => Value)()
            : initialValue;
      return [value, vi.fn()] as const;
    },
  };
});

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Modal: "Modal",
  Platform: { OS: "web" },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Share: { share: vi.fn() },
  StyleSheet: { create: <Value>(value: Value) => value },
  TextInput: "TextInput",
  View: "View",
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => runtime.params,
  useRouter: () => ({ push: runtime.push, replace: runtime.replace }),
}));
vi.mock("expo-video", () => ({
  useVideoPlayer: () => ({ addListener: () => ({ remove: vi.fn() }) }),
  VideoView: "VideoView",
}));
vi.mock("@/components/app-shell", () => ({ AppShell: "AppShell" }));
vi.mock("@/components/status-message", () => ({
  StatusMessage: "StatusMessage",
}));
vi.mock("@/components/media-image", () => ({
  Image: "Image",
  MediaPlaceholder: "MediaPlaceholder",
  useMediaSource: () => null,
}));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: "UserAvatar" }));
vi.mock("../components/user-avatar", () => ({ UserAvatar: "UserAvatar" }));
vi.mock(
  "@/components/post-card",
  async () => import("../components/post-card"),
);
vi.mock(
  "@/components/activity-preferences",
  async () => import("../components/activity-preferences"),
);
vi.mock("@/components/circles-ui", () => ({
  ago: () => "just now",
  Button: "Button",
  C: {
    action: "#A53728",
    bg: "#F9F8F5",
    border: "#E8E9E2",
    coral: "#ED604A",
    green: "#718569",
    ink: "#242825",
    muted: "#4D5948",
    paper: "#FFFFFF",
    sage: "#E9EEE5",
    secondary: "#4D5948",
    soft: "#FFF0EB",
  },
  Empty: "Empty",
  Icon: "Icon",
  IconButton: "IconButton",
  Loading: "Loading",
  s: { between: {}, card: {}, row: {} },
  T: "T",
  Heading: "T",
}));
vi.mock("../components/circles-ui", () => ({
  ago: () => "just now",
  Button: "Button",
  Icon: "Icon",
  IconButton: "IconButton",
  C: {
    action: "#A53728",
    bg: "#F9F8F5",
    border: "#E8E9E2",
    coral: "#ED604A",
    green: "#718569",
    ink: "#242825",
    muted: "#4D5948",
    paper: "#FFFFFF",
    sage: "#E9EEE5",
    secondary: "#4D5948",
    soft: "#FFF0EB",
  },
  Empty: "Empty",
  s: { between: {}, card: {}, row: {} },
  T: "T",
  Heading: "T",
}));
vi.mock("@/hooks/circles-context", () => ({
  useCircles: () => ({
    authState: runtime.authState,
    user: runtime.user,
    refresh: runtime.refresh,
    showLogin: runtime.showLogin,
    requireAuth: runtime.requireAuth,
    notify: runtime.notify,
  }),
}));
vi.mock("@/lib/fnd001-query-display-state", () => ({
  resolveFnd001QueryDisplayState: () => "empty",
}));
vi.mock(
  "@/lib/a26-activity-repairs",
  async () => import("../lib/a26-activity-repairs"),
);
vi.mock("@/lib/activity-ui", async () => import("../lib/activity-ui"));
vi.mock("@/lib/single-flight-submit", () => ({
  createSingleFlightSubmitter: () => ({
    isBusy: false,
    run: async (work: () => Promise<void>) => work(),
  }),
}));
vi.mock("@/lib/source-query-invalidation", () => ({
  invalidateModerationViews: vi.fn(),
  invalidatePostFeeds: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      activity: {
        list: { invalidate: vi.fn() },
        unreadCount: { invalidate: vi.fn() },
      },
      social: {},
    }),
    activity: {
      list: { useInfiniteQuery: () => runtime.list },
      unreadCount: { useQuery: () => runtime.unread },
      markRead: { useMutation: () => runtime.mutation },
      markAllRead: { useMutation: () => runtime.mutation },
      resolveTarget: { useQuery: () => runtime.target },
      preferences: { useQuery: () => runtime.preferences },
      updateCategories: { useMutation: () => runtime.mutation },
      setCircleMuted: { useMutation: () => runtime.mutation },
    },
    social: {
      comments: {
        useQuery: () => ({
          data: [],
          isError: false,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      comment: { useMutation: () => runtime.mutation },
      deletePost: { useMutation: () => runtime.mutation },
      likePost: { useMutation: () => runtime.mutation },
      report: { useMutation: () => runtime.mutation },
      savePost: { useMutation: () => runtime.mutation },
    },
  },
}));

const {
  ACTIVITY_PREFERENCES_LOAD_ERROR,
  activityPostCardActionsAvailable,
  resolveActivityRouteGate,
  resolveActivityUnreadControls,
} = await import("../lib/a26-activity-repairs");
const { ActivityInbox, default: UpdatesScreen } =
  await import("../app/updates/index");
const { ActivityDetail, default: ActivityDetailScreen } =
  await import("../app/updates/[id]");
const { ActivityOutcomeStatus, ActivityPreferencesPanel } =
  await import("../components/activity-preferences");
const { PostCard } = await import("../components/post-card");
const { default: ActivityPreferencesScreen } =
  await import("../app/updates/preferences");

const post = {
  id: 91,
  author: {
    id: 8,
    name: "Jordan",
    handle: "jordan",
    bio: "",
    avatar: "",
    followers: 0,
    following: 0,
  },
  circleId: 22,
  circleName: "Writers",
  text: "A kind update.",
  media: null,
  mediaType: "text",
  likes: 1,
  comments: 2,
  liked: false,
  saved: false,
  createdAt: "2026-10-26T12:00:00.000Z",
} as Post;

const item = {
  id: 55,
  kind: "comment_on_your_post" as const,
  createdAt: "2026-10-26T12:00:00.000Z",
  readAt: null,
  available: true,
  actorName: "Jordan",
  circleName: "Writers",
};

function resetRender(values: unknown[] = []) {
  runtime.stateCursor = 0;
  runtime.stateValues = values;
}

function renderDirect(component: () => ReactNode): ReactNode {
  resetRender();
  return component();
}

function findElements(
  node: ReactNode,
  type: unknown,
): ReactElement<Record<string, unknown>>[] {
  const matches: ReactElement<Record<string, unknown>>[] = [];
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    if (child.type === type) matches.push(child);
    matches.push(
      ...findElements(child.props.children as ReactNode | undefined, type),
    );
  }
  return matches;
}

function renderFunctionElement(
  node: ReactElement<Record<string, unknown>>,
): ReactElement<Record<string, unknown>> {
  if (typeof node.type !== "function") {
    throw new Error("Expected a function component.");
  }
  const component = node.type as (
    props: Record<string, unknown>,
  ) => ReactElement<Record<string, unknown>>;
  return component(node.props);
}

beforeEach(() => {
  runtime.authState = "authenticated";
  runtime.user = { id: 7, name: "Avery" };
  runtime.refresh.mockReset();
  runtime.showLogin.mockReset();
  runtime.requireAuth.mockReset();
  runtime.notify.mockReset();
  runtime.push.mockReset();
  runtime.replace.mockReset();
  runtime.params = { id: "55" };
  runtime.listRefetch.mockReset();
  runtime.unreadRefetch.mockReset();
  runtime.preferenceRefetch.mockReset();
  runtime.mutation.isPending = false;
  runtime.mutation.mutate.mockReset();
  runtime.mutation.mutateAsync.mockReset();
  runtime.list = {
    data: { pages: [{ viewerId: 7, items: [item], nextCursor: null }] },
    isError: false,
    isFetchedAfterMount: true,
    isFetching: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: runtime.listRefetch,
  };
  runtime.unread = {
    data: { viewerId: 7, count: 1, throughId: 55 },
    isError: false,
    isFetchedAfterMount: true,
    isFetching: false,
    refetch: runtime.unreadRefetch,
  };
  runtime.target = {
    data: { viewerId: 7, activityId: 55, target: { type: "post", post } },
    isError: false,
    isFetchedAfterMount: true,
    isFetching: false,
    refetch: vi.fn(),
  };
  runtime.preferences = {
    data: {
      viewerId: 7,
      commentsEnabled: true,
      membershipApprovalsEnabled: true,
      circle: null,
    },
    isError: false,
    isFetchedAfterMount: true,
    isFetching: false,
    refetch: runtime.preferenceRefetch,
  };
});

describe("A26 Activity repairs", () => {
  it("gates retained identities on auth errors and retains only fresh unread bulk authority", () => {
    expect(resolveActivityRouteGate({ authState: "error", viewerId: 7 })).toBe(
      "auth-error",
    );
    expect(
      resolveActivityRouteGate({ authState: "authenticated", viewerId: 7 }),
    ).toBe("ready");
    expect(
      resolveActivityRouteGate({ authState: "authenticated", viewerId: null }),
    ).toBe("guest");

    expect(
      resolveActivityUnreadControls({
        hasItems: true,
        unreadIsError: true,
        unreadAuthorityAvailable: false,
        throughId: undefined,
      }),
    ).toEqual({ showRecovery: true, showMarkAll: false });
    expect(
      resolveActivityUnreadControls({
        hasItems: true,
        unreadIsError: false,
        unreadAuthorityAvailable: true,
        throughId: 55,
      }),
    ).toEqual({ showRecovery: false, showMarkAll: true });
  });

  it("renders retryable auth failure instead of guest or protected Activity content on inbox and detail", () => {
    runtime.authState = "error";
    runtime.user = { id: 7, name: "Retained account" };

    const inbox = renderDirect(() => UpdatesScreen());
    const inboxRetry = findElements(inbox, "Empty").at(0);
    expect(inboxRetry?.props).toMatchObject({
      title: "We couldn’t check your sign-in.",
      action: "Try again",
    });
    expect(findElements(inbox, "StatusMessage").at(0)?.props).toMatchObject({
      message: "We couldn’t confirm your sign-in. Try again.",
      tone: "error",
    });
    (inboxRetry?.props.onAction as () => void)();
    expect(runtime.refresh).toHaveBeenCalledTimes(1);

    const detail = renderDirect(() => ActivityDetailScreen());
    const detailRetry = findElements(detail, "Empty").at(0);
    expect(detailRetry?.props).toMatchObject({
      title: "We couldn’t check your sign-in.",
      action: "Try again",
    });
    expect(findElements(detail, "StatusMessage").at(0)?.props).toMatchObject({
      message: "We couldn’t confirm your sign-in. Try again.",
      tone: "error",
    });
  });

  it("keeps populated rows, exposes unread recovery, and withholds Mark all read until a fresh watermark returns", () => {
    runtime.unread = {
      data: undefined,
      isError: true,
      isFetchedAfterMount: true,
      isFetching: false,
      refetch: runtime.unreadRefetch,
    };

    const inbox = renderDirect(() => ActivityInbox({ viewerId: 7 }));
    const recoveryStatus = findElements(inbox, "StatusMessage").find(
      (status) =>
        status.props.message ===
        "We couldn’t check unread updates. Mark all read is unavailable until it refreshes.",
    );
    expect(recoveryStatus?.props).toMatchObject({
      message:
        "We couldn’t check unread updates. Mark all read is unavailable until it refreshes.",
      tone: "error",
    });
    const retry = findElements(inbox, "Button").find(
      (button) => button.props.title === "Try again",
    );
    expect(retry?.props.accessibilityLabel).toBe(
      "Try checking unread updates again",
    );
    expect(
      findElements(inbox, "Button").some(
        (button) => button.props.title === "Mark all read",
      ),
    ).toBe(false);
    (retry?.props.onPress as () => void)();
    expect(runtime.unreadRefetch).toHaveBeenCalledTimes(1);
  });

  it("passes unavailable retained-target authority into PostCard and freezes every target action with busy semantics", () => {
    runtime.target = {
      data: { viewerId: 7, activityId: 55, target: { type: "post", post } },
      isError: false,
      isFetchedAfterMount: true,
      isFetching: true,
      refetch: vi.fn(),
    };

    const detail = renderDirect(() =>
      ActivityDetail({ viewerId: 7, activityId: 55 }),
    );
    const detailCard = findElements(detail, PostCard).at(0);
    expect(detailCard?.props.actionsAvailable).toBe(false);
    expect(activityPostCardActionsAvailable(false)).toBe(false);

    const card = renderDirect(() =>
      PostCard({ post, actionsAvailable: false }),
    );
    const profile = findElements(card, "Pressable").find(
      (control) => control.props.accessibilityLabel === "Open Jordan's profile",
    );
    const like = findElements(card, "Pressable").find(
      (control) => control.props.accessibilityLabel === "Like moment",
    );
    const comments = findElements(card, "Pressable").find(
      (control) => control.props.accessibilityLabel === "Open 2 comments",
    );
    expect(profile?.props).toMatchObject({
      disabled: true,
      accessibilityState: { disabled: true, busy: true },
    });
    expect(like?.props).toMatchObject({
      disabled: true,
      accessibilityState: { disabled: true, busy: true },
    });
    expect(comments?.props).toMatchObject({
      disabled: true,
      accessibilityState: { disabled: true, busy: true },
    });
    expect(
      findElements(card, "IconButton").find(
        (control) => control.props.label === "Moment options",
      )?.props,
    ).toMatchObject({ disabled: true, loading: true });
    expect(
      findElements(card, "IconButton").find(
        (control) => control.props.label === "Share moment",
      )?.props,
    ).toMatchObject({ disabled: true, loading: true });
    (like?.props.onPress as () => void)();
    expect(runtime.requireAuth).not.toHaveBeenCalled();
  });

  it("announces both auth and preferences-load failures while retaining their visual Empty retry surfaces", () => {
    runtime.authState = "error";
    runtime.user = null;
    const screen = renderDirect(() => ActivityPreferencesScreen());
    const screenStatus = findElements(screen, ActivityOutcomeStatus).at(0);
    expect(renderFunctionElement(screenStatus!).props).toMatchObject({
      message: ACTIVITY_PREFERENCES_LOAD_ERROR,
      tone: "error",
    });
    expect(findElements(screen, "Empty").at(0)?.props).toMatchObject({
      title: "We couldn’t check your sign-in.",
      action: "Try again",
    });

    runtime.authState = "authenticated";
    runtime.user = { id: 7, name: "Avery" };
    runtime.preferences = {
      data: undefined,
      isError: true,
      isFetchedAfterMount: true,
      isFetching: false,
      refetch: runtime.preferenceRefetch,
    };
    const panel = renderDirect(() => ActivityPreferencesPanel({ viewerId: 7 }));
    const panelStatus = findElements(panel, ActivityOutcomeStatus).at(0);
    expect(renderFunctionElement(panelStatus!).props).toMatchObject({
      message: ACTIVITY_PREFERENCES_LOAD_ERROR,
      tone: "error",
    });
    const panelRetry = findElements(panel, "Empty").at(0);
    expect(panelRetry?.props.action).toBe("Try again");
    (panelRetry?.props.onAction as () => void)();
    expect(runtime.preferenceRefetch).toHaveBeenCalledTimes(1);
  });
});
