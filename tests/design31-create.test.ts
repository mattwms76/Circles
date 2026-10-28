import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canPublishToCreateRecipient,
  canRetryCreateRecipient,
  createRootSafeAreaInsets,
  resolveCreateRecipient,
} from "../lib/design31-create";
vi.mock("@/components/screen-metadata", () => ({
  ScreenMetadata: "ScreenMetadata",
}));
vi.mock("../components/screen-metadata", () => ({
  ScreenMetadata: "ScreenMetadata",
}));

const fixture = vi.hoisted(() => ({
  params: {
    mode: "post" as string | undefined,
    circleId: "12" as string | undefined,
    intro: undefined as string | undefined,
  },
  publicationReady: true,
  publicationFetched: true,
  circles: {
    data: undefined as
      | { id: number; name: string; joined?: boolean }[]
      | undefined,
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  },
  foreground: true,
  platformOS: "web" as "ios" | "web",
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
  AppState: { currentState: "active", addEventListener: vi.fn() },
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Modal: "Modal",
  Platform: {
    get OS() {
      return fixture.platformOS;
    },
  },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  View: "View",
}));
vi.mock("expo-constants", () => ({
  default: { executionEnvironment: "standalone" },
}));
vi.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: vi.fn(),
}));
vi.mock("expo-crypto", () => ({ randomUUID: vi.fn() }));
vi.mock("@/components/video-recorder", () => ({
  VideoRecorder: "VideoRecorder",
}));
vi.mock("@/components/recorded-video-preview", () => ({
  RecordedVideoPreview: "RecordedVideoPreview",
}));
vi.mock("@/lib/recorded-video-files", () => ({
  deleteRecordedVideo: vi.fn(),
  recordedVideoBase64: vi.fn(),
}));
vi.mock("expo-router", () => ({
  useFocusEffect: vi.fn(),
  useLocalSearchParams: () => fixture.params,
  useRouter: () => ({
    back: vi.fn(),
    canGoBack: () => true,
    replace: vi.fn(),
  }),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 7, right: 29, bottom: 11, left: 3 }),
}));
vi.mock("@/components/media-image", () => ({ Image: "Image" }));
vi.mock("@/components/status-message", () => ({
  StatusMessage: "StatusMessage",
}));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: "UserAvatar" }));
vi.mock("@/lib/design31-create", async () => import("../lib/design31-create"));
vi.mock(
  "@/lib/post-publish-attempt",
  async () => import("../lib/post-publish-attempt"),
);
vi.mock(
  "@/lib/post-publish-error",
  async () => import("../lib/post-publish-error"),
);
vi.mock("@/components/circles-ui", () => ({
  Button: "Button",
  C: {
    action: "#A53728",
    bg: "#F9F8F5",
    border: "#D0D3C8",
    green: "#718569",
    ink: "#283126",
    muted: "#4D5948",
    paper: "#FFFFFF",
    sage: "#E9EEE5",
    secondary: "#4D5948",
  },
  Empty: "Empty",
  Icon: "Icon",
  IconButton: "IconButton",
  Input: "Input",
  photo: { coffee: "coffee", mountains: "mountains" },
  s: {
    between: {},
    card: {},
    eyebrow: {},
    row: {},
    title: {},
  },
  T: "T",
  Heading: "T",
  Wordmark: "Wordmark",
}));
vi.mock("@/hooks/circles-context", () => ({
  useCircles: () => ({
    authState: "authenticated",
    notify: vi.fn(),
    requireAuth: (action?: () => void) => {
      action?.();
      return true;
    },
    showLogin: vi.fn(),
    user: { id: 71, name: "Ari" },
  }),
}));
vi.mock("@/hooks/use-foreground-state", () => ({
  useForegroundState: () => fixture.foreground,
}));
vi.mock("@/lib/batch1-mutation-feedback", () => ({
  batch1OperationIdentityMatches: () => false,
  batch1OperationKey: () => "scope",
  createBatch1OperationGuard: () => ({
    isActive: () => false,
    run: vi.fn(),
  }),
  createBatch1OperationInstance: () => ({
    activate: () => null,
    createIdentity: () => ({ instanceId: 1 }),
    deactivate: vi.fn(),
    isCurrent: () => false,
  }),
}));
vi.mock("@/lib/feed-ui-helpers", () => ({
  isCircleCoverMime: () => true,
  mediaUploadKey: () => "media-key",
  normalizeCreateMode: (mode?: string | string[]) =>
    mode === "circle" || mode === "live" ? mode : "post",
  parsePositiveSafeId: (value?: string | string[]) => {
    const parsed = Number(Array.isArray(value) ? value[0] : value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  },
  reusableUploadUrl: () => undefined,
  validateComposerDraft: () => null,
}));
vi.mock("@/lib/media", () => ({
  assetBase64: vi.fn(),
  supportedMime: () => "image/jpeg",
}));
vi.mock("@/shared/onboarding", () => ({ INTRODUCTION_DRAFT: "Welcome!" }));
vi.mock("@/lib/onboarding-introduction", () => ({
  canPrefillIntroduction: () => false,
}));
vi.mock("@/lib/source-query-invalidation", () => ({
  invalidateCircleDirectories: vi.fn(),
  invalidatePostFeeds: vi.fn(),
}));
vi.mock("@/lib/platform-feature-ui", () => ({
  platformCreationIssue: () => null,
  platformUploadLimitMb: () => 25,
}));
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
        useQuery: () => ({
          data: undefined,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
    social: {
      publicationStatus: {
        useQuery: () => ({
          data: { ready: fixture.publicationReady },
          isFetchedAfterMount: fixture.publicationFetched,
          isFetching: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      circles: { useQuery: () => fixture.circles },
      createCircle: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      createPost: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      profile: { useQuery: () => ({ data: { avatar: null, name: "Ari" } }) },
      upload: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    useUtils: () => ({}),
  },
}));

const { default: CreateScreen } = await import("../app/create");

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(textContent).join("");
  return "";
}

function findElement(
  node: ReactNode,
  type: string,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    if (child.type === type && predicate(child)) return child;
    const nested = findElement(
      child.props.children as ReactNode,
      type,
      predicate,
    );
    if (nested) return nested;
  }
  return undefined;
}

function renderCreateScreen(): ReactNode {
  const accountBoundary = CreateScreen();
  if (
    !isValidElement(accountBoundary) ||
    typeof accountBoundary.type !== "function"
  ) {
    throw new Error("CreateScreen must retain its account-keyed boundary.");
  }
  const renderAccountBoundary = accountBoundary.type as (
    props: Record<string, never>,
  ) => ReactNode;
  return renderAccountBoundary({});
}

function findButton(node: ReactNode, title: string) {
  return findElement(
    node,
    "Button",
    (element) => element.props.title === title,
  );
}

beforeEach(() => {
  fixture.params.mode = "post";
  fixture.params.circleId = "12";
  fixture.params.intro = undefined;
  fixture.foreground = true;
  fixture.platformOS = "web";
  fixture.publicationReady = true;
  fixture.publicationFetched = true;
  fixture.circles.data = undefined;
  fixture.circles.isPending = false;
  fixture.circles.isFetching = false;
  fixture.circles.isError = false;
  fixture.circles.refetch.mockReset();
});

describe("Record–Preview–Publish receipt readiness", () => {
  it("blocks Publish when durable receipts are unavailable without blocking local media selection", () => {
    fixture.publicationReady = false;
    fixture.params.circleId = undefined;
    const rendered = renderCreateScreen();
    expect(findButton(rendered, "Publish your moment")?.props.disabled).toBe(
      true,
    );
    expect(
      findElement(
        rendered,
        "StatusMessage",
        (element) =>
          element.props.testID === "create-publication-readiness" &&
          String(element.props.message).includes("record and preview locally"),
      ),
    ).toBeDefined();
    expect(
      findElement(rendered, "Pressable", (element) =>
        String(element.props.accessibilityLabel).startsWith("Add "),
      )?.props.disabled,
    ).toBe(false);
  });
  it("does not trust cached readiness before this account/composer has fetched it", () => {
    fixture.publicationFetched = false;
    fixture.params.circleId = undefined;
    const rendered = renderCreateScreen();
    expect(findButton(rendered, "Publish your moment")?.props.disabled).toBe(
      true,
    );
    expect(
      findElement(
        rendered,
        "StatusMessage",
        (element) =>
          element.props.message === "Checking retry-safe publishing…" &&
          element.props.tone === "info",
      ),
    ).toBeDefined();
  });
  it("does not leave a native record action enabled while foreground authority is absent", () => {
    fixture.params.circleId = undefined;
    fixture.platformOS = "ios";
    fixture.foreground = false;
    const rendered = renderCreateScreen();
    expect(findButton(rendered, "Record video")?.props.disabled).toBe(true);
  });
});

describe("D26-16 Create retained recipient states", () => {
  it("keeps a loaded approved deep-linked circle named, selected, and publishable", () => {
    const recipient = resolveCreateRecipient({
      circleId: 12,
      circles: [{ id: 12, name: "Night Hikers", joined: true }],
      isResolving: false,
      isError: false,
    });
    expect(recipient).toEqual({
      kind: "selected",
      circleId: 12,
      name: "Night Hikers",
    });
    expect(canPublishToCreateRecipient(recipient)).toBe(true);

    fixture.circles.data = [{ id: 12, name: "Night Hikers", joined: true }];
    const rendered = renderCreateScreen();
    expect(
      findElement(
        rendered,
        "T",
        (element) =>
          textContent(element.props.children as ReactNode) ===
          "Selected circle: Night Hikers.",
      ),
    ).toBeDefined();
    expect(findButton(rendered, "Publish your moment")?.props.disabled).toBe(
      false,
    );
  });

  it("keeps a retained recipient resolving and prevents a hidden-destination publish", () => {
    const recipient = resolveCreateRecipient({
      circleId: 12,
      circles: undefined,
      isResolving: true,
      isError: false,
    });
    expect(recipient).toEqual({ kind: "resolving", circleId: 12 });
    expect(canPublishToCreateRecipient(recipient)).toBe(false);

    fixture.circles.isPending = true;
    const rendered = renderCreateScreen();
    expect(
      findElement(
        rendered,
        "StatusMessage",
        (element) =>
          element.props.message === "Finding your selected circle…" &&
          element.props.tone === "info",
      ),
    ).toBeDefined();
    expect(findButton(rendered, "Publish your moment")?.props.disabled).toBe(
      true,
    );
  });

  it("shows an error-specific retry without falling back to Everyone or submitting", () => {
    const recipient = resolveCreateRecipient({
      circleId: 12,
      circles: undefined,
      isResolving: false,
      isError: true,
    });
    expect(recipient).toEqual({ kind: "error", circleId: 12 });
    expect(canRetryCreateRecipient(recipient)).toBe(true);
    expect(canPublishToCreateRecipient(recipient)).toBe(false);

    fixture.circles.isError = true;
    const rendered = renderCreateScreen();
    expect(
      findElement(
        rendered,
        "StatusMessage",
        (element) =>
          element.props.message ===
            "Couldn't load the selected circle. Retry or choose Everyone." &&
          element.props.tone === "error",
      ),
    ).toBeDefined();
    const retry = findButton(rendered, "Retry selected circle");
    expect(retry?.props.disabled).toBe(false);
    (retry?.props.onPress as (() => void) | undefined)?.();
    expect(fixture.circles.refetch).toHaveBeenCalledTimes(1);
    expect(findButton(rendered, "Publish your moment")?.props.disabled).toBe(
      true,
    );
  });

  it("treats a settled absent or nonmember recipient as unavailable rather than Everyone", () => {
    const absent = resolveCreateRecipient({
      circleId: 12,
      circles: [],
      isResolving: false,
      isError: false,
    });
    const nonmember = resolveCreateRecipient({
      circleId: 12,
      circles: [{ id: 12, name: "Night Hikers", joined: false }],
      isResolving: false,
      isError: false,
    });

    expect(absent).toEqual({ kind: "unavailable", circleId: 12 });
    expect(nonmember).toEqual({ kind: "unavailable", circleId: 12 });
    expect(canPublishToCreateRecipient(absent)).toBe(false);
    expect(canRetryCreateRecipient(absent)).toBe(false);
  });
});

describe("D26-17 Create lateral safe-area ownership", () => {
  it("preserves asymmetric lateral values once at the root rather than flattening them into a shared gutter", () => {
    expect(createRootSafeAreaInsets({ top: 7, left: 3, right: 29 })).toEqual({
      paddingTop: 7,
      paddingLeft: 3,
      paddingRight: 29,
    });
  });
});
