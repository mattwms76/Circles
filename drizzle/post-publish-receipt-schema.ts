import {
  bigint,
  index,
  integer,
  pgSchema,
  timestamp,
  unique,
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
    // Preserve all bigint precision; this surrogate is never part of the publication DTO.
    id: bigint("id", { mode: "bigint" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
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
    // Business uniqueness remains the retry-safe actor/operation conflict arbiter.
    unique("post_publish_receipts_actor_operation_unique").on(
      table.actorId,
      table.operationId,
    ),
    index("post_publish_receipts_post_idx").on(table.postId),
  ],
);

/**
 * Deliberately private physical-table projection for receipt claims. The canonical exported table
 * above must retain the captured six-column metadata for Drizzle Kit and readiness checks, but an
 * INSERT must also remain valid against the admitted legacy five-column relation. In particular,
 * Drizzle must never enumerate the generated `id` or defaulted `createdAt` during a claim.
 */
const postPublishReceiptInsertTarget = circlesPublish.table(
  "postPublishReceipts",
  {
    actorId: integer("actorId").notNull(),
    operationId: varchar("operationId", { length: 96 }).notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    postId: integer("postId"),
  },
);

/** Exposes the safe write projection without exporting another Drizzle table to schema tooling. */
export function postPublishReceiptInsertProjection() {
  return postPublishReceiptInsertTarget;
}
