import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import {
  moderationActions,
  moderationCases,
} from "../drizzle/moderation-schema";
import { circles, memberships, profiles } from "../drizzle/schema";
import {
  MODERATION_HISTORY_MAX,
  MODERATION_NOTE_MAX,
  MODERATION_PAGE_DEFAULT,
  MODERATION_PAGE_MAX,
  moderationNote,
  moderationTextLength,
  type ModerationAction,
  type ModerationCase,
  type ModerationDecision,
  type ModerationDetail,
  type ModerationFilter,
  type ModerationPage,
  type ModerationResolution,
  type ModerationStatus,
} from "../shared/moderation";
import { getDb, type CirclesDatabase, type CirclesTransaction } from "./db";
import {
  deleteCirclePostForModeration,
  getModerationPostTarget,
} from "./social-service";

type ModerationListInput = {
  circleId: number;
  viewerScope: number;
  filter: ModerationFilter;
  cursor?: { id: number };
  limit?: number;
};
type ModerationDetailInput = {
  circleId: number;
  viewerScope: number;
  caseId: number;
};
type ModerationCaseRow = typeof moderationCases.$inferSelect;

function moderationError(code: TRPCError["code"], message: string): never {
  throw new TRPCError({ code, message });
}

function requireId(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 2_147_483_647
  ) {
    moderationError("BAD_REQUEST", `Invalid ${field}`);
  }
  return value;
}

/** An optional/client scope never selects the viewer; it only rejects stale account work. */
function assertViewerScope(viewerId: number, viewerScope: unknown): void {
  if (viewerScope !== viewerId) {
    moderationError("CONFLICT", "Account changed. Please try again.");
  }
}

async function requireDb(): Promise<CirclesDatabase> {
  const db = await getDb();
  if (!db)
    moderationError(
      "PRECONDITION_FAILED",
      "Moderation workspace is unavailable",
    );
  return db;
}

/** Lock the exact parent before inspecting a case/post, matching social revocation authority. */
async function lockModeratorCircle(
  tx: CirclesTransaction,
  viewerId: number,
  circleId: number,
): Promise<void> {
  const circlesRows = await tx
    .select({ id: circles.id })
    .from(circles)
    .where(eq(circles.id, circleId))
    .limit(1)
    .for("update");
  if (!circlesRows[0]) moderationError("NOT_FOUND", "Circle not found");

  const roleRows = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(eq(memberships.circleId, circleId), eq(memberships.userId, viewerId)),
    )
    .limit(1);
  const role = roleRows[0]?.role;
  if (role !== "owner" && role !== "moderator") {
    moderationError(
      "FORBIDDEN",
      "Only a current circle owner or moderator may review reports",
    );
  }
}

function toIso(value: Date): string {
  return value.toISOString();
}

function mapCase(row: ModerationCaseRow, viewerId: number): ModerationCase {
  const status = row.status as ModerationStatus;
  const selfReview = row.subjectUserId === viewerId;
  const resolved = status !== "open";
  return {
    id: row.id,
    circleId: row.circleId,
    postId: row.postId,
    status,
    reportCount: row.reportCount,
    createdAt: toIso(row.createdAt),
    lastReportedAt: toIso(row.lastReportedAt),
    resolvedAt: row.resolvedAt ? toIso(row.resolvedAt) : null,
    canResolve: !selfReview && !resolved,
    // Self-review wins even for an old matching retry: no current author may infer/retry a decision.
    blockedReason: selfReview ? "self_review" : resolved ? "resolved" : null,
  };
}

function normalizeList(input: ModerationListInput): {
  circleId: number;
  limit: number;
  cursorId?: number;
  filter: ModerationFilter;
} {
  const circleId = requireId(input?.circleId, "circle identifier");
  if (input?.filter !== "open" && input?.filter !== "resolved") {
    moderationError("BAD_REQUEST", "Invalid moderation filter");
  }
  const limit = input.limit ?? MODERATION_PAGE_DEFAULT;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MODERATION_PAGE_MAX
  ) {
    moderationError("BAD_REQUEST", "Invalid moderation page size");
  }
  const cursorId = input.cursor
    ? requireId(input.cursor.id, "moderation cursor")
    : undefined;
  return {
    circleId,
    limit,
    ...(cursorId ? { cursorId } : {}),
    filter: input.filter,
  };
}

function normalizeDetail(input: ModerationDetailInput): {
  circleId: number;
  caseId: number;
} {
  return {
    circleId: requireId(input?.circleId, "circle identifier"),
    caseId: requireId(input?.caseId, "moderation case identifier"),
  };
}

function normalizeResolution(input: ModerationResolution): {
  circleId: number;
  caseId: number;
  decision: ModerationDecision;
  note: string;
} {
  const { circleId, caseId } = normalizeDetail(input);
  if (input?.decision !== "keep" && input?.decision !== "remove") {
    moderationError("BAD_REQUEST", "Invalid moderation decision");
  }
  if (typeof input.note !== "string") {
    moderationError("BAD_REQUEST", "Resolution note must be plain text");
  }
  const note = moderationNote(input.note);
  if (moderationTextLength(note) > MODERATION_NOTE_MAX) {
    moderationError("BAD_REQUEST", "Resolution note is too long");
  }
  return { circleId, caseId, decision: input.decision, note };
}

async function caseForCircleOrNotFound(
  tx: CirclesTransaction,
  circleId: number,
  caseId: number,
  lock = false,
): Promise<ModerationCaseRow> {
  const query = tx
    .select()
    .from(moderationCases)
    .where(
      and(
        eq(moderationCases.circleId, circleId),
        eq(moderationCases.id, caseId),
      ),
    )
    .limit(1);
  const rows = lock ? await query.for("update") : await query;
  if (!rows[0]) moderationError("NOT_FOUND", "Moderation case not found");
  return rows[0];
}

/** A moderator-only queue; every call starts by checking the live, exact circle membership. */
export async function listModerationCases(
  viewerId: number,
  input: ModerationListInput,
): Promise<ModerationPage> {
  assertViewerScope(viewerId, input?.viewerScope);
  const normalized = normalizeList(input);
  const db = await requireDb();
  return db.transaction(async (tx) => {
    await lockModeratorCircle(tx, viewerId, normalized.circleId);
    const clauses = [eq(moderationCases.circleId, normalized.circleId)];
    if (normalized.filter === "open") {
      clauses.push(eq(moderationCases.status, "open"));
    } else {
      clauses.push(inArray(moderationCases.status, ["kept", "removed"]));
    }
    if (normalized.cursorId !== undefined) {
      clauses.push(lt(moderationCases.id, normalized.cursorId));
    }
    const rows = await tx
      .select()
      .from(moderationCases)
      .where(and(...clauses))
      .orderBy(desc(moderationCases.id))
      .limit(normalized.limit + 1);
    const pageRows = rows.slice(0, normalized.limit);
    const last = pageRows[pageRows.length - 1];
    return {
      circleId: normalized.circleId,
      viewerScope: viewerId,
      items: pageRows.map((row) => mapCase(row, viewerId)),
      nextCursor:
        rows.length > normalized.limit && last ? { id: last.id } : null,
    };
  });
}

/** Detail maps only a still-current scoped post and never contains reporter identity. */
export async function getModerationCaseDetail(
  viewerId: number,
  input: ModerationDetailInput,
): Promise<ModerationDetail> {
  assertViewerScope(viewerId, input?.viewerScope);
  const normalized = normalizeDetail(input);
  const db = await requireDb();
  return db.transaction(async (tx) => {
    await lockModeratorCircle(tx, viewerId, normalized.circleId);
    const row = await caseForCircleOrNotFound(
      tx,
      normalized.circleId,
      normalized.caseId,
    );
    const actionRows = await tx
      .select({
        id: moderationActions.id,
        decision: moderationActions.decision,
        note: moderationActions.note,
        reviewerId: moderationActions.reviewerId,
        reviewerName: profiles.name,
        createdAt: moderationActions.createdAt,
      })
      .from(moderationActions)
      .leftJoin(profiles, eq(profiles.userId, moderationActions.reviewerId))
      .where(eq(moderationActions.caseId, row.id))
      .orderBy(desc(moderationActions.id))
      .limit(MODERATION_HISTORY_MAX);
    const post =
      row.postId === null
        ? null
        : await getModerationPostTarget(tx, viewerId, row.postId, row.circleId);
    const history: ModerationAction[] = actionRows.map((action) => ({
      id: action.id,
      decision: action.decision as ModerationDecision,
      note: action.note,
      reviewer:
        action.reviewerId === null
          ? null
          : {
              id: action.reviewerId,
              // Deliberately never fall back to users.name (OAuth/private identity).
              name: Array.from(action.reviewerName?.trim() || "Circles member")
                .slice(0, 140)
                .join(""),
            },
      createdAt: toIso(action.createdAt),
    }));
    return {
      circleId: normalized.circleId,
      viewerScope: viewerId,
      item: mapCase(row, viewerId),
      post,
      reasons: [...row.reasons],
      history,
    };
  });
}

/**
 * Applies one immutable desired decision. Exact retries converge; a different decision or note
 * is rejected rather than silently rewriting the previous final action.
 */
export async function resolveModerationCase(
  viewerId: number,
  input: ModerationResolution,
): Promise<{ success: true }> {
  assertViewerScope(viewerId, input?.viewerScope);
  const normalized = normalizeResolution(input);
  const db = await requireDb();
  await db.transaction(async (tx) => {
    await lockModeratorCircle(tx, viewerId, normalized.circleId);
    const row = await caseForCircleOrNotFound(
      tx,
      normalized.circleId,
      normalized.caseId,
      true,
    );
    // This is intentionally before action lookup so matching retries remain denied to the subject.
    if (row.subjectUserId === viewerId) {
      moderationError(
        "FORBIDDEN",
        "You cannot resolve reports about your own post",
      );
    }

    const existingActions = await tx
      .select({
        decision: moderationActions.decision,
        note: moderationActions.note,
      })
      .from(moderationActions)
      .where(eq(moderationActions.caseId, row.id))
      .limit(1);
    const existing = existingActions[0];
    const expectedStatus: ModerationStatus =
      normalized.decision === "keep" ? "kept" : "removed";
    if (existing || row.status !== "open") {
      if (
        existing &&
        row.status === expectedStatus &&
        existing.decision === normalized.decision &&
        existing.note === normalized.note
      ) {
        return;
      }
      moderationError(
        "CONFLICT",
        "This moderation case already has a different final decision",
      );
    }

    if (normalized.decision === "remove" && row.postId !== null) {
      // This helper uses the current social deletion operation inside this transaction and returns
      // false for a missing/foreign target. The case may still safely receive a final disposition.
      await deleteCirclePostForModeration(
        tx,
        viewerId,
        normalized.circleId,
        row.postId,
      );
    }

    const resolvedAt = new Date();
    await tx.insert(moderationActions).values({
      caseId: row.id,
      reviewerId: viewerId,
      decision: normalized.decision,
      note: normalized.note,
      createdAt: resolvedAt,
    });
    await tx
      .update(moderationCases)
      .set({ status: expectedStatus, resolvedAt })
      .where(
        and(
          eq(moderationCases.id, row.id),
          eq(moderationCases.circleId, normalized.circleId),
        ),
      );
  });
  return { success: true };
}

export const moderationInternals = {
  assertViewerScope,
  normalizeList,
  normalizeResolution,
};
