import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Post } from "../shared/social";

const runtime = vi.hoisted(() => ({
  commentsDisplayState: "loading" as "loading" | "error" | "empty" | "content",
  comments: [] as {
    id: number;
    author: { id: number; name: string; avatar: string };
    text: string;
    createdAt: string;
  }[],
  commentsRefetch: vi.fn(),
  stateCursor: 0,
  stateValues: [] as unknown[],
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: <Value>(callback: Value) => callback,
    useEffect: () => undefined,
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
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Modal: "Modal",
  Platform: { OS: "web" },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Share: { share: vi.fn() },
  TextInput: "TextInput",
  View: "View",
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 34 }),
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("expo-video", () => ({
  useVideoPlayer: () => ({ addListener: () => ({ remove: vi.fn() }) }),
  VideoView: "VideoView",
}));
vi.mock("@/components/media-image", () => ({
  Image: "Image",
  MediaPlaceholder: "MediaPlaceholder",
  useMediaSource: () => null,
}));
vi.mock("@/components/status-message", () => ({
  StatusMessage: "StatusMessage",
}));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: "UserAvatar" }));
vi.mock("../components/user-avatar", () => ({ UserAvatar: "UserAvatar" }));
vi.mock("@/components/circles-ui", () => ({
  ago: () => "just now",
  Button: "Button",
  C: {
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
  Heading: "Heading",
  Icon: "Icon",
  IconButton: "IconButton",
  Loading: "Loading",
  s: { between: {}, card: {}, row: {} },
  T: "T",
}));
vi.mock("../components/circles-ui", () => ({
  ago: () => "just now",
  Button: "Button",
  C: {
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
  Heading: "Heading",
  Icon: "Icon",
  IconButton: "IconButton",
  Loading: "Loading",
  s: { between: {}, card: {}, row: {} },
  T: "T",
}));
vi.mock("@/hooks/circles-context", () => ({
  useCircles: () => ({
    user: { id: 7 },
    requireAuth: vi.fn(),
    notify: vi.fn(),
  }),
}));
vi.mock("@/lib/fnd001-query-display-state", () => ({
  resolveFnd001QueryDisplayState: () => runtime.commentsDisplayState,
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
vi.mock("@/lib/trpc", () => {
  const mutation = {
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
  };
  return {
    trpc: {
      useUtils: () => ({}),
      social: {
        commentsPage: {
          useInfiniteQuery: () => ({
            data: { pages: [{ items: runtime.comments, nextCursor: null }] },
            hasNextPage: false,
            isError: runtime.commentsDisplayState === "error",
            isLoading: runtime.commentsDisplayState === "loading",
            isFetchingNextPage: false,
            isFetchNextPageError: false,
            fetchNextPage: vi.fn(),
            refetch: runtime.commentsRefetch,
          }),
        },
        comment: { useMutation: () => mutation },
        deletePost: { useMutation: () => mutation },
        likePost: { useMutation: () => mutation },
        report: { useMutation: () => mutation },
        savePost: { useMutation: () => mutation },
      },
    },
  };
});

const { PostCard } = await import("../components/post-card");

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

function renderCommentsSheet(
  displayState: typeof runtime.commentsDisplayState,
) {
  runtime.commentsDisplayState = displayState;
  runtime.stateCursor = 0;
  runtime.stateValues = [true];
  return PostCard({ post });
}

function commentsScroll(displayState: typeof runtime.commentsDisplayState) {
  const card = renderCommentsSheet(displayState);
  const modal = findElements(card, "Modal").find(
    (element) =>
      element.props.accessibilityLabel === "Comments" &&
      element.props.visible === true,
  );
  expect(modal).toBeDefined();

  const scrollViews = findElements(
    modal?.props.children as ReactNode,
    "ScrollView",
  );
  expect(scrollViews).toHaveLength(1);
  return scrollViews[0]!;
}

describe("D28-006 PostCard comments sheet containment", () => {
  beforeEach(() => {
    runtime.comments = [];
    runtime.commentsRefetch.mockReset();
    runtime.stateCursor = 0;
    runtime.stateValues = [];
  });

  it("puts loading, header, and composer in one shrinkable full-sheet scroll surface", () => {
    const scroll = commentsScroll("loading");

    expect(scroll.props).toMatchObject({
      style: { flexShrink: 1, minHeight: 0 },
      contentContainerStyle: {
        gap: 16,
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 46,
      },
      keyboardShouldPersistTaps: "handled",
      keyboardDismissMode: "interactive",
    });
    expect(
      findElements(scroll.props.children as ReactNode, "Loading"),
    ).toHaveLength(1);
    expect(
      findElements(scroll.props.children as ReactNode, "IconButton").some(
        (element) => element.props.label === "Close comments",
      ),
    ).toBe(true);
    expect(
      findElements(scroll.props.children as ReactNode, "TextInput").some(
        (element) => element.props.accessibilityLabel === "Comment text",
      ),
    ).toBe(true);
  });

  it("keeps the error retry inside the scrollable comments sheet", () => {
    const scroll = commentsScroll("error");
    const retry = findElements(scroll.props.children as ReactNode, "Empty").at(
      0,
    );

    expect(retry?.props).toMatchObject({
      title: "We couldn’t load the comments.",
      action: "Try again",
    });
    (retry?.props.onAction as () => void)();
    expect(runtime.commentsRefetch).toHaveBeenCalledTimes(1);
    expect(
      findElements(scroll.props.children as ReactNode, "ScrollView"),
    ).toHaveLength(0);
  });

  it("keeps the empty-state copy inside the scrollable comments sheet", () => {
    const scroll = commentsScroll("empty");
    const emptyCopy = findElements(
      scroll.props.children as ReactNode,
      "T",
    ).find(
      (element) =>
        element.props.children === "Be the first to say something kind.",
    );

    expect(emptyCopy).toBeDefined();
  });

  it("keeps populated comments in the same scrollable sheet without a nested list", () => {
    runtime.comments = [
      {
        id: 15,
        author: { id: 12, name: "Morgan", avatar: "" },
        text: "Thank you for sharing.",
        createdAt: "2026-10-27T12:00:00.000Z",
      },
    ];
    const scroll = commentsScroll("content");

    expect(
      findElements(scroll.props.children as ReactNode, "UserAvatar").some(
        (element) => element.props.name === "Morgan",
      ),
    ).toBe(true);
    expect(
      findElements(scroll.props.children as ReactNode, "ScrollView"),
    ).toHaveLength(0);
  });
});
