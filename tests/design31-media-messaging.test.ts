import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Post } from "../shared/social";

const stateHarness = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  updates: [] as { index: number; value: unknown }[],
  reset(values: unknown[] = []) {
    this.values = [...values];
    this.cursor = 0;
    this.updates = [];
  },
  beginRender() {
    this.cursor = 0;
  },
}));

const scenario = vi.hoisted(() => ({
  platform: "web",
  authState: "guest",
  user: null as { id: number; name: string | null } | null,
  refresh: vi.fn(),
  showLogin: vi.fn(),
  notify: vi.fn(),
  router: {
    back: vi.fn(),
    canGoBack: vi.fn(() => true),
    push: vi.fn(),
    replace: vi.fn(),
  },
  params: { id: "50", name: "A very long conversation name" },
  conversations: {
    data: [] as unknown[],
    error: null as Error | null,
    isLoading: false,
    refetch: vi.fn(),
  },
  messages: {
    data: { pages: [[]] } as { pages: unknown[][] },
    error: null as Error | null,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchNextPageError: false,
    isFetchingNextPage: false,
    isLoading: false,
    refetch: vi.fn(),
  },
  conversationOptions: null as unknown,
  mutation: {
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn(async () => ({})),
  },
  report: {
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn(async () => ({})),
  },
  remove: {
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn(async () => ({})),
  },
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: <T extends (...args: never[]) => unknown>(callback: T) =>
      callback,
    useEffect: () => undefined,
    useLayoutEffect: () => undefined,
    useMemo: <T>(factory: () => T) => factory(),
    useRef: <T>(initialValue: T) => ({ current: initialValue }),
    useState: <T>(initialValue: T | (() => T)) => {
      const index = stateHarness.cursor++;
      if (!(index in stateHarness.values)) {
        stateHarness.values[index] =
          typeof initialValue === "function"
            ? (initialValue as () => T)()
            : initialValue;
      }
      const setValue = (nextValue: T | ((prior: T) => T)) => {
        const prior = stateHarness.values[index] as T;
        const value =
          typeof nextValue === "function"
            ? (nextValue as (prior: T) => T)(prior)
            : nextValue;
        stateHarness.values[index] = value;
        stateHarness.updates.push({ index, value });
      };
      return [stateHarness.values[index] as T, setValue];
    },
  };
});

vi.mock("react-native", () => ({
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Modal: "Modal",
  Platform: {
    get OS() {
      return scenario.platform;
    },
  },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Share: { share: vi.fn() },
  StyleSheet: {
    create: <T>(value: T) => value,
    flatten: (value: unknown) => value ?? {},
  },
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  useWindowDimensions: () => ({ width: 390, height: 844 }),
}));
vi.mock("expo-image", () => ({ Image: "ExpoImage" }));
vi.mock("expo-image-picker", () => ({ launchImageLibraryAsync: vi.fn() }));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => scenario.params,
  useRouter: () => scenario.router,
}));
vi.mock("expo-video", () => ({
  VideoView: "VideoView",
  useVideoPlayer: () => ({
    addListener: () => ({ remove: vi.fn() }),
    status: "idle",
  }),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));
vi.mock("@/constants/oauth", () => ({
  getApiBaseUrl: () => "https://api.example.test",
  getApiRequestUrl: (path: string) => `https://api.example.test${path}`,
}));
vi.mock("@/lib/_core/auth", () => ({ getSessionToken: vi.fn() }));
vi.mock("@/lib/media-cache", () => ({
  nativeMediaRequestKey: (accountId: number | undefined, uri: string) =>
    `${accountId ?? "guest"}:${uri}`,
  nativeMediaTokenForRequest: () => null,
}));
vi.mock("@/lib/media-fallback", () => ({
  mediaArrayAuthorizationUri: () => "",
  mediaFallbackIdentity: () => "synthetic-media",
  resolveMediaSourceArray: () => null,
}));
vi.mock("@/shared/media", () => ({
  requiresNativeMediaAuthorization: (uri: string, isWeb: boolean) =>
    !isWeb && uri.endsWith(".enc"),
  resolveMediaUrlForRenderer: (uri: string) => uri,
}));
vi.mock("@/hooks/circles-context-core", () => ({
  useCircles: () => ({
    authState: scenario.authState,
    completeNativeLogin: vi.fn(),
    logout: vi.fn(),
    notify: scenario.notify,
    refresh: scenario.refresh,
    requireAuth: (action?: () => void) => {
      action?.();
      return true;
    },
    showLogin: scenario.showLogin,
    user: scenario.user,
  }),
}));
vi.mock("@/hooks/circles-context", () => ({
  useCircles: () => ({
    authState: scenario.authState,
    completeNativeLogin: vi.fn(),
    logout: vi.fn(),
    notify: scenario.notify,
    refresh: scenario.refresh,
    requireAuth: (action?: () => void) => {
      action?.();
      return true;
    },
    showLogin: scenario.showLogin,
    user: scenario.user,
  }),
}));
vi.mock("@/components/app-shell", () => ({ AppShell: "AppShell" }));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: "UserAvatar" }));
vi.mock("../components/user-avatar", () => ({ UserAvatar: "UserAvatar" }));
vi.mock("@/components/status-message", () => ({
  StatusMessage: "StatusMessage",
}));
vi.mock("@/components/media-image", () => ({
  Image: "Image",
  MediaPlaceholder: "MediaPlaceholder",
  useMediaSource: () => null,
}));
vi.mock("@/components/circles-ui", () => ({
  ago: () => "just now",
  Avatar: "Avatar",
  Button: "Button",
  C: {
    action: "#A53728",
    actionText: "#FFFFFF",
    bg: "#F9F8F5",
    border: "#E8E9E2",
    coral: "#ED604A",
    green: "#718569",
    ink: "#242825",
    muted: "#4D5948",
    paper: "#FFFFFF",
    sage: "#E9EEE5",
    secondary: "#4D5948",
  },
  Empty: "Empty",
  Icon: "Icon",
  IconButton: "IconButton",
  Loading: "Loading",
  Pill: "Pill",
  s: { between: {}, card: {}, eyebrow: {}, row: {}, title: {} },
  T: "T",
  Heading: "T",
}));
vi.mock("../components/circles-ui", () => ({
  ago: () => "just now",
  Avatar: "Avatar",
  Button: "Button",
  C: {
    action: "#A53728",
    actionText: "#FFFFFF",
    bg: "#F9F8F5",
    border: "#E8E9E2",
    coral: "#ED604A",
    green: "#718569",
    ink: "#242825",
    muted: "#4D5948",
    paper: "#FFFFFF",
    sage: "#E9EEE5",
    secondary: "#4D5948",
  },
  Empty: "Empty",
  Icon: "Icon",
  IconButton: "IconButton",
  Loading: "Loading",
  Pill: "Pill",
  s: { between: {}, card: {}, eyebrow: {}, row: {}, title: {} },
  T: "T",
  Heading: "T",
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    social: {
      comment: { useMutation: () => scenario.mutation },
      comments: {
        useQuery: () => ({
          data: [],
          isError: false,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      conversations: {
        useQuery: (_input: unknown, options: unknown) => {
          scenario.conversationOptions = options;
          return scenario.conversations;
        },
      },
      deletePost: { useMutation: () => scenario.remove },
      likePost: { useMutation: () => scenario.mutation },
      markRead: { useMutation: () => scenario.mutation },
      messages: { useInfiniteQuery: () => scenario.messages },
      report: { useMutation: () => scenario.report },
      savePost: { useMutation: () => scenario.mutation },
      sendMessage: { useMutation: () => scenario.mutation },
      upload: { useMutation: () => scenario.mutation },
    },
    useUtils: () => ({ social: {} }),
  },
}));
vi.mock("@/lib/fnd001-query-display-state", () => ({
  resolveFnd001QueryDisplayState: () => "empty",
}));
vi.mock("@/lib/batch2-message-accessibility", () => ({
  canSendMessage: (text: string, hasAttachment: boolean) =>
    hasAttachment || text.trim().length > 0,
  conversationAccessibility: (name: string, unread: number) => ({
    label: `Open conversation with ${name}`,
    value: unread > 0 ? `${unread} unread messages` : "No unread messages",
  }),
  createMessageCompositionSingleFlight: () => ({
    finish: vi.fn(),
    isActive: false,
    start: () => true,
  }),
  isCurrentMessageCompositionOperation: () => true,
}));
vi.mock("@/lib/media", () => ({
  assetBase64: vi.fn(),
  supportedMime: vi.fn(),
}));
vi.mock("@/lib/message-composition", () => ({
  createMessageCompositionRetryId: () => "synthetic-message-id",
  readReceiptRetryDelayMs: () => null,
}));
vi.mock("@/shared/message-pagination", () => ({
  mergeMessageHistoryPages: (pages: unknown[][]) => pages.flat(),
  MESSAGE_PAGE_DEFAULT_LIMIT: 100,
  olderMessagePageCursor: () => undefined,
}));
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

vi.mock(
  "@/lib/a26-messaging-state",
  async () => import("../lib/a26-messaging-state"),
);
vi.mock(
  "@/lib/a26-paged-display",
  async () => import("../lib/a26-paged-display"),
);
vi.mock(
  "@/lib/d28-010-chat-media",
  async () => import("../lib/d28-010-chat-media"),
);
const mediaModule = await vi.importActual<
  typeof import("../components/media-image")
>("../components/media-image");
const { default: MessagesScreen } = await import("../app/(tabs)/messages");
const { default: ChatScreen } = await import("../app/chat/[id]");
const { PostCard } = await import("../components/post-card");

function renderDirect(component: () => ReactNode): ReactNode {
  stateHarness.beginRender();
  return component();
}

function renderFunctionElement(
  node: ReactNode,
): ReactElement<Record<string, unknown>> {
  if (!isValidElement(node) || typeof node.type !== "function") {
    throw new Error("Expected a function component element.");
  }
  const component = node.type as (
    props: Record<string, unknown>,
  ) => ReactElement<Record<string, unknown>>;
  const rendered = component(node.props as Record<string, unknown>);
  if (!isValidElement<Record<string, unknown>>(rendered)) {
    throw new Error(
      "Expected the function component to return a React element.",
    );
  }
  return rendered;
}

function directChildren(
  node: ReactNode,
): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).filter(isValidElement) as ReactElement<
    Record<string, unknown>
  >[];
}

function findAll(
  node: ReactNode,
  type: string,
): ReactElement<Record<string, unknown>>[] {
  const found: ReactElement<Record<string, unknown>>[] = [];
  for (const child of directChildren(node)) {
    if (child.type === type) found.push(child);
    found.push(...findAll(child.props.children as ReactNode, type));
  }
  return found;
}

function elementWithChild(
  node: ReactNode,
  type: string,
  child: unknown,
): ReactElement<Record<string, unknown>> | undefined {
  return findAll(node, type).find(
    (element) => element.props.children === child,
  );
}

function elementWithMessage(
  node: ReactNode,
  type: string,
  message: string,
): ReactElement<Record<string, unknown>> | undefined {
  return findAll(node, type).find(
    (element) => element.props.message === message,
  );
}

const longAuthor =
  "Avery Long Localized Post Author Name That Must Remain Visible";
const post = {
  id: 901,
  author: {
    id: 7,
    name: longAuthor,
    handle: "avery",
    bio: "",
    avatar: "",
    followers: 0,
    following: 0,
  },
  circleId: null,
  circleName: null,
  text: "A kind update.",
  media: null,
  mediaType: "text",
  likes: 0,
  comments: 0,
  liked: false,
  saved: false,
  createdAt: "2026-10-26T12:00:00.000Z",
} as Post;

describe("D26 media and messaging behavior", () => {
  beforeEach(() => {
    stateHarness.reset();
    scenario.platform = "web";
    scenario.authState = "guest";
    scenario.user = null;
    scenario.refresh.mockReset();
    scenario.showLogin.mockReset();
    scenario.notify.mockReset();
    scenario.conversationOptions = null;
    scenario.conversations = {
      data: [],
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    };
    scenario.messages = {
      data: { pages: [[]] },
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchNextPageError: false,
      isFetchingNextPage: false,
      isLoading: false,
      refetch: vi.fn(),
    };
    scenario.mutation.isPending = false;
    scenario.report.isPending = false;
    scenario.remove.isPending = false;
  });

  it("keeps bearer-pending media neutral and gives only a true decode error one user retry", () => {
    scenario.platform = "ios";
    scenario.user = { id: 7, name: "Avery" };
    const pendingOuter = renderDirect(() =>
      mediaModule.Image({
        source: {
          uri: "/manus-storage/social-encrypted/7/123e4567-e89b-42d3-a456-426614174000.jpg.enc",
        },
        accessible: true,
        accessibilityLabel: "Photo attachment",
        style: { width: 220, aspectRatio: 1.38 },
      }),
    );
    const pending = renderFunctionElement(pendingOuter);
    expect(pending.type).toBe("View");
    expect(pending.props).toMatchObject({
      accessibilityLabel: "Photo attachment",
      accessible: true,
    });
    expect(findAll(pending, "ExpoImage")).toEqual([]);
    expect(findAll(pending, "Pressable")).toEqual([]);

    scenario.platform = "web";
    stateHarness.reset();
    const imageProps = {
      source: { uri: "https://images.example.test/photo.jpg" },
      accessible: true,
      accessibilityLabel: "Photo attachment",
      style: { width: 220, aspectRatio: 1.38 },
      unavailableLabel: "Photo unavailable",
      retryLabel: "Retry photo",
    };
    const renderImage = () => {
      const outer = renderDirect(() => mediaModule.Image(imageProps));
      return renderFunctionElement(outer);
    };

    const initial = renderImage();
    expect(initial.type).toBe("ExpoImage");
    (initial.props.onError as (event: never) => void)({} as never);

    const failed = renderImage();
    expect(failed.type).toBe(mediaModule.MediaPlaceholder);
    const failedSurface = renderFunctionElement(failed);
    expect(
      elementWithChild(failedSurface, "Text", "Photo unavailable"),
    ).toBeDefined();
    const retry = findAll(failedSurface, "Pressable").at(0);
    expect(retry?.props.accessibilityLabel).toBe("Retry photo");
    (retry?.props.onPress as () => void)();

    const retried = renderImage();
    expect(retried.type).toBe("ExpoImage");
    (retried.props.onError as (event: never) => void)({} as never);

    const terminalFailure = renderFunctionElement(renderImage());
    expect(
      elementWithChild(terminalFailure, "Text", "Photo unavailable"),
    ).toBeDefined();
    expect(findAll(terminalFailure, "Pressable")).toEqual([]);
  });

  it("renders Messages checking, retryable auth-error, and actual guest states separately", () => {
    scenario.authState = "checking";
    const checking = renderDirect(() => MessagesScreen());
    expect(scenario.conversationOptions).toMatchObject({ enabled: false });
    expect(
      elementWithMessage(checking, "StatusMessage", "Checking your sign-in…"),
    ).toMatchObject({ props: { tone: "info" } });
    expect(findAll(checking, "Empty")).toEqual([]);

    scenario.authState = "error";
    scenario.refresh.mockReset();
    const errored = renderDirect(() => MessagesScreen());
    const retry = findAll(errored, "Empty").at(0);
    expect(retry?.props).toMatchObject({
      action: "Try again",
      title: "Your inbox is waiting.",
    });
    (retry?.props.onAction as () => void)();
    expect(scenario.refresh).toHaveBeenCalledTimes(1);
    expect(
      elementWithMessage(
        errored,
        "StatusMessage",
        "We couldn’t confirm your sign-in. Try again.",
      ),
    ).toMatchObject({ props: { tone: "error" } });

    scenario.authState = "guest";
    scenario.showLogin.mockReset();
    const guest = renderDirect(() => MessagesScreen());
    const signIn = findAll(guest, "Empty").at(0);
    expect(signIn?.props.action).toBe("Sign in");
    (signIn?.props.onAction as () => void)();
    expect(scenario.showLogin).toHaveBeenCalledTimes(1);
  });

  it("preserves full chat and post names, uses the semantic sender fill, and supplies announced photo fallback props", () => {
    scenario.authState = "authenticated";
    scenario.user = { id: 7, name: "Avery" };
    scenario.params = {
      id: "50",
      name: "A very long conversation name that should wrap instead of truncating",
    };
    scenario.messages = {
      data: {
        pages: [
          [
            {
              id: 1,
              conversationId: 50,
              author: post.author,
              text: "A message with a photo.",
              media: "https://images.example.test/photo.jpg",
              createdAt: post.createdAt,
              read: true,
            },
          ],
        ],
      },
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchNextPageError: false,
      isFetchingNextPage: false,
      isLoading: false,
      refetch: vi.fn(),
    };
    const chatInstance = renderFunctionElement(
      renderDirect(() => ChatScreen()),
    );
    const title = elementWithChild(chatInstance, "T", scenario.params.name);
    expect(title?.props.numberOfLines).toBeUndefined();
    const senderBubble = findAll(chatInstance, "View").find(
      (element) =>
        (element.props.style as { backgroundColor?: string } | undefined)
          ?.backgroundColor === "#A53728",
    );
    expect(senderBubble).toBeDefined();
    const chatPhoto = findAll(chatInstance, "Image").find(
      (element) => element.props.accessibilityLabel === "Photo attachment",
    );
    expect(chatPhoto?.props).toMatchObject({
      contentFit: "cover",
      retryLabel: "Retry photo",
      unavailableLabel: "Photo unavailable",
    });
    expect((chatPhoto?.props.unavailableContent as ReactElement)?.type).toBe(
      "StatusMessage",
    );

    stateHarness.reset([false, false, "", false, null, null]);
    const postTree = renderDirect(() => PostCard({ post }));
    const author = elementWithChild(postTree, "T", longAuthor);
    expect(author?.props.numberOfLines).toBeUndefined();
  });

  it("uses a noninteractive menu root with sibling backdrop, keeps pending menus open, and gates author actions", () => {
    scenario.authState = "authenticated";
    scenario.user = { id: 8, name: "Viewer" };
    scenario.report.isPending = true;
    stateHarness.reset([false, true, "", false, null, null]);
    const pendingMenuTree = renderDirect(() => PostCard({ post }));
    const pendingMenu = findAll(pendingMenuTree, "Modal").find(
      (element) => element.props.visible === true,
    );
    const root = directChildren(pendingMenu?.props.children as ReactNode).at(0);
    expect(root?.type).toBe("View");
    expect(root?.props.onPress).toBeUndefined();
    const rootChildren = directChildren(root?.props.children as ReactNode);
    const backdrop = rootChildren.find(
      (element) => element.type === "Pressable",
    );
    const sheet = rootChildren.find((element) => element.type === "View");
    expect(backdrop?.props).toMatchObject({
      accessible: false,
      disabled: true,
      importantForAccessibility: "no",
    });
    expect(sheet?.props.onPress).toBeUndefined();
    (pendingMenu?.props.onRequestClose as () => void)();
    expect(stateHarness.updates).toEqual([]);
    expect(
      findAll(sheet, "Button").map((button) => button.props.title),
    ).toEqual(["Close"]);

    scenario.user = { id: 7, name: "Avery" };
    scenario.report.isPending = false;
    stateHarness.reset([false, true, "", false, null, null]);
    const ownerPost = { ...post, circleId: 44, circleName: "Kindness" };
    const ownerMenuTree = renderDirect(() => PostCard({ post: ownerPost }));
    const ownerMenu = findAll(ownerMenuTree, "Modal").find(
      (element) => element.props.visible === true,
    );
    expect(
      findAll(ownerMenu, "Button").map((button) => button.props.title),
    ).toEqual(["Report inappropriate content", "Remove my moment", "Close"]);
  });
});
