import type { Post } from "./social";

export const ACTIVITY_ID_MAX = 2_147_483_647;
export const ACTIVITY_PAGE_DEFAULT = 20;
export const ACTIVITY_PAGE_MAX = 40;
export const ACTIVITY_KINDS = [
  "comment_on_your_post",
  "membership_approved",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export type ActivityCursor = { beforeId: number };
export type ActivityItem = {
  id: number;
  kind: ActivityKind;
  createdAt: string;
  readAt: string | null;
  available: boolean;
  actorName: string | null;
  circleName: string | null;
};
export type ActivityPage = {
  viewerId: number;
  items: ActivityItem[];
  nextCursor: ActivityCursor | null;
};
export type ActivityUnread = {
  viewerId: number;
  count: number;
  throughId: number;
};
export type ActivityPreferences = {
  viewerId: number;
  commentsEnabled: boolean;
  membershipApprovalsEnabled: boolean;
  circle: { id: number; name: string; muted: boolean } | null;
};
export type ActivityTarget = {
  viewerId: number;
  activityId: number;
  target:
    | { type: "post"; post: Post }
    | { type: "circle"; circleId: number }
    | null;
};
export type ActivityWriteResult = { viewerId: number; success: true };

/** Scope is an affinity check; actual identity always comes from the protected context. */
export type ActivityScope = { viewerScope?: number };
export type ActivityListInput = ActivityScope & {
  limit?: number;
  cursor?: ActivityCursor;
};
export type ActivityPreferencesInput = ActivityScope & { circleId?: number };
export type ActivityCategoryPatch = ActivityScope & {
  commentsEnabled?: boolean;
  membershipApprovalsEnabled?: boolean;
};
export type ActivityCirclePatch = ActivityScope & {
  circleId: number;
  muted: boolean;
};
