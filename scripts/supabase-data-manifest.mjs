import { createHash } from "node:crypto";

/**
 * The only application rows the migration utility is allowed to read or write.
 * Names are copied verbatim from the legacy MySQL Drizzle schemas/migrations.
 * This module deliberately does not introspect schemas to discover new tables.
 */
export const PRIVATE_SCHEMA = "circles_app";
export const DATA_MIGRATION_KEY = "circles-mysql-to-supabase-v1";
export const DATA_MIGRATION_TABLE = "_dataMigrations";
export const DATA_MIGRATION_COLUMNS = Object.freeze([
  "key",
  "sourceTree",
  "completedAt",
  "summary",
]);
export const MANIFEST_VERSION = 1;

function table(name, columns, primaryKey, options = {}) {
  return Object.freeze({
    name,
    columns: Object.freeze([...columns]),
    primaryKey: Object.freeze([...primaryKey]),
    identityColumn: options.identityColumn ?? null,
  });
}

/**
 * Dependency order is intentional: parent rows precede every referenced child.
 * It includes durable session authority, starter-seed markers, upload ownership,
 * participant message watermarks, and the complete live lease/viewer/signal/chat context.
 */
export const LEGACY_TABLES = Object.freeze([
  table(
    "users",
    [
      "id",
      "openId",
      "name",
      "email",
      "loginMethod",
      "role",
      "createdAt",
      "updatedAt",
      "lastSignedIn",
    ],
    ["id"],
    { identityColumn: "id" },
  ),
  table(
    "profiles",
    [
      "id",
      "userId",
      "name",
      "handle",
      "bio",
      "avatar",
      "cover",
      "createdAt",
      "updatedAt",
    ],
    ["id"],
    { identityColumn: "id" },
  ),
  table(
    "circles",
    [
      "id",
      "ownerId",
      "name",
      "description",
      "category",
      "privacy",
      "image",
      "color",
      "createdAt",
      "updatedAt",
    ],
    ["id"],
    { identityColumn: "id" },
  ),
  table(
    "memberships",
    ["id", "circleId", "userId", "role", "createdAt", "updatedAt"],
    ["id"],
    { identityColumn: "id" },
  ),
  table(
    "posts",
    [
      "id",
      "authorId",
      "circleId",
      "text",
      "media",
      "mediaType",
      "createdAt",
      "updatedAt",
    ],
    ["id"],
    { identityColumn: "id" },
  ),
  table("reactions", ["id", "postId", "userId", "type", "createdAt"], ["id"], {
    identityColumn: "id",
  }),
  table("bookmarks", ["id", "postId", "userId", "createdAt"], ["id"], {
    identityColumn: "id",
  }),
  table(
    "comments",
    ["id", "postId", "authorId", "text", "createdAt", "updatedAt"],
    ["id"],
    { identityColumn: "id" },
  ),
  table(
    "conversations",
    ["id", "kind", "directKey", "circleId", "createdAt", "updatedAt"],
    ["id"],
    { identityColumn: "id" },
  ),
  table(
    "conversationParticipants",
    [
      "id",
      "conversationId",
      "userId",
      "lastReadMessageId",
      "lastReadAt",
      "createdAt",
      "updatedAt",
    ],
    ["id"],
    { identityColumn: "id" },
  ),
  table(
    "messages",
    ["id", "conversationId", "authorId", "text", "media", "createdAt"],
    ["id"],
    { identityColumn: "id" },
  ),
  table("follows", ["id", "followerId", "followingId", "createdAt"], ["id"], {
    identityColumn: "id",
  }),
  table(
    "reports",
    ["id", "postId", "reporterId", "reason", "createdAt", "updatedAt"],
    ["id"],
    { identityColumn: "id" },
  ),
  table(
    "socialUploads",
    ["id", "userId", "storageKey", "url", "mimeType", "bytes", "createdAt"],
    ["id"],
    { identityColumn: "id" },
  ),
  table("socialSeedMarkers", ["key", "completedAt"], ["key"]),
  table(
    "applicationSessions",
    [
      "sessionFingerprint",
      "userOpenId",
      "appId",
      "expiresAt",
      "revokedAt",
      "createdAt",
    ],
    ["sessionFingerprint"],
  ),
  table(
    "streams",
    [
      "id",
      "hostId",
      "title",
      "circleId",
      "thumbnail",
      "status",
      "readyAt",
      "lastHeartbeatAt",
      "hostGeneration",
      "createdAt",
      "endedAt",
    ],
    ["id"],
    { identityColumn: "id" },
  ),
  table(
    "activeHostLeases",
    ["hostId", "streamId", "lastHeartbeatAt"],
    ["hostId"],
  ),
  table(
    "liveViewers",
    ["streamId", "userId", "joinedAt", "lastSeenAt", "generation", "leftAt"],
    ["streamId", "userId"],
  ),
  table(
    "liveSignals",
    [
      "id",
      "streamId",
      "fromId",
      "toId",
      "kind",
      "fromGeneration",
      "toGeneration",
      "payload",
      "createdAt",
    ],
    ["id"],
    { identityColumn: "id" },
  ),
  table(
    "liveChat",
    ["id", "streamId", "userId", "userName", "avatar", "text", "createdAt"],
    ["id"],
    { identityColumn: "id" },
  ),
]);

export const LEGACY_TABLE_BY_NAME = new Map(
  LEGACY_TABLES.map((entry) => [entry.name, entry]),
);
export const LEGACY_TABLE_NAMES = Object.freeze(
  LEGACY_TABLES.map((entry) => entry.name),
);

/** The marker's sourceTree is a stable fingerprint of the reviewed source-to-target mapping. */
export const SOURCE_TREE = `manifest-sha256:${createHash("sha256")
  .update(
    JSON.stringify({
      version: MANIFEST_VERSION,
      schema: PRIVATE_SCHEMA,
      tables: LEGACY_TABLES.map(
        ({ name, columns, primaryKey, identityColumn }) => ({
          name,
          columns,
          primaryKey,
          identityColumn,
        }),
      ),
    }),
  )
  .digest("hex")}`;

export function isAllowedTable(name) {
  return LEGACY_TABLE_BY_NAME.has(name);
}

export function isAllowedColumn(tableName, columnName) {
  return (
    LEGACY_TABLE_BY_NAME.get(tableName)?.columns.includes(columnName) ?? false
  );
}
