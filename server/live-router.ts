import { TRPCError } from "@trpc/server";
import {
  and,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
} from "drizzle-orm";
import { z } from "zod";
import {
  activeHostLeases,
  liveChat,
  liveSignals,
  liveViewers,
  streams,
  type Stream,
} from "../drizzle/live-schema";
import { circles, memberships } from "../drizzle/schema";
import type { LiveStream } from "../shared/social";
import { createHostGenerationRestartSignals } from "../shared/live-generation-restart";
import {
  MAX_LIVE_CHAT_POLL_BATCH,
  liveChatRateWindowMs,
  type LiveChatAdmissionKind,
  wouldExceedLiveChatAdmission,
} from "../shared/live-chat-limits";
import {
  currentLivePeerAuthority,
  isLiveCircleParticipantRole,
  type LivePeerAuthorityViewer,
} from "../shared/live-peer-authority";
import { getDb } from "./db";
import { assertPlatformFeature } from "./platform-settings";
import {
  createTurnIceConfiguration,
  loadTurnConfiguration,
  TurnConfigurationError,
  type TurnConfiguration,
} from "./turn-config";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  assertCircleCoverImageOwnership,
  getCircleContentAccessForProtectedRead,
  getDisplayProfileWithDb,
  getProfile,
} from "./social-service";

export const MAX_SIGNAL_BYTES = 32_768;
export const MAX_ICE_CANDIDATE_BYTES = 8_192;
export const MAX_ICE_SDP_MID_BYTES = 256;
/** Direct P2P fans out a media stream per viewer; this is deliberately not SFU scalability. */
export const P2P_VIEWER_LIMIT = 4;
/** One signal poll has a small, bounded protocol work unit. */
export const MAX_LIVE_SIGNAL_BATCH = 64;
/** Expiry prevents an abandoned participant from retaining durable signals indefinitely. */
export const LIVE_SIGNAL_TTL_MS = 2 * 60_000;
export const MAX_LIVE_SIGNALS_PER_STREAM = 512;
export const MAX_LIVE_SIGNALS_PER_PARTICIPANT = 128;
export const LIVE_SIGNAL_RATE_WINDOW_MS = 10_000;
export const MAX_LIVE_SIGNALS_PER_PARTICIPANT_PER_WINDOW = 48;
/** Provisional setup heartbeats cannot keep an unready stream alive forever. */
export const HOST_SETUP_DEADLINE_MS = 90_000;
/** A crashed host disappears quickly without requiring a browser unload event. */
export const HOST_LEASE_MS = 45_000;
/** Viewer counts and signaling do not retain abandoned browser sessions. */
export const VIEWER_LEASE_MS = 30_000;
const idInput = z.object({ streamId: z.number().int().positive() });
const listInput = z
  .object({
    search: z.string().trim().max(80).optional(),
    hostIds: z
      .array(z.number().int().positive())
      .min(1)
      .max(100)
      .transform((hostIds) => [...new Set(hostIds)])
      .optional(),
    /** Restricts discovery to media-ready streams with a current host lease. */
    readyOnly: z.boolean().optional(),
    /** Optional client affinity check; request context remains authoritative. */
    viewerScope: z.number().int().positive().nullable().optional(),
  })
  .optional();
const signalKind = z.enum(["offer", "answer", "ice"]);

type SignalKind = z.infer<typeof signalKind>;
type LiveSignalKind = SignalKind | "join" | "leave";
type CircleMembershipRole = "owner" | "moderator" | "member" | "pending";
type LiveDatabase = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type LiveTransaction = Parameters<
  Parameters<LiveDatabase["transaction"]>[0]
>[0];
type LiveReadDatabase = LiveDatabase | LiveTransaction;
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

export function isP2pAudienceAtCapacity(activeViewerCount: number): boolean {
  return activeViewerCount >= P2P_VIEWER_LIMIT;
}

/**
 * This predicate is evaluated with the stream row locked, immediately before
 * an insert. It limits both retained rows and burst work per participant.
 */
export function wouldExceedLiveSignalQuota(input: {
  streamSignals: number;
  participantSignals: number;
  recentParticipantSignals: number;
}): boolean {
  return (
    input.streamSignals >= MAX_LIVE_SIGNALS_PER_STREAM ||
    input.participantSignals >= MAX_LIVE_SIGNALS_PER_PARTICIPANT ||
    input.recentParticipantSignals >=
      MAX_LIVE_SIGNALS_PER_PARTICIPANT_PER_WINDOW
  );
}

/** Hosting is a member capability even when a circle is publicly readable. */
export function canHostCircleRole(
  role: CircleMembershipRole | string | null | undefined,
): boolean {
  return isLiveCircleParticipantRole(role);
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

export function signalPayloadIsValid(
  kind: SignalKind,
  payload: string,
): boolean {
  try {
    if (Buffer.byteLength(payload, "utf8") > MAX_SIGNAL_BYTES) return false;
    const value: unknown = JSON.parse(payload);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const signal = value as Record<string, unknown>;
    const liveOfferEpoch = signal.liveOfferEpoch;
    if (
      liveOfferEpoch !== undefined &&
      (typeof liveOfferEpoch !== "number" ||
        !Number.isInteger(liveOfferEpoch) ||
        liveOfferEpoch <= 0)
    ) {
      return false;
    }

    if (kind === "ice") {
      return (
        typeof signal.candidate === "string" &&
        signal.candidate.length > 0 &&
        Buffer.byteLength(signal.candidate, "utf8") <=
          MAX_ICE_CANDIDATE_BYTES &&
        (signal.sdpMid === null ||
          signal.sdpMid === undefined ||
          (typeof signal.sdpMid === "string" &&
            Buffer.byteLength(signal.sdpMid, "utf8") <=
              MAX_ICE_SDP_MID_BYTES)) &&
        (signal.sdpMLineIndex === null ||
          signal.sdpMLineIndex === undefined ||
          (typeof signal.sdpMLineIndex === "number" &&
            Number.isInteger(signal.sdpMLineIndex) &&
            signal.sdpMLineIndex >= 0))
      );
    }

    return (
      signal.type === kind &&
      typeof signal.sdp === "string" &&
      signal.sdp.length > 0 &&
      Buffer.byteLength(signal.sdp, "utf8") <= MAX_SIGNAL_BYTES
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

type LockedLiveCircleAccess = Readonly<{
  privacy: "public" | "private";
  role: CircleMembershipRole | null;
}>;

/**
 * Circle removal takes this same parent-row lock. Every protected live
 * transaction takes it before host-lease or stream locks, so role revocation
 * and live admission/work are ordered without holding a lock over WebRTC I/O.
 */
async function lockLiveCircleAccess(
  tx: LiveTransaction,
  userId: number,
  circleId: number | null,
): Promise<LockedLiveCircleAccess | null> {
  if (circleId === null) return null;
  const [circle] = await tx
    .select({ privacy: circles.privacy })
    .from(circles)
    .where(eq(circles.id, circleId))
    .limit(1)
    .for("update");
  if (!circle) notFound();
  const [membership] = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(eq(memberships.circleId, circleId), eq(memberships.userId, userId)),
    )
    .limit(1);
  const role = membership?.role ?? null;
  if (circle.privacy === "private" && !canHostCircleRole(role)) {
    forbidden("You do not have access to this circle live stream.");
  }
  return { privacy: circle.privacy, role };
}

function assertCurrentLiveHostRole(
  circleAccess: LockedLiveCircleAccess | null,
): void {
  if (circleAccess !== null && !canHostCircleRole(circleAccess.role)) {
    forbidden("Join this circle before hosting a live stream.");
  }
}

function assertLockedLiveStreamCircle(
  stream: Stream,
  expectedCircleId: number | null,
): void {
  if (stream.circleId !== expectedCircleId) notFound();
}

function streamHasActiveHostLease(stream: Stream, now = Date.now()): boolean {
  return (
    stream.status === "live" && hasActiveHostLease(stream.lastHeartbeatAt, now)
  );
}

function isValidDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function streamIsReadyAndActive(stream: Stream, now = Date.now()): boolean {
  return streamHasActiveHostLease(stream, now) && isValidDate(stream.readyAt);
}

/**
 * A discovery response is allowed to show a live indicator only while the
 * ready stream's host lease is still current. Malformed timestamps fail closed
 * rather than creating an unbounded or fabricated indicator.
 */
function liveAvailability(
  stream: Stream,
  now: number,
): {
  liveReady: boolean;
  liveExpiresAt: string | null;
} {
  if (!streamIsReadyAndActive(stream, now)) {
    return { liveReady: false, liveExpiresAt: null };
  }

  const heartbeatMs = stream.lastHeartbeatAt.getTime();
  const expiresAt = new Date(heartbeatMs + HOST_LEASE_MS);
  if (!isValidDate(expiresAt)) {
    return { liveReady: false, liveExpiresAt: null };
  }

  return { liveReady: true, liveExpiresAt: expiresAt.toISOString() };
}

/**
 * A ready-only avatar must not survive a host's removal from its circle. The
 * viewer's circle read check remains separate: both the viewer and host must
 * currently be allowed by their respective policies before this is exposed.
 */
async function hostRetainsCircleMembership(
  db: LiveReadDatabase,
  stream: Stream,
): Promise<boolean> {
  if (stream.circleId === null) return true;
  const [membership] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.circleId, stream.circleId),
        eq(memberships.userId, stream.hostId),
      ),
    )
    .limit(1);
  return canHostCircleRole(membership?.role);
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
  expectedCircleId: number | null,
  expectedGeneration: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const circleAccess = await lockLiveCircleAccess(
      tx,
      hostId,
      expectedCircleId,
    );
    assertCurrentLiveHostRole(circleAccess);
    const lease = await lockActiveHostLease(tx, hostId);
    const [stream] = await tx
      .select()
      .from(streams)
      .where(eq(streams.id, streamId))
      .for("update")
      .limit(1);
    if (!stream || stream.status !== "live") notFound();
    assertLockedLiveStreamCircle(stream, expectedCircleId);
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
  expectedCircleId: number | null,
  ready: boolean | undefined,
  setup: boolean | undefined,
  expectedGeneration: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const circleAccess = await lockLiveCircleAccess(
      tx,
      hostId,
      expectedCircleId,
    );
    assertCurrentLiveHostRole(circleAccess);
    const lease = await lockActiveHostLease(tx, hostId);
    const stream = await lockLiveStream(tx, streamId);
    assertLockedLiveStreamCircle(stream, expectedCircleId);
    if (stream.status !== "live") notFound();
    if (stream.hostId !== hostId) notFound();
    if (
      !hasCurrentLiveSignalGeneration(expectedGeneration, stream.hostGeneration)
    ) {
      forbidden("This live media session has been replaced.");
    }

    const now = new Date();
    if (ready && setup) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A host setup heartbeat cannot mark a stream ready.",
      });
    }
    if (stream.readyAt === null && ready !== true) {
      if (setup !== true) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Live setup must send a provisional heartbeat before media is ready.",
        });
      }
      if (
        now.getTime() - stream.createdAt.getTime() >=
        HOST_SETUP_DEADLINE_MS
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Live camera setup timed out. Start a new live moment.",
        });
      }
    }
    const active = await reconcileActiveHostLease(tx, lease, hostId, now);
    if (active?.id !== stream.id) notFound();

    await tx
      .update(streams)
      .set({
        lastHeartbeatAt: now,
        ...(ready === true && stream.readyAt === null ? { readyAt: now } : {}),
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

/**
 * Transaction counterpart used after the parent-circle lock and
 * lockLiveStream(). The parent lock serializes current role admission with
 * member removal before this checks generation-bound viewer presence.
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

async function viewerCount(
  db: LiveReadDatabase,
  streamId: number,
): Promise<number> {
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

/**
 * The host receives this bounded, current snapshot before processing a signal
 * batch. It intentionally rechecks private-circle membership here instead of
 * waiting for social-service removal hooks, which do not own live transport.
 */
async function currentLivePeerAuthorityInTransaction(
  tx: LiveTransaction,
  stream: Stream,
  circleAccess: LockedLiveCircleAccess | null,
  now: number,
): Promise<LivePeerAuthorityViewer[]> {
  const viewers = await tx
    .select({
      userId: liveViewers.userId,
      generation: liveViewers.generation,
      lastSeenAt: liveViewers.lastSeenAt,
      leftAt: liveViewers.leftAt,
    })
    .from(liveViewers)
    .where(
      and(
        eq(liveViewers.streamId, stream.id),
        isNull(liveViewers.leftAt),
        gt(liveViewers.lastSeenAt, new Date(now - VIEWER_LEASE_MS)),
      ),
    )
    .orderBy(liveViewers.userId)
    // P2P admission already makes this a maximum-four collection. Keeping the
    // snapshot explicitly bounded fails closed if historical data violates it.
    .limit(P2P_VIEWER_LIMIT);

  const privateCircle = circleAccess?.privacy === "private";
  const membershipsForViewers =
    privateCircle && stream.circleId !== null && viewers.length > 0
      ? await tx
          .select({ userId: memberships.userId, role: memberships.role })
          .from(memberships)
          .where(
            and(
              eq(memberships.circleId, stream.circleId),
              inArray(
                memberships.userId,
                viewers.map((viewer) => viewer.userId),
              ),
            ),
          )
      : [];

  return currentLivePeerAuthority({
    viewers,
    memberships: membershipsForViewers,
    privateCircle,
    now,
    viewerLeaseMs: VIEWER_LEASE_MS,
  });
}

async function toLiveStream(
  db: LiveReadDatabase,
  stream: Stream,
  now = Date.now(),
): Promise<LiveStream> {
  const [host, viewers] = await Promise.all([
    getDisplayProfileWithDb(db, stream.hostId),
    viewerCount(db, stream.id),
  ]);
  const availability = liveAvailability(stream, now);
  return {
    id: stream.id,
    host,
    title: stream.title,
    circleId: stream.circleId,
    thumbnail: stream.thumbnail,
    viewers,
    status: stream.status,
    createdAt: stream.createdAt.toISOString(),
    liveReady: availability.liveReady,
    liveExpiresAt: availability.liveExpiresAt,
  };
}

/**
 * Circle-scoped discovery serializes its current membership decision and DTO mapping with member
 * removal. The shared parent SHARE lock yields removal-wins when removal acquired UPDATE first,
 * while a read that acquired SHARE first completes a single coherent card before removal commits.
 */
async function currentLiveStreamOutput(
  db: LiveDatabase,
  stream: Stream,
  viewerId: number | null,
  readyOnly: boolean,
  now: number,
): Promise<LiveStream | null> {
  const circleId = stream.circleId;
  if (circleId === null) return toLiveStream(db, stream, now);

  return db.transaction(async (tx) => {
    let access: Awaited<
      ReturnType<typeof getCircleContentAccessForProtectedRead>
    >;
    try {
      access = await getCircleContentAccessForProtectedRead(
        tx,
        viewerId,
        circleId,
      );
    } catch (error) {
      // `canAccessCircle` previously omitted a stale/deleted circle from discovery. Preserve that
      // public read behavior while allowing unavailable database/authorization failures to surface.
      if (error instanceof TRPCError && error.code === "NOT_FOUND") return null;
      throw error;
    }
    if (!access) return null;
    if (readyOnly && !(await hostRetainsCircleMembership(tx, stream))) {
      return null;
    }
    return toLiveStream(tx, stream, now);
  });
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

/** Every retained signal is short lived; this runs under the already-held stream lock. */
async function purgeExpiredLiveSignalsInTransaction(
  tx: LiveTransaction,
  streamId: number,
  now: Date,
): Promise<void> {
  await tx
    .delete(liveSignals)
    .where(
      and(
        eq(liveSignals.streamId, streamId),
        lt(liveSignals.createdAt, new Date(now.getTime() - LIVE_SIGNAL_TTL_MS)),
        or(
          eq(liveSignals.kind, "offer"),
          eq(liveSignals.kind, "answer"),
          eq(liveSignals.kind, "ice"),
        ),
      ),
    );
}

async function assertLiveSignalCapacityInTransaction(
  tx: LiveTransaction,
  input: { streamId: number; participantId: number; now: Date },
): Promise<void> {
  const recentCutoff = new Date(
    input.now.getTime() - LIVE_SIGNAL_RATE_WINDOW_MS,
  );
  const [streamRows, participantRows, recentParticipantRows] =
    await Promise.all([
      tx
        .select({ total: count() })
        .from(liveSignals)
        .where(eq(liveSignals.streamId, input.streamId)),
      tx
        .select({ total: count() })
        .from(liveSignals)
        .where(
          and(
            eq(liveSignals.streamId, input.streamId),
            eq(liveSignals.fromId, input.participantId),
          ),
        ),
      tx
        .select({ total: count() })
        .from(liveSignals)
        .where(
          and(
            eq(liveSignals.streamId, input.streamId),
            eq(liveSignals.fromId, input.participantId),
            gt(liveSignals.createdAt, recentCutoff),
          ),
        ),
    ]);
  const [streamTotal] = streamRows;
  const [participantTotal] = participantRows;
  const [recentParticipantTotal] = recentParticipantRows;
  if (
    wouldExceedLiveSignalQuota({
      streamSignals: Number(streamTotal?.total ?? 0),
      participantSignals: Number(participantTotal?.total ?? 0),
      recentParticipantSignals: Number(recentParticipantTotal?.total ?? 0),
    })
  ) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Live signaling is busy. Please wait and retry.",
    });
  }
}

/**
 * The parent-circle then stream-row locks already held by every caller make
 * these counts and the following insert one atomic admission decision. Rows
 * are retained up to the explicit caps; this path never deletes live history.
 */
async function assertLiveChatAdmissionInTransaction(
  tx: LiveTransaction,
  input: {
    streamId: number;
    participantId: number;
    kind: LiveChatAdmissionKind;
    now: Date;
  },
): Promise<void> {
  const recentCutoff = new Date(
    input.now.getTime() - liveChatRateWindowMs(input.kind),
  );
  const [streamRows, participantRows, recentParticipantRows] =
    await Promise.all([
      tx
        .select({ total: count() })
        .from(liveChat)
        .where(eq(liveChat.streamId, input.streamId)),
      tx
        .select({ total: count() })
        .from(liveChat)
        .where(
          and(
            eq(liveChat.streamId, input.streamId),
            eq(liveChat.userId, input.participantId),
          ),
        ),
      tx
        .select({ total: count() })
        .from(liveChat)
        .where(
          and(
            eq(liveChat.streamId, input.streamId),
            eq(liveChat.userId, input.participantId),
            gt(liveChat.createdAt, recentCutoff),
          ),
        ),
    ]);

  if (
    wouldExceedLiveChatAdmission(input.kind, {
      streamRows: Number(streamRows[0]?.total ?? 0),
      participantRows: Number(participantRows[0]?.total ?? 0),
      recentParticipantRows: Number(recentParticipantRows[0]?.total ?? 0),
    })
  ) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Live chat is busy. Please wait and retry.",
    });
  }
}

async function hasDuplicateLiveIceInTransaction(
  tx: LiveTransaction,
  input: {
    streamId: number;
    fromId: number;
    toId: number;
    fromGeneration: number;
    toGeneration: number;
    payload: string;
  },
): Promise<boolean> {
  const [duplicate] = await tx
    .select({ id: liveSignals.id })
    .from(liveSignals)
    .where(
      and(
        eq(liveSignals.streamId, input.streamId),
        eq(liveSignals.fromId, input.fromId),
        eq(liveSignals.toId, input.toId),
        eq(liveSignals.kind, "ice"),
        eq(liveSignals.fromGeneration, input.fromGeneration),
        eq(liveSignals.toGeneration, input.toGeneration),
        eq(liveSignals.payload, input.payload),
      ),
    )
    .limit(1);
  return !!duplicate;
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
    .input(listInput)
    .query(async ({ ctx, input }): Promise<LiveStream[]> => {
      const viewerId = ctx.user?.id ?? null;
      if (input?.viewerScope !== undefined && input.viewerScope !== viewerId) {
        throw new TRPCError({
          code: viewerId === null ? "UNAUTHORIZED" : "FORBIDDEN",
          message: "You are not allowed to access live streams.",
        });
      }

      const db = await getDb();
      if (!db) unavailable();

      const search = input?.search;
      const now = Date.now();
      const readyOnly = input?.readyOnly === true;
      const conditions = [eq(streams.status, "live")];
      if (search) conditions.push(ilike(streams.title, `%${search}%`));
      if (readyOnly) {
        // Keep the ready-avatar source bounded in SQL before its fixed list cap.
        conditions.push(
          isNotNull(streams.readyAt),
          gt(streams.lastHeartbeatAt, new Date(now - HOST_LEASE_MS)),
        );
      }
      if (input?.hostIds) {
        conditions.push(inArray(streams.hostId, input.hostIds));
      }
      const rows = await db
        .select()
        .from(streams)
        .where(conditions.length === 1 ? conditions[0] : and(...conditions))
        .orderBy(desc(streams.createdAt))
        .limit(100);

      const visible: LiveStream[] = [];
      const readyHostIds = new Set<number>();
      for (const stream of rows) {
        const availability = liveAvailability(stream, now);
        // A host retains visibility of its own preparing session in the legacy
        // list so its live screen can mount media. Ready-only discovery never
        // makes that exception, including for the current host.
        if (
          readyOnly
            ? !availability.liveReady
            : stream.hostId !== viewerId && !availability.liveReady
        ) {
          continue;
        }
        // Existing data can contain historical duplicate host sessions. The
        // newest eligible ready-only row wins, rather than falling through to
        // an older session if its circle is not readable by this viewer.
        if (readyOnly) {
          if (readyHostIds.has(stream.hostId)) continue;
          readyHostIds.add(stream.hostId);
        }
        const output = await currentLiveStreamOutput(
          db,
          stream,
          viewerId,
          readyOnly,
          now,
        );
        if (output) visible.push(output);
      }
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
      // Read the authoritative feature flag before TURN acquisition or any
      // stream/lease lifecycle work. In inactive mode this is a no-op.
      await assertPlatformFeature(db, "liveStreamingEnabled");
      // Production must not create a stream that would later fall back to a
      // public STUN-only transport. Do this before any stream/lease write.
      loadLiveTurnConfiguration();
      const circleId = input.circleId ?? null;

      const now = new Date();
      const stream = await db.transaction(async (tx) => {
        // Serialize admission with the lifecycle transaction. The settings
        // reader runs before this path locks the host lease or any stream row.
        await assertPlatformFeature(tx, "liveStreamingEnabled");
        const circleAccess = await lockLiveCircleAccess(
          tx,
          ctx.user.id,
          circleId,
        );
        assertCurrentLiveHostRole(circleAccess);
        // Live cards render this value to other viewers. Reuse the circle-cover policy so only a
        // canonical upload owned by this host or an explicit trusted starter image can persist.
        await assertCircleCoverImageOwnership(tx, ctx.user.id, input.thumbnail);
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
      return toLiveStream(db, stream);
    }),

  end: protectedProcedure
    .input(idInput.extend({ generation: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) unavailable();
      const stream = await getStreamOrThrow(input.streamId);
      await endHostStreamAtomically(
        db,
        ctx.user.id,
        input.streamId,
        stream.circleId,
        input.generation,
      );
      return { success: true } as const;
    }),

  heartbeat: protectedProcedure
    .input(
      idInput.extend({
        ready: z.boolean().optional(),
        /** Hosts renew this only while waiting for capture permission/media. */
        setup: z.literal(true).optional(),
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
          stream.circleId,
          input.ready,
          input.setup,
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
      await db.transaction(async (tx) => {
        await lockLiveCircleAccess(tx, ctx.user.id, stream.circleId);
        const lockedStream = await lockLiveStream(tx, stream.id);
        assertLockedLiveStreamCircle(lockedStream, stream.circleId);
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

    return db.transaction(async (tx) => {
      const circleAccess = await lockLiveCircleAccess(
        tx,
        ctx.user.id,
        accessibleStream.circleId,
      );
      // Both host restarts and viewer joins take this same stream-row lock. A
      // joining viewer therefore either appears in the restart snapshot or
      // targets the newer host generation; it can never fall between them.
      const stream = await lockLiveStream(tx, input.streamId);
      assertLockedLiveStreamCircle(stream, accessibleStream.circleId);
      if (stream.hostId === ctx.user.id) {
        assertCurrentLiveHostRole(circleAccess);
      }
      if (!streamHasActiveHostLease(stream, now.getTime())) notFound();
      await purgeExpiredLiveSignalsInTransaction(tx, stream.id, now);

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
        .select({
          generation: liveViewers.generation,
          lastSeenAt: liveViewers.lastSeenAt,
          leftAt: liveViewers.leftAt,
        })
        .from(liveViewers)
        .where(
          and(
            eq(liveViewers.streamId, stream.id),
            eq(liveViewers.userId, ctx.user.id),
          ),
        )
        .for("update")
        .limit(1);
      const isAlreadyActive =
        existingViewer !== undefined &&
        hasActiveViewerLease(existingViewer, now.getTime());
      if (!isAlreadyActive) {
        const cutoff = new Date(now.getTime() - VIEWER_LEASE_MS);
        const [activeViewerTotal] = await tx
          .select({ total: count() })
          .from(liveViewers)
          .where(
            and(
              eq(liveViewers.streamId, stream.id),
              isNull(liveViewers.leftAt),
              gt(liveViewers.lastSeenAt, cutoff),
            ),
          );
        if (isP2pAudienceAtCapacity(Number(activeViewerTotal?.total ?? 0))) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This live moment has reached its small direct audience limit. Please try again later.",
          });
        }
      }
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
      const accessibleStream = await getStreamOrThrow(input.streamId);
      return db.transaction(async (tx) => {
        const circleAccess = await lockLiveCircleAccess(
          tx,
          ctx.user.id,
          accessibleStream.circleId,
        );
        const stream = await lockLiveStream(tx, input.streamId);
        assertLockedLiveStreamCircle(stream, accessibleStream.circleId);
        if (stream.hostId === ctx.user.id) {
          assertCurrentLiveHostRole(circleAccess);
        }
        const currentGeneration = await assertActiveParticipantInTransaction(
          tx,
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
            await tx
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
      });
    }),

  /**
   * Hosts periodically reconcile negotiated WebRTC peers with the current
   * membership and viewer-lease authority. The parent lock is acquired before
   * the stream lock, matching join/heartbeat/signal paths and member removal.
   */
  peerAuthority: protectedProcedure
    .input(idInput.extend({ generation: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) unavailable();
      const accessibleStream = await getStreamOrThrow(input.streamId);

      return db.transaction(async (tx) => {
        const circleAccess = await lockLiveCircleAccess(
          tx,
          ctx.user.id,
          accessibleStream.circleId,
        );
        const stream = await lockLiveStream(tx, input.streamId);
        assertLockedLiveStreamCircle(stream, accessibleStream.circleId);
        if (stream.hostId !== ctx.user.id) {
          forbidden("Only the host can reconcile live media peers.");
        }
        assertCurrentLiveHostRole(circleAccess);
        if (!streamIsReadyAndActive(stream)) notFound();
        if (
          !hasCurrentLiveSignalGeneration(
            input.generation,
            stream.hostGeneration,
          )
        ) {
          forbidden("This live media session has been replaced.");
        }

        return {
          viewers: await currentLivePeerAuthorityInTransaction(
            tx,
            stream,
            circleAccess,
            Date.now(),
          ),
        };
      });
    }),

  leave: protectedProcedure
    .input(idInput.extend({ generation: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) unavailable();
      const accessibleStream = await getStreamOrThrow(input.streamId);

      await db.transaction(async (tx) => {
        const circleAccess = await lockLiveCircleAccess(
          tx,
          ctx.user.id,
          accessibleStream.circleId,
        );
        const stream = await lockLiveStream(tx, input.streamId);
        assertLockedLiveStreamCircle(stream, accessibleStream.circleId);
        if (stream.status !== "live") notFound();
        if (stream.hostId === ctx.user.id) {
          assertCurrentLiveHostRole(circleAccess);
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
      const accessibleStream = await getStreamOrThrow(input.streamId);
      return db.transaction(async (tx) => {
        const circleAccess = await lockLiveCircleAccess(
          tx,
          ctx.user.id,
          accessibleStream.circleId,
        );
        const stream = await lockLiveStream(tx, input.streamId);
        assertLockedLiveStreamCircle(stream, accessibleStream.circleId);
        if (stream.hostId === ctx.user.id) {
          assertCurrentLiveHostRole(circleAccess);
        }
        const now = new Date();
        await purgeExpiredLiveSignalsInTransaction(tx, stream.id, now);
        const currentGeneration = await assertActiveParticipantInTransaction(
          tx,
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
        const rows = await tx
          .select({
            id: liveSignals.id,
            fromId: liveSignals.fromId,
            toId: liveSignals.toId,
            kind: liveSignals.kind,
            fromGeneration: liveSignals.fromGeneration,
            toGeneration: liveSignals.toGeneration,
            payload: liveSignals.payload,
          })
          .from(liveSignals)
          .where(and(...conditions))
          .orderBy(liveSignals.id)
          .limit(MAX_LIVE_SIGNAL_BATCH);

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
            fromGeneration: row.fromGeneration,
            payload: row.payload,
          }));
      });
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

      await db.transaction(async (tx) => {
        const senderCircleAccess = await lockLiveCircleAccess(
          tx,
          ctx.user.id,
          accessibleStream.circleId,
        );
        const recipientCircleAccess =
          input.toId === ctx.user.id
            ? senderCircleAccess
            : await lockLiveCircleAccess(
                tx,
                input.toId,
                accessibleStream.circleId,
              );
        const stream = await lockLiveStream(tx, input.streamId);
        assertLockedLiveStreamCircle(stream, accessibleStream.circleId);
        if (stream.hostId === ctx.user.id) {
          assertCurrentLiveHostRole(senderCircleAccess);
        }
        if (stream.hostId === input.toId) {
          assertCurrentLiveHostRole(recipientCircleAccess);
        }
        if (!streamIsReadyAndActive(stream)) notFound();
        const now = new Date();
        await purgeExpiredLiveSignalsInTransaction(tx, stream.id, now);
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
          forbidden(
            "This WebRTC signal is not allowed for these participants.",
          );
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
          forbidden(
            "This WebRTC signal is not allowed for these participants.",
          );
        }

        if (
          input.kind === "ice" &&
          (await hasDuplicateLiveIceInTransaction(tx, {
            streamId: stream.id,
            fromId: ctx.user.id,
            toId: input.toId,
            fromGeneration: senderGeneration,
            toGeneration: recipientGeneration,
            payload: input.payload,
          }))
        ) {
          // ICE retransmission is normal; keeping one durable copy avoids
          // inflating both the recipient queue and the quota counters.
          return;
        }
        await assertLiveSignalCapacityInTransaction(tx, {
          streamId: stream.id,
          participantId: ctx.user.id,
          now,
        });

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
    const accessibleStream = await getStreamOrThrow(input.streamId);
    return db.transaction(async (tx) => {
      const circleAccess = await lockLiveCircleAccess(
        tx,
        ctx.user.id,
        accessibleStream.circleId,
      );
      const stream = await lockLiveStream(tx, input.streamId);
      assertLockedLiveStreamCircle(stream, accessibleStream.circleId);
      if (stream.hostId === ctx.user.id) {
        assertCurrentLiveHostRole(circleAccess);
      }
      await assertActiveParticipantInTransaction(tx, stream, ctx.user.id);
      const rows = await tx
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
        .limit(MAX_LIVE_CHAT_POLL_BATCH);

      return rows
        .reverse()
        .map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
    });
  }),

  sendChat: protectedProcedure
    .input(idInput.extend({ text: z.string().trim().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) unavailable();
      const accessibleStream = await getStreamOrThrow(input.streamId);
      const profile = await getProfile(ctx.user.id);
      await db.transaction(async (tx) => {
        const circleAccess = await lockLiveCircleAccess(
          tx,
          ctx.user.id,
          accessibleStream.circleId,
        );
        const stream = await lockLiveStream(tx, input.streamId);
        assertLockedLiveStreamCircle(stream, accessibleStream.circleId);
        if (stream.hostId === ctx.user.id) {
          assertCurrentLiveHostRole(circleAccess);
        }
        await assertActiveParticipantInTransaction(tx, stream, ctx.user.id);
        await assertLiveChatAdmissionInTransaction(tx, {
          streamId: stream.id,
          participantId: ctx.user.id,
          kind: "chat",
          now: new Date(),
        });
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
    const profile = await getProfile(ctx.user.id);
    await db.transaction(async (tx) => {
      const circleAccess = await lockLiveCircleAccess(
        tx,
        ctx.user.id,
        accessibleStream.circleId,
      );
      const stream = await lockLiveStream(tx, input.streamId);
      assertLockedLiveStreamCircle(stream, accessibleStream.circleId);
      if (stream.hostId === ctx.user.id) {
        assertCurrentLiveHostRole(circleAccess);
      }
      await assertActiveParticipantInTransaction(tx, stream, ctx.user.id);
      await assertLiveChatAdmissionInTransaction(tx, {
        streamId: stream.id,
        participantId: ctx.user.id,
        kind: "reaction",
        now: new Date(),
      });
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
