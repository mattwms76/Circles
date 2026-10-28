import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vitest";
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
type ElementWithParent = {
  element: ReactElement<ElementProps>;
  parent: ReactElement<ElementProps> | undefined;
};

function findElements(
  node: ReactNode,
  predicate: (element: ReactElement<ElementProps>) => boolean,
  parent?: ReactElement<ElementProps>,
): ElementWithParent[] {
  const matches: ElementWithParent[] = [];

  for (const child of Children.toArray(node)) {
    if (!isValidElement<ElementProps>(child)) continue;
    if (predicate(child)) matches.push({ element: child, parent });
    matches.push(
      ...findElements(child.props.children as ReactNode, predicate, child),
    );
  }

  return matches;
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

function recommendationCard(
  overrides: Partial<Parameters<typeof RecommendationCard>[0]> = {},
) {
  return RecommendationCard({
    circle: circle(),
    reason: "Matches your selected interests.",
    joined: false,
    pending: false,
    busy: false,
    onJoin: vi.fn(),
    ...overrides,
  });
}

describe("D26-24/25 onboarding recommendation cards", () => {
  it("gives each public Join action a concise visual title and its circle-specific accessible name", () => {
    const names = ["Neighbourhood Night Market", "Círculo de lectura nocturna"];

    for (const name of names) {
      const onJoin = vi.fn();
      const card = recommendationCard({
        busy: true,
        circle: circle({ id: name.length, name }),
        onJoin,
      });
      const joinControls = findElements(
        card,
        (element) => element.type === "Button",
      );

      expect(joinControls).toHaveLength(1);
      expect(joinControls[0]?.element.props).toMatchObject({
        title: "Join circle",
        accessibilityLabel: `Join ${name}`,
        secondary: true,
        loading: true,
        onPress: onJoin,
      });
    }
  });

  it("keeps a pending recommendation non-actionable instead of exposing a duplicate Join control", () => {
    const card = recommendationCard({ pending: true });

    expect(
      findElements(card, (element) => element.type === "Button"),
    ).toHaveLength(0);
    expect(
      findElements(
        card,
        (element) =>
          element.type === "T" && element.props.children === "Request pending",
      ),
    ).toHaveLength(1);
  });

  it("constrains a long category chip while retaining the full title and category for assistive technology", () => {
    const longName =
      "A circle with a deliberately long name that still needs room to wrap safely";
    const longCategory =
      "Intergenerational neighbourhood storytelling, repair cafés, and community language exchange";
    const card = recommendationCard({
      circle: circle({ name: longName, category: longCategory }),
    });
    const title = findElements(
      card,
      (element) => element.type === "T" && element.props.children === longName,
    )[0];
    const category = findElements(
      card,
      (element) =>
        element.type === "T" && element.props.children === longCategory,
    )[0];

    expect(title?.element.props).toMatchObject({
      accessibilityLabel: longName,
      style: { flexShrink: 1 },
    });
    expect(title?.parent?.props.style).toMatchObject({
      flex: 1,
      minWidth: 0,
    });
    expect(category?.element.props).toMatchObject({
      accessibilityLabel: `Category: ${longCategory}`,
      ellipsizeMode: "tail",
      numberOfLines: 2,
      style: { color: "#4D5948", flexShrink: 1 },
    });
    expect(category?.parent?.props.style).toMatchObject({
      alignSelf: "flex-start",
      flexShrink: 1,
      minWidth: 0,
      maxWidth: "45%",
    });
  });
});
