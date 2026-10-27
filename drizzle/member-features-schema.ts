import {
  customType,
  integer,
  primaryKey,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { circles, posts, users } from "./schema";
import { circlesPublish } from "./post-publish-receipt-schema";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

/** Ciphertext for uploads when managed object storage is not configured. */
export const mediaObjects = circlesPublish.table("mediaObjects", {
  key: varchar("key", { length: 512 }).primaryKey(),
  bytes: bytea("bytes").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const devicePushTokens = circlesPublish.table(
  "devicePushTokens",
  {
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: varchar("token", { length: 200 }).notNull(),
    platform: varchar("platform", { length: 16 }).notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.token] })],
);

export const circlePrompts = circlesPublish.table("circlePrompts", {
  circleId: integer("circleId")
    .primaryKey()
    .references(() => circles.id, { onDelete: "cascade" }),
  body: varchar("body", { length: 180 }).notNull(),
  updatedBy: integer("updatedBy")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  updatedAt: timestamp("updatedAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const promptPosts = circlesPublish.table("promptPosts", {
  postId: integer("postId")
    .primaryKey()
    .references(() => posts.id, { onDelete: "cascade" }),
  circleId: integer("circleId")
    .notNull()
    .references(() => circles.id, { onDelete: "cascade" }),
  promptBody: varchar("promptBody", { length: 180 }).notNull(),
});
