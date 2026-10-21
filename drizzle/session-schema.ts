import { index, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Server-side authority for Circles application JWTs. The JWT carries only a
 * random session id (jti); this table stores a SHA-256 fingerprint instead of
 * the raw id so a database read does not disclose a bearer credential.
 */
export const applicationSessions = mysqlTable(
  "applicationSessions",
  {
    sessionFingerprint: varchar("sessionFingerprint", { length: 64 })
      .primaryKey()
      .notNull(),
    userOpenId: varchar("userOpenId", { length: 64 }).notNull(),
    appId: varchar("appId", { length: 128 }).notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    revokedAt: timestamp("revokedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("application_sessions_user_app_idx").on(
      table.userOpenId,
      table.appId,
    ),
    index("application_sessions_expiry_idx").on(table.expiresAt),
  ],
);

export type ApplicationSession = typeof applicationSessions.$inferSelect;
export type InsertApplicationSession = typeof applicationSessions.$inferInsert;
