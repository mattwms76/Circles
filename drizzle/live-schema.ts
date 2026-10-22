import {
  int,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

/** A host-owned broadcast session. A stream stays queryable after it has ended. */
export const streams = mysqlTable("streams", {
  id: int("id").autoincrement().primaryKey(),
  hostId: int("hostId").notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  circleId: int("circleId"),
  thumbnail: varchar("thumbnail", { length: 2048 }).notNull().default(""),
  status: mysqlEnum("status", ["live", "ended"]).notNull().default("live"),
  /** Set only after the host has captured local camera media. */
  readyAt: timestamp("readyAt"),
  /** Host lease renewed by authenticated heartbeat calls. */
  lastHeartbeatAt: timestamp("lastHeartbeatAt").notNull().defaultNow(),
  /** Bumped whenever the host starts a fresh media transport for this stream. */
  hostGeneration: int("hostGeneration").notNull().default(1),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  endedAt: timestamp("endedAt"),
});

/**
 * One durable lock row per host. A non-null streamId owns that host's current
 * broadcast slot; ended broadcasts stay in streams as historical records.
 */
export const activeHostLeases = mysqlTable("activeHostLeases", {
  hostId: int("hostId").primaryKey(),
  streamId: int("streamId"),
  lastHeartbeatAt: timestamp("lastHeartbeatAt"),
});

/**
 * Durable viewer presence. Only rows with a null leftAt count as viewers or
 * participants; this avoids client-maintained/fake viewer counters.
 */
export const liveViewers = mysqlTable(
  "liveViewers",
  {
    streamId: int("streamId").notNull(),
    userId: int("userId").notNull(),
    joinedAt: timestamp("joinedAt").notNull().defaultNow(),
    /** Viewer lease renewed by authenticated heartbeat calls after joining. */
    lastSeenAt: timestamp("lastSeenAt").notNull().defaultNow(),
    /** Bumped for every fresh viewer media transport, including a rejoin. */
    generation: int("generation").notNull().default(1),
    leftAt: timestamp("leftAt"),
  },
  (table) => [primaryKey({ columns: [table.streamId, table.userId] })],
);

/** Authenticated, persisted WebRTC signaling messages. */
export const liveSignals = mysqlTable("liveSignals", {
  id: int("id").autoincrement().primaryKey(),
  streamId: int("streamId").notNull(),
  fromId: int("fromId").notNull(),
  toId: int("toId"),
  kind: mysqlEnum("kind", [
    "join",
    "offer",
    "answer",
    "ice",
    "leave",
  ]).notNull(),
  /** Sender media lifecycle that produced this signal. */
  fromGeneration: int("fromGeneration").notNull().default(1),
  /** Recipient media lifecycle allowed to consume this signal. */
  toGeneration: int("toGeneration").notNull().default(1),
  payload: text("payload").notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});

/** Persisted live chat. Heart reactions are represented as normal ❤ messages. */
export const liveChat = mysqlTable("liveChat", {
  id: int("id").autoincrement().primaryKey(),
  streamId: int("streamId").notNull(),
  userId: int("userId").notNull(),
  userName: varchar("userName", { length: 160 }).notNull(),
  avatar: varchar("avatar", { length: 2048 }).notNull().default(""),
  text: varchar("text", { length: 500 }).notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});

export type Stream = typeof streams.$inferSelect;
export type LiveSignal = typeof liveSignals.$inferSelect;
