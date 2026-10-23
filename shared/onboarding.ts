import type { Circle } from "./social";

/** Explicit, editable interests only. Do not infer these from private content. */
export const INTERESTS = [
  {
    id: "lifestyle",
    label: "Everyday life",
    category: "Lifestyle",
    icon: "sunny-outline",
  },
  {
    id: "outdoors",
    label: "Outdoors",
    category: "Outdoors",
    icon: "leaf-outline",
  },
  {
    id: "design",
    label: "Design",
    category: "Design",
    icon: "color-palette-outline",
  },
  {
    id: "photography",
    label: "Photography",
    category: "Photography",
    icon: "camera-outline",
  },
  {
    id: "fitness",
    label: "Fitness",
    category: "Fitness",
    icon: "barbell-outline",
  },
  {
    id: "music",
    label: "Music",
    category: "Music",
    icon: "musical-notes-outline",
  },
  {
    id: "food",
    label: "Food & cooking",
    category: "Food",
    icon: "restaurant-outline",
  },
  {
    id: "travel",
    label: "Travel",
    category: "Travel",
    icon: "compass-outline",
  },
  { id: "books", label: "Books", category: "Books", icon: "book-outline" },
  {
    id: "gaming",
    label: "Gaming",
    category: "Gaming",
    icon: "game-controller-outline",
  },
  {
    id: "technology",
    label: "Technology",
    category: "Technology",
    icon: "hardware-chip-outline",
  },
  { id: "art", label: "Art & making", category: "Art", icon: "brush-outline" },
] as const;
export type InterestId = (typeof INTERESTS)[number]["id"];
export const INTEREST_IDS = INTERESTS.map((interest) => interest.id) as [
  InterestId,
  ...InterestId[],
];
export const MAX_INTERESTS = 6;
export type OnboardingStep =
  | "interests"
  | "circles"
  | "first-post"
  | "complete";
export type OnboardingStatus = {
  userId: number;
  interests: InterestId[];
  step: OnboardingStep;
  completedAt: string | null;
};
export type CircleRecommendation = {
  circle: Circle;
  matchedInterests: InterestId[];
  reason: string;
};
export type CircleRecommendations = {
  userId: number;
  interests: InterestId[];
  items: CircleRecommendation[];
  basis: "interests" | "explore";
};
export const INTRODUCTION_DRAFT =
  "Hi everyone! I’m new here. One thing I’d love to share or learn with this circle is…";

export function interestMatches(
  category: string,
  interests: readonly InterestId[],
): InterestId[] {
  const normalized = category.trim().toLowerCase();
  return INTERESTS.filter(
    (interest) =>
      interests.includes(interest.id) &&
      interest.category.toLowerCase() === normalized,
  ).map((interest) => interest.id);
}
export function recommendationReason(matched: readonly InterestId[]): string {
  const labels = INTERESTS.filter((interest) =>
    matched.includes(interest.id),
  ).map((interest) => interest.label);
  return labels.length
    ? `Because you chose ${labels.join(" and ")}.`
    : "A public circle to explore — not an interest match.";
}

export type IntroductionTarget = {
  userId: number;
  circleId: number;
  eligible: boolean;
};
