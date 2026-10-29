import {
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

const circlesApp = pgSchema("circles_app");
const streamStatus = circlesApp.enum("stream_status", ["live", "ended"]);
const liveSignalKind = circlesApp.enum("live_signal_kind", [
  "join",
  "offer",
  "answer",
  "ice",
  "leave",
]);
const generatedId = (name = "id") =>
  integer(name).generatedByDefaultAsIdentity().primaryKey();
const createdAt = (name = "createdAt") =>
  timestamp(name, { withTimezone: true }).defaultNow().notNull();

/** A host-owned broadcast session. A stream stays queryable after it has ended. */
export const streams = circlesApp.table("streams", {
  id: generatedId(),
  hostId: integer("hostId").notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  circleId: integer("circleId"),
  thumbnail: varchar("thumbnail", { length: 2048 }).notNull().default(""),
  status: streamStatus("status").notNull().default("live"),
  /** Set only after the host has captured local camera media. */
  readyAt: timestamp("readyAt", { withTimezone: true }),
  /** Host lease renewed by authenticated heartbeat calls. */
  lastHeartbeatAt: timestamp("lastHeartbeatAt", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** Bumped whenever the host starts a fresh media transport for this stream. */
  hostGeneration: integer("hostGeneration").notNull().default(1),
  createdAt: createdAt(),
  endedAt: timestamp("endedAt", { withTimezone: true }),
});

/** One durable lock row per host, retaining historical streams independently. */
export const activeHostLeases = circlesApp.table("activeHostLeases", {
  hostId: integer("hostId").primaryKey(),
  streamId: integer("streamId"),
  lastHeartbeatAt: timestamp("lastHeartbeatAt", { withTimezone: true }),
});

/** Durable viewer presence; rows with null leftAt count as viewers or participants. */
export const liveViewers = circlesApp.table(
  "liveViewers",
  {
    streamId: integer("streamId").notNull(),
    userId: integer("userId").notNull(),
    joinedAt: createdAt("joinedAt"),
    /** Viewer lease renewed by authenticated heartbeat calls after joining. */
    lastSeenAt: timestamp("lastSeenAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Bumped for every fresh viewer media transport, including a rejoin. */
    generation: integer("generation").notNull().default(1),
    leftAt: timestamp("leftAt", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.streamId, table.userId] })],
);

/** Authenticated, persisted WebRTC signaling messages. */
export const liveSignals = circlesApp.table("liveSignals", {
  id: generatedId(),
  streamId: integer("streamId").notNull(),
  fromId: integer("fromId").notNull(),
  toId: integer("toId"),
  kind: liveSignalKind("kind").notNull(),
  /** Sender media lifecycle that produced this signal. */
  fromGeneration: integer("fromGeneration").notNull().default(1),
  /** Recipient media lifecycle allowed to consume this signal. */
  toGeneration: integer("toGeneration").notNull().default(1),
  payload: text("payload").notNull(),
  createdAt: createdAt(),
});

/** Persisted live chat. Heart reactions are represented as normal ❤ messages. */
export const liveChat = circlesApp.table(
  "liveChat",
  {
    id: generatedId(),
    streamId: integer("streamId").notNull(),
    userId: integer("userId").notNull(),
    userName: varchar("userName", { length: 160 }).notNull(),
    avatar: varchar("avatar", { length: 2048 }).notNull().default(""),
    text: varchar("text", { length: 500 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("live_chat_stream_created_id_idx").on(
      table.streamId,
      table.createdAt,
      table.id,
    ),
    index("live_chat_stream_user_created_idx").on(
      table.streamId,
      table.userId,
      table.createdAt,
    ),
  ],
);

export type Stream = typeof streams.$inferSelect;
export type LiveSignal = typeof liveSignals.$inferSelect;
