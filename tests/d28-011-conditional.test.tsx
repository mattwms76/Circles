import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stateHarness = vi.hoisted(() => ({
  cursor: 0,
  reset() {
    this.cursor = 0;
  },
}));

const scenario = vi.hoisted(() => ({
  authState: "guest" as "checking" | "authenticated" | "guest" | "error",
  user: null as { id: number; name: string | null } | null,
  refresh: vi.fn(),
  showLogin: vi.fn(),
  router: {
    back: vi.fn(),
    canGoBack: vi.fn(() => true),
    replace: vi.fn(),
  },
  messages: {
    data: { pages: [[]] } as { pages: unknown[][] } | undefined,
    dataUpdatedAt: 0,
    error: null as Error | null,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isError: false,
    isFetchNextPageError: false,
    isFetchingNextPage: false,
    isLoading: false,
    refetch: vi.fn(),
  },
  conversations: {
    data: [{ id: 50, name: "A conversation" }],
    dataUpdatedAt: 0,
    error: null as Error | null,
    isError: false,
  },
  mutation: {
    isPending: false,
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
    useRef: (initialValue: unknown) => ({ current: initialValue }),
    useState: (initialValue: unknown | (() => unknown)) => {
      stateHarness.cursor += 1;
      const value =
        typeof initialValue === "function" ? initialValue() : initialValue;
      return [value, vi.fn()] as const;
    },
  };
});

vi.mock("react-native", () => ({
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Platform: { OS: "web" },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  View: "View",
  useWindowDimensions: () => ({ width: 320, height: 640 }),
}));
vi.mock("expo-image-picker", () => ({ launchImageLibraryAsync: vi.fn() }));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "50" }),
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
  useSafeAreaInsets: () => ({ bottom: 10, left: 0, right: 0 }),
}));
vi.mock("@/hooks/circles-context", () => ({
  useCircles: () => ({
    authState: scenario.authState,
    notify: vi.fn(),
    refresh: scenario.refresh,
    showLogin: scenario.showLogin,
    user: scenario.user,
  }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    social: {
      conversations: { useQuery: () => scenario.conversations },
      markRead: { useMutation: () => scenario.mutation },
      messages: { useInfiniteQuery: () => scenario.messages },
      sendMessage: { useMutation: () => scenario.mutation },
      upload: { useMutation: () => scenario.mutation },
    },
    useUtils: () => ({ social: { conversations: { invalidate: vi.fn() } } }),
  },
}));
vi.mock("@/lib/a26-messaging-state", () => ({
  authorizedConversationMetadata: (
    conversations: { id: number; name: string }[] | undefined,
    conversationId: number,
  ) =>
    conversations?.find((conversation) => conversation.id === conversationId),
  isDefinitiveMessageApplicationError: () => false,
  MAX_MESSAGE_TEXT_LENGTH: 10_000,
  messageTextIsWithinLimit: () => true,
  positiveSafeConversationId: (id: string | string[] | undefined) =>
    typeof id === "string" && /^\d+$/.test(id) && Number(id) > 0
      ? Number(id)
      : null,
}));
vi.mock("@/lib/d28-010-chat-media", () => ({
  d28_010ChatAttachmentWidth: () => 220,
}));
vi.mock("@/components/app-shell", () => ({ AppShell: "AppShell" }));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: "UserAvatar" }));
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
  C: {
    action: "#A53728",
    actionText: "#FFFFFF",
    bg: "#F9F8F5",
    border: "#E8E9E2",
    green: "#718569",
    ink: "#242825",
    muted: "#4D5948",
    paper: "#FFFFFF",
    secondary: "#4D5948",
  },
  Empty: "Empty",
  Icon: "Icon",
  IconButton: "IconButton",
  Loading: "Loading",
  s: { row: {} },
  T: "T",
}));
vi.mock("@/lib/media", () => ({
  assetBase64: vi.fn(),
  supportedMime: vi.fn(),
}));
vi.mock("@/lib/message-composition", () => ({
  createMessageCompositionRetryId: () => "retry-id",
  readReceiptRetryDelayMs: () => null,
}));
vi.mock("@/shared/message-pagination", () => ({
  mergeMessageHistoryPages: (pages: unknown[][]) => pages.flat(),
  MESSAGE_PAGE_DEFAULT_LIMIT: 100,
  olderMessagePageCursor: () => undefined,
}));
vi.mock("@/lib/batch2-message-accessibility", () => ({
  canSendMessage: (text: string, hasAttachment: boolean) =>
    hasAttachment || text.trim().length > 0,
  createMessageCompositionSingleFlight: () => ({
    finish: vi.fn(),
    isActive: false,
    start: () => true,
  }),
  isCurrentMessageCompositionOperation: () => true,
}));

const { default: ChatScreen } = await import("../app/chat/[id]");

type TreeElement = ReactElement<Record<string, unknown>>;

function directChildren(node: ReactNode): TreeElement[] {
  return Children.toArray(node).filter(isValidElement) as TreeElement[];
}

function findAll(node: ReactNode, type: string): TreeElement[] {
  const found: TreeElement[] = [];
  for (const child of directChildren(node)) {
    if (child.type === type) found.push(child);
    found.push(...findAll(child.props.children as ReactNode, type));
  }
  return found;
}

function findFunction(node: ReactNode, name: string): TreeElement | undefined {
  for (const child of directChildren(node)) {
    if (typeof child.type === "function" && child.type.name === name) {
      return child;
    }
    const nested = findFunction(child.props.children as ReactNode, name);
    if (nested) return nested;
  }
  return undefined;
}

function renderFunctionElement(node: ReactNode): TreeElement {
  if (!isValidElement(node) || typeof node.type !== "function") {
    throw new Error("Expected a function component element.");
  }
  const component = node.type as (
    props: Record<string, unknown>,
  ) => ReactElement<Record<string, unknown>>;
  return component(node.props as Record<string, unknown>);
}

function renderChat(): TreeElement {
  stateHarness.reset();
  return renderFunctionElement(ChatScreen());
}

function recoveryScroll(tree: ReactNode): TreeElement {
  const recovery = findFunction(tree, "ChatGuardRecovery");
  expect(recovery).toBeDefined();
  const scroll = renderFunctionElement(recovery);
  expect(scroll.type).toBe("ScrollView");
  expect(scroll.props).toMatchObject({
    style: { flex: 1 },
    contentContainerStyle: {
      flexGrow: 1,
      justifyContent: "center",
      paddingTop: 24,
      paddingHorizontal: 24,
      paddingBottom: 34,
    },
    keyboardShouldPersistTaps: "handled",
    showsHorizontalScrollIndicator: false,
    showsVerticalScrollIndicator: false,
  });
  return scroll;
}

function resetScenario() {
  stateHarness.reset();
  scenario.authState = "guest";
  scenario.user = null;
  scenario.refresh.mockReset();
  scenario.showLogin.mockReset();
  scenario.messages = {
    data: { pages: [[]] },
    dataUpdatedAt: 0,
    error: null,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isError: false,
    isFetchNextPageError: false,
    isFetchingNextPage: false,
    isLoading: false,
    refetch: vi.fn(),
  };
  scenario.conversations = {
    data: [{ id: 50, name: "A conversation" }],
    dataUpdatedAt: 0,
    error: null,
    isError: false,
  };
}

describe("D28-011 chat guard overflow recovery", () => {
  beforeEach(resetScenario);

  it("scrolls the checking guard beneath the chat header", () => {
    scenario.authState = "checking";
    const scroll = recoveryScroll(renderChat());
    expect(findAll(scroll, "StatusMessage")).toMatchObject([
      { props: { message: "Checking your sign-in…", tone: "info" } },
    ]);
  });

  it("scrolls the auth-error recovery and retains its Try again action", () => {
    scenario.authState = "error";
    const scroll = recoveryScroll(renderChat());
    const recovery = findAll(scroll, "Empty").at(0);
    expect(recovery?.props).toMatchObject({
      action: "Try again",
      title: "Your conversation is waiting.",
    });
    (recovery?.props.onAction as () => void)();
    expect(scenario.refresh).toHaveBeenCalledTimes(1);
  });

  it("scrolls the direct guest sign-in guard and retains its action", () => {
    const scroll = recoveryScroll(renderChat());
    const guest = findAll(scroll, "Empty").at(0);
    expect(guest?.props).toMatchObject({
      action: "Sign in",
      title: "Your conversations are private.",
    });
    (guest?.props.onAction as () => void)();
    expect(scenario.showLogin).toHaveBeenCalledTimes(1);
  });

  it("scrolls the authenticated-without-actor recovery", () => {
    scenario.authState = "authenticated";
    const scroll = recoveryScroll(renderChat());
    expect(findAll(scroll, "Empty").at(0)?.props).toMatchObject({
      action: "Try again",
      title: "Your sign-in needs another check.",
    });
  });

  it("scrolls the protected-chat loading state", () => {
    scenario.authState = "authenticated";
    scenario.user = { id: 7, name: "Avery" };
    scenario.messages.isLoading = true;
    const scroll = recoveryScroll(renderChat());
    expect(findAll(scroll, "Loading")).toHaveLength(1);
  });

  it("scrolls the unavailable recovery after an unstructured transcript failure", () => {
    scenario.authState = "authenticated";
    scenario.user = { id: 7, name: "Avery" };
    scenario.messages.error = new Error("Network unavailable");
    const scroll = recoveryScroll(renderChat());
    expect(findAll(scroll, "Empty").at(0)?.props).toMatchObject({
      action: "Back to inbox",
      title: "This conversation is unavailable.",
    });
  });

  it("leaves the authenticated transcript as its existing scroll and pinned composer path", () => {
    scenario.authState = "authenticated";
    scenario.user = { id: 7, name: "Avery" };
    const chat = renderChat();
    expect(findFunction(chat, "ChatGuardRecovery")).toBeUndefined();
    const transcript = findAll(chat, "ScrollView").at(0);
    expect(transcript?.props).toMatchObject({
      keyboardDismissMode: "interactive",
      keyboardShouldPersistTaps: "handled",
      contentContainerStyle: { flexGrow: 1, padding: 22 },
    });
    expect(findAll(chat, "TextInput")).toHaveLength(1);
  });
});
