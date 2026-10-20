import {
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** One public-facing social profile is created for each authenticated user. */
export const profiles = mysqlTable(
  "profiles",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    handle: varchar("handle", { length: 48 }).notNull(),
    bio: text("bio").notNull(),
    avatar: varchar("avatar", { length: 2048 }).notNull(),
    cover: varchar("cover", { length: 2048 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("profiles_user_id_unique").on(table.userId),
    uniqueIndex("profiles_handle_unique").on(table.handle),
  ],
);

export const circles = mysqlTable(
  "circles",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerId: int("ownerId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 140 }).notNull(),
    description: text("description").notNull(),
    category: varchar("category", { length: 80 }).notNull(),
    privacy: mysqlEnum("privacy", ["public", "private"])
      .notNull()
      .default("public"),
    image: varchar("image", { length: 2048 }).notNull().default(""),
    color: varchar("color", { length: 32 }).notNull().default("#ED604A"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("circles_category_idx").on(table.category),
    index("circles_owner_idx").on(table.ownerId),
  ],
);

export const memberships = mysqlTable(
  "memberships",
  {
    id: int("id").autoincrement().primaryKey(),
    circleId: int("circleId")
      .notNull()
      .references(() => circles.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: mysqlEnum("role", ["owner", "moderator", "member", "pending"])
      .notNull()
      .default("member"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("memberships_circle_user_unique").on(table.circleId, table.userId),
    index("memberships_user_role_idx").on(table.userId, table.role),
  ],
);

export const posts = mysqlTable(
  "posts",
  {
    id: int("id").autoincrement().primaryKey(),
    authorId: int("authorId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    circleId: int("circleId").references(() => circles.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    media: varchar("media", { length: 2048 }),
    mediaType: mysqlEnum("mediaType", ["text", "photo", "video"])
      .notNull()
      .default("text"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("posts_created_at_idx").on(table.createdAt),
    index("posts_circle_created_idx").on(table.circleId, table.createdAt),
    index("posts_author_created_idx").on(table.authorId, table.createdAt),
  ],
);

/** A single reaction per person/post currently represents the Circles “like”. */
export const reactions = mysqlTable(
  "reactions",
  {
    id: int("id").autoincrement().primaryKey(),
    postId: int("postId")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: mysqlEnum("type", ["like"]).notNull().default("like"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("reactions_post_user_unique").on(table.postId, table.userId),
    index("reactions_user_idx").on(table.userId),
  ],
);

export const bookmarks = mysqlTable(
  "bookmarks",
  {
    id: int("id").autoincrement().primaryKey(),
    postId: int("postId")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("bookmarks_post_user_unique").on(table.postId, table.userId),
    index("bookmarks_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const comments = mysqlTable(
  "comments",
  {
    id: int("id").autoincrement().primaryKey(),
    postId: int("postId")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    authorId: int("authorId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("comments_post_created_idx").on(table.postId, table.createdAt),
  ],
);

export const conversations = mysqlTable(
  "conversations",
  {
    id: int("id").autoincrement().primaryKey(),
    kind: mysqlEnum("kind", ["direct", "circle"]).notNull(),
    /** Canonical “smallerUserId:largerUserId” key for a direct conversation. */
    directKey: varchar("directKey", { length: 64 }),
    circleId: int("circleId").references(() => circles.id, { onDelete: "cascade" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("conversations_direct_key_unique").on(table.directKey),
    uniqueIndex("conversations_circle_id_unique").on(table.circleId),
    index("conversations_kind_updated_idx").on(table.kind, table.updatedAt),
  ],
);

export const conversationParticipants = mysqlTable(
  "conversationParticipants",
  {
    id: int("id").autoincrement().primaryKey(),
    conversationId: int("conversationId")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("lastReadAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("conversation_participants_conversation_user_unique").on(
      table.conversationId,
      table.userId,
    ),
    index("conversation_participants_user_idx").on(table.userId),
  ],
);

export const messages = mysqlTable(
  "messages",
  {
    id: int("id").autoincrement().primaryKey(),
    conversationId: int("conversationId")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    authorId: int("authorId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    media: varchar("media", { length: 2048 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("messages_conversation_created_idx").on(table.conversationId, table.createdAt),
  ],
);

export const follows = mysqlTable(
  "follows",
  {
    id: int("id").autoincrement().primaryKey(),
    followerId: int("followerId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followingId: int("followingId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("follows_follower_following_unique").on(table.followerId, table.followingId),
    index("follows_following_idx").on(table.followingId),
  ],
);

export const reports = mysqlTable(
  "reports",
  {
    id: int("id").autoincrement().primaryKey(),
    postId: int("postId")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    reporterId: int("reporterId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: varchar("reason", { length: 500 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("reports_post_reporter_unique").on(table.postId, table.reporterId),
    index("reports_post_idx").on(table.postId),
  ],
);

/** Tracks object-store ownership so a user cannot claim another member’s private upload. */
export const socialUploads = mysqlTable(
  "socialUploads",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storageKey: varchar("storageKey", { length: 1024 }).notNull(),
    url: varchar("url", { length: 2048 }).notNull(),
    mimeType: varchar("mimeType", { length: 128 }).notNull(),
    bytes: int("bytes").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("social_uploads_storage_key_unique").on(table.storageKey),
    index("social_uploads_user_idx").on(table.userId),
  ],
);

/** Idempotency marker for the explicitly public, finite starter community seed. */
export const socialSeedMarkers = mysqlTable("socialSeedMarkers", {
  key: varchar("key", { length: 100 }).primaryKey(),
  completedAt: timestamp("completedAt").defaultNow().notNull(),
});

export type ProfileRow = typeof profiles.$inferSelect;
export type CircleRow = typeof circles.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
