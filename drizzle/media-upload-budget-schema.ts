import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgSchema,
  primaryKey,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Upload-attempt accounting is deliberately outside circles_app. The established 27-table
 * application health contract stays exact while this private, runtime-only ledger can be
 * independently audited before a provider PUT is admitted.
 */
export const circlesMedia = pgSchema("circles_media");

/**
 * Account-scoped provider-capacity budget. It deliberately has no FK: an application account
 * removal must not silently release capacity for an opaque object that may still exist.
 */
export const socialUploadBudgets = circlesMedia.table(
  "socialUploadBudgets",
  {
    userId: integer("userId").primaryKey(),
    reservedObjects: integer("reservedObjects").notNull().default(0),
    reservedBytes: bigint("reservedBytes", { mode: "bigint" })
      .notNull()
      .default(0n),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "social_upload_budgets_objects_check",
      sql`${table.reservedObjects} >= 0`,
    ),
    check(
      "social_upload_budgets_bytes_check",
      sql`${table.reservedBytes} >= 0`,
    ),
  ],
);

/**
 * One durable pre-PUT charge per provider object attempt. Rows are intentionally retained even
 * after upload authorization metadata is removed because this storage adapter has no delete API.
 */
export const socialUploadReservations = circlesMedia.table(
  "socialUploadReservations",
  {
    reservationId: varchar("reservationId", { length: 64 }).notNull(),
    userId: integer("userId").notNull(),
    storageKey: varchar("storageKey", { length: 1024 }).notNull(),
    url: varchar("url", { length: 2048 }).notNull(),
    objectBytes: integer("objectBytes").notNull(),
    /** `put_started` is deliberately conservative: a provider object may exist after any outcome. */
    state: varchar("state", { length: 24 }).notNull(),
    putStartedAt: timestamp("putStartedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    putConfirmedAt: timestamp("putConfirmedAt", { withTimezone: true }),
    metadataRecordedAt: timestamp("metadataRecordedAt", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.reservationId] }),
    unique("social_upload_reservations_storage_key_unique").on(
      table.storageKey,
    ),
    index("social_upload_reservations_user_idx").on(table.userId),
    index("social_upload_reservations_reconcile_idx").on(
      table.state,
      table.putStartedAt,
      table.reservationId,
    ),
    check(
      "social_upload_reservations_object_bytes_check",
      sql`${table.objectBytes} > 0`,
    ),
    check(
      "social_upload_reservations_state_check",
      sql`${table.state} IN ('put_started', 'uploaded', 'recorded')`,
    ),
  ],
);
