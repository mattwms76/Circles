import { and, eq, inArray } from "drizzle-orm";
import { activityCirclePreferences, activityItems, activityPreferences } from "../drizzle/activity-schema";
import { memberships, users } from "../drizzle/schema";
import type { CirclesTransaction } from "./db";

const APPROVED_ROLES = ["owner", "moderator", "member"] as const;

type CommentActivitySource = {
  recipientId: number;
  actorId: number;
  sourceId: number;
  postId: number;
  circleId: number | null;
};

type MembershipApprovalActivitySource = {
  recipientId: number;
  actorId: number;
  sourceId: number;
  circleId: number;
};

/**
 * Activity preference writers take this same lock. It makes the eligibility read and
 * insertion atomic with a recipient's desired-state update without inventing a row.
 */
export async function lockActivityRecipient(
  tx: CirclesTransaction,
  recipientId: number,
): Promise<boolean> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, recipientId))
    .limit(1)
    .for("update");
  return rows.length === 1;
}

async function categoryEnabled(
  tx: CirclesTransaction,
  recipientId: number,
  category: "commentsEnabled" | "membershipApprovalsEnabled",
): Promise<boolean> {
  const rows = await tx
    .select({ enabled: activityPreferences[category] })
    .from(activityPreferences)
    .where(eq(activityPreferences.recipientId, recipientId))
    .limit(1);
  // Absence deliberately means the schema's documented global defaults; no event reads create state.
  return rows[0]?.enabled ?? true;
}

async function isMutedForCircle(
  tx: CirclesTransaction,
  recipientId: number,
  circleId: number | null,
): Promise<boolean> {
  if (circleId === null) return false;
  const rows = await tx
    .select({ muted: activityCirclePreferences.muted })
    .from(activityCirclePreferences)
    .where(
      and(
        eq(activityCirclePreferences.recipientId, recipientId),
        eq(activityCirclePreferences.circleId, circleId),
      ),
    )
    .limit(1);
  return rows[0]?.muted ?? false;
}

async function isCurrentApprovedMember(
  tx: CirclesTransaction,
  recipientId: number,
  circleId: number,
): Promise<boolean> {
  const rows = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, recipientId),
        eq(memberships.circleId, circleId),
        inArray(memberships.role, APPROVED_ROLES),
      ),
    )
    .limit(1);
  return rows.length === 1;
}

/** Called only after the source comment was actually inserted in the caller's transaction. */
export async function recordCommentActivity(
  tx: CirclesTransaction,
  source: CommentActivitySource,
): Promise<void> {
  if (source.recipientId === source.actorId) return;
  if (!(await lockActivityRecipient(tx, source.recipientId))) return;
  if (!(await categoryEnabled(tx, source.recipientId, "commentsEnabled"))) return;
  if (source.circleId !== null) {
    // Public-circle activity is still recipient-member-only; public visibility is not inbox authority.
    if (!(await isCurrentApprovedMember(tx, source.recipientId, source.circleId))) return;
    if (await isMutedForCircle(tx, source.recipientId, source.circleId)) return;
  }
  await tx
    .insert(activityItems)
    .values({
      recipientId: source.recipientId,
      actorId: source.actorId,
      kind: "comment_on_your_post",
      sourceId: source.sourceId,
      circleId: source.circleId,
      postId: source.postId,
    })
    .onConflictDoNothing({
      target: [activityItems.recipientId, activityItems.kind, activityItems.sourceId],
    });
}

/** Called only after a pending membership row was durably transitioned to `member`. */
export async function recordMembershipApprovalActivity(
  tx: CirclesTransaction,
  source: MembershipApprovalActivitySource,
): Promise<void> {
  if (source.recipientId === source.actorId) return;
  if (!(await lockActivityRecipient(tx, source.recipientId))) return;
  if (!(await categoryEnabled(tx, source.recipientId, "membershipApprovalsEnabled"))) return;
  if (await isMutedForCircle(tx, source.recipientId, source.circleId)) return;
  await tx
    .insert(activityItems)
    .values({
      recipientId: source.recipientId,
      actorId: source.actorId,
      kind: "membership_approved",
      sourceId: source.sourceId,
      circleId: source.circleId,
      postId: null,
    })
    .onConflictDoNothing({
      target: [activityItems.recipientId, activityItems.kind, activityItems.sourceId],
    });
}
