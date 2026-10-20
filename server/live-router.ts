import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, gt, isNull, like } from "drizzle-orm";
import { z } from "zod";
import {
  liveChat,
  liveSignals,
  liveViewers,
  streams,
  type Stream,
} from "../drizzle/live-schema";
import { memberships } from "../drizzle/schema";
import type { LiveStream } from "../shared/social";
import { getDb } from "./db";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { canAccessCircle, getProfile } from "./social-service";

const MAX_SIGNAL_BYTES = 32_768;
const MAX_ICE_CANDIDATE_BYTES = 8_192;
/** A crashed host disappears quickly without requiring a browser unload event. */
export const HOST_LEASE_MS = 45_000;
/** Viewer counts and signaling do not retain abandoned browser sessions. */
export const VIEWER_LEASE_MS = 30_000;
const idInput = z.object({ streamId: z.number().int().positive() });
const signalKind = z.enum(["offer", "answer", "ice"]);

type SignalKind = z.infer<typeof signalKind>;
type LiveSignalKind = SignalKind | "join" | "leave";
type CircleMembershipRole = "owner" | "moderator" | "member" | "pending";

/** Strict boundary keeps an expired lease expired at exactly its cutoff. */
export function hasActiveLease(
  lastSeenAt: Date | null | undefined,
  now: number,
  leaseMs: number,
): boolean {
  return !!lastSeenAt && lastSeenAt.getTime() > now - leaseMs;
}

export function hasActiveHostLease(
  lastHeartbeatAt: Date | null | undefined,
  now = Date.now(),
): boolean {
  return hasActiveLease(lastHeartbeatAt, now, HOST_LEASE_MS);
}

export function hasActiveViewerLease(
  viewer: { leftAt: Date | null; lastSeenAt: Date | null | undefined },
  now = Date.now(),
): boolean {
  return (
    viewer.leftAt === null &&
    hasActiveLease(viewer.lastSeenAt, now, VIEWER_LEASE_MS)
  );
}

/** Hosting is a member capability even when a circle is publicly readable. */
export function canHostCircleRole(
  role: CircleMembershipRole | string | null | undefined,
): boolean {
  return role === "owner" || role === "moderator" || role === "member";
}

/**
 * Pure authorization rule used by the signal mutation. The sender identity is
 * always derived from the session; callers never submit a fromId.
 */
export function canSendSignal(input: {
  streamIsLive: boolean;
  hostId: number;
  senderId: number;
  recipientId: number;
  kind: SignalKind;
  recipientIsActiveViewer: boolean;
  senderIsActiveViewer: boolean;
}): boolean {
  if (!input.streamIsLive) return false;

  if (input.senderId === input.hostId) {
    return (
      input.recipientId !== input.hostId &&
      input.recipientIsActiveViewer &&
      (input.kind === "offer" || input.kind === "ice")
    );
  }

  return (
    input.senderIsActiveViewer &&
    input.recipientId === input.hostId &&
    (input.kind === "answer" || input.kind === "ice")
  );
}

function unavailable(): never {
  throw new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message: "Live streaming is temporarily unavailable.",
  });
}

function notFound(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "Live stream not found." });
}

function forbidden(
  message = "You are not allowed to access this live stream.",
): never {
  throw new TRPCError({ code: "FORBIDDEN", message });
}

function signalPayloadIsValid(kind: SignalKind, payload: string): boolean {
  try {
    const value: unknown = JSON.parse(payload);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const signal = value as Record<string, unknown>;

    if (kind === "ice") {
      return (
        typeof signal.candidate === "string" &&
        signal.candidate.length > 0 &&
        signal.candidate.length <= MAX_ICE_CANDIDATE_BYTES &&
        (signal.sdpMid === null ||
          signal.sdpMid === undefined ||
          typeof signal.sdpMid === "string") &&
        (signal.sdpMLineIndex === null ||
          signal.sdpMLineIndex === undefined ||
          (typeof signal.sdpMLineIndex === "number" &&
            Number.isInteger(signal.sdpMLineIndex)))
      );
    }

    return (
      signal.type === kind &&
      typeof signal.sdp === "string" &&
      signal.sdp.length > 0 &&
      signal.sdp.length <= MAX_SIGNAL_BYTES
    );
  } catch {
    return false;
  }
}

async function getStreamOrThrow(streamId: number): Promise<Stream> {
  const db = await getDb();
  if (!db) unavailable();
  const [stream] = await db
    .select()
    .from(streams)
    .where(eq(streams.id, streamId))
    .limit(1);
  if (!stream) notFound();
  return stream;
}

async function assertCircleAccess(
  userId: number,
  circleId: number | null,
): Promise<void> {
  if (circleId !== null && !(await canAccessCircle(userId, circleId))) {
    forbidden("You do not have access to this circle live stream.");
  }
}

async function assertApprovedCircleHost(
  userId: number,
  circleId: number | null,
): Promise<void> {
  if (circleId === null) return;
  const db = await getDb();
  if (!db) unavailable();
  const [membership] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(eq(memberships.circleId, circleId), eq(memberships.userId, userId)),
    )
    .limit(1);
  if (!canHostCircleRole(membership?.role)) {
    forbidden("Join this circle before hosting a live stream.");
  }
}

function streamHasActiveHostLease(stream: Stream, now = Date.now()): boolean {
  return (
    stream.status === "live" && hasActiveHostLease(stream.lastHeartbeatAt, now)
  );
}

function streamIsReadyAndActive(stream: Stream, now = Date.now()): boolean {
  return streamHasActiveHostLease(stream, now) && stream.readyAt !== null;
}

async function isActiveViewer(
  streamId: number,
  userId: number,
  now = Date.now(),
): Promise<boolean> {
  const db = await getDb();
  if (!db) unavailable();
  const rows = await db
    .select({ userId: liveViewers.userId })
    .from(liveViewers)
    .where(
      and(
        eq(liveViewers.streamId, streamId),
        eq(liveViewers.userId, userId),
        isNull(liveViewers.leftAt),
        gt(liveViewers.lastSeenAt, new Date(now - VIEWER_LEASE_MS)),
      ),
    )
    .limit(1);
  return rows.length === 1;
}

async function assertActiveParticipant(
  stream: Stream,
  userId: number,
): Promise<void> {
  if (!streamIsReadyAndActive(stream)) notFound();
  await assertCircleAccess(userId, stream.circleId);
  if (stream.hostId !== userId && !(await isActiveViewer(stream.id, userId))) {
    forbidden("Join this live stream before participating.");
  }
}

async function viewerCount(streamId: number): Promise<number> {
  const db = await getDb();
  if (!db) unavailable();
  const cutoff = new Date(Date.now() - VIEWER_LEASE_MS);
  const [result] = await db
    .select({ total: count() })
    .from(liveViewers)
    .where(
      and(
        eq(liveViewers.streamId, streamId),
        isNull(liveViewers.leftAt),
        gt(liveViewers.lastSeenAt, cutoff),
      ),
    );
  return Number(result?.total ?? 0);
}

async function toLiveStream(stream: Stream): Promise<LiveStream> {
  const [host, viewers] = await Promise.all([
    getProfile(stream.hostId),
    viewerCount(stream.id),
  ]);
  return {
    id: stream.id,
    host,
    title: stream.title,
    circleId: stream.circleId,
    thumbnail: stream.thumbnail,
    viewers,
    status: stream.status,
    createdAt: stream.createdAt.toISOString(),
  };
}

async function insertSystemSignal(input: {
  streamId: number;
  fromId: number;
  toId: number;
  kind: "join" | "leave";
}): Promise<void> {
  const db = await getDb();
  if (!db) unavailable();
  await db.insert(liveSignals).values({ ...input, payload: "{}" });
}

export const liveRouter = router({
  list: publicProcedure
    .input(
      z.object({ search: z.string().trim().max(80).optional() }).optional(),
    )
    .query(async ({ ctx, input }): Promise<LiveStream[]> => {
      const db = await getDb();
      if (!db) unavailable();

      const search = input?.search;
      const now = Date.now();
      const viewerId = ctx.user?.id ?? null;
      const rows = await db
        .select()
        .from(streams)
        .where(
          search
            ? and(
                eq(streams.status, "live"),
                like(streams.title, `%${search}%`),
              )
            : eq(streams.status, "live"),
        )
        .orderBy(desc(streams.createdAt))
        .limit(100);

      const visible = (
        await Promise.all(
          rows.map(async (stream) => {
            // A host retains visibility of its own preparing session so its live
            // screen can mount media, but no one else sees unready or expired data.
            if (
              stream.hostId !== viewerId &&
              !streamIsReadyAndActive(stream, now)
            ) {
              return null;
            }
            if (
              stream.circleId !== null &&
              !(await canAccessCircle(viewerId, stream.circleId))
            ) {
              return null;
            }
            return toLiveStream(stream);
          }),
        )
      ).filter((stream): stream is LiveStream => stream !== null);
      return visible;
    }),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(160),
        circleId: z.number().int().positive().optional(),
        thumbnail: z.string().trim().max(2048).optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<LiveStream> => {
      const db = await getDb();
      if (!db) unavailable();
      const circleId = input.circleId ?? null;
      await assertApprovedCircleHost(ctx.user.id, circleId);

      const now = new Date();
      const existing = await db
        .select()
        .from(streams)
        .where(and(eq(streams.hostId, ctx.user.id), eq(streams.status, "live")))
        .limit(100);
      const expired = existing.filter(
        (stream) => !streamHasActiveHostLease(stream, now.getTime()),
      );
      await Promise.all(
        expired.map((stream) =>
          db
            .update(streams)
            .set({ status: "ended", endedAt: now })
            .where(and(eq(streams.id, stream.id), eq(streams.status, "live"))),
        ),
      );
      const active = existing.filter((stream) =>
        streamHasActiveHostLease(stream, now.getTime()),
      );
      if (active.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "End your current live stream before starting another one.",
        });
      }

      const inserted = await db.insert(streams).values({
        hostId: ctx.user.id,
        title: input.title,
        circleId,
        thumbnail: input.thumbnail ?? "",
        // The initial lease gives camera startup time without publishing a fake
        // broadcast. The client makes it ready only after capture succeeds.
        lastHeartbeatAt: now,
        readyAt: null,
      });
      const stream = await getStreamOrThrow(Number(inserted[0].insertId));
      return toLiveStream(stream);
    }),

  end: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) unavailable();
    const stream = await getStreamOrThrow(input.streamId);
    if (stream.hostId !== ctx.user.id)
      forbidden("Only the host can end this live stream.");
    if (stream.status !== "live") notFound();

    await db
      .update(streams)
      .set({ status: "ended", endedAt: new Date() })
      .where(and(eq(streams.id, stream.id), eq(streams.status, "live")));
    return { success: true } as const;
  }),

  heartbeat: protectedProcedure
    .input(idInput.extend({ ready: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) unavailable();
      const stream = await getStreamOrThrow(input.streamId);
      const now = new Date();

      if (stream.hostId === ctx.user.id) {
        // An expired lease cannot be revived: create() will release it and lets
        // the host make a fresh session instead of resurrecting stale metadata.
        if (!streamHasActiveHostLease(stream, now.getTime())) notFound();
        await db
          .update(streams)
          .set({
            lastHeartbeatAt: now,
            ...(input.ready && stream.readyAt === null ? { readyAt: now } : {}),
          })
          .where(and(eq(streams.id, stream.id), eq(streams.status, "live")));
        return { success: true } as const;
      }

      if (input.ready !== undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only the host can mark a live stream ready.",
        });
      }
      if (!streamIsReadyAndActive(stream, now.getTime())) notFound();
      await assertCircleAccess(ctx.user.id, stream.circleId);
      if (!(await isActiveViewer(stream.id, ctx.user.id, now.getTime()))) {
        forbidden("Join this live stream before renewing presence.");
      }
      await db
        .update(liveViewers)
        .set({ lastSeenAt: now })
        .where(
          and(
            eq(liveViewers.streamId, stream.id),
            eq(liveViewers.userId, ctx.user.id),
            isNull(liveViewers.leftAt),
          ),
        );
      return { success: true } as const;
    }),

  join: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) unavailable();
    const stream = await getStreamOrThrow(input.streamId);
    const now = new Date();
    if (!streamHasActiveHostLease(stream, now.getTime())) notFound();
    await assertCircleAccess(ctx.user.id, stream.circleId);

    // The host is already a participant and must not inflate viewer counts.
    if (stream.hostId === ctx.user.id) return { hostId: stream.hostId };
    if (stream.readyAt === null) notFound();

    const wasActive = await isActiveViewer(
      stream.id,
      ctx.user.id,
      now.getTime(),
    );
    await db
      .insert(liveViewers)
      .values({
        streamId: stream.id,
        userId: ctx.user.id,
        joinedAt: now,
        lastSeenAt: now,
        leftAt: null,
      })
      .onDuplicateKeyUpdate({
        set: { joinedAt: now, lastSeenAt: now, leftAt: null },
      });
    if (!wasActive) {
      await insertSystemSignal({
        streamId: stream.id,
        fromId: ctx.user.id,
        toId: stream.hostId,
        kind: "join",
      });
    }
    return { hostId: stream.hostId };
  }),

  leave: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) unavailable();
    const stream = await getStreamOrThrow(input.streamId);
    if (stream.status !== "live") notFound();
    await assertCircleAccess(ctx.user.id, stream.circleId);
    if (stream.hostId === ctx.user.id) {
      forbidden("The host must end the live stream instead of leaving it.");
    }
    const [viewer] = await db
      .select({ streamId: liveViewers.streamId })
      .from(liveViewers)
      .where(
        and(
          eq(liveViewers.streamId, stream.id),
          eq(liveViewers.userId, ctx.user.id),
          isNull(liveViewers.leftAt),
        ),
      )
      .limit(1);
    if (!viewer) {
      forbidden("You have not joined this live stream.");
    }

    const wasActive = await isActiveViewer(stream.id, ctx.user.id);

    await db
      .update(liveViewers)
      .set({ leftAt: new Date() })
      .where(
        and(
          eq(liveViewers.streamId, stream.id),
          eq(liveViewers.userId, ctx.user.id),
          isNull(liveViewers.leftAt),
        ),
      );
    if (wasActive) {
      await insertSystemSignal({
        streamId: stream.id,
        fromId: ctx.user.id,
        toId: stream.hostId,
        kind: "leave",
      });
    }
    return { success: true } as const;
  }),

  signals: protectedProcedure
    .input(
      idInput.extend({ afterId: z.number().int().nonnegative().optional() }),
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) unavailable();
      const stream = await getStreamOrThrow(input.streamId);
      await assertActiveParticipant(stream, ctx.user.id);

      const conditions = [
        eq(liveSignals.streamId, stream.id),
        eq(liveSignals.toId, ctx.user.id),
      ];
      if (input.afterId !== undefined)
        conditions.push(gt(liveSignals.id, input.afterId));
      const rows = await db
        .select({
          id: liveSignals.id,
          fromId: liveSignals.fromId,
          toId: liveSignals.toId,
          kind: liveSignals.kind,
          payload: liveSignals.payload,
        })
        .from(liveSignals)
        .where(and(...conditions))
        .orderBy(liveSignals.id)
        .limit(100);

      return rows.map((row) => ({
        ...row,
        toId: row.toId,
        kind: row.kind as LiveSignalKind,
      }));
    }),

  signal: protectedProcedure
    .input(
      idInput.extend({
        toId: z.number().int().positive(),
        kind: signalKind,
        payload: z.string().min(2).max(MAX_SIGNAL_BYTES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) unavailable();
      if (!signalPayloadIsValid(input.kind, input.payload)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid WebRTC signal payload.",
        });
      }

      const stream = await getStreamOrThrow(input.streamId);
      if (!streamIsReadyAndActive(stream)) notFound();
      await assertCircleAccess(ctx.user.id, stream.circleId);

      const [senderIsActiveViewer, recipientIsActiveViewer] = await Promise.all(
        [
          ctx.user.id === stream.hostId
            ? Promise.resolve(false)
            : isActiveViewer(stream.id, ctx.user.id),
          input.toId === stream.hostId
            ? Promise.resolve(false)
            : isActiveViewer(stream.id, input.toId),
        ],
      );
      if (
        !canSendSignal({
          streamIsLive: streamIsReadyAndActive(stream),
          hostId: stream.hostId,
          senderId: ctx.user.id,
          recipientId: input.toId,
          kind: input.kind,
          recipientIsActiveViewer,
          senderIsActiveViewer,
        })
      ) {
        forbidden("This WebRTC signal is not allowed for these participants.");
      }
      await assertCircleAccess(input.toId, stream.circleId);

      await db.insert(liveSignals).values({
        streamId: stream.id,
        fromId: ctx.user.id,
        toId: input.toId,
        kind: input.kind,
        payload: input.payload,
      });
      return { success: true } as const;
    }),

  chat: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) unavailable();
    const stream = await getStreamOrThrow(input.streamId);
    await assertActiveParticipant(stream, ctx.user.id);
    const rows = await db
      .select({
        id: liveChat.id,
        userName: liveChat.userName,
        avatar: liveChat.avatar,
        text: liveChat.text,
        createdAt: liveChat.createdAt,
      })
      .from(liveChat)
      .where(eq(liveChat.streamId, stream.id))
      .orderBy(desc(liveChat.createdAt), desc(liveChat.id))
      .limit(100);

    return rows
      .reverse()
      .map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }),

  sendChat: protectedProcedure
    .input(idInput.extend({ text: z.string().trim().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) unavailable();
      const stream = await getStreamOrThrow(input.streamId);
      await assertActiveParticipant(stream, ctx.user.id);
      const profile = await getProfile(ctx.user.id);
      await db.insert(liveChat).values({
        streamId: stream.id,
        userId: ctx.user.id,
        userName: profile.name || profile.handle,
        avatar: profile.avatar,
        text: input.text,
      });
      return { success: true } as const;
    }),

  react: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) unavailable();
    const stream = await getStreamOrThrow(input.streamId);
    await assertActiveParticipant(stream, ctx.user.id);
    const profile = await getProfile(ctx.user.id);
    await db.insert(liveChat).values({
      streamId: stream.id,
      userId: ctx.user.id,
      userName: profile.name || profile.handle,
      avatar: profile.avatar,
      text: "❤",
    });
    return { success: true } as const;
  }),
});
