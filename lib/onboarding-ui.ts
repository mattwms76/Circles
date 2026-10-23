import {
  INTEREST_IDS,
  MAX_INTERESTS,
  type InterestId,
  type OnboardingStatus,
} from "../shared/onboarding";
import type { Circle } from "../shared/social";

const allowedInterestIds = new Set<string>(INTEREST_IDS);

/** Keeps only explicit, allowlisted interests and preserves their first selection order. */
export function normalizeInterestSelection(
  values: readonly string[] | readonly InterestId[] | null | undefined,
): InterestId[] {
  if (!values) return [];

  const normalized: InterestId[] = [];
  for (const value of values) {
    if (
      normalized.length < MAX_INTERESTS &&
      allowedInterestIds.has(value) &&
      !normalized.includes(value as InterestId)
    ) {
      normalized.push(value as InterestId);
    }
  }
  return normalized;
}

/** Adds or removes one explicit interest without ever exceeding the server limit. */
export function toggleInterestSelection(
  selected: readonly InterestId[],
  interest: InterestId,
): InterestId[] {
  const normalized = normalizeInterestSelection(selected);
  if (normalized.includes(interest)) {
    return normalized.filter((item) => item !== interest);
  }
  if (normalized.length >= MAX_INTERESTS) return normalized;
  return [...normalized, interest];
}

/**
 * A response without the current account's id is never safe to render. This
 * prevents cached protected query data from a previous account becoming UI.
 */
export function hydrateOnboardingForAccount(
  status: OnboardingStatus | null | undefined,
  accountId: number | null | undefined,
): OnboardingStatus | null {
  if (!status || !accountId || status.userId !== accountId) return null;
  return {
    ...status,
    interests: normalizeInterestSelection(status.interests),
  };
}

export function isCurrentOnboardingAccount(
  capturedAccountId: number,
  currentAccountId: number | null | undefined,
): boolean {
  return capturedAccountId === currentAccountId;
}

/** Pending/private memberships cannot be offered as an introduction target. */
export function isIntroductionEligible(
  circle: Pick<Circle, "privacy" | "joined" | "role">,
  optimisticallyJoined = false,
): boolean {
  return (
    circle.privacy === "public" &&
    circle.role !== "pending" &&
    (circle.joined === true || optimisticallyJoined)
  );
}
