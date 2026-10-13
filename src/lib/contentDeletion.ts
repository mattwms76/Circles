export const CONTENT_DELETE_WINDOW_MS = 15 * 60 * 1000;

/** A UI hint only: the database independently checks ownership and its own clock. */
export function canDeleteOwnContent(
  ownerId: string,
  viewerId: string,
  createdAtIso?: string,
  now = Date.now(),
): boolean {
  if (!viewerId || ownerId !== viewerId || !createdAtIso) return false;
  const created = Date.parse(createdAtIso);
  return Number.isFinite(created) && now >= created && now < created + CONTENT_DELETE_WINDOW_MS;
}
