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

function visualText(badge: Element): unknown {
  const badgeView = visualBadge(badge);
  const text = badgeView?.props.children;
  return isValidElement<Record<string, unknown>>(text)
    ? text.props.children
    : undefined;
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

describe("D28-022 ActivityBadge unread accessibility", () => {
  it("keeps 137 visually capped at 99+ while announcing its exact current count", () => {
    runtime.unread = {
      data: unread(137),
      isError: false,
      isFetchedAfterMount: true,
      isFetching: false,
    };

    const badge = badgeFor();
    const indicator = visualBadge(badge);

    expect(visualText(badge)).toBe("99+");
    expect(badge.props.accessibilityLabel).toBe("Open Updates, 137 unread");
    expect(
      readableStyle(
        (badge.props.style as (state: { pressed: boolean }) => unknown)({
          pressed: false,
        }),
      ),
    ).toMatchObject({ minWidth: 44, minHeight: 44 });
    expect(readableStyle(indicator?.props.style)).toMatchObject({
      minWidth: 18,
      minHeight: 18,
      paddingHorizontal: 4,
      paddingVertical: 2,
      borderRadius: 9,
    });
    expect(readableStyle(indicator?.props.style)).not.toHaveProperty("height");
  });

  it.each([
    [0, "Open Updates, 0 unread", undefined],
    [1, "Open Updates, 1 unread", "1"],
  ])("announces the exact accessible count for %i", (count, label, visual) => {
    runtime.unread = {
      data: unread(count),
      isError: false,
      isFetchedAfterMount: true,
      isFetching: false,
    };

    const badge = badgeFor();

    expect(badge.props.accessibilityLabel).toBe(label);
    expect(visualText(badge)).toBe(visual);
  });

  it("uses only the current viewer response and keeps its viewer-scoped query enabled", () => {
    runtime.unread = {
      data: unread(137, 7),
      isError: false,
      isFetchedAfterMount: true,
      isFetching: false,
    };

    const badge = badgeFor(42);

    expect(badge.props.accessibilityLabel).toBe("Open Updates");
    expect(visualText(badge)).toBeUndefined();
    expect(runtime.useQuery).toHaveBeenCalledWith(
      { viewerScope: 42 },
      expect.objectContaining({ enabled: true }),
    );
  });

  it.each([Infinity, -1, 1.5, Number.NaN, "137"])(
    "does not announce or render a malformed unread count of %s",
    (count) => {
      runtime.unread = {
        data: unread(count),
        isError: false,
        isFetchedAfterMount: true,
        isFetching: false,
      };

      const badge = badgeFor();

      expect(badge.props.accessibilityLabel).toBe("Open Updates");
      expect(visualText(badge)).toBeUndefined();
    },
  );
});
