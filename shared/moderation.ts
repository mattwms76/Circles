import type { Post } from "./social";

export const MODERATION_PAGE_DEFAULT = 20;
export const MODERATION_PAGE_MAX = 50;
export const MODERATION_NOTE_MAX = 500;
export const MODERATION_REASON_MAX = 500;
export const MODERATION_REASONS_MAX = 20;
export const MODERATION_HISTORY_MAX = 20;
export type ModerationDecision = "keep" | "remove";
export type ModerationStatus = "open" | "kept" | "removed";
export type ModerationFilter = "open" | "resolved";
export type ModerationScope = { circleId: number; viewerScope: number };
export type ModerationCursor = { id: number };
export type ModerationReason = { reason: string; count: number };
export type ModerationReviewer = { id: number; name: string };
export type ModerationAction = {
  id: number;
  decision: ModerationDecision;
  note: string;
  reviewer: ModerationReviewer | null;
  createdAt: string;
};
export type ModerationCase = {
  id: number;
  circleId: number;
  postId: number | null;
  status: ModerationStatus;
  reportCount: number;
  createdAt: string;
  lastReportedAt: string;
  resolvedAt: string | null;
  canResolve: boolean;
  blockedReason: "self_review" | "resolved" | null;
};
export type ModerationPage = ModerationScope & {
  items: ModerationCase[];
  nextCursor: ModerationCursor | null;
};
export type ModerationDetail = ModerationScope & {
  item: ModerationCase;
  post: Post | null;
  reasons: ModerationReason[];
  history: ModerationAction[];
};
export type ModerationResolution = ModerationScope & {
  caseId: number;
  decision: ModerationDecision;
  note: string;
};

/** Notes use Unicode code-point length; blank optional notes normalize to empty. */
export function moderationNote(value: string): string {
  return value.trim();
}
export function moderationTextLength(value: string): number {
  return Array.from(value).length;
}
