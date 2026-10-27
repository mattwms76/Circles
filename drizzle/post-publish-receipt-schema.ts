import {
  index,
  integer,
  pgSchema,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { posts, users } from "./schema";

/**
 * Retry-safe publication state is intentionally outside circles_app so the established app-table
 * inventory remains exact. The nullable post pointer is a durable tombstone after a post delete.
 */
export const circlesPublish = pgSchema("circles_publish");

export const postPublishReceipts = circlesPublish.table(
  "postPublishReceipts",
  {
    actorId: integer("actorId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    operationId: varchar("operationId", { length: 96 }).notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    /**
     * A deleted post clears this foreign key but deliberately leaves actor/operation/hash state
     * intact. The service treats that null as a non-recreatable publication tombstone.
     */
    postId: integer("postId").references(() => posts.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("post_publish_receipts_actor_operation_unique").on(
      table.actorId,
      table.operationId,
    ),
    index("post_publish_receipts_post_idx").on(table.postId),
  ],
);
