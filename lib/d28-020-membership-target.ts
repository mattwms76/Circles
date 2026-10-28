export type D28020MembershipTarget = Readonly<{
  accountId: number;
  circleId: number;
}>;

/**
 * A settling membership request may only clear the exact target it captured,
 * while its originating account and component instance are still current.
 */
export function canClearD28020MembershipTarget(
  activeTarget: D28020MembershipTarget | null,
  settlingTarget: D28020MembershipTarget,
  currentAccountId: number | null,
  isMounted: boolean,
): boolean {
  return (
    isMounted &&
    currentAccountId === settlingTarget.accountId &&
    activeTarget === settlingTarget
  );
}
