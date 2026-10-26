import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityItem } from "../shared/activity";
import { statusAccessibilityProps } from "../lib/status-announcement";

const context = vi.hoisted(() => ({
  authState: "checking" as "checking" | "authenticated" | "guest" | "error",
  refresh: vi.fn(),
  showLogin: vi.fn(),
  user: null as { id: number } | null,
}));

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Pressable: "Pressable",
  StyleSheet: { create: <T>(value: T) => value },
  View: "View",
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/app-shell", () => ({ AppShell: "AppShell" }));
vi.mock("@/components/post-card", () => ({ PostCard: "PostCard" }));
vi.mock(
  "@/components/activity-preferences",
  async () => import("../components/activity-preferences"),
);
vi.mock("@/components/status-message", () => ({
  StatusMessage: "StatusMessage",
}));
vi.mock("@/lib/activity-ui", async () => import("../lib/activity-ui"));
vi.mock("@/hooks/circles-context", () => ({
  useCircles: () => context,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: vi.fn(),
    activity: {
      list: { useInfiniteQuery: vi.fn() },
      unreadCount: { useQuery: vi.fn() },
      markRead: { useMutation: vi.fn() },
      markAllRead: { useMutation: vi.fn() },
      preferences: { useQuery: vi.fn() },
      updateCategories: { useMutation: vi.fn() },
      setCircleMuted: { useMutation: vi.fn() },
      resolveTarget: { useQuery: vi.fn() },
    },
  },
}));
vi.mock("@/components/circles-ui", () => ({
  Button: "Button",
  C: {
    action: "#A53728",
    border: "#E8E9E2",
    paper: "#FFFFFF",
    sage: "#E9EEE5",
    secondary: "#4D5948",
    soft: "#FFF0EB",
  },
  Empty: "Empty",
  Icon: "Icon",
  IconButton: "IconButton",
  Loading: "Loading",
  ago: () => "3 minutes ago",
  s: { between: {} },
  T: "T",
}));
vi.mock("../components/circles-ui", () => ({
  Button: "Button",
  C: {
    action: "#A53728",
    border: "#E8E9E2",
    paper: "#FFFFFF",
    sage: "#E9EEE5",
    secondary: "#4D5948",
    soft: "#FFF0EB",
  },
  Empty: "Empty",
  T: "T",
}));

const { ActivityRow, activityRowLabels } = await import("../app/updates/index");
const { default: ActivityPreferencesScreen } =
  await import("../app/updates/preferences");
const { ActivityOutcomeStatus, ActivityPreferencesPanel } =
  await import("../components/activity-preferences");

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

function unreadItem(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: 55,
    kind: "comment_on_your_post",
    createdAt: "2026-10-26T12:00:00.000Z",
    readAt: null,
    available: true,
    actorName: "Ari",
    circleName: "Writers",
    ...overrides,
  };
}

describe("D26-12/D26-28 Activity accessibility and auth states", () => {
  beforeEach(() => {
    context.authState = "checking";
    context.user = null;
    context.refresh.mockReset();
    context.showLogin.mockReset();
  });

  it("renders actual bounded row labels with title, detail, time, unread context, and retained busy state", () => {
    const item = unreadItem();
    const row = ActivityRow({
      item,
      disabled: true,
      marking: true,
      onOpen: vi.fn(),
      onMarkRead: vi.fn(),
    });
    const controls = findElements(row, "Pressable");

    expect(controls).toHaveLength(2);
    expect(controls[0]?.props).toMatchObject({
      accessibilityLabel:
        "Open update: Ari commented on your moment. — In Writers — 3 minutes ago — unread",
      accessibilityState: { disabled: true, busy: true },
    });
    expect(controls[1]?.props).toMatchObject({
      accessibilityLabel:
        "Mark update as read: Ari commented on your moment. — In Writers — 3 minutes ago — unread",
      accessibilityState: { disabled: true, busy: true },
    });

    const longName = "A".repeat(300);
    const bounded = activityRowLabels(
      unreadItem({ actorName: longName, circleName: longName }),
    );
    expect(bounded.open).toContain("…");
    expect(bounded.open).not.toContain(longName);
  });

  it("keeps checking and auth-error retry distinct from a confirmed guest sign-in", () => {
    let screen = ActivityPreferencesScreen();
    expect(findElements(screen, "Loading")).toHaveLength(1);

    context.authState = "error";
    screen = ActivityPreferencesScreen();
    const authError = findElements(screen, "Empty")[0];
    expect(authError?.props).toMatchObject({
      title: "We couldn’t check your sign-in.",
      action: "Try again",
    });
    (authError?.props.onAction as () => void)();
    expect(context.refresh).toHaveBeenCalledTimes(1);
    expect(context.showLogin).not.toHaveBeenCalled();

    context.authState = "guest";
    screen = ActivityPreferencesScreen();
    const guest = findElements(screen, "Empty")[0];
    expect(guest?.props).toMatchObject({
      title: "Choose your Updates after signing in.",
      action: "Sign in",
    });
    (guest?.props.onAction as () => void)();
    expect(context.showLogin).toHaveBeenCalledTimes(1);

    context.authState = "authenticated";
    context.user = { id: 7 };
    screen = ActivityPreferencesScreen();
    expect(
      findElements(screen, ActivityPreferencesPanel)[0]?.props,
    ).toMatchObject({
      viewerId: 7,
    });
  });

  it("uses exactly one shared non-focus outcome component with info, success, and error tones", () => {
    const info = ActivityOutcomeStatus({
      message: "Checking your update preferences…",
      tone: "info",
      testID: "preferences-info",
    });
    const success = ActivityOutcomeStatus({
      message: "Update preferences saved.",
      tone: "success",
      testID: "preferences-success",
    });
    const error = ActivityOutcomeStatus({
      message: "We couldn’t save that preference. Please try again.",
      tone: "error",
      testID: "preferences-error",
    });

    expect([info, success, error]).toHaveLength(3);
    expect(info.type).toBe("StatusMessage");
    expect(info.props).toMatchObject({
      message: "Checking your update preferences…",
      tone: "info",
      testID: "preferences-info",
    });
    expect(success.props).toMatchObject({ tone: "success" });
    expect(error.props).toMatchObject({ tone: "error" });
    expect(info.props.accessibilityRole).toBeUndefined();
    expect(statusAccessibilityProps("info", "web")).toEqual({
      "aria-live": "polite",
    });
    expect(statusAccessibilityProps("success", "android")).toEqual({
      accessibilityLiveRegion: "polite",
    });
    expect(statusAccessibilityProps("error", "web")).toEqual({
      accessibilityRole: "alert",
      "aria-live": "assertive",
    });
  });
});
