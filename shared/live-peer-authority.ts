export type LivePeerAuthorityViewer = Readonly<{
  userId: number;
  generation: number;
}>;

export type LivePeerAuthorityCandidate = LivePeerAuthorityViewer &
  Readonly<{
    lastSeenAt: Date | null | undefined;
    leftAt: Date | null;
  }>;

export type LivePeerAuthorityMembership = Readonly<{
  userId: number;
  role: string | null | undefined;
}>;

/** An approved circle role is required for both hosting and private viewing. */
export function isLiveCircleParticipantRole(
  role: string | null | undefined,
): boolean {
  return role === "owner" || role === "moderator" || role === "member";
}

/**
 * Rechecks the server-authoritative lease and, for private circles, the current
 * membership row. Callers still constrain this in SQL first; the repeated
 * predicate keeps a stale or malformed selected row from becoming a media peer.
 */
export function currentLivePeerAuthority(input: {
  viewers: readonly LivePeerAuthorityCandidate[];
  memberships: readonly LivePeerAuthorityMembership[];
  privateCircle: boolean;
  now: number;
  viewerLeaseMs: number;
}): LivePeerAuthorityViewer[] {
  const membershipRoles = new Map(
    input.memberships.map((membership) => [membership.userId, membership.role]),
  );
  const cutoff = input.now - input.viewerLeaseMs;

  return input.viewers
    .filter(
      (viewer) =>
        viewer.leftAt === null &&
        viewer.lastSeenAt instanceof Date &&
        viewer.lastSeenAt.getTime() > cutoff &&
        (!input.privateCircle ||
          isLiveCircleParticipantRole(membershipRoles.get(viewer.userId))),
    )
    .map(({ userId, generation }) => ({ userId, generation }));
}

/** A host keeps a WebRTC peer only for the exact current viewer generation. */
export function hasLivePeerAuthority(
  viewers: readonly LivePeerAuthorityViewer[],
  viewerId: number,
  generation: number,
): boolean {
  return viewers.some(
    (viewer) => viewer.userId === viewerId && viewer.generation === generation,
  );
}
