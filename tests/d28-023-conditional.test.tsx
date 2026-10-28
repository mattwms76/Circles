import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  unread: undefined as unknown,
  useQuery: vi.fn(),
}));

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: (value: unknown) => value },
  View: "View",
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    activity: {
      unreadCount: { useQuery: runtime.useQuery },
    },
  },
}));
vi.mock("@/lib/activity-ui", async () => import("../lib/activity-ui"));
vi.mock("../lib/control-accessibility", () => ({
  controlAccessibilityProps: () => ({}),
}));
vi.mock("../components/circles-ui", () => ({
  C: { action: "#A53728", bg: "#FFFFFF", ink: "#202020" },
  Icon: "Icon",
  T: "T",
}));

const { ActivityBadge } = await import("../components/activity-badge");

type Element = ReactElement<Record<string, unknown>>;

function unread(count: unknown, viewerId = 42) {
  return { viewerId, count, throughId: 1 };
}

function badgeFor(viewerId = 42): Element {
  return ActivityBadge({ viewerId, onPress: vi.fn() }) as Element;
}

function visualBadge(badge: Element): Element | undefined {
  return Children.toArray(badge.props.children as ReactNode).find(
    (child): child is Element =>
      isValidElement<Record<string, unknown>>(child) && child.type === "View",
  );
}

function readableStyle(style: unknown): Record<string, unknown> {
  return Array.isArray(style)
    ? Object.assign({}, ...style.filter(Boolean))
    : (style as Record<string, unknown>);
}

beforeEach(() => {
  runtime.unread = {
    data: unread(0),
    isError: false,
    isFetchedAfterMount: true,
    isFetching: false,
  };
  runtime.useQuery.mockReset();
  runtime.useQuery.mockImplementation(() => runtime.unread);
});

describe("D28-023 ActivityBadge intrinsic enlarged-text layout", () => {
  it("keeps the 44-point target and exact accessible count while 99+ can grow vertically", () => {
    runtime.unread = {
      data: unread(137),
      isError: false,
      isFetchedAfterMount: true,
      isFetching: false,
    };

    const badge = badgeFor();
    const indicator = visualBadge(badge);
    const indicatorStyle = readableStyle(indicator?.props.style);
    const text = indicator?.props.children as Element;

    expect(badge.props.accessibilityLabel).toBe("Open Updates, 137 unread");
    expect(text.props.children).toBe("99+");
    expect(
      readableStyle(
        (badge.props.style as (state: { pressed: boolean }) => unknown)({
          pressed: false,
        }),
      ),
    ).toMatchObject({ minWidth: 44, minHeight: 44 });
    expect(indicatorStyle).toMatchObject({
      top: 3,
      right: 2,
      minWidth: 18,
      minHeight: 18,
      paddingHorizontal: 4,
      paddingVertical: 2,
      borderRadius: 9,
    });
    expect(indicatorStyle).not.toHaveProperty("height");
  });

  it("leaves visual badge text eligible for the platform default text scale", () => {
    runtime.unread = {
      data: unread(1),
      isError: false,
      isFetchedAfterMount: true,
      isFetching: false,
    };

    const indicator = visualBadge(badgeFor());
    const text = indicator?.props.children as Element;

    expect(text.props.children).toBe("1");
    expect(text.props).not.toHaveProperty("allowFontScaling");
    expect(text.props).not.toHaveProperty("maxFontSizeMultiplier");
  });
});
