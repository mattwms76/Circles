import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveD28008AuthPresentation } from "../lib/d28-008-auth-presentation";

const fixture = vi.hoisted(() => ({
  authState: "guest",
  user: null as { id: number; name: string } | null,
  refresh: vi.fn(),
  showLogin: vi.fn(),
  params: {
    mode: "post" as string | undefined,
    circleId: undefined as string | undefined,
    intro: undefined as string | undefined,
  },
  profile: {
    id: 71,
    name: "Ari",
    handle: "ari",
    bio: "A little about Ari.",
    avatar: null,
    cover: null,
    followers: 0,
    following: 0,
    isFollowing: false,
  },
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: <T>(callback: T) => callback,
    useEffect: () => undefined,
    useMemo: <T>(factory: () => T) => factory(),
    useRef: <T>(initialValue: T) => ({ current: initialValue }),
    useState: <T>(initialValue: T | (() => T)) => [
      typeof initialValue === "function"
        ? (initialValue as () => T)()
        : initialValue,
      vi.fn(),
    ],
  };
});

vi.mock("react-native", () => ({
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Modal: "Modal",
  Platform: { OS: "web" },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  View: "View",
  useWindowDimensions: () => ({
    width: 390,
    height: 844,
    scale: 1,
    fontScale: 1,
  }),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock("expo-constants", () => ({
  default: { executionEnvironment: "standalone" },
}));
vi.mock("expo-crypto", () => ({ randomUUID: vi.fn(() => "uuid") }));
vi.mock("expo-image-picker", () => ({ launchImageLibraryAsync: vi.fn() }));
vi.mock("expo-router", () => ({
  useFocusEffect: vi.fn(),
  useLocalSearchParams: () => fixture.params,
  useRouter: () => ({
    back: vi.fn(),
    canGoBack: () => true,
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));
vi.mock("../components/app-shell", () => ({ AppShell: "AppShell" }));
vi.mock("@/components/app-shell", () => ({ AppShell: "AppShell" }));
vi.mock("@/components/media-image", () => ({ Image: "Image" }));
vi.mock("../components/post-card", () => ({ PostCard: "PostCard" }));
vi.mock("@/components/recorded-video-preview", () => ({
  RecordedVideoPreview: "RecordedVideoPreview",
}));
vi.mock("@/components/screen-metadata", () => ({
  ScreenMetadata: "ScreenMetadata",
}));
vi.mock("../components/status-message", () => ({
  StatusMessage: "StatusMessage",
}));
vi.mock("@/components/status-message", () => ({
  StatusMessage: "StatusMessage",
}));
vi.mock("../components/user-avatar", () => ({ UserAvatar: "UserAvatar" }));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: "UserAvatar" }));
vi.mock("@/components/video-recorder", () => ({
  VideoRecorder: "VideoRecorder",
}));
vi.mock("../components/circles-ui", () => ({
  Button: "Button",
  C: {
    action: "#A53728",
    bg: "#F9F8F5",
    border: "#D0D3C8",
    ink: "#283126",
    muted: "#4D5948",
    paper: "#FFFFFF",
    sage: "#E9EEE5",
    secondary: "#4D5948",
  },
  Empty: "Empty",
  Heading: "Heading",
  Icon: "Icon",
  IconButton: "IconButton",
  Input: "Input",
  Loading: "Loading",
  photo: { coffee: "coffee", mountains: "mountains" },
  Pill: "Pill",
  s: { between: {}, card: {}, eyebrow: {}, row: {}, title: {} },
  T: "T",
  Wordmark: "Wordmark",
}));
vi.mock("@/components/circles-ui", () => ({
  Button: "Button",
  C: {
    action: "#A53728",
    bg: "#F9F8F5",
    border: "#D0D3C8",
    ink: "#283126",
    muted: "#4D5948",
    paper: "#FFFFFF",
    sage: "#E9EEE5",
    secondary: "#4D5948",
  },
  Empty: "Empty",
  Heading: "Heading",
  Icon: "Icon",
  IconButton: "IconButton",
  Input: "Input",
  Loading: "Loading",
  photo: { coffee: "coffee", mountains: "mountains" },
  Pill: "Pill",
  s: { between: {}, card: {}, eyebrow: {}, row: {}, title: {} },
  T: "T",
  Wordmark: "Wordmark",
}));
vi.mock("@/hooks/circles-context", () => ({
  useCircles: () => ({
    authState: fixture.authState,
    logout: vi.fn(),
    notify: vi.fn(),
    refresh: fixture.refresh,
    requireAuth: (action?: () => void) => action?.(),
    showLogin: fixture.showLogin,
    user: fixture.user,
  }),
}));
vi.mock("@/hooks/use-foreground-state", () => ({
  useForegroundState: () => true,
}));
vi.mock("@/lib/a26-directory-ui", () => ({
  getA26OwnProfileQueryInput: (id?: number) => ({ id }),
  isA26CurrentActorProfile: (actorId?: number, profileId?: number) =>
    actorId === profileId,
}));
vi.mock("@/lib/a26-paged-display", () => ({
  resolvePagedDisplayState: () => ({ kind: "empty", showRetainedError: false }),
}));
vi.mock("@/lib/a26-profile", () => ({
  A26_PROFILE_BIO_MAX_LENGTH: 2000,
  A26_PROFILE_HANDLE_MAX_LENGTH: 48,
  A26_PROFILE_NAME_MAX_LENGTH: 120,
  a26ProfileMomentStat: () => ({
    displayValue: "0",
    label: "moments",
    accessibilityLabel: "0 moments",
  }),
  a26ProfileStatsLayout: () => ({ container: {}, item: {} }),
  a26ProfileUpdateErrorMessage: () => "Unable to save.",
  flattenA26ProfilePages: () => [],
  formatA26ProfileStatCount: (value: number) => String(value),
  hasA26ProfileDraftErrors: () => false,
  normalizeA26ProfileDraft: (value: unknown) => value,
  validateA26ProfileDraft: () => ({}),
}));
vi.mock("@/lib/batch1-mutation-feedback", () => ({
  batch1OperationIdentityMatches: () => false,
  batch1OperationKey: () => "scope",
  createBatch1OperationGuard: () => ({ isActive: () => false, run: vi.fn() }),
  createBatch1OperationInstance: () => ({
    activate: () => null,
    createIdentity: () => ({ instanceId: 1 }),
    deactivate: vi.fn(),
    isCurrent: () => false,
  }),
}));
vi.mock("@/lib/control-accessibility", () => ({
  controlAccessibilityProps: () => ({}),
}));
vi.mock("@/lib/design31-create", () => ({
  canPublishToCreateRecipient: () => true,
  canRetryCreateRecipient: () => false,
  createRootSafeAreaInsets: () => ({}),
  resolveCreateRecipient: () => ({ kind: "everyone" }),
}));
vi.mock("@/lib/feed-ui-helpers", () => ({
  isCircleCoverMime: () => true,
  mediaUploadKey: () => "media-key",
  normalizeCreateMode: (mode?: string | string[]) =>
    mode === "circle" || mode === "live" ? mode : "post",
  parsePositiveSafeId: () => undefined,
  reusableUploadUrl: () => undefined,
  validateComposerDraft: () => null,
}));
vi.mock("@/lib/media", () => ({
  assetBase64: vi.fn(),
  supportedMime: () => "image/jpeg",
}));
vi.mock("@/lib/onboarding-introduction", () => ({
  canPrefillIntroduction: () => false,
}));
vi.mock("@/lib/platform-feature-ui", () => ({
  platformCreationIssue: () => null,
  platformUploadLimitMb: () => 25,
}));
vi.mock("@/lib/post-publish-attempt", () => ({
  createPostPublishAttemptTracker: () => ({
    clear: vi.fn(),
    isUnsettled: () => false,
    markSubmitted: vi.fn(),
    prepare: () => ({}),
    reject: vi.fn(),
  }),
  shouldKeepPostPublishAttemptUnsettled: () => false,
}));
vi.mock("@/lib/post-publish-error", () => ({
  postPublishErrorMessage: () => "Unable to publish.",
}));
vi.mock("@/lib/recorded-video-files", () => ({
  deleteRecordedVideo: vi.fn(),
  recordedVideoBase64: vi.fn(),
}));
vi.mock("@/lib/source-query-invalidation", () => ({
  invalidateCircleDirectories: vi.fn(),
  invalidatePostFeeds: vi.fn(),
  invalidateProfileViews: vi.fn(),
}));
vi.mock("@/shared/onboarding", () => ({ INTRODUCTION_DRAFT: "Welcome!" }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    live: { create: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
    onboarding: {
      introductionTarget: {
        useQuery: () => ({
          data: undefined,
          isError: false,
          isFetchedAfterMount: false,
          isFetching: false,
        }),
      },
    },
    platform: {
      status: {
        useQuery: () => ({ data: undefined, isError: false, refetch: vi.fn() }),
      },
    },
    social: {
      circles: {
        useQuery: () => ({
          data: [],
          isError: false,
          isFetching: false,
          isPending: false,
          refetch: vi.fn(),
        }),
      },
      createCircle: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      createPost: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      feedPage: {
        useInfiniteQuery: () => ({
          data: { pages: [{ items: [], nextCursor: null }] },
          error: undefined,
          fetchNextPage: vi.fn(),
          hasNextPage: false,
          isError: false,
          isFetchingNextPage: false,
          isFetchNextPageError: false,
          isLoading: false,
          isRefetchError: false,
          isRefetching: false,
          refetch: vi.fn(),
        }),
      },
      follow: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      openDirect: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      profile: {
        useQuery: () => ({
          data: fixture.profile,
          isError: false,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      publicationStatus: {
        useQuery: () => ({
          data: { ready: true },
          isError: false,
          isFetchedAfterMount: true,
          isFetching: false,
          refetch: vi.fn(),
        }),
      },
      updateProfile: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      upload: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    useUtils: () => ({}),
  },
}));

const { default: ProfileScreen } = await import("../components/profile-screen");
const { default: EmailConfirmationScreen } =
  await import("../app/account/confirmed");
const { default: CreateScreen } = await import("../app/create");

type Element = ReactElement<Record<string, unknown>>;

function elements(node: ReactNode): Element[] {
  const result: Element[] = [];
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    result.push(child);
    result.push(...elements(child.props.children as ReactNode));
  }
  return result;
}

function findElement(
  node: ReactNode,
  type: string,
  predicate: (element: Element) => boolean = () => true,
) {
  return elements(node).find(
    (element) => element.type === type && predicate(element),
  );
}

function renderCreateScreen(): ReactNode {
  const accountBoundary = CreateScreen();
  if (
    !isValidElement<Record<string, unknown>>(accountBoundary) ||
    typeof accountBoundary.type !== "function"
  ) {
    throw new Error("CreateScreen must retain its account-keyed boundary.");
  }
  return (accountBoundary.type as () => ReactNode)();
}

function setAuth(authState: string) {
  fixture.authState = authState;
  fixture.user = authState === "authenticated" ? { id: 71, name: "Ari" } : null;
}

beforeEach(() => {
  fixture.refresh.mockReset();
  fixture.showLogin.mockReset();
  fixture.params.mode = "post";
  fixture.params.circleId = undefined;
  fixture.params.intro = undefined;
  setAuth("guest");
});

describe("D28-008 auth presentation resolver", () => {
  it.each([
    ["checking", false, "checking"],
    ["error", false, "error"],
    ["guest", false, "guest"],
    ["authenticated", true, "authenticated"],
  ])(
    "maps %s without treating it as a settled guest",
    (state, hasUser, expected) => {
      expect(resolveD28008AuthPresentation(state, hasUser)).toBe(expected);
    },
  );
});

describe("D28-008 actual profile source", () => {
  it("keeps own-profile checking, error/retry, guest, and authenticated presentations distinct", () => {
    setAuth("checking");
    expect(findElement(ProfileScreen({}), "Loading")).toBeDefined();

    setAuth("error");
    const error = findElement(
      ProfileScreen({}),
      "Empty",
      (element) =>
        element.props.title === "We couldn’t confirm your sign-in." &&
        element.props.action === "Try again",
    );
    expect(error).toBeDefined();
    (error?.props.onAction as () => void)();
    expect(fixture.refresh).toHaveBeenCalledOnce();

    setAuth("guest");
    expect(
      findElement(
        ProfileScreen({}),
        "Empty",
        (element) => element.props.action === "Make yourself at home",
      ),
    ).toBeDefined();

    setAuth("authenticated");
    expect(
      findElement(
        ProfileScreen({}),
        "View",
        (element) => element.props.testID === "profile-hero",
      ),
    ).toBeDefined();
  });

  it("leaves another person’s public profile outside the own-profile auth boundary", () => {
    setAuth("checking");
    expect(
      findElement(ProfileScreen({ personId: 71 }), "Loading"),
    ).toBeUndefined();
  });
});

describe("D28-008 actual email-confirmation source", () => {
  it("keeps checking, error/retry, guest, and authenticated presentations distinct", () => {
    setAuth("checking");
    expect(findElement(EmailConfirmationScreen(), "Loading")).toBeDefined();

    setAuth("error");
    const error = findElement(
      EmailConfirmationScreen(),
      "Empty",
      (element) =>
        element.props.title === "We couldn’t confirm your sign-in." &&
        element.props.action === "Try again",
    );
    expect(error).toBeDefined();
    (error?.props.onAction as () => void)();
    expect(fixture.refresh).toHaveBeenCalledOnce();

    setAuth("guest");
    expect(
      findElement(
        EmailConfirmationScreen(),
        "Button",
        (element) => element.props.title === "Sign in to Circles",
      ),
    ).toBeDefined();

    setAuth("authenticated");
    expect(
      findElement(
        EmailConfirmationScreen(),
        "Heading",
        (element) => element.props.children === "You’re already signed in.",
      ),
    ).toBeDefined();
  });
});

describe("D28-008 actual Create source", () => {
  it("keeps checking, error/retry, guest, and authenticated presentations distinct", () => {
    setAuth("checking");
    expect(findElement(renderCreateScreen(), "Loading")).toBeDefined();

    setAuth("error");
    const error = findElement(
      renderCreateScreen(),
      "Empty",
      (element) =>
        element.props.title === "We couldn’t confirm your sign-in." &&
        element.props.action === "Try again",
    );
    expect(error).toBeDefined();
    (error?.props.onAction as () => void)();
    expect(fixture.refresh).toHaveBeenCalledOnce();

    setAuth("guest");
    expect(
      findElement(
        renderCreateScreen(),
        "Empty",
        (element) => element.props.action === "Sign in",
      ),
    ).toBeDefined();

    setAuth("authenticated");
    expect(findElement(renderCreateScreen(), "UserAvatar")).toBeDefined();
  });
});
