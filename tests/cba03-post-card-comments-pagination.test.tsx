import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Post } from "../shared/social";

const runtime = vi.hoisted(() => ({
  fetchNextPage: vi.fn(),
  queryInput: null as unknown,
  queryOptions: null as unknown,
  stateCursor: 0,
  stateValues: [] as unknown[],
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: <Value,>(callback: Value) => callback,
    useEffect: () => undefined,
    useRef: <Value,>(initialValue: Value) => ({ current: initialValue }),
    useState: <Value,>(initialValue: Value | (() => Value)) => {
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
  useSafeAreaInsets: () => ({ bottom: 0, top: 0 }),
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
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
    requireAuth: (operation: () => void) => operation(),
    notify: vi.fn(),
  }),
}));
vi.mock("@/lib/fnd001-query-display-state", () => ({
  resolveFnd001QueryDisplayState: ({ hasContent }: { hasContent: boolean }) =>
    hasContent ? "content" : "empty",
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
  const mutation = { isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() };
  return {
    trpc: {
      useUtils: () => ({}),
      social: {
        commentsPage: {
          useInfiniteQuery: (input: unknown, options: unknown) => {
            runtime.queryInput = input;
            runtime.queryOptions = options;
            return {
              data: {
                pages: [
                  {
                    items: [
                      {
                        id: 1,
                        author: { id: 10, name: "Ari", avatar: "" },
                        text: "First page comment",
                        createdAt: "2026-10-29T12:00:00.000Z",
                      },
                    ],
                    nextCursor: {
                      id: 1,
                      createdAt: "2026-10-29T12:00:00.000Z",
                      createdAtExact: "2026-10-29T12:00:00.123456Z",
                    },
                  },
                  {
                    items: [
                      {
                        id: 2,
                        author: { id: 11, name: "Bea", avatar: "" },
                        text: "Second page comment",
                        createdAt: "2026-10-29T12:01:00.000Z",
                      },
                    ],
                    nextCursor: null,
                  },
                ],
              },
              fetchNextPage: runtime.fetchNextPage,
              hasNextPage: true,
              isError: false,
              isFetchNextPageError: false,
              isFetchingNextPage: false,
              isLoading: false,
              refetch: vi.fn(),
            };
          },
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
  id: 44,
  author: {
    id: 8,
    name: "Jordan",
    handle: "jordan",
    bio: "",
    avatar: "",
    followers: 0,
    following: 0,
  },
  circleId: null,
  circleName: null,
  text: "A bounded conversation.",
  media: null,
  mediaType: "text",
  likes: 0,
  comments: 75,
  liked: false,
  saved: false,
  createdAt: "2026-10-29T12:00:00.000Z",
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

describe("CBA-03 PostCard comments cursor continuation", () => {
  beforeEach(() => {
    runtime.fetchNextPage.mockReset();
    runtime.queryInput = null;
    runtime.queryOptions = null;
    runtime.stateCursor = 0;
    runtime.stateValues = [true];
  });

  it("renders loaded cursor pages and exposes a continuation action instead of hiding comments", () => {
    const card = PostCard({ post });
    const commentSheet = findElements(card, "Modal").find(
      (element) =>
        element.props.accessibilityLabel === "Comments" &&
        element.props.visible === true,
    );
    const avatars = findElements(
      commentSheet?.props.children as ReactNode,
      "UserAvatar",
    );
    const loadMore = findElements(
      commentSheet?.props.children as ReactNode,
      "Button",
    ).find((element) => element.props.title === "Load more comments");
    const options = runtime.queryOptions as {
      getNextPageParam: (page: { nextCursor: unknown }) => unknown;
    };

    expect(runtime.queryInput).toEqual({ postId: 44, limit: 20 });
    expect(avatars.map((avatar) => avatar.props.name)).toEqual(["Ari", "Bea"]);
    expect(options.getNextPageParam({ nextCursor: { id: 2 } })).toEqual({
      id: 2,
    });
    expect(options.getNextPageParam({ nextCursor: null })).toBeUndefined();
    expect(loadMore).toBeDefined();
    (loadMore?.props.onPress as () => void)();
    expect(runtime.fetchNextPage).toHaveBeenCalledTimes(1);
  });
});
