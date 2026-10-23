import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, gt, ilike, isNull, or } from "drizzle-orm";
import { z } from "zod";
import {
  activeHostLeases,
  liveChat,
  liveSignals,
  liveViewers,
  streams,
  type Stream,
} from "../drizzle/live-schema";
import { memberships } from "../drizzle/schema";
import type { LiveStream } from "../shared/social";
import { createHostGenerationRestartSignals } from "../shared/live-generation-restart";
import { getDb } from "./db";
import {
  createTurnIceConfiguration,
  loadTurnConfiguration,
  TurnConfigurationError,
  type TurnConfiguration,
} from "./turn-config";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  canAccessCircle,
  getDisplayProfile,
  getProfile,
} from "./social-service";

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
type LiveDatabase = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type LiveTransaction = Parameters<
  Parameters<LiveDatabase["transaction"]>[0]
>[0];
type ActiveHostLease = typeof activeHostLeases.$inferSelect;

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

/** The lease may be released only by the stream that currently owns it. */
export function hostLeaseBelongsToStream(
  leaseStreamId: number | null,
  streamId: number,
): boolean {
  return leaseStreamId === streamId;
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
  senderHasJoinedCurrentHostGeneration?: boolean;
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
    input.senderHasJoinedCurrentHostGeneration !== false &&
    input.recipientId === input.hostId &&
    (input.kind === "answer" || input.kind === "ice")
  );
}

export type LiveSignalSession = {
  generation: number;
  cursor: number;
};

/** A replaced media lifecycle cannot read or write through its old generation. */
export function hasCurrentLiveSignalGeneration(
  presentedGeneration: number,
  currentGeneration: number | null,
): boolean {
  return (
    currentGeneration !== null && presentedGeneration === currentGeneration
  );
}

/** Defense in depth for the SQL generation/cursor predicates in signals. */
export function isLiveSignalVisibleToSession(
  signal: { id: number; toGeneration: number },
  session: LiveSignalSession,
): boolean {
  return (
    signal.id > session.cursor && signal.toGeneration === session.generation
  );
}

/**
 * Relay credentials are issued only after the caller has passed the existing
 * authenticated join path. The server-only helper never exposes its shared
 * secret; development receives null and retains the direct/STUN transport.
 */
function createLiveJoinSession(input: {
  hostId: number;
  generation: number;
  hostGeneration: number;
  signalCursor: number;
  userId: number;
  turnConfiguration: TurnConfiguration | null;
}) {
  return {
    hostId: input.hostId,
    generation: input.generation,
    hostGeneration: input.hostGeneration,
    signalCursor: input.signalCursor,
    ice: createTurnIceConfiguration(input.userId, input.turnConfiguration),
  };
}

function unavailable(): never {
  throw new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message: "Live streaming is temporarily unavailable.",
  });
}

/**
 * Keep malformed or absent production relay settings scoped to live calls.
 * This preserves strict parser behavior without making feeds, auth, or DMs
 * fail while the live provider is unavailable.
 */
function loadLiveTurnConfiguration(): TurnConfiguration | null {
  try {
    return loadTurnConfiguration();
  } catch (error) {
    if (error instanceof TurnConfigurationError) unavailable();
    throw error;
  }
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

/**
 * Every live write takes this row lock before examining lifecycle state. It is
 * the common serialization boundary for end, join, leave, signaling, and
 * chat writes, so a completed end cannot be followed by a stale insert.
 */
async function lockLiveStream(
  tx: LiveTransaction,
  streamId: number,
): Promise<Stream> {
  const [stream] = await tx
    .select()
    .from(streams)
    .where(eq(streams.id, streamId))
    .for("update")
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

/**
 * Creates the per-host lease row if needed, then locks it for this transaction.
 * The no-op duplicate update serializes first-use creators before SELECT FOR
 * UPDATE reads the row.
 */
async function lockActiveHostLease(
  tx: LiveTransaction,
  hostId: number,
): Promise<ActiveHostLease> {
  await tx.insert(activeHostLeases).values({ hostId }).onConflictDoUpdate({
    // A no-op conflict update acquires the existing primary-key row lock before
    // the SELECT FOR UPDATE below. DO NOTHING would leave first-use creators
    // able to race between the insert and locked read.
    target: activeHostLeases.hostId,
    set: { hostId },
  });
  const [lease] = await tx
    .select()
    .from(activeHostLeases)
    .where(eq(activeHostLeases.hostId, hostId))
    .for("update")
    .limit(1);
  if (!lease) throw new Error("Active host lease row was not created.");
  return lease;
}

/**
 * With the host lease row locked, terminate only expired live rows and return
 * the deterministic active owner. This also backfills the lease table for a
 * live stream that predates the additive migration.
 */
async function reconcileActiveHostLease(
  tx: LiveTransaction,
  lease: ActiveHostLease,
  hostId: number,
  now: Date,
): Promise<Stream | null> {
  const hostStreams = await tx
    .select()
    .from(streams)
    .where(and(eq(streams.hostId, hostId), eq(streams.status, "live")))
    .orderBy(desc(streams.createdAt), desc(streams.id))
    .for("update");
  const nowMs = now.getTime();
  const active = hostStreams.find((stream) =>
    streamHasActiveHostLease(stream, nowMs),
  );

  await Promise.all(
    hostStreams
      .filter((stream) => !streamHasActiveHostLease(stream, nowMs))
      .map((stream) =>
        tx
          .update(streams)
          .set({ status: "ended", endedAt: now })
          .where(and(eq(streams.id, stream.id), eq(streams.status, "live"))),
      ),
  );

  if (active) {
    if (
      !hostLeaseBelongsToStream(lease.streamId, active.id) ||
      lease.lastHeartbeatAt?.getTime() !== active.lastHeartbeatAt.getTime()
    ) {
      await tx
        .update(activeHostLeases)
        .set({ streamId: active.id, lastHeartbeatAt: active.lastHeartbeatAt })
        .where(eq(activeHostLeases.hostId, hostId));
    }
    return active;
  }

  if (lease.streamId !== null || lease.lastHeartbeatAt !== null) {
    await tx
      .update(activeHostLeases)
      .set({ streamId: null, lastHeartbeatAt: null })
      .where(eq(activeHostLeases.hostId, hostId));
  }
  return null;
}

async function endHostStreamAtomically(
  db: LiveDatabase,
  hostId: number,
  streamId: number,
  expectedGeneration: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const lease = await lockActiveHostLease(tx, hostId);
    const [stream] = await tx
      .select()
      .from(streams)
      .where(eq(streams.id, streamId))
      .for("update")
      .limit(1);
    if (!stream || stream.status !== "live") notFound();
    if (stream.hostId !== hostId)
      forbidden("Only the host can end this live stream.");
    if (
      !hasCurrentLiveSignalGeneration(expectedGeneration, stream.hostGeneration)
    ) {
      forbidden("This live media session has been replaced.");
    }

    const active = await reconcileActiveHostLease(
      tx,
      lease,
      hostId,
      new Date(),
    );
    await tx
      .update(streams)
      .set({ status: "ended", endedAt: new Date() })
      .where(and(eq(streams.id, stream.id), eq(streams.status, "live")));
    await tx.delete(liveSignals).where(eq(liveSignals.streamId, stream.id));

    if (
      hostLeaseBelongsToStream(lease.streamId, stream.id) ||
      active?.id === stream.id
    ) {
      await tx
        .update(activeHostLeases)
        .set({ streamId: null, lastHeartbeatAt: null })
        .where(eq(activeHostLeases.hostId, hostId));
    }
  });
}

async function renewHostLeaseAtomically(
  db: LiveDatabase,
  hostId: number,
  streamId: number,
  ready: boolean | undefined,
  expectedGeneration: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const lease = await lockActiveHostLease(tx, hostId);
    const stream = await lockLiveStream(tx, streamId);
    if (stream.status !== "live") notFound();
    if (stream.hostId !== hostId) notFound();
    if (
      !hasCurrentLiveSignalGeneration(expectedGeneration, stream.hostGeneration)
    ) {
      forbidden("This live media session has been replaced.");
    }

    const now = new Date();
    const active = await reconcileActiveHostLease(tx, lease, hostId, now);
    if (active?.id !== stream.id) notFound();

    await tx
      .update(streams)
      .set({
        lastHeartbeatAt: now,
        ...(ready && stream.readyAt === null ? { readyAt: now } : {}),
      })
      .where(and(eq(streams.id, stream.id), eq(streams.status, "live")));
    await tx
      .update(activeHostLeases)
      .set({ streamId: stream.id, lastHeartbeatAt: now })
      .where(
        and(
          eq(activeHostLeases.hostId, hostId),
          eq(activeHostLeases.streamId, stream.id),
        ),
      );
  });
}

async function getActiveViewerGeneration(
  streamId: number,
  userId: number,
  now = Date.now(),
): Promise<number | null> {
  const db = await getDb();
  if (!db) unavailable();
  const rows = await db
    .select({ generation: liveViewers.generation })
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
  return rows[0]?.generation ?? null;
}

/** The caller already holds the stream row lock for the whole lifecycle write. */
async function getActiveViewerGenerationInTransaction(
  tx: LiveTransaction,
  streamId: number,
  userId: number,
  now = Date.now(),
): Promise<number | null> {
  const rows = await tx
    .select({ generation: liveViewers.generation })
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
  return rows[0]?.generation ?? null;
}

async function assertActiveParticipant(
  stream: Stream,
  userId: number,
): Promise<number> {
  if (!streamIsReadyAndActive(stream)) notFound();
  await assertCircleAccess(userId, stream.circleId);
  if (stream.hostId === userId) return stream.hostGeneration;
  const generation = await getActiveViewerGeneration(stream.id, userId);
  if (generation === null) {
    forbidden("Join this live stream before participating.");
  }
  return generation;
}

/**
 * Transaction counterpart used only after lockLiveStream(). Circle access is
 * still checked at the route boundary before entering the transaction.
 */
async function assertActiveParticipantInTransaction(
  tx: LiveTransaction,
  stream: Stream,
  userId: number,
): Promise<number> {
  if (!streamIsReadyAndActive(stream)) notFound();
  if (stream.hostId === userId) return stream.hostGeneration;
  const generation = await getActiveViewerGenerationInTransaction(
    tx,
    stream.id,
    userId,
  );
  if (generation === null) {
    forbidden("Join this live stream before participating.");
  }
  return generation;
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
    getDisplayProfile(stream.hostId),
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

async function signalHighWaterMarkInTransaction(
  tx: LiveTransaction,
  streamId: number,
): Promise<number> {
  const [latest] = await tx
    .select({ id: liveSignals.id })
    .from(liveSignals)
    .where(eq(liveSignals.streamId, streamId))
    .orderBy(desc(liveSignals.id))
    .limit(1);
  return latest?.id ?? 0;
}

/** Remove only messages belonging to the media lifecycle that was superseded. */
async function purgeParticipantGenerationSignalsInTransaction(
  tx: LiveTransaction,
  input: {
  streamId: number;
  participantId: number;
  generation: number;
  },
): Promise<void> {
  await tx
    .delete(liveSignals)
    .where(
      and(
        eq(liveSignals.streamId, input.streamId),
        or(
          and(
            eq(liveSignals.fromId, input.participantId),
            eq(liveSignals.fromGeneration, input.generation),
          ),
          and(
            eq(liveSignals.toId, input.participantId),
            eq(liveSignals.toGeneration, input.generation),
          ),
        ),
      ),
    );
}

async function insertSystemSignalInTransaction(
  tx: LiveTransaction,
  input: {
  streamId: number;
  fromId: number;
  toId: number;
  kind: "join" | "leave";
  fromGeneration: number;
  toGeneration: number;
  },
): Promise<void> {
  await tx.insert(liveSignals).values({ ...input, payload: "{}" });
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
                ilike(streams.title, `%${search}%`),
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
      // Production must not create a stream that would later fall back to a
      // public STUN-only transport. Do this before any stream/lease write.
      loadLiveTurnConfiguration();
      const db = await getDb();
      if (!db) unavailable();
      const circleId = input.circleId ?? null;
      await assertApprovedCircleHost(ctx.user.id, circleId);

      const now = new Date();
      const stream = await db.transaction(async (tx) => {
        const lease = await lockActiveHostLease(tx, ctx.user.id);
        const active = await reconcileActiveHostLease(
          tx,
          lease,
          ctx.user.id,
          now,
        );
        if (active) return null;

        const [created] = await tx
          .insert(streams)
          .values({
            hostId: ctx.user.id,
            title: input.title,
            circleId,
            thumbnail: input.thumbnail ?? "",
            // The initial lease gives camera startup time without publishing a fake
            // broadcast. The client makes it ready only after capture succeeds.
            lastHeartbeatAt: now,
            readyAt: null,
          })
          .returning();
        if (!created) throw new Error("Created live stream was not returned.");
        await tx
          .update(activeHostLeases)
          .set({ streamId: created.id, lastHeartbeatAt: now })
          .where(eq(activeHostLeases.hostId, ctx.user.id));
        return created;
      });

      if (!stream) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "End your current live stream before starting another one.",
        });
      }
      // Profile creation belongs to the authenticated host action, never a public formatter.
      await getProfile(ctx.user.id);
      return toLiveStream(stream);
    }),

  end: protectedProcedure
    .input(idInput.extend({ generation: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) unavailable();
      await endHostStreamAtomically(
        db,
        ctx.user.id,
        input.streamId,
        input.generation,
      );
      return { success: true } as const;
    }),

  heartbeat: protectedProcedure
    .input(
      idInput.extend({
        ready: z.boolean().optional(),
        // Every media lifecycle, including a host's lease renewal, is bound to
        // the generation allocated by join. Legacy host calls fail closed.
        generation: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) unavailable();
      const stream = await getStreamOrThrow(input.streamId);
      const now = new Date();

      if (stream.hostId === ctx.user.id) {
        // An expired lease cannot be revived: create() will release it and lets
        // the host make a fresh session instead of resurrecting stale metadata.
        await renewHostLeaseAtomically(
          db,
          ctx.user.id,
          stream.id,
          input.ready,
          input.generation,
        );
        return { success: true } as const;
      }

      if (input.ready !== undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only the host can mark a live stream ready.",
        });
      }
      const viewerGeneration = input.generation;
      await assertCircleAccess(ctx.user.id, stream.circleId);
      await db.transaction(async (tx) => {
        const lockedStream = await lockLiveStream(tx, stream.id);
        if (!streamIsReadyAndActive(lockedStream, now.getTime())) notFound();
        const currentGeneration = await getActiveViewerGenerationInTransaction(
          tx,
          lockedStream.id,
          ctx.user.id,
          now.getTime(),
        );
        if (
          !hasCurrentLiveSignalGeneration(viewerGeneration, currentGeneration)
        ) {
          forbidden("This live media session has been replaced.");
        }
        const [renewed] = await tx
          .update(liveViewers)
          .set({ lastSeenAt: now })
          .where(
            and(
              eq(liveViewers.streamId, lockedStream.id),
              eq(liveViewers.userId, ctx.user.id),
              eq(liveViewers.generation, viewerGeneration),
              isNull(liveViewers.leftAt),
            ),
          )
          .returning({ generation: liveViewers.generation });
        if (!renewed) {
          forbidden("This live media session has been replaced.");
        }
      });
      return { success: true } as const;
    }),

  join: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    // Validate relay availability before this path can replace host/viewer
    // generations or insert a membership-presence row.
    const turnConfiguration = loadLiveTurnConfiguration();
    const db = await getDb();
    if (!db) unavailable();
    const accessibleStream = await getStreamOrThrow(input.streamId);
    const now = new Date();
    await assertCircleAccess(ctx.user.id, accessibleStream.circleId);

    return db.transaction(async (tx) => {
      // Both host restarts and viewer joins take this same stream-row lock. A
      // joining viewer therefore either appears in the restart snapshot or
      // targets the newer host generation; it can never fall between them.
      const stream = await lockLiveStream(tx, input.streamId);
      if (!streamHasActiveHostLease(stream, now.getTime())) notFound();

      // The host does not inflate viewer counts, but a reload is a fresh media
      // lifecycle. The locked stream serializes each increment and snapshot.
      if (stream.hostId === ctx.user.id) {
        const signalCursor = await signalHighWaterMarkInTransaction(
          tx,
          stream.id,
        );
        const priorGeneration = stream.hostGeneration;
        const generation = priorGeneration + 1;
        await tx
          .update(streams)
          .set({ hostGeneration: generation })
          .where(
            and(
              eq(streams.id, stream.id),
              eq(streams.status, "live"),
              eq(streams.hostGeneration, priorGeneration),
            ),
          );
        await purgeParticipantGenerationSignalsInTransaction(tx, {
          streamId: stream.id,
          participantId: stream.hostId,
          generation: priorGeneration,
        });
        const activeViewers = await tx
          .select({
            userId: liveViewers.userId,
            generation: liveViewers.generation,
          })
          .from(liveViewers)
          .where(
            and(
              eq(liveViewers.streamId, stream.id),
              isNull(liveViewers.leftAt),
              gt(
                liveViewers.lastSeenAt,
                new Date(now.getTime() - VIEWER_LEASE_MS),
              ),
            ),
          );
        const restartSignals = createHostGenerationRestartSignals({
          streamId: stream.id,
          hostId: stream.hostId,
          hostGeneration: generation,
          viewers: activeViewers,
        });
        if (restartSignals.length > 0) {
          await tx.insert(liveSignals).values(restartSignals);
        }
        return createLiveJoinSession({
          hostId: stream.hostId,
          generation,
          hostGeneration: generation,
          signalCursor,
          userId: ctx.user.id,
          turnConfiguration,
        });
      }
      if (stream.readyAt === null) notFound();

      const [existingViewer] = await tx
        .select({ generation: liveViewers.generation })
        .from(liveViewers)
        .where(
          and(
            eq(liveViewers.streamId, stream.id),
            eq(liveViewers.userId, ctx.user.id),
          ),
        )
        .for("update")
        .limit(1);
      const generation = (existingViewer?.generation ?? 0) + 1;
      await tx
        .insert(liveViewers)
        .values({
          streamId: stream.id,
          userId: ctx.user.id,
          joinedAt: now,
          lastSeenAt: now,
          generation,
          leftAt: null,
        })
        .onConflictDoUpdate({
          target: [liveViewers.streamId, liveViewers.userId],
          set: { joinedAt: now, lastSeenAt: now, generation, leftAt: null },
        });
      if (existingViewer) {
        await purgeParticipantGenerationSignalsInTransaction(tx, {
          streamId: stream.id,
          participantId: ctx.user.id,
          generation: existingViewer.generation,
        });
      }
      const signalCursor = await signalHighWaterMarkInTransaction(
        tx,
        stream.id,
      );
      await insertSystemSignalInTransaction(tx, {
        streamId: stream.id,
        fromId: ctx.user.id,
        toId: stream.hostId,
        kind: "join",
        fromGeneration: generation,
        toGeneration: stream.hostGeneration,
      });
      return createLiveJoinSession({
        hostId: stream.hostId,
        generation,
        hostGeneration: stream.hostGeneration,
        signalCursor,
        userId: ctx.user.id,
        turnConfiguration,
      });
    });
  }),

  /**
   * Rotation never calls join: it validates the caller's existing media
   * lifecycle with the same live/circle/lease/generation boundary used for
   * signaling, then returns only a fresh ephemeral relay credential.
   */
  relay: protectedProcedure
    .input(idInput.extend({ generation: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const turnConfiguration = loadLiveTurnConfiguration();
      const db = await getDb();
      if (!db) unavailable();
      const stream = await getStreamOrThrow(input.streamId);
      const currentGeneration = await assertActiveParticipant(
        stream,
        ctx.user.id,
      );
      if (
        !hasCurrentLiveSignalGeneration(input.generation, currentGeneration)
      ) {
        forbidden("This live media session has been replaced.");
      }

      // A viewer cannot refresh credentials for a generation which has not
      // joined the currently active host lifecycle, matching signal()'s
      // restart guard without writing a new join row or bumping generations.
      if (ctx.user.id !== stream.hostId) {
        const joinedCurrentHostGeneration = !!(
          await db
            .select({ id: liveSignals.id })
            .from(liveSignals)
            .where(
              and(
                eq(liveSignals.streamId, stream.id),
                eq(liveSignals.fromId, ctx.user.id),
                eq(liveSignals.toId, stream.hostId),
                eq(liveSignals.kind, "join"),
                eq(liveSignals.fromGeneration, currentGeneration),
                eq(liveSignals.toGeneration, stream.hostGeneration),
              ),
            )
            .limit(1)
        )[0];
        if (!joinedCurrentHostGeneration) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "The host media session restarted; waiting to rejoin.",
          });
        }
      }

      return {
        ice: createTurnIceConfiguration(ctx.user.id, turnConfiguration),
      };
    }),

  leave: protectedProcedure
    .input(idInput.extend({ generation: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) unavailable();
      const accessibleStream = await getStreamOrThrow(input.streamId);
      await assertCircleAccess(ctx.user.id, accessibleStream.circleId);

      await db.transaction(async (tx) => {
        const stream = await lockLiveStream(tx, input.streamId);
        if (stream.status !== "live") notFound();
        if (stream.hostId === ctx.user.id) {
          forbidden("The host must end the live stream instead of leaving it.");
        }
        const [viewer] = await tx
          .select({
            generation: liveViewers.generation,
            lastSeenAt: liveViewers.lastSeenAt,
          })
          .from(liveViewers)
          .where(
            and(
              eq(liveViewers.streamId, stream.id),
              eq(liveViewers.userId, ctx.user.id),
              isNull(liveViewers.leftAt),
            ),
          )
          .for("update")
          .limit(1);
        if (!viewer) {
          forbidden("You have not joined this live stream.");
        }
        if (
          !hasCurrentLiveSignalGeneration(input.generation, viewer.generation)
        ) {
          forbidden("This live media session has been replaced.");
        }

        const leftAt = new Date();
        const [left] = await tx
          .update(liveViewers)
          .set({ leftAt })
          .where(
            and(
              eq(liveViewers.streamId, stream.id),
              eq(liveViewers.userId, ctx.user.id),
              eq(liveViewers.generation, input.generation),
              isNull(liveViewers.leftAt),
            ),
          )
          .returning({ generation: liveViewers.generation });
        if (!left) {
          forbidden("This live media session has been replaced.");
        }

        // Signals and the leave notification are coupled to the successful CAS,
        // never merely to a stale pre-update viewer read.
        await purgeParticipantGenerationSignalsInTransaction(tx, {
          streamId: stream.id,
          participantId: ctx.user.id,
          generation: input.generation,
        });
        if (
          hasActiveViewerLease(
            { leftAt: null, lastSeenAt: viewer.lastSeenAt },
            leftAt.getTime(),
          )
        ) {
          await insertSystemSignalInTransaction(tx, {
            streamId: stream.id,
            fromId: ctx.user.id,
            toId: stream.hostId,
            kind: "leave",
            fromGeneration: input.generation,
            toGeneration: stream.hostGeneration,
          });
        }
      });
      return { success: true } as const;
    }),

  signals: protectedProcedure
    .input(
      idInput.extend({
        generation: z.number().int().positive(),
        afterId: z.number().int().nonnegative().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) unavailable();
      const stream = await getStreamOrThrow(input.streamId);
      const currentGeneration = await assertActiveParticipant(
        stream,
        ctx.user.id,
      );
      if (
        !hasCurrentLiveSignalGeneration(input.generation, currentGeneration)
      ) {
        forbidden("This live media session has been replaced.");
      }

      const conditions = [
        eq(liveSignals.streamId, stream.id),
        eq(liveSignals.toId, ctx.user.id),
        eq(liveSignals.toGeneration, currentGeneration),
      ];
      if (input.afterId !== undefined)
        conditions.push(gt(liveSignals.id, input.afterId));
      const rows = await db
        .select({
          id: liveSignals.id,
          fromId: liveSignals.fromId,
          toId: liveSignals.toId,
          kind: liveSignals.kind,
          toGeneration: liveSignals.toGeneration,
          payload: liveSignals.payload,
        })
        .from(liveSignals)
        .where(and(...conditions))
        .orderBy(liveSignals.id)
        .limit(100);

      return rows
        .filter((row) =>
          isLiveSignalVisibleToSession(row, {
            generation: currentGeneration,
            cursor: input.afterId ?? 0,
          }),
        )
        .map((row) => ({
          id: row.id,
          fromId: row.fromId,
          toId: row.toId,
          kind: row.kind as LiveSignalKind,
          payload: row.payload,
        }));
    }),

  signal: protectedProcedure
    .input(
      idInput.extend({
        toId: z.number().int().positive(),
        kind: signalKind,
        generation: z.number().int().positive(),
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

      const accessibleStream = await getStreamOrThrow(input.streamId);
      await Promise.all([
        assertCircleAccess(ctx.user.id, accessibleStream.circleId),
        assertCircleAccess(input.toId, accessibleStream.circleId),
      ]);

      await db.transaction(async (tx) => {
        const stream = await lockLiveStream(tx, input.streamId);
        if (!streamIsReadyAndActive(stream)) notFound();
        const [senderGeneration, recipientGeneration] = await Promise.all([
          ctx.user.id === stream.hostId
            ? Promise.resolve(stream.hostGeneration)
            : getActiveViewerGenerationInTransaction(
                tx,
                stream.id,
                ctx.user.id,
              ),
          input.toId === stream.hostId
            ? Promise.resolve(stream.hostGeneration)
            : getActiveViewerGenerationInTransaction(tx, stream.id, input.toId),
        ]);
        if (
          senderGeneration === null ||
          !hasCurrentLiveSignalGeneration(input.generation, senderGeneration)
        ) {
          forbidden("This live media session has been replaced.");
        }
        if (recipientGeneration === null) {
          forbidden("This WebRTC signal is not allowed for these participants.");
        }
        const senderHasJoinedCurrentHostGeneration =
          ctx.user.id === stream.hostId ||
          !!(
            await tx
              .select({ id: liveSignals.id })
              .from(liveSignals)
              .where(
                and(
                  eq(liveSignals.streamId, stream.id),
                  eq(liveSignals.fromId, ctx.user.id),
                  eq(liveSignals.toId, stream.hostId),
                  eq(liveSignals.kind, "join"),
                  eq(liveSignals.fromGeneration, senderGeneration),
                  eq(liveSignals.toGeneration, stream.hostGeneration),
                ),
              )
              .limit(1)
          )[0];
        if (!senderHasJoinedCurrentHostGeneration) {
          throw new TRPCError({
            // A stale peer can emit ICE while the viewer is waiting to consume the
            // restart signal. This is intentionally non-terminal: the pending
            // server-issued reset lets that still-authorized viewer rejoin.
            code: "CONFLICT",
            message: "The host media session restarted; waiting to rejoin.",
          });
        }
        if (
          !canSendSignal({
            streamIsLive: streamIsReadyAndActive(stream),
            hostId: stream.hostId,
            senderId: ctx.user.id,
            recipientId: input.toId,
            kind: input.kind,
            recipientIsActiveViewer:
              input.toId !== stream.hostId && recipientGeneration !== null,
            senderIsActiveViewer:
              ctx.user.id !== stream.hostId && senderGeneration !== null,
            senderHasJoinedCurrentHostGeneration,
          })
        ) {
          forbidden("This WebRTC signal is not allowed for these participants.");
        }

        await tx.insert(liveSignals).values({
          streamId: stream.id,
          fromId: ctx.user.id,
          toId: input.toId,
          kind: input.kind,
          fromGeneration: senderGeneration,
          toGeneration: recipientGeneration,
          payload: input.payload,
        });
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
      const accessibleStream = await getStreamOrThrow(input.streamId);
      await assertCircleAccess(ctx.user.id, accessibleStream.circleId);
      const profile = await getProfile(ctx.user.id);
      await db.transaction(async (tx) => {
        const stream = await lockLiveStream(tx, input.streamId);
        await assertActiveParticipantInTransaction(tx, stream, ctx.user.id);
        await tx.insert(liveChat).values({
          streamId: stream.id,
          userId: ctx.user.id,
          userName: profile.name || profile.handle,
          avatar: profile.avatar,
          text: input.text,
        });
      });
      return { success: true } as const;
    }),

  react: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) unavailable();
    const accessibleStream = await getStreamOrThrow(input.streamId);
    await assertCircleAccess(ctx.user.id, accessibleStream.circleId);
    const profile = await getProfile(ctx.user.id);
    await db.transaction(async (tx) => {
      const stream = await lockLiveStream(tx, input.streamId);
      await assertActiveParticipantInTransaction(tx, stream, ctx.user.id);
      await tx.insert(liveChat).values({
        streamId: stream.id,
        userId: ctx.user.id,
        userName: profile.name || profile.handle,
        avatar: profile.avatar,
        text: "❤",
      });
    });
    return { success: true } as const;
  }),
});
