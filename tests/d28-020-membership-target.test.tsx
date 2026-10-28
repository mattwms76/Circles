import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vitest";
import {
  canClearD28020MembershipTarget,
  type D28020MembershipTarget,
} from "../lib/d28-020-membership-target";
import type { Circle } from "../shared/social";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  View: "View",
}));
vi.mock("expo-router", () => ({
  useLocalSearchParams: vi.fn(),
  useRouter: vi.fn(),
}));
vi.mock("@/components/app-shell", () => ({ AppShell: "AppShell" }));
vi.mock("@/components/circles-ui", () => ({
  Button: "Button",
  C: {
    action: "#A53728",
    border: "#E8E9E2",
    coral: "#ED604A",
    ink: "#242825",
    paper: "#FFFFFF",
    sage: "#E9EEE5",
    secondary: "#4D5948",
    soft: "#FFF0EB",
  },
  Empty: "Empty",
  Icon: "Icon",
  Loading: "Loading",
  s: { between: { flexDirection: "row" }, card: {}, row: {} },
  T: "T",
  Heading: "T",
}));
vi.mock("@/components/status-message", () => ({
  StatusMessage: "StatusMessage",
}));
vi.mock("@/hooks/circles-context", () => ({ useCircles: vi.fn() }));
vi.mock("@/lib/onboarding-ui", () => ({
  hydrateOnboardingForAccount: vi.fn(),
  isCurrentOnboardingAccount: vi.fn(),
  isIntroductionEligible: vi.fn(),
  toggleInterestSelection: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));
vi.mock("@/shared/onboarding", () => ({ INTERESTS: [], MAX_INTERESTS: 6 }));

const { RecommendationCard } = await import("../app/onboarding");

type ElementProps = Record<string, unknown>;

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement<ElementProps>) => boolean,
): ReactElement<ElementProps> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<ElementProps>(child)) continue;
    if (predicate(child)) return child;
    const nested = findElement(child.props.children as ReactNode, predicate);
    if (nested) return nested;
  }
  return undefined;
}

function circle(overrides: Partial<Circle> = {}): Circle {
  return {
    id: 72,
    name: "Neighbourhood Night Market",
    description: "A friendly local group for sharing recipes and event plans.",
    category: "Food and community",
    image: "",
    color: "#4D5948",
    memberCount: 18,
    ownerId: 12,
    privacy: "public",
    ...overrides,
  };
}

function joinButton({
  name,
  busy,
  disabled,
}: {
  name: string;
  busy: boolean;
  disabled: boolean;
}) {
  const card = RecommendationCard({
    circle: circle({ id: name.length, name }),
    reason: "Matches your selected interests.",
    joined: false,
    pending: false,
    busy,
    disabled,
    onJoin: vi.fn(),
  });
  return findElement(card, (element) => element.type === "Button");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("D28-020 recommendation membership progress", () => {
  it("renders a spinner only for the initiating card while preserving the other disabled Join name", () => {
    const target = joinButton({
      name: "Neighbourhood Night Market",
      busy: true,
      disabled: true,
    });
    const other = joinButton({
      name: "Círculo de lectura nocturna",
      busy: false,
      disabled: true,
    });

    expect(target?.props).toMatchObject({
      title: "Join circle",
      accessibilityLabel: "Join Neighbourhood Night Market",
      loading: true,
      disabled: true,
    });
    expect(other?.props).toMatchObject({
      title: "Join circle",
      accessibilityLabel: "Join Círculo de lectura nocturna",
      loading: false,
      disabled: true,
    });
  });

  it("does not let a deferred old-account or unmounted completion clear a newer target", async () => {
    const first: D28020MembershipTarget = { accountId: 31, circleId: 72 };
    const newer: D28020MembershipTarget = { accountId: 31, circleId: 89 };
    const activeTarget = { current: first as D28020MembershipTarget | null };
    const oldRequest = deferred<void>();
    const oldSettlement = oldRequest.promise.then(() => {
      if (
        canClearD28020MembershipTarget(activeTarget.current, first, 31, true)
      ) {
        activeTarget.current = null;
      }
    });

    activeTarget.current = newer;
    oldRequest.resolve();
    await oldSettlement;

    expect(activeTarget.current).toBe(newer);
    expect(canClearD28020MembershipTarget(newer, newer, 32, true)).toBe(false);
    expect(canClearD28020MembershipTarget(newer, newer, 31, false)).toBe(false);
    expect(canClearD28020MembershipTarget(newer, newer, 31, true)).toBe(true);
  });
});
