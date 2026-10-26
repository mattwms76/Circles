import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookRuntime = vi.hoisted(() => {
  const states: unknown[] = [];
  const memos = new Map<number, { deps: readonly unknown[]; value: unknown }>();
  const effects = new Map<
    number,
    { cleanup?: () => void; deps: readonly unknown[] }
  >();
  let index = 0;

  function sameDependencies(
    left: readonly unknown[] | undefined,
    right: readonly unknown[] | undefined,
  ) {
    return (
      left !== undefined &&
      right !== undefined &&
      left.length === right.length &&
      left.every((value, dependencyIndex) =>
        Object.is(value, right[dependencyIndex]),
      )
    );
  }

  return {
    beginRender() {
      index = 0;
    },
    reset() {
      for (const effect of effects.values()) effect.cleanup?.();
      states.length = 0;
      memos.clear();
      effects.clear();
      index = 0;
    },
    useState(initialValue: unknown) {
      const stateIndex = index++;
      if (!(stateIndex in states)) {
        states[stateIndex] =
          typeof initialValue === "function"
            ? (initialValue as () => unknown)()
            : initialValue;
      }
      return [
        states[stateIndex],
        (nextValue: unknown) => {
          states[stateIndex] =
            typeof nextValue === "function"
              ? (nextValue as (current: unknown) => unknown)(states[stateIndex])
              : nextValue;
        },
      ];
    },
    useRef(initialValue: unknown) {
      const refIndex = index++;
      if (!(refIndex in states)) states[refIndex] = { current: initialValue };
      return states[refIndex];
    },
    useMemo(create: () => unknown, deps: readonly unknown[]) {
      const memoIndex = index++;
      const existing = memos.get(memoIndex);
      if (existing && sameDependencies(existing.deps, deps))
        return existing.value;
      const value = create();
      memos.set(memoIndex, { deps, value });
      return value;
    },
    useEffect(setup: () => void | (() => void), deps: readonly unknown[]) {
      const effectIndex = index++;
      const existing = effects.get(effectIndex);
      if (existing && sameDependencies(existing.deps, deps)) return;
      existing?.cleanup?.();
      const cleanup = setup();
      effects.set(effectIndex, {
        deps,
        cleanup: typeof cleanup === "function" ? cleanup : undefined,
      });
    },
  };
});

const runtime = vi.hoisted(() => {
  const profile = {
    id: 42,
    name: "A very long localized profile name that must remain fully visible without a two-line cap",
    handle: "pat-lee",
    bio: "A little about Pat.",
    avatar: null,
    cover: null,
    followers: 12,
    following: 8,
    isFollowing: false,
  };
  const profileQueryResult = {
    data: profile,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
  const feedQueryResult = {
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
  const updateMutation = { isPending: false, mutate: vi.fn() };
  const followMutation = { mutateAsync: vi.fn(), isPending: false };
  const directMutation = { mutateAsync: vi.fn() };

  return {
    width: 390,
    fontScale: 1,
    user: { id: 71, name: "Synthetic actor" },
    push: vi.fn(),
    requireAuth: vi.fn((action: () => void) => action()),
    showLogin: vi.fn(),
    notify: vi.fn(),
    logout: vi.fn(),
    profile,
    profileQueryResult,
    feedQueryResult,
    updateMutation,
    followMutation,
    directMutation,
    profileQuery: vi.fn(() => profileQueryResult),
    feedQuery: vi.fn(() => feedQueryResult),
    invalidateProfileViews: vi.fn(),
    utils: {},
  };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: hookRuntime.useEffect,
    useMemo: hookRuntime.useMemo,
    useRef: hookRuntime.useRef,
    useState: hookRuntime.useState,
  };
});
vi.mock("react-native", () => ({
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Modal: "Modal",
  Platform: { OS: "web" },
  ScrollView: "ScrollView",
  View: "View",
  useWindowDimensions: () => ({
    width: runtime.width,
    height: 844,
    scale: 1,
    fontScale: runtime.fontScale,
  }),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: runtime.push }),
}));
vi.mock("@/components/media-image", () => ({ Image: "Image" }));
vi.mock("../components/app-shell", () => ({ AppShell: "AppShell" }));
vi.mock("../components/post-card", () => ({ PostCard: "PostCard" }));
vi.mock("../components/user-avatar", () => ({ UserAvatar: "UserAvatar" }));
vi.mock("../components/circles-ui", () => ({
  Button: "Button",
  C: {
    bg: "#F9F8F5",
    muted: "#4D5948",
    paper: "#FFFFFF",
    sage: "#E9EEE5",
    secondary: "#4D5948",
  },
  Empty: "Empty",
  IconButton: "IconButton",
  Input: "Input",
  Loading: "Loading",
  photo: { mountains: "mountains" },
  Pill: "Pill",
  s: {
    between: { flexDirection: "row", justifyContent: "space-between" },
    row: { flexDirection: "row", alignItems: "center" },
    title: { fontSize: 28 },
    eyebrow: { fontSize: 12 },
  },
  T: "T",
}));
vi.mock("@/hooks/circles-context", () => ({
  useCircles: () => ({
    user: runtime.user,
    requireAuth: runtime.requireAuth,
    notify: runtime.notify,
    showLogin: runtime.showLogin,
    logout: runtime.logout,
  }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => runtime.utils,
    social: {
      feed: { useQuery: runtime.feedQuery },
      follow: { useMutation: () => runtime.followMutation },
      openDirect: { useMutation: () => runtime.directMutation },
      profile: { useQuery: runtime.profileQuery },
      updateProfile: { useMutation: () => runtime.updateMutation },
    },
  },
}));
vi.mock("@/lib/fnd001-query-display-state", () => ({
  resolveFnd001QueryDisplayState: () => "empty",
}));
vi.mock("@/lib/source-query-invalidation", () => ({
  invalidateProfileViews: runtime.invalidateProfileViews,
}));
vi.mock(
  "@/lib/batch1-mutation-feedback",
  async () => import("../lib/batch1-mutation-feedback"),
);

const { default: ProfileScreen } = await import("../components/profile-screen");

type Element = ReactElement<Record<string, unknown>>;
type FollowActionProps = {
  accountId: number | null;
  target: { id: number; name: string; isFollowing?: boolean };
  onRefetch: () => void;
  requireAuth: (action: () => void) => void;
  notify: (message: string) => void;
};

function elements(node: ReactNode): Element[] {
  const result: Element[] = [];
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    result.push(child);
    result.push(...elements(child.props.children as ReactNode));
  }
  return result;
}

function byTestId(node: ReactNode, testID: string): Element {
  const result = elements(node).find(
    (element) => element.props.testID === testID,
  );
  if (!result) throw new Error(`Missing element: ${testID}`);
  return result;
}

function buttonByTitle(node: ReactNode, title: string): Element {
  const result = elements(node).find(
    (element) => element.type === "Button" && element.props.title === title,
  );
  if (!result) throw new Error(`Missing Button: ${title}`);
  return result;
}

function flattenedStyle(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return Object.assign({}, ...value.map((entry) => flattenedStyle(entry)));
  }
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function followActionFactory() {
  hookRuntime.reset();
  hookRuntime.beginRender();
  const profile = ProfileScreen({ personId: runtime.profile.id });
  const action = elements(profile).find(
    (element) =>
      typeof element.type === "function" &&
      element.props.target === runtime.profile,
  );
  if (!action || typeof action.type !== "function") {
    throw new Error("Expected the actual ProfileFollowActions element.");
  }
  return {
    props: action.props as FollowActionProps,
    render: action.type as (props: FollowActionProps) => ReactNode,
  };
}

beforeEach(() => {
  hookRuntime.reset();
  runtime.width = 390;
  runtime.fontScale = 1;
  runtime.user = { id: 71, name: "Synthetic actor" };
  runtime.directMutation.mutateAsync.mockReset();
  runtime.followMutation.mutateAsync.mockReset();
  vi.clearAllMocks();
  runtime.requireAuth.mockImplementation((action: () => void) => action());
});

describe("D26 Profile direct-message action", () => {
  it("single-flights a direct-message operation, exposes pending feedback, and suppresses stale actor/person/instance routing", async () => {
    const firstDirect = deferred<{ id: number }>();
    const reactivatedDirect = deferred<{ id: number }>();
    runtime.directMutation.mutateAsync
      .mockImplementationOnce(() => firstDirect.promise)
      .mockImplementationOnce(() => reactivatedDirect.promise);

    const action = followActionFactory();
    hookRuntime.reset();
    const renderFollow = (props: FollowActionProps) => {
      hookRuntime.beginRender();
      return action.render(props);
    };
    const originalProps = action.props;

    let rendered = renderFollow(originalProps);
    const sayHello = buttonByTitle(rendered, "Say hello");
    expect(sayHello.props).toMatchObject({
      accessibilityLabel:
        "Open a direct conversation with A very long localized profile name that must remain fully visible without a two-line cap",
      disabled: false,
      loading: false,
    });

    (sayHello.props.onPress as () => void)();
    (sayHello.props.onPress as () => void)();
    expect(runtime.directMutation.mutateAsync).toHaveBeenCalledTimes(1);

    rendered = renderFollow(originalProps);
    expect(
      buttonByTitle(rendered, "Opening conversation…").props,
    ).toMatchObject({
      disabled: true,
      loading: true,
    });
    expect(buttonByTitle(rendered, "Follow").props).toMatchObject({
      disabled: true,
      loading: false,
    });

    renderFollow({ ...originalProps, accountId: 72 });
    renderFollow({
      ...originalProps,
      target: { ...originalProps.target, id: 43, name: "Other person" },
    });
    renderFollow(originalProps);
    firstDirect.resolve({ id: 501 });
    await firstDirect.promise;
    await Promise.resolve();
    expect(runtime.push).not.toHaveBeenCalled();

    hookRuntime.reset();
    rendered = renderFollow(originalProps);
    const reactivatedSayHello = buttonByTitle(rendered, "Say hello");
    (reactivatedSayHello.props.onPress as () => void)();
    expect(runtime.directMutation.mutateAsync).toHaveBeenCalledTimes(2);
    reactivatedDirect.resolve({ id: 502 });
    await reactivatedDirect.promise;
    await Promise.resolve();
    expect(runtime.push).toHaveBeenCalledWith(
      "/chat/502?name=A%20very%20long%20localized%20profile%20name%20that%20must%20remain%20fully%20visible%20without%20a%20two-line%20cap",
    );
  });
});

describe("D26 Profile name and own-action reflow", () => {
  it.each([
    { width: 320, fontScale: 1, description: "320-point width" },
    { width: 390, fontScale: 1.3, description: "scaled text" },
  ])(
    "keeps the complete name, avatar frame, and every own action accessible at $description",
    ({ width, fontScale }) => {
      runtime.width = width;
      runtime.fontScale = fontScale;
      hookRuntime.reset();
      hookRuntime.beginRender();
      const profile = ProfileScreen({});
      const hero = byTestId(profile, "profile-hero");
      const actions = byTestId(profile, "profile-own-actions");
      const name = byTestId(profile, "profile-name");
      const connectEmail = buttonByTitle(actions, "Connect email sign-in");
      const avatar = elements(hero).find(
        (element) => element.type === "UserAvatar",
      );
      const avatarFrame = elements(hero).find(
        (element) =>
          element.type === "View" &&
          flattenedStyle(element.props.style).backgroundColor === "#F9F8F5" &&
          flattenedStyle(element.props.style).borderRadius === 50,
      );

      expect(name.props.children).toBe(runtime.profile.name);
      expect(name.props.numberOfLines).toBeUndefined();
      expect(flattenedStyle(hero.props.style)).toMatchObject({
        flexWrap: "wrap",
        alignItems: "flex-start",
      });
      expect(flattenedStyle(actions.props.style)).toMatchObject({
        width: "100%",
        alignItems: "stretch",
        minWidth: 0,
      });
      expect(flattenedStyle(connectEmail.props.style)).toMatchObject({
        width: "100%",
        borderRadius: 9,
      });
      expect(avatar?.props).toMatchObject({
        size: 79,
        userId: runtime.profile.id,
      });
      expect(flattenedStyle(avatarFrame?.props.style)).toMatchObject({
        padding: 5,
        borderRadius: 50,
      });

      (connectEmail.props.onPress as () => void)();
      expect(runtime.requireAuth).toHaveBeenCalledOnce();
      expect(runtime.push).toHaveBeenLastCalledWith("/account/email");
    },
  );

  it("keeps the action column compact at regular width and unscaled text", () => {
    hookRuntime.reset();
    hookRuntime.beginRender();
    const profile = ProfileScreen({});
    const hero = byTestId(profile, "profile-hero");
    const actions = byTestId(profile, "profile-own-actions");
    const connectEmail = buttonByTitle(actions, "Connect email sign-in");

    expect(flattenedStyle(hero.props.style)).toMatchObject({
      flexWrap: "nowrap",
      alignItems: "flex-end",
    });
    expect(flattenedStyle(actions.props.style)).toMatchObject({
      marginTop: 36,
      alignItems: "flex-end",
    });
    expect(flattenedStyle(actions.props.style).width).toBeUndefined();
    expect(flattenedStyle(connectEmail.props.style).width).toBeUndefined();
  });
});
