import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, lte, lt, sql } from "drizzle-orm";
import {
  activityCirclePreferences,
  activityItems,
  activityPreferences,
} from "../drizzle/activity-schema";
import { circles, memberships, posts, profiles } from "../drizzle/schema";
import {
  ACTIVITY_ID_MAX,
  ACTIVITY_PAGE_DEFAULT,
  ACTIVITY_PAGE_MAX,
  type ActivityCategoryPatch,
  type ActivityCirclePatch,
  type ActivityItem,
  type ActivityKind,
  type ActivityListInput,
  type ActivityPage,
  type ActivityPreferences,
  type ActivityPreferencesInput,
  type ActivityScope,
  type ActivityTarget,
  type ActivityUnread,
  type ActivityWriteResult,
} from "../shared/activity";
import { getActivityPostTarget } from "./social-service";
import { lockActivityRecipient } from "./activity-events";
import { getDb, type CirclesDatabase, type CirclesTransaction } from "./db";

const APPROVED_ROLES = ["owner", "moderator", "member"] as const;
type Database = CirclesDatabase | CirclesTransaction;
type ActivityRow = typeof activityItems.$inferSelect;

function activityError(code: TRPCError["code"], message: string): never {
  throw new TRPCError({ code, message });
}

function requireActivityId(
  value: unknown,
  field = "activity identifier",
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > ACTIVITY_ID_MAX
  ) {
    activityError("BAD_REQUEST", `Invalid ${field}`);
  }
  return value;
}

/** An optional scope is a cache-affinity assertion, never caller supplied authority. */
function assertViewerScope(
  viewerId: number,
  input: ActivityScope | undefined,
): void {
  if (input?.viewerScope !== undefined && input.viewerScope !== viewerId) {
    activityError(
      "CONFLICT",
      "Activity response belongs to a different account",
    );
  }
}

async function requireDb(): Promise<CirclesDatabase> {
  const db = await getDb();
  if (!db)
    activityError("PRECONDITION_FAILED", "Activity inbox is unavailable");
  return db;
}

function countToSafeInteger(value: unknown): number {
  const numberValue = Number(value ?? 0);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 0;
  return Math.min(ACTIVITY_ID_MAX, Math.floor(numberValue));
}

function toIso(value: Date): string {
  return value.toISOString();
}

function activityDisplayName(value: string): string {
  return Array.from(value.trim()).slice(0, 140).join("");
}

function activityNotFound(): never {
  activityError("NOT_FOUND", "Activity item not found");
}

function normalizeList(input: ActivityListInput): {
  limit: number;
  beforeId?: number;
} {
  const limit = input.limit ?? ACTIVITY_PAGE_DEFAULT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > ACTIVITY_PAGE_MAX) {
    activityError("BAD_REQUEST", "Invalid activity page size");
  }
  const beforeId = input.cursor
    ? requireActivityId(input.cursor.beforeId, "activity cursor")
    : undefined;
  return beforeId === undefined ? { limit } : { limit, beforeId };
}

async function globalPreferenceRow(db: Database, recipientId: number) {
  const rows = await db
    .select({
      commentsEnabled: activityPreferences.commentsEnabled,
      membershipApprovalsEnabled:
        activityPreferences.membershipApprovalsEnabled,
    })
    .from(activityPreferences)
    .where(eq(activityPreferences.recipientId, recipientId))
    .limit(1);
  return rows[0] ?? { commentsEnabled: true, membershipApprovalsEnabled: true };
}

/**
 * Private Activity DTOs lock the same parent row used by social membership removal before they
 * re-read the recipient role. Pending requesters retain their existing preference policy; callers
 * that project activity content still apply the approved-role predicate below.
 */
async function lockMemberCircleForReadOrNull(
  tx: CirclesTransaction,
  recipientId: number,
  circleId: number,
) {
  const circleRows = await tx
    .select({ name: circles.name })
    .from(circles)
    .where(eq(circles.id, circleId))
    .limit(1)
    .for("share");
  const circle = circleRows[0];
  if (!circle) return null;
  const membershipRows = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.circleId, circleId),
        eq(memberships.userId, recipientId),
      ),
    )
    .limit(1);
  const membership = membershipRows[0];
  return membership ? { name: circle.name, role: membership.role } : null;
}

/** Mutations lock the circle before the recipient row to match social's established lock order. */
async function lockMemberCircleOrNull(
  tx: CirclesTransaction,
  recipientId: number,
  circleId: number,
) {
  const rows = await tx
    .select({ name: circles.name })
    .from(circles)
    .where(eq(circles.id, circleId))
    .limit(1)
    .for("update");
  const circle = rows[0];
  if (!circle) return null;
  const membership = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.circleId, circleId),
        eq(memberships.userId, recipientId),
      ),
    )
    .limit(1);
  return membership[0] ? circle : null;
}

async function circlePreferenceOutput(
  db: CirclesTransaction,
  viewerId: number,
  circleId: number,
  global: { commentsEnabled: boolean; membershipApprovalsEnabled: boolean },
): Promise<ActivityPreferences> {
  const circle = await lockMemberCircleForReadOrNull(db, viewerId, circleId);
  if (!circle) activityError("NOT_FOUND", "Circle preference target not found");
  const preference = await db
    .select({ muted: activityCirclePreferences.muted })
    .from(activityCirclePreferences)
    .where(
      and(
        eq(activityCirclePreferences.recipientId, viewerId),
        eq(activityCirclePreferences.circleId, circleId),
      ),
    )
    .limit(1);
  return {
    viewerId,
    commentsEnabled: global.commentsEnabled,
    membershipApprovalsEnabled: global.membershipApprovalsEnabled,
    circle: {
      id: circleId,
      name: activityDisplayName(circle.name),
      muted: preference[0]?.muted ?? false,
    },
  };
}

async function activeCircleName(
  db: CirclesTransaction,
  recipientId: number,
  circleId: number,
): Promise<string | null> {
  const circle = await lockMemberCircleForReadOrNull(db, recipientId, circleId);
  if (
    !circle ||
    !APPROVED_ROLES.includes(circle.role as (typeof APPROVED_ROLES)[number])
  ) {
    return null;
  }
  return activityDisplayName(circle.name);
}

/**
 * There is no persisted circle-scoped bit. A comment is only available when its
 * surviving post still has the same circle ID as the event; null is only a global post.
 * Deletion clears/cascades targets, so no former-circle item can be reinterpreted globally.
 */
async function itemAvailability(
  db: CirclesTransaction,
  recipientId: number,
  item: ActivityRow,
): Promise<{ available: boolean; circleName: string | null }> {
  if (item.kind === "comment_on_your_post") {
    if (item.postId === null) return { available: false, circleName: null };
    let circleName: string | null = null;
    if (item.circleId !== null) {
      // Lock/check the parent before selecting the protected post target or its author metadata.
      circleName = await activeCircleName(db, recipientId, item.circleId);
      if (circleName === null) return { available: false, circleName: null };
    }
    const postRows = await db
      .select({ circleId: posts.circleId })
      .from(posts)
      .where(eq(posts.id, item.postId))
      .limit(1);
    const post = postRows[0];
    if (!post || post.circleId !== item.circleId) {
      return { available: false, circleName: null };
    }
    if (item.circleId === null) return { available: true, circleName: null };
    return { available: true, circleName };
  }
  if (item.kind === "membership_approved" && item.circleId !== null) {
    const circleName = await activeCircleName(db, recipientId, item.circleId);
    return circleName === null
      ? { available: false, circleName: null }
      : { available: true, circleName };
  }
  return { available: false, circleName: null };
}

async function mapItem(
  db: CirclesTransaction,
  recipientId: number,
  row: ActivityRow,
): Promise<ActivityItem> {
  const target = await itemAvailability(db, recipientId, row);
  let actorName: string | null = null;
  if (target.available && row.actorId !== null) {
    const actor = await db
      .select({ name: profiles.name })
      .from(profiles)
      .where(eq(profiles.userId, row.actorId))
      .limit(1);
    actorName = activityDisplayName(actor[0]?.name ?? "") || "Circles member";
  }
  return {
    id: row.id,
    kind: row.kind as ActivityKind,
    createdAt: toIso(row.createdAt),
    readAt: row.readAt ? toIso(row.readAt) : null,
    available: target.available,
    actorName: target.available ? actorName : null,
    circleName: target.available ? target.circleName : null,
  };
}

async function recipientItemOrNotFound(
  db: Database,
  recipientId: number,
  id: number,
): Promise<ActivityRow> {
  const rows = await db
    .select()
    .from(activityItems)
    .where(
      and(eq(activityItems.recipientId, recipientId), eq(activityItems.id, id)),
    )
    .limit(1);
  if (!rows[0]) activityNotFound();
  return rows[0];
}

export async function listActivity(
  viewerId: number,
  input: ActivityListInput = {},
): Promise<ActivityPage> {
  assertViewerScope(viewerId, input);
  const { limit, beforeId } = normalizeList(input);
  const db = await requireDb();
  const clauses = [eq(activityItems.recipientId, viewerId)];
  if (beforeId !== undefined) clauses.push(lt(activityItems.id, beforeId));
  const rows = await db
    .select()
    .from(activityItems)
    .where(and(...clauses))
    .orderBy(desc(activityItems.id))
    .limit(limit + 1);
  const pageRows = rows.slice(0, limit);
  const last = pageRows[pageRows.length - 1];
  return {
    viewerId,
    items: await Promise.all(
      pageRows.map((row) => db.transaction((tx) => mapItem(tx, viewerId, row))),
    ),
    nextCursor: rows.length > limit && last ? { beforeId: last.id } : null,
  };
}

export async function getActivityUnread(
  viewerId: number,
  input: ActivityScope = {},
): Promise<ActivityUnread> {
  assertViewerScope(viewerId, input);
  const db = await requireDb();
  const counts = await db
    .select({
      count: sql<number>`count(*) filter (where ${activityItems.readAt} is null)`,
      throughId: sql<number>`coalesce(max(${activityItems.id}), 0)`,
    })
    .from(activityItems)
    .where(eq(activityItems.recipientId, viewerId));
  return {
    viewerId,
    count: countToSafeInteger(counts[0]?.count),
    throughId: countToSafeInteger(counts[0]?.throughId),
  };
}

export async function getActivityPreferences(
  viewerId: number,
  input: ActivityPreferencesInput = {},
): Promise<ActivityPreferences> {
  assertViewerScope(viewerId, input);
  const circleId =
    input.circleId === undefined
      ? undefined
      : requireActivityId(input.circleId, "circle identifier");
  const db = await requireDb();
  const global = await globalPreferenceRow(db, viewerId);
  if (circleId === undefined) {
    return { viewerId, ...global, circle: null };
  }
  return db.transaction((tx) =>
    circlePreferenceOutput(tx, viewerId, circleId, global),
  );
}

export async function resolveActivityTarget(
  viewerId: number,
  input: ActivityScope & { id: number },
): Promise<ActivityTarget> {
  assertViewerScope(viewerId, input);
  const id = requireActivityId(input.id);
  const db = await requireDb();
  const item = await recipientItemOrNotFound(db, viewerId, id);
  if (item.kind === "comment_on_your_post" && item.postId !== null) {
    // The social helper repeats post/circle/current-approved-membership authorization at resolution time.
    const post = await getActivityPostTarget(
      viewerId,
      item.postId,
      item.circleId,
    );
    return {
      viewerId,
      activityId: id,
      target: post ? { type: "post", post } : null,
    };
  }
  if (item.kind === "membership_approved" && item.circleId !== null) {
    const circleId = item.circleId;
    const circleName = await db.transaction((tx) =>
      activeCircleName(tx, viewerId, circleId),
    );
    return {
      viewerId,
      activityId: id,
      target: circleName === null ? null : { type: "circle", circleId },
    };
  }
  return { viewerId, activityId: id, target: null };
}

export async function markActivityRead(
  viewerId: number,
  input: ActivityScope & { id: number },
): Promise<ActivityWriteResult> {
  assertViewerScope(viewerId, input);
  const id = requireActivityId(input.id);
  const db = await requireDb();
  const updated = await db
    .update(activityItems)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(activityItems.recipientId, viewerId),
        eq(activityItems.id, id),
        isNull(activityItems.readAt),
      ),
    )
    .returning({ id: activityItems.id });
  if (!updated[0]) {
    // An already-read own item is still a successful desired state; all other cases are indistinguishable.
    await recipientItemOrNotFound(db, viewerId, id);
  }
  return { viewerId, success: true };
}

export async function markAllActivityRead(
  viewerId: number,
  input: ActivityScope & { throughId: number },
): Promise<ActivityWriteResult> {
  assertViewerScope(viewerId, input);
  const throughId =
    input?.throughId === 0
      ? 0
      : requireActivityId(input?.throughId, "activity watermark");
  const db = await requireDb();
  if (throughId > 0) {
    await db
      .update(activityItems)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(activityItems.recipientId, viewerId),
          isNull(activityItems.readAt),
          lte(activityItems.id, throughId),
        ),
      );
  }
  return { viewerId, success: true };
}

export async function updateActivityCategories(
  viewerId: number,
  input: ActivityCategoryPatch,
): Promise<ActivityPreferences> {
  assertViewerScope(viewerId, input);
  if (
    input.commentsEnabled === undefined &&
    input.membershipApprovalsEnabled === undefined
  ) {
    activityError("BAD_REQUEST", "Choose at least one activity category");
  }
  if (
    (input.commentsEnabled !== undefined &&
      typeof input.commentsEnabled !== "boolean") ||
    (input.membershipApprovalsEnabled !== undefined &&
      typeof input.membershipApprovalsEnabled !== "boolean")
  ) {
    activityError("BAD_REQUEST", "Invalid activity category state");
  }
  const db = await requireDb();
  return db.transaction(async (tx) => {
    if (!(await lockActivityRecipient(tx, viewerId)))
      activityError("NOT_FOUND", "Account not found");
    const set = {
      ...(input.commentsEnabled === undefined
        ? {}
        : { commentsEnabled: input.commentsEnabled }),
      ...(input.membershipApprovalsEnabled === undefined
        ? {}
        : { membershipApprovalsEnabled: input.membershipApprovalsEnabled }),
      updatedAt: new Date(),
    };
    await tx
      .insert(activityPreferences)
      .values({
        recipientId: viewerId,
        commentsEnabled: input.commentsEnabled ?? true,
        membershipApprovalsEnabled: input.membershipApprovalsEnabled ?? true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({ target: activityPreferences.recipientId, set });
    const global = await globalPreferenceRow(tx, viewerId);
    return { viewerId, ...global, circle: null };
  });
}

export async function setActivityCircleMuted(
  viewerId: number,
  input: ActivityCirclePatch,
): Promise<ActivityPreferences> {
  assertViewerScope(viewerId, input);
  const circleId = requireActivityId(input.circleId, "circle identifier");
  if (typeof input.muted !== "boolean")
    activityError("BAD_REQUEST", "Invalid muted state");
  const db = await requireDb();
  return db.transaction(async (tx) => {
    // Circle first, recipient second: this matches social's circle mutation lock order.
    const circle = await lockMemberCircleOrNull(tx, viewerId, circleId);
    if (!circle)
      activityError("NOT_FOUND", "Circle preference target not found");
    if (!(await lockActivityRecipient(tx, viewerId)))
      activityError("NOT_FOUND", "Account not found");
    await tx
      .insert(activityCirclePreferences)
      .values({
        recipientId: viewerId,
        circleId,
        muted: input.muted,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          activityCirclePreferences.recipientId,
          activityCirclePreferences.circleId,
        ],
        set: { muted: input.muted, updatedAt: new Date() },
      });
    const global = await globalPreferenceRow(tx, viewerId);
    return {
      viewerId,
      ...global,
      circle: {
        id: circleId,
        name: activityDisplayName(circle.name),
        muted: input.muted,
      },
    };
  });
}

/** Exported for synthetic tests without exposing caller-supplied recipient authority. */
export const activityInternals = {
  assertViewerScope,
  itemAvailability,
  normalizeList,
  activityDisplayName,
};
