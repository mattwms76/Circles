import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Post } from "../shared/social";

const runtime = vi.hoisted(() => ({
  reportPending: false,
  removePending: false,
  stateCursor: 0,
  stateValues: [] as unknown[],
  setters: [] as ReturnType<typeof vi.fn>[],
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
      const setValue = vi.fn();
      runtime.setters[index] = setValue;
      return [value, setValue] as const;
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
  useSafeAreaInsets: () => ({ top: 34, bottom: 34 }),
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
  const mutation = (pending: () => boolean) => ({
    get isPending() {
      return pending();
    },
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
        comment: { useMutation: () => mutation(() => false) },
        deletePost: {
          useMutation: () => mutation(() => runtime.removePending),
        },
        likePost: { useMutation: () => mutation(() => false) },
        report: { useMutation: () => mutation(() => runtime.reportPending) },
        savePost: { useMutation: () => mutation(() => false) },
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
  likes: 1,
  comments: 2,
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

function optionsModal(): Element {
  runtime.stateCursor = 0;
  const card = PostCard({ post });
  const modal = findElements(card, "Modal").find(
    (element) =>
      element.props.accessibilityLabel === "Moment options" &&
      element.props.visible === true,
  );
  expect(modal).toBeDefined();
  return modal!;
}

function optionsRoot(modal: Element): Element {
  const root = Children.toArray(modal.props.children as ReactNode).at(0);
  expect(isValidElement<Record<string, unknown>>(root)).toBe(true);
  return root as Element;
}

function optionsCard(root: Element): Element {
  const card = findElements(root.props.children as ReactNode, "View").find(
    (element) =>
      (element.props.style as Record<string, unknown>)?.backgroundColor ===
      "#FFFFFF",
  );
  expect(card).toBeDefined();
  return card!;
}

describe("D28-007 Moment options short-height containment", () => {
  beforeEach(() => {
    runtime.reportPending = false;
    runtime.removePending = false;
    runtime.stateCursor = 0;
    runtime.stateValues = [false, true];
    runtime.setters = [];
  });

  it("uses safe-area-bounded card space and one hidden-scrollbar action stack", () => {
    const root = optionsRoot(optionsModal());
    const card = optionsCard(root);
    const scroll = Children.toArray(card.props.children as ReactNode).at(0);

    expect(root.props.style).toMatchObject({
      paddingHorizontal: 30,
      paddingTop: 50,
      paddingBottom: 50,
    });
    expect(card.props.style).toMatchObject({
      maxHeight: "100%",
      minHeight: 0,
      overflow: "hidden",
    });
    expect(isValidElement<Record<string, unknown>>(scroll)).toBe(true);
    expect((scroll as Element).type).toBe("ScrollView");
    expect((scroll as Element).props).toMatchObject({
      showsVerticalScrollIndicator: false,
      style: { flexShrink: 1, minHeight: 0 },
      contentContainerStyle: { padding: 22, gap: 12 },
    });
    expect(
      findElements(
        (scroll as Element).props.children as ReactNode,
        "Button",
      ).map((button) => button.props.title),
    ).toEqual(["Report inappropriate content", "Remove my moment", "Close"]);
  });

  it("retains the existing busy guard for both dismissal paths", () => {
    runtime.reportPending = true;
    const modal = optionsModal();
    const root = optionsRoot(modal);
    const backdrop = findElements(
      root.props.children as ReactNode,
      "Pressable",
    ).at(0);
    const close = findElements(root.props.children as ReactNode, "Button").find(
      (button) => button.props.title === "Close",
    );

    expect(backdrop?.props).toMatchObject({
      accessible: false,
      importantForAccessibility: "no",
      disabled: true,
    });
    expect(close?.props.disabled).toBe(true);
    (modal.props.onRequestClose as () => void)();
    expect(runtime.setters[1]).not.toHaveBeenCalled();
  });
});
