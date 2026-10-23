import {
  check,
  index,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  ModerationDecision,
  ModerationReason,
  ModerationStatus,
} from "../shared/moderation";
import { circles, circlesApp, posts, users } from "./schema";

const createdAt = (name = "createdAt") =>
  timestamp(name, { withTimezone: true }).defaultNow().notNull();

/**
 * Minimal durable report aggregate. `sourcePostId` remains after a post FK clears so that
 * removal cannot turn a later report for another resource into the same moderation case.
 */
export const moderationCases = circlesApp.table(
  "moderationCases",
  {
    id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
    circleId: integer("circleId")
      .notNull()
      .references(() => circles.id, { onDelete: "cascade" }),
    postId: integer("postId").references(() => posts.id, {
      onDelete: "set null",
    }),
    sourcePostId: integer("sourcePostId").notNull(),
    subjectUserId: integer("subjectUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    status: varchar("status", { length: 16 })
      .$type<ModerationStatus>()
      .notNull()
      .default("open"),
    reportCount: integer("reportCount").notNull(),
    reasons: jsonb("reasons")
      .$type<ModerationReason[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    lastReportedAt: createdAt("lastReportedAt"),
    resolvedAt: timestamp("resolvedAt", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("moderation_cases_circle_source_post_unique").on(
      table.circleId,
      table.sourcePostId,
    ),
    index("moderation_cases_circle_status_id_idx").on(
      table.circleId,
      table.status,
      table.id,
    ),
    index("moderation_cases_post_idx").on(table.postId),
    check(
      "moderation_cases_source_post_positive_check",
      sql`${table.sourcePostId} > 0`,
    ),
    check(
      "moderation_cases_report_count_positive_check",
      sql`${table.reportCount} > 0`,
    ),
    check(
      "moderation_cases_status_check",
      sql`${table.status} IN ('open', 'kept', 'removed')`,
    ),
    check(
      "moderation_cases_reasons_array_check",
      sql`jsonb_typeof(${table.reasons}) = 'array' AND jsonb_array_length(${table.reasons}) <= 20`,
    ),
  ],
);

/** One immutable final resolution action per case; no reporter or post-content snapshot is stored. */
export const moderationActions = circlesApp.table(
  "moderationActions",
  {
    id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
    caseId: integer("caseId")
      .notNull()
      .references(() => moderationCases.id, { onDelete: "cascade" }),
    reviewerId: integer("reviewerId").references(() => users.id, {
      onDelete: "set null",
    }),
    decision: varchar("decision", { length: 16 })
      .$type<ModerationDecision>()
      .notNull(),
    note: varchar("note", { length: 500 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("moderation_actions_case_unique").on(table.caseId),
    index("moderation_actions_case_id_desc_idx").on(table.caseId, table.id),
    index("moderation_actions_reviewer_idx").on(table.reviewerId),
    check(
      "moderation_actions_decision_check",
      sql`${table.decision} IN ('keep', 'remove')`,
    ),
  ],
);
