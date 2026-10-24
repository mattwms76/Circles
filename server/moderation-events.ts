import { desc, eq } from "drizzle-orm";
import { moderationCases } from "../drizzle/moderation-schema";
import { reports } from "../drizzle/schema";
import {
  MODERATION_REASONS_MAX,
  type ModerationReason,
} from "../shared/moderation";
import type { CirclesTransaction } from "./db";

type ModerationReportSource = {
  circleId: number | null;
  postId: number;
  subjectUserId: number;
};

type StoredReport = { reason: string; updatedAt: Date };

function compareReasons(
  left: ModerationReason,
  right: ModerationReason,
): number {
  if (right.count !== left.count) return right.count - left.count;
  return left.reason < right.reason ? -1 : left.reason > right.reason ? 1 : 0;
}

/**
 * Builds a snapshot from the current one-row-per-reporter legacy report state. This makes a
 * retry or changed reason replace its aggregate contribution instead of incrementing it twice.
 */
export function aggregateModerationReasons(rows: readonly StoredReport[]): {
  reportCount: number;
  reasons: ModerationReason[];
  lastReportedAt: Date;
} | null {
  if (!rows.length) return null;
  const counts = new Map<string, number>();
  let lastReportedAt = rows[0]!.updatedAt;
  for (const row of rows) {
    const reason = row.reason.trim();
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
    if (row.updatedAt > lastReportedAt) lastReportedAt = row.updatedAt;
  }
  const reasons = [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort(compareReasons)
    .slice(0, MODERATION_REASONS_MAX);
  return { reportCount: rows.length, reasons, lastReportedAt };
}

/**
 * Runs after the legacy report upsert inside that same serialized social transaction. Global
 * reports deliberately remain on their legacy path and never gain a circle workspace case.
 */
export async function recordModerationReport(
  tx: CirclesTransaction,
  source: ModerationReportSource,
): Promise<void> {
  if (source.circleId === null) return;

  const rows = await tx
    .select({ reason: reports.reason, updatedAt: reports.updatedAt })
    .from(reports)
    .where(eq(reports.postId, source.postId))
    .orderBy(desc(reports.updatedAt), desc(reports.id));
  const aggregate = aggregateModerationReasons(rows);
  if (!aggregate) return;

  await tx
    .insert(moderationCases)
    .values({
      circleId: source.circleId,
      postId: source.postId,
      sourcePostId: source.postId,
      subjectUserId: source.subjectUserId,
      status: "open",
      reportCount: aggregate.reportCount,
      reasons: aggregate.reasons,
      lastReportedAt: aggregate.lastReportedAt,
    })
    .onConflictDoUpdate({
      target: [moderationCases.circleId, moderationCases.sourcePostId],
      // Do not include status, resolvedAt, or an action field: final outcomes never reopen and
      // later reports cannot rewrite a reviewer decision/note/history.
      set: {
        postId: source.postId,
        subjectUserId: source.subjectUserId,
        reportCount: aggregate.reportCount,
        reasons: aggregate.reasons,
        lastReportedAt: aggregate.lastReportedAt,
      },
    });
}
