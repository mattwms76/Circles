import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Circle } from "../shared/social";

const runtime = vi.hoisted(() => ({
  invalidateDirectories: vi.fn(),
  joinMutate: vi.fn(),
  notify: vi.fn(),
  push: vi.fn(),
  requireAuth: vi.fn<(action: () => void) => void>(),
  utils: {},
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      effect();
    },
    useRef: <Value,>(initialValue: Value) => ({ current: initialValue }),
    useState: <Value,>(initialValue: Value | (() => Value)) => [
      typeof initialValue === "function"
        ? (initialValue as () => Value)()
        : initialValue,
      vi.fn(),
    ],
  };
});
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  View: "View",
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: runtime.push }),
}));
vi.mock("@/components/media-image", () => ({ Image: "Image" }));
vi.mock("@/components/circles-ui", () => ({
  Button: "Button",
  C: { muted: "#4D5948", secondary: "#4D5948" },
  Icon: "Icon",
  s: { between: {}, card: {}, row: {} },
  T: "T",
}));
vi.mock("../components/circles-ui", () => ({
  Button: "Button",
  C: { muted: "#4D5948", secondary: "#4D5948" },
  Icon: "Icon",
  s: { between: {}, card: {}, row: {} },
  T: "T",
}));
vi.mock("@/hooks/circles-context", () => ({
  useCircles: () => ({
    user: { id: 14 },
    requireAuth: runtime.requireAuth,
    notify: runtime.notify,
  }),
}));
vi.mock("@/lib/batch3-account-resource-scope", () => ({
  batch3AccountResourceScope: (
    accountId: number | undefined,
    resource: string,
  ) => (accountId ? `${accountId}:${resource}` : null),
  createBatch3AccountResourceSingleFlight: () => ({
    finish: vi.fn(),
    start: () => true,
  }),
  isCurrentBatch3AccountResourceOperation: (
    current: { generation: number; scope: string } | null,
    captured: { generation: number; scope: string },
  ) =>
    current?.generation === captured.generation &&
    current.scope === captured.scope,
  isPendingAccountResourceScope: (
    pendingScope: string | null,
    currentScope: string | null,
  ) => pendingScope === currentScope && currentScope !== null,
}));
vi.mock("@/lib/source-query-invalidation", () => ({
  invalidateCircleDirectories: runtime.invalidateDirectories,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => runtime.utils,
    social: {
      joinCircle: { useMutation: () => ({ mutate: runtime.joinMutate }) },
    },
  },
}));

const { CircleCard } = await import("../components/circle-card");

type Element = ReactElement<Record<string, unknown>>;

function circle(overrides: Partial<Circle> = {}): Circle {
  return {
    id: 44,
    name: "Neighbourhood Night Market",
    description: "A friendly local group for recipes and weekend event plans.",
    category: "Food and community",
    image: "https://example.test/night-market.jpg",
    color: "#4D5948",
    memberCount: 18,
    ownerId: 8,
    privacy: "private",
    ...overrides,
  };
}

function matchingElements(
  node: ReactNode,
  predicate: (element: Element) => boolean,
): Element[] {
  const matches: Element[] = [];
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    if (predicate(child)) matches.push(child);
    matches.push(
      ...matchingElements(child.props.children as ReactNode, predicate),
    );
  }
  return matches;
}

function textFrom(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(textFrom).join("");
  if (isValidElement<Record<string, unknown>>(node)) {
    return textFrom(node.props.children as ReactNode);
  }
  return "";
}

function renderCard(value: Circle): Element {
  const wrapper = CircleCard({ circle: value }) as Element;
  return (wrapper.type as (props: Record<string, unknown>) => Element)(
    wrapper.props,
  );
}

describe("CBA-14 CircleCard accessible navigation", () => {
  beforeEach(() => {
    runtime.invalidateDirectories.mockReset();
    runtime.joinMutate.mockReset();
    runtime.notify.mockReset();
    runtime.push.mockReset();
    runtime.requireAuth.mockReset();
    runtime.requireAuth.mockImplementation((action) => action());
  });

  it("exposes exactly one named Open target while retaining all visible circle details", () => {
    const card = renderCard(circle());
    const pressables = matchingElements(
      card,
      (element) => element.type === "Pressable",
    );
    const openTargets = pressables.filter(
      (element) =>
        element.props.accessibilityRole === "button" &&
        element.props.accessibilityLabel === "Open Neighbourhood Night Market",
    );
    const text = textFrom(card);

    expect(pressables).toHaveLength(2);
    expect(openTargets).toHaveLength(1);
    expect(pressables[0]?.props).toMatchObject({
      accessible: false,
      importantForAccessibility: "no-hide-descendants",
    });
    expect(text).toContain("Food and community");
    expect(text).toContain("Neighbourhood Night Market");
    expect(text).toContain(
      "A friendly local group for recipes and weekend event plans.",
    );
    expect(text).toContain("18 members · private");
  });

  it("keeps Join as an independent mutation control rather than a second Open target", () => {
    const card = renderCard(circle());
    const controls = matchingElements(
      card,
      (element) => element.type === "Button",
    );

    expect(controls).toHaveLength(1);
    expect(controls[0]?.props).toMatchObject({
      title: "Join circle",
      disabled: false,
    });

    (controls[0]?.props.onPress as () => void)();

    expect(runtime.requireAuth).toHaveBeenCalledTimes(1);
    expect(runtime.joinMutate).toHaveBeenCalledWith(
      { circleId: 44 },
      expect.any(Object),
    );
    expect(runtime.push).not.toHaveBeenCalled();
  });

  it("retains the separately disabled Requested membership state", () => {
    const card = renderCard(circle({ role: "pending" }));
    const controls = matchingElements(
      card,
      (element) => element.type === "Button",
    );

    expect(controls).toHaveLength(1);
    expect(controls[0]?.props).toMatchObject({
      title: "Requested",
      secondary: true,
      disabled: true,
    });
  });
});
