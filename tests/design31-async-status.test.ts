import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  moderationDetail: null as Record<string, unknown> | null,
  params: {} as { code?: string; state?: string; error?: string },
  platform: "web",
  replace: vi.fn(),
  resolveMutation: vi.fn(),
  stateCursor: 0,
  stateValues: [] as unknown[],
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: <Value>(callback: Value) => callback,
    useEffect: (effect: () => void | (() => void)) => {
      runtime.effects.push(effect);
    },
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
      const setValue = vi.fn(
        (nextValue: Value | ((previous: Value) => Value)) => {
          runtime.stateValues[index] =
            typeof nextValue === "function"
              ? (nextValue as (previous: Value) => Value)(value)
              : nextValue;
        },
      );
      return [value, setValue] as const;
    },
  };
});

vi.mock("react-native", () => ({
  AccessibilityInfo: {},
  ActivityIndicator: "ActivityIndicator",
  Alert: { alert: vi.fn() },
  Platform: {
    get OS() {
      return runtime.platform;
    },
  },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: <Value>(styles: Value) => styles },
  TextInput: "TextInput",
  View: "View",
}));

vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));

vi.mock("expo-router", () => ({
  useLocalSearchParams: () => runtime.params,
  useRouter: () => ({ replace: runtime.replace }),
}));

vi.mock("expo-linking", () => ({ getInitialURL: vi.fn() }));

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
  Loading: "Loading",
  s: { card: {}, eyebrow: {}, title: {} },
  T: "T",
}));

vi.mock("../components/circles-ui", () => ({
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
  Loading: "Loading",
  s: { card: {}, eyebrow: {}, title: {} },
  T: "T",
}));

vi.mock("@/components/post-card", () => ({ PostCard: "PostCard" }));

vi.mock(
  "@/components/status-message",
  async () => import("../components/status-message"),
);

vi.mock("@/constants/oauth", () => ({
  clearNativeOAuthFlowToken: vi.fn(),
  getApiBaseUrl: vi.fn(),
  getNativeOAuthFlowToken: vi.fn(),
}));

vi.mock("@/hooks/circles-context", () => ({
  useCircles: () => ({ completeNativeLogin: vi.fn() }),
}));

vi.mock("@/hooks/native-login-transition", () => ({
  cleanupFailedNativeLoginConfirmation: vi.fn(),
  clearCapturedNativeCredentialsIfCurrent: vi.fn(),
  persistNativeBearerAfterEmailAuthDrain: vi.fn(),
}));

vi.mock("@/lib/_core/api", () => ({ logout: vi.fn() }));

vi.mock("@/lib/_core/auth", () => ({
  clearUserInfo: vi.fn(),
  getSessionToken: vi.fn(),
  removeSessionToken: vi.fn(),
  setSessionToken: vi.fn(),
}));

vi.mock("@/lib/email-auth-client", () => ({
  cancelAndDrainEmailAuthRequests: vi.fn(),
}));

vi.mock("@/shared/moderation", () => ({
  MODERATION_NOTE_MAX: 500,
  MODERATION_PAGE_DEFAULT: 20,
  moderationTextLength: (value: string) => Array.from(value).length,
}));

vi.mock("@/lib/moderation-ui", () => ({
  boundModerationNote: (value: string) => value,
  isConfirmedModerationAuthorityLoss: () => false,
  isCurrentModerationScope: () => true,
  moderationDecisionLabel: (decision: string) => decision,
  moderationScopeKey: ({
    circleId,
    viewerScope,
  }: {
    circleId: number;
    viewerScope: number;
  }) => `moderation:${circleId}:${viewerScope}`,
  resolveModerationDetailUiState: ({ detail }: { detail: unknown }) => ({
    detail,
    isAuthorityAvailable: true,
    isError: false,
    isLoading: false,
  }),
  resolveModerationPagesUiState: () => ({
    isAuthorityAvailable: true,
    isError: false,
    isLoading: false,
    items: [],
    pages: [],
  }),
  serializeModerationNote: (value: string) => value,
  validateModerationNote: () => undefined,
}));

vi.mock("@/lib/source-query-invalidation", () => ({
  invalidateModerationViews: vi.fn(),
  invalidatePostFeeds: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    moderation: {
      detail: {
        useQuery: () => ({
          data: runtime.moderationDetail,
          error: undefined,
          isError: false,
          isFetchedAfterMount: true,
          isFetching: false,
          refetch: vi.fn(),
        }),
      },
      list: {
        useInfiniteQuery: () => ({
          data: { pages: [] },
          isError: false,
          isFetchedAfterMount: true,
          isFetching: false,
          isFetchingNextPage: false,
          fetchNextPage: vi.fn(),
          refetch: vi.fn(),
        }),
      },
      resolve: {
        useMutation: () => ({ mutateAsync: runtime.resolveMutation }),
      },
    },
    useUtils: () => ({}),
  },
}));

const { StatusMessage } = await import("../components/status-message");
const { ModerationWorkspace } =
  await import("../components/moderation-workspace");
const { default: OAuthCallback } = await import("../app/oauth/callback");

type ElementLike = {
  props?: { children?: unknown; [key: string]: unknown };
  type?: unknown;
};

function resetRenderState(values: unknown[]) {
  runtime.effects.length = 0;
  runtime.platform = "web";
  runtime.replace.mockReset();
  runtime.stateCursor = 0;
  runtime.stateValues = values;
}

function elementsOfType(node: unknown, type: unknown): ElementLike[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => elementsOfType(child, type));
  }
  if (!node || typeof node !== "object") return [];

  const element = node as ElementLike;
  const children = elementsOfType(element.props?.children, type);
  return element.type === type ? [element, ...children] : children;
}

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (!node || typeof node !== "object") return "";
  return textContent((node as ElementLike).props?.children);
}

function renderSharedStatus(statusElement: ElementLike) {
  resetRenderState([]);
  return StatusMessage(
    statusElement.props as Parameters<typeof StatusMessage>[0],
  );
}

function moderationStatusElement(
  message: string,
  tone: "info" | "success" | "error",
) {
  resetRenderState(["open", 17, "", { message, tone }, null, false, null]);
  const workspace = ModerationWorkspace({
    circleId: 42,
    viewerId: 7,
    onBack: vi.fn(),
  });
  const statusElements = elementsOfType(workspace, StatusMessage);
  expect(statusElements).toHaveLength(1);
  return statusElements[0]!;
}

function renderCurrentModerationWorkspace() {
  resetRenderState(["open", 17, "", null, null, false, null]);
  const workspace = ModerationWorkspace({
    circleId: 42,
    viewerId: 7,
    onBack: vi.fn(),
  });
  for (const effect of runtime.effects) effect();
  return workspace;
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

const fullAuthorName =
  "Dr. Amélie Nørgaard-Ramírez, Community Archaeology Coordinator";

beforeEach(() => {
  runtime.resolveMutation.mockReset();
  runtime.resolveMutation.mockResolvedValue(undefined);
  runtime.moderationDetail = {
    circleId: 42,
    history: [],
    item: {
      blockedReason: null,
      canResolve: true,
      circleId: 42,
      createdAt: "2026-10-26T12:00:00.000Z",
      id: 17,
      lastReportedAt: "2026-10-26T12:01:00.000Z",
      postId: 19,
      reportCount: 2,
      resolvedAt: null,
      status: "open",
    },
    post: {
      author: {
        avatar: "",
        bio: "",
        followers: 0,
        following: 0,
        handle: "amelie",
        id: 9,
        name: fullAuthorName,
      },
      circleId: 42,
      circleName: "Neighborhood history",
      comments: 0,
      createdAt: "2026-10-26T12:00:00.000Z",
      id: 19,
      liked: false,
      likes: 0,
      media: null,
      mediaType: "text",
      saved: false,
      text: "Reported moment",
    },
    reasons: [],
    viewerScope: 7,
  };
  runtime.params = {};
});

describe("D26-07 local async feedback and D26-14 moderation author disclosure", () => {
  it("renders each OAuth callback state through one shared status and retains its named recovery control", () => {
    resetRenderState(["processing", null]);
    const processing = elementsOfType(OAuthCallback(), StatusMessage);
    expect(processing).toHaveLength(1);
    expect(processing[0]?.props).toMatchObject({
      message: "Completing secure sign-in…",
      testID: "oauth-callback-status",
    });
    expect(renderSharedStatus(processing[0]!)?.props).toMatchObject({
      "aria-live": "polite",
      children: "Completing secure sign-in…",
    });

    resetRenderState(["success", null]);
    const success = elementsOfType(OAuthCallback(), StatusMessage);
    expect(success).toHaveLength(1);
    expect(success[0]?.props).toMatchObject({
      message: "Signed in. Opening your circles…",
      tone: "success",
    });
    expect(renderSharedStatus(success[0]!)?.props).toMatchObject({
      "aria-live": "polite",
      children: "Signed in. Opening your circles…",
    });

    const recoveryMessage =
      "This sign-in link is no longer valid. Please return to Circles and try again.";
    resetRenderState(["error", recoveryMessage]);
    const errorScreen = OAuthCallback();
    const errorStatus = elementsOfType(errorScreen, StatusMessage);
    expect(errorStatus).toHaveLength(1);
    expect(errorStatus[0]?.props).toMatchObject({
      message: recoveryMessage,
      tone: "error",
      testID: "oauth-callback-status",
    });
    expect(renderSharedStatus(errorStatus[0]!)?.props).toMatchObject({
      accessibilityRole: "alert",
      "aria-live": "assertive",
      children: recoveryMessage,
    });

    const errorHeadings = elementsOfType(errorScreen, "T").filter(
      (element) => textContent(element) === "Authentication failed",
    );
    expect(errorHeadings).toHaveLength(1);
    expect(errorHeadings[0]?.props?.accessibilityRole).toBe("header");

    const recoveryButtons = elementsOfType(errorScreen, "Button").filter(
      (element) => element.props?.title === "Back to Circles",
    );
    expect(recoveryButtons).toHaveLength(1);
    (recoveryButtons[0]?.props?.onPress as () => void)();
    expect(runtime.replace).toHaveBeenCalledWith("/");
  });

  it("uses one shared local moderation status for progress, success, and recoverable error", () => {
    const progress = moderationStatusElement(
      "Recording Keep decision…",
      "info",
    );
    expect(progress.props).toMatchObject({
      message: "Recording Keep decision…",
      testID: "moderation-resolution-status",
      tone: "info",
    });
    expect(renderSharedStatus(progress)?.props).toMatchObject({
      "aria-live": "polite",
      children: "Recording Keep decision…",
    });

    const success = moderationStatusElement(
      "Keep decision recorded.",
      "success",
    );
    expect(renderSharedStatus(success)?.props).toMatchObject({
      "aria-live": "polite",
      children: "Keep decision recorded.",
    });

    const failure = moderationStatusElement(
      "We couldn’t record that decision. Please try again.",
      "error",
    );
    expect(renderSharedStatus(failure)?.props).toMatchObject({
      accessibilityRole: "alert",
      "aria-live": "assertive",
      children: "We couldn’t record that decision. Please try again.",
    });
  });

  it("wires Keep resolution progress, fresh success, and generic recoverable failure through the local status", async () => {
    const successWorkspace = renderCurrentModerationWorkspace();
    const keepButtons = elementsOfType(successWorkspace, "Button").filter(
      (element) => element.props?.title === "Keep moment",
    );
    expect(keepButtons).toHaveLength(1);
    (keepButtons[0]?.props?.onPress as () => void)();

    expect(runtime.resolveMutation).toHaveBeenCalledWith({
      caseId: 17,
      circleId: 42,
      decision: "keep",
      note: "",
      viewerScope: 7,
    });
    expect(runtime.stateValues[3]).toEqual({
      message: "Recording Keep decision…",
      tone: "info",
    });

    await flushMicrotasks();
    expect(runtime.stateValues[3]).toEqual({
      message: "Keep decision recorded.",
      tone: "success",
    });

    runtime.resolveMutation.mockRejectedValueOnce(
      new Error("synthetic private provider detail"),
    );
    const failureWorkspace = renderCurrentModerationWorkspace();
    const retryKeepButton = elementsOfType(failureWorkspace, "Button").find(
      (element) => element.props?.title === "Keep moment",
    );
    expect(retryKeepButton).toBeDefined();
    (retryKeepButton?.props?.onPress as () => void)();

    await flushMicrotasks();
    expect(runtime.stateValues[3]).toEqual({
      message: "We couldn’t record that decision. Please try again.",
      tone: "error",
    });
  });

  it("visibly and programmatically discloses the complete reported author name without a line cap", () => {
    resetRenderState([
      "open",
      17,
      "",
      { message: "Recording Keep decision…", tone: "info" },
      null,
      false,
      null,
    ]);
    const renderedWorkspace = ModerationWorkspace({
      circleId: 42,
      viewerId: 7,
      onBack: vi.fn(),
    });
    const authorDisclosures = elementsOfType(renderedWorkspace, "T").filter(
      (element) =>
        element.props?.accessibilityLabel ===
        `Reported moment by ${fullAuthorName}`,
    );

    expect(authorDisclosures).toHaveLength(1);
    expect(textContent(authorDisclosures[0])).toBe(
      `Reported moment by ${fullAuthorName}`,
    );
    expect(authorDisclosures[0]?.props?.numberOfLines).toBeUndefined();
    expect(authorDisclosures[0]?.props?.ellipsizeMode).toBeUndefined();
  });
});
