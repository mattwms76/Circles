import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { compactPostActionCount } from "../lib/d28-021-post-card-action-rail";
import type { Post } from "../shared/social";

const runtime = vi.hoisted(() => ({
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
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
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
    user: { id: 8 },
    requireAuth: vi.fn(),
    notify: vi.fn(),
  }),
}));
vi.mock("@/lib/fnd001-query-display-state", () => ({
  resolveFnd001QueryDisplayState: () => "loading",
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
  const mutation = () => ({
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
  });
  return {
    trpc: {
      useUtils: () => ({}),
      social: {
        comments: {
          useQuery: () => ({
            data: [],
            isError: false,
            isLoading: true,
            refetch: vi.fn(),
          }),
        },
        comment: { useMutation: mutation },
        deletePost: { useMutation: mutation },
        likePost: { useMutation: mutation },
        report: { useMutation: mutation },
        savePost: { useMutation: mutation },
      },
    },
  };
});

const { PostCard } = await import("../components/post-card");

type Element = ReactElement<Record<string, unknown>>;

const post = {
  id: 91,
  author: {
    id: 7,
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
  likes: 1234,
  comments: 5678,
  liked: false,
  saved: false,
  createdAt: "2026-10-26T12:00:00.000Z",
} as Post;

function findElements(node: ReactNode, type: unknown): Element[] {
  const matches: Element[] = [];
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    if (child.type === type) matches.push(child);
    matches.push(
      ...findElements(child.props.children as ReactNode | undefined, type),
    );
  }
  return matches;
}

function readableStyle(style: unknown): Record<string, unknown> {
  return Array.isArray(style)
    ? Object.assign({}, ...style.filter(Boolean))
    : (style as Record<string, unknown>);
}

function actionRail(card: Element): Element {
  const rail = findElements(card, "View").find((element) => {
    const style = readableStyle(element.props.style);
    return (
      style.flexDirection === "row" &&
      style.flexWrap === "wrap" &&
      style.gap === 8
    );
  });
  expect(rail).toBeDefined();
  return rail!;
}

describe("D28-021 compact PostCard action rail counts", () => {
  beforeEach(() => {
    runtime.stateCursor = 0;
    runtime.stateValues = [];
  });

  it("uses a bounded compact visual count without changing exact count semantics", () => {
    expect(compactPostActionCount(0)).toBe("0");
    expect(compactPostActionCount(99)).toBe("99");
    expect(compactPostActionCount(100)).toBe("99+");
    expect(compactPostActionCount(5678)).toBe("99+");
  });

  it("keeps all four 44-point actions in one wrapping rail with exact accessible counts", () => {
    const card = PostCard({ post }) as Element;
    const rail = actionRail(card);
    const actions = Children.toArray(rail.props.children as ReactNode).filter(
      isValidElement,
    ) as Element[];
    const [like, comments, share, save] = actions;

    expect(actions.map((action) => action.type)).toEqual([
      "Pressable",
      "Pressable",
      "IconButton",
      "IconButton",
    ]);
    expect(readableStyle(rail.props.style)).toMatchObject({
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
    });
    expect(like?.props).toMatchObject({
      accessibilityLabel: "Like moment",
      accessibilityValue: { text: "1234 likes" },
    });
    expect(comments?.props).toMatchObject({
      accessibilityLabel: "Open 5678 comments",
      accessibilityValue: { text: "5678 comments" },
    });
    expect(readableStyle(like?.props.style)).toMatchObject({
      minWidth: 44,
      minHeight: 44,
    });
    expect(readableStyle(comments?.props.style)).toMatchObject({
      minWidth: 44,
      minHeight: 44,
    });
    expect(
      findElements(like?.props.children as ReactNode, "T").at(0)?.props
        .children,
    ).toBe("99+");
    expect(
      findElements(comments?.props.children as ReactNode, "T").at(0)?.props
        .children,
    ).toBe("99+");
    expect(share?.props).toMatchObject({ label: "Share moment" });
    expect(save?.props).toMatchObject({ label: "Save moment" });
  });
});
