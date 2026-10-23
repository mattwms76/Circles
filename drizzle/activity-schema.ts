import { boolean, check, index, integer, primaryKey, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { circles, circlesApp, posts, users } from "./schema";

const createdAt = (name = "createdAt") =>
  timestamp(name, { withTimezone: true }).defaultNow().notNull();
const updatedAt = (name = "updatedAt") =>
  timestamp(name, { withTimezone: true }).defaultNow().notNull();

/**
 * Durable recipient-private metadata for activity created after this feature ships.
 * `sourceId` deliberately has no FK: a deleted comment/membership remains deduplicated
 * and safely resolves as unavailable rather than changing identity.
 */
export const activityItems = circlesApp.table(
  "activityItems",
  {
    id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
    recipientId: integer("recipientId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actorId: integer("actorId").references(() => users.id, { onDelete: "set null" }),
    kind: varchar("kind", { length: 32 }).notNull(),
    sourceId: integer("sourceId").notNull(),
    circleId: integer("circleId").references(() => circles.id, { onDelete: "set null" }),
    postId: integer("postId").references(() => posts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    readAt: timestamp("readAt", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("activity_items_recipient_kind_source_unique").on(
      table.recipientId,
      table.kind,
      table.sourceId,
    ),
    index("activity_items_recipient_id_desc_idx").on(table.recipientId, table.id),
    index("activity_items_recipient_unread_idx")
      .on(table.recipientId, table.id)
      .where(sql`${table.readAt} IS NULL`),
    index("activity_items_actor_idx").on(table.actorId),
    index("activity_items_circle_idx").on(table.circleId),
    index("activity_items_post_idx").on(table.postId),
    check(
      "activity_items_kind_check",
      sql`${table.kind} IN ('comment_on_your_post', 'membership_approved')`,
    ),
    check("activity_items_source_id_positive_check", sql`${table.sourceId} > 0`),
    check(
      "activity_items_target_shape_check",
      // FK SET NULL must retain a deleted post/circle activity row as an unavailable tombstone.
      // The only type-specific payload invariant that survives target deletion is that approvals
      // never name a post; current-source hooks always supply their required targets.
      sql`${table.kind} <> 'membership_approved' OR ${table.postId} IS NULL`,
    ),
  ],
);

/** One global desired-state category row per recipient, materialized only on the first write. */
export const activityPreferences = circlesApp.table("activityPreferences", {
  recipientId: integer("recipientId")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  commentsEnabled: boolean("commentsEnabled").default(true).notNull(),
  membershipApprovalsEnabled: boolean("membershipApprovalsEnabled").default(true).notNull(),
  updatedAt: updatedAt(),
});

/** A current member (including a pending requester) may mute future activity for one circle. */
export const activityCirclePreferences = circlesApp.table(
  "activityCirclePreferences",
  {
    recipientId: integer("recipientId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    circleId: integer("circleId")
      .notNull()
      .references(() => circles.id, { onDelete: "cascade" }),
    muted: boolean("muted").default(false).notNull(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({
      name: "activity_circle_preferences_recipient_circle_pkey",
      columns: [table.recipientId, table.circleId],
    }),
    index("activity_circle_preferences_circle_idx").on(table.circleId),
  ],
);
