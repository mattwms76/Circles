import {
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  uniqueIndex,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * All Circles application data lives outside Supabase's public/private/auth/storage
 * schemas. Table and column names intentionally preserve the existing API contract.
 */
export const circlesApp = pgSchema("circles_app");

export const userRole = circlesApp.enum("user_role", ["user", "admin"]);
export const circlePrivacy = circlesApp.enum("circle_privacy", [
  "public",
  "private",
]);
export const membershipRole = circlesApp.enum("membership_role", [
  "owner",
  "moderator",
  "member",
  "pending",
]);
export const mediaType = circlesApp.enum("media_type", [
  "text",
  "photo",
  "video",
]);
export const reactionType = circlesApp.enum("reaction_type", ["like"]);
export const conversationKind = circlesApp.enum("conversation_kind", [
  "direct",
  "circle",
]);

const createdAt = (name = "createdAt") =>
  timestamp(name, { withTimezone: true }).defaultNow().notNull();
const updatedAt = (name = "updatedAt") =>
  timestamp(name, { withTimezone: true }).defaultNow().notNull();
const generatedId = (name = "id") =>
  integer(name).generatedByDefaultAsIdentity().primaryKey();

/** Core user table backing the existing Manus OAuth flow. */
export const users = circlesApp.table("users", {
  id: generatedId(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRole("role").default("user").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  lastSignedIn: timestamp("lastSignedIn", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** One public-facing social profile is created for each authenticated user. */
export const profiles = circlesApp.table(
  "profiles",
  {
    id: generatedId(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    handle: varchar("handle", { length: 48 }).notNull(),
    bio: text("bio").notNull(),
    avatar: varchar("avatar", { length: 2048 }).notNull(),
    cover: varchar("cover", { length: 2048 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("profiles_user_id_unique").on(table.userId),
    // MySQL's legacy unique varchar comparison was case-insensitive. Keep that
    // invariant in PostgreSQL while the service normalizes newly written handles.
    uniqueIndex("profiles_handle_ci_unique").on(sql`lower(${table.handle})`),
  ],
);

export const circles = circlesApp.table(
  "circles",
  {
    id: generatedId(),
    ownerId: integer("ownerId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 140 }).notNull(),
    description: text("description").notNull(),
    category: varchar("category", { length: 80 }).notNull(),
    privacy: circlePrivacy("privacy").notNull().default("public"),
    image: varchar("image", { length: 2048 }).notNull().default(""),
    color: varchar("color", { length: 32 }).notNull().default("#ED604A"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("circles_category_idx").on(table.category),
    index("circles_owner_idx").on(table.ownerId),
  ],
);

export const memberships = circlesApp.table(
  "memberships",
  {
    id: generatedId(),
    circleId: integer("circleId")
      .notNull()
      .references(() => circles.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull().default("member"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("memberships_circle_user_unique").on(
      table.circleId,
      table.userId,
    ),
    index("memberships_user_role_idx").on(table.userId, table.role),
  ],
);

export const posts = circlesApp.table(
  "posts",
  {
    id: generatedId(),
    authorId: integer("authorId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    circleId: integer("circleId").references(() => circles.id, {
      onDelete: "cascade",
    }),
    text: text("text").notNull(),
    media: varchar("media", { length: 2048 }),
    mediaType: mediaType("mediaType").notNull().default("text"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("posts_created_at_idx").on(table.createdAt),
    index("posts_circle_created_idx").on(table.circleId, table.createdAt),
    index("posts_author_created_idx").on(table.authorId, table.createdAt),
  ],
);

/** A single reaction per person/post currently represents the Circles “like”. */
export const reactions = circlesApp.table(
  "reactions",
  {
    id: generatedId(),
    postId: integer("postId")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: reactionType("type").notNull().default("like"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("reactions_post_user_unique").on(table.postId, table.userId),
    index("reactions_user_idx").on(table.userId),
  ],
);

export const bookmarks = circlesApp.table(
  "bookmarks",
  {
    id: generatedId(),
    postId: integer("postId")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("bookmarks_post_user_unique").on(table.postId, table.userId),
    index("bookmarks_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const comments = circlesApp.table(
  "comments",
  {
    id: generatedId(),
    postId: integer("postId")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    authorId: integer("authorId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("comments_post_created_idx").on(table.postId, table.createdAt),
  ],
);

export const conversations = circlesApp.table(
  "conversations",
  {
    id: generatedId(),
    kind: conversationKind("kind").notNull(),
    /** Canonical “smallerUserId:largerUserId” key for a direct conversation. */
    directKey: varchar("directKey", { length: 64 }),
    circleId: integer("circleId").references(() => circles.id, {
      onDelete: "cascade",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("conversations_direct_key_unique").on(table.directKey),
    uniqueIndex("conversations_circle_id_unique").on(table.circleId),
    index("conversations_kind_updated_idx").on(table.kind, table.updatedAt),
    check(
      "conversations_kind_target_check",
      sql`(
        (${table.kind} = 'direct' AND ${table.directKey} IS NOT NULL AND ${table.circleId} IS NULL)
        OR
        (${table.kind} = 'circle' AND ${table.directKey} IS NULL AND ${table.circleId} IS NOT NULL)
      )`,
    ),
  ],
);

export const conversationParticipants = circlesApp.table(
  "conversationParticipants",
  {
    id: generatedId(),
    conversationId: integer("conversationId")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Exact, monotonic message watermark delivered to this participant; timestamps are display-only. */
    lastReadMessageId: integer("lastReadMessageId").notNull().default(0),
    lastReadAt: timestamp("lastReadAt", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("conversation_participants_conversation_user_unique").on(
      table.conversationId,
      table.userId,
    ),
    index("conversation_participants_user_idx").on(table.userId),
  ],
);

export const messages = circlesApp.table(
  "messages",
  {
    id: generatedId(),
    conversationId: integer("conversationId")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    authorId: integer("authorId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    media: varchar("media", { length: 2048 }),
    /**
     * A caller-generated nonce unique per sender/conversation. It remains nullable for legacy
     * clients and old rows during the staged mobile rollout.
     */
    clientMessageId: varchar("clientMessageId", { length: 96 }),
    createdAt: createdAt(),
  },
  (table) => [
    index("messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
    uniqueIndex("messages_conversation_author_client_message_id_unique").on(
      table.conversationId,
      table.authorId,
      table.clientMessageId,
    ).where(sql`${table.clientMessageId} IS NOT NULL`),
    check(
      "messages_content_check",
      sql`btrim(${table.text}) <> '' OR ${table.media} IS NOT NULL`,
    ),
    check(
      "messages_client_message_id_check",
      sql`${table.clientMessageId} IS NULL OR ${table.clientMessageId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$'`,
    ),
  ],
);

export const follows = circlesApp.table(
  "follows",
  {
    id: generatedId(),
    followerId: integer("followerId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followingId: integer("followingId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("follows_follower_following_unique").on(
      table.followerId,
      table.followingId,
    ),
    index("follows_following_idx").on(table.followingId),
    check(
      "follows_not_self_check",
      sql`${table.followerId} <> ${table.followingId}`,
    ),
  ],
);

export const reports = circlesApp.table(
  "reports",
  {
    id: generatedId(),
    postId: integer("postId")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    reporterId: integer("reporterId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: varchar("reason", { length: 500 }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("reports_post_reporter_unique").on(
      table.postId,
      table.reporterId,
    ),
    index("reports_post_idx").on(table.postId),
  ],
);

/** Tracks object-store ownership so a user cannot claim another member’s private upload. */
export const socialUploads = circlesApp.table(
  "socialUploads",
  {
    id: generatedId(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storageKey: varchar("storageKey", { length: 1024 }).notNull(),
    url: varchar("url", { length: 2048 }).notNull(),
    mimeType: varchar("mimeType", { length: 128 }).notNull(),
    bytes: integer("bytes").notNull(),
    createdAt: createdAt(),
    /** Null until an owning social mutation commits; allows safe client abort/retry cleanup. */
    claimedAt: timestamp("claimedAt", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("social_uploads_storage_key_unique").on(table.storageKey),
    index("social_uploads_user_idx").on(table.userId),
  ],
);

/** Idempotency marker for the explicitly public, finite starter community seed. */
export const socialSeedMarkers = circlesApp.table("socialSeedMarkers", {
  key: varchar("key", { length: 100 }).primaryKey(),
  completedAt: timestamp("completedAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Import completion markers are private application metadata. Runtime may read
 * completed markers but cannot mutate them; only a finite administrator importer
 * records a marker after successful parity verification.
 */
export const dataMigrations = circlesApp.table("_dataMigrations", {
  key: text("key").primaryKey(),
  sourceTree: text("sourceTree").notNull(),
  completedAt: timestamp("completedAt", { withTimezone: true }).notNull(),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type ProfileRow = typeof profiles.$inferSelect;
export type CircleRow = typeof circles.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
