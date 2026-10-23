import type { IntroductionTarget } from "../shared/onboarding";

/** A route flag never establishes account, completion or membership authority. */
export function canPrefillIntroduction({
  requested,
  accountId,
  target,
  circleId,
  confirmed,
}: {
  requested: boolean;
  accountId: number | null | undefined;
  target: IntroductionTarget | null | undefined;
  circleId: number | undefined;
  confirmed: boolean;
}): boolean {
  return !!(
    requested &&
    confirmed &&
    accountId &&
    circleId &&
    target?.userId === accountId &&
    target.circleId === circleId &&
    target.eligible === true
  );
}
