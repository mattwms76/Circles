import type { Express, Request, Response } from "express";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import {
  circles,
  conversationParticipants,
  conversations,
  memberships,
  messages,
  posts,
  profiles,
  socialUploads,
} from "../../drizzle/schema";
import { streams } from "../../drizzle/live-schema";
import { getDb, type CirclesDatabase, type CirclesTransaction } from "../db";
import * as storageModule from "../storage";

const {
  storageFetchSignedObject,
  storageGetSignedUrl,
  StorageOperationTimeoutError,
} = storageModule;

function privateMediaStoreActive(): boolean {
  const probe = storageModule as {
    privateMediaStoreActive?: () => boolean;
  };
  return probe.privateMediaStoreActive?.() === true;
}
import {
  decryptSocialMedia,
  SOCIAL_MEDIA_FRAME_OVERHEAD,
} from "../social-service";
import { previewLimiterIdentityFromRequest } from "./runtimeSecurity";
import { sdk } from "./sdk";
import { requestCancellation, RequestAbortedError } from "./bounded-network";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const HOST_LEASE_MS = 45_000;
const APPROVED_ROLES = ["owner", "moderator", "member"] as const;
const ENCRYPTED_SOCIAL_KEY =
  /^social-encrypted\/[1-9]\d*\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp|mp4)\.enc$/;
const MEDIA_FETCH_TIMEOUT_MS = 15_000;
const MAX_CONCURRENT_MEDIA_DOWNLOADS = 4;
const MAX_CONCURRENT_MEDIA_DOWNLOADS_PER_CLIENT = 2;
const MEDIA_BUDGET_WINDOW_MS = 60_000;
const MEDIA_BUDGET_BYTES_PER_WINDOW = 40 * 1024 * 1024;
const MAX_TRACKED_MEDIA_CLIENTS = 512;
const SAFE_MEDIA_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
]);

type Database = CirclesDatabase;
type MediaQueryDatabase = CirclesDatabase | CirclesTransaction;
type ByteRange = { start: number; end: number };
type MediaWorkBudgetEntry = {
  windowStartedAt: number;
  usedBytes: number;
  activeRequests: number;
};

export type MediaWorkAdmission =
  | { kind: "allowed"; release: () => void }
  | { kind: "rate_limited" | "concurrency_limited"; retryAfterSeconds: number };

export type MediaWorkAdmissionOptions = {
  maxConcurrentDownloads: number;
  maxConcurrentDownloadsPerClient: number;
  budgetWindowMs: number;
  maxBytesPerClientWindow: number;
  maxTrackedClients: number;
};

/**
 * An intentionally instance-local guard for expensive whole-frame decrypts. Entries expire after
 * one budget window and the map has a fixed upper bound, so arbitrary public client addresses
 * cannot turn request tracking into an unbounded memory sink.
 */
export function createMediaWorkAdmission(options: MediaWorkAdmissionOptions) {
  let activeDownloads = 0;
  const clientBudgets = new Map<string, MediaWorkBudgetEntry>();

  const retryAfterSeconds = (remainingMs: number) =>
    Math.max(1, Math.ceil(remainingMs / 1000));

  const pruneExpiredClients = (now: number) => {
    for (const [clientKey, budget] of clientBudgets) {
      if (
        budget.activeRequests === 0 &&
        now - budget.windowStartedAt >= options.budgetWindowMs
      ) {
        clientBudgets.delete(clientKey);
      }
    }
  };

  return {
    tryAcquire(
      clientKey: string,
      bytes: number,
      now = Date.now(),
    ): MediaWorkAdmission {
      if (!Number.isSafeInteger(bytes) || bytes < 1) {
        throw new RangeError("Media work cost must be a positive safe integer");
      }

      pruneExpiredClients(now);
      if (activeDownloads >= options.maxConcurrentDownloads) {
        return { kind: "concurrency_limited", retryAfterSeconds: 1 };
      }

      let budget = clientBudgets.get(clientKey);
      if (budget && now - budget.windowStartedAt >= options.budgetWindowMs) {
        budget.windowStartedAt = now;
        budget.usedBytes = 0;
      }
      if (
        budget?.activeRequests &&
        budget.activeRequests >= options.maxConcurrentDownloadsPerClient
      ) {
        return { kind: "concurrency_limited", retryAfterSeconds: 1 };
      }
      if (
        budget &&
        budget.usedBytes + bytes > options.maxBytesPerClientWindow
      ) {
        return {
          kind: "rate_limited",
          retryAfterSeconds: retryAfterSeconds(
            budget.windowStartedAt + options.budgetWindowMs - now,
          ),
        };
      }
      if (!budget) {
        if (
          clientBudgets.size >= options.maxTrackedClients ||
          bytes > options.maxBytesPerClientWindow
        ) {
          return {
            kind: "rate_limited",
            retryAfterSeconds: retryAfterSeconds(options.budgetWindowMs),
          };
        }
        budget = { windowStartedAt: now, usedBytes: 0, activeRequests: 0 };
        clientBudgets.set(clientKey, budget);
      }

      budget.usedBytes += bytes;
      budget.activeRequests += 1;
      activeDownloads += 1;
      let released = false;
      return {
        kind: "allowed",
        release: () => {
          if (released) return;
          released = true;
          activeDownloads -= 1;
          budget.activeRequests -= 1;
          if (
            budget.activeRequests === 0 &&
            Date.now() - budget.windowStartedAt >= options.budgetWindowMs
          ) {
            clientBudgets.delete(clientKey);
          }
        },
      };
    },
  };
}

const mediaWorkAdmission = createMediaWorkAdmission({
  maxConcurrentDownloads: MAX_CONCURRENT_MEDIA_DOWNLOADS,
  maxConcurrentDownloadsPerClient: MAX_CONCURRENT_MEDIA_DOWNLOADS_PER_CLIENT,
  budgetWindowMs: MEDIA_BUDGET_WINDOW_MS,
  maxBytesPerClientWindow: MEDIA_BUDGET_BYTES_PER_WINDOW,
  maxTrackedClients: MAX_TRACKED_MEDIA_CLIENTS,
});

class MediaFetchTimeoutError extends Error {
  constructor() {
    super("Media backend request timed out");
  }
}

function parseSingleRange(
  value: string | undefined,
  total: number,
): ByteRange | null | false {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || total <= 0) return false;
  const [, startText, endText] = match;
  if (!startText && !endText) return false;
  if (!startText) {
    const length = Number(endText);
    if (!Number.isSafeInteger(length) || length <= 0) return false;
    return { start: Math.max(0, total - length), end: total - 1 };
  }
  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : total - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= total ||
    requestedEnd < start
  ) {
    return false;
  }
  return { start, end: Math.min(requestedEnd, total - 1) };
}

/**
 * Reads an encrypted frame into one pre-sized buffer. Storage may omit Content-Length, so the
 * reader itself also rejects an overlong or truncated frame before it reaches AES-GCM.
 */
export async function readBoundedEncryptedMediaBody(
  body: ReadableStream<Uint8Array> | null,
  expectedBytes: number,
): Promise<Buffer> {
  if (!body || !Number.isSafeInteger(expectedBytes) || expectedBytes < 1) {
    throw new Error("Invalid encrypted media body");
  }

  const reader = body.getReader();
  const encrypted = Buffer.allocUnsafe(expectedBytes);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      if (value.byteLength > expectedBytes - offset) {
        throw new Error("Encrypted media exceeded expected length");
      }
      encrypted.set(value, offset);
      offset += value.byteLength;
    }
    if (offset !== expectedBytes) {
      throw new Error("Encrypted media did not match expected length");
    }
    return encrypted;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function fetchBoundedEncryptedMedia(
  signedUrl: string,
  expectedBytes: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) throw new RequestAbortedError();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), MEDIA_FETCH_TIMEOUT_MS);
  try {
    const storageResponse = await storageFetchSignedObject(signedUrl, {
      signal: controller.signal,
    });
    if (!storageResponse.ok) {
      await storageResponse.body?.cancel().catch(() => undefined);
      throw new Error("Media backend error");
    }
    const contentLengthHeader = storageResponse.headers.get("content-length");
    const contentLength =
      contentLengthHeader === null ? null : Number(contentLengthHeader);
    if (
      contentLength !== null &&
      (!Number.isSafeInteger(contentLength) || contentLength !== expectedBytes)
    ) {
      await storageResponse.body?.cancel().catch(() => undefined);
      throw new Error("Invalid encrypted media length");
    }
    return await readBoundedEncryptedMediaBody(
      storageResponse.body,
      expectedBytes,
    );
  } catch (error) {
    if (signal?.aborted) throw new RequestAbortedError();
    if (
      controller.signal.aborted ||
      error instanceof StorageOperationTimeoutError
    ) {
      throw new MediaFetchTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function mediaWorkClientKey(req: Request, userId: number | null): string {
  if (userId !== null) return `user:${userId}`;
  const previewIdentity = previewLimiterIdentityFromRequest(req);
  if (previewIdentity) return `preview:${previewIdentity}`;
  // req.ip follows the deployment's Express trust-proxy setting. Do not accept a caller-supplied
  // forwarding header here, because that would let public clients evade the byte budget. The only
  // exception is the HMAC-authenticated, short-lived Preview identity verified above.
  return `ip:${req.ip || req.socket.remoteAddress || "unknown"}`;
}

function setMediaResponseHeaders(res: Response, mimeType: string) {
  res.set({
    "Content-Type": mimeType,
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    // This fixed filename prevents a caller-controlled upload name from affecting any renderer.
    "Content-Disposition": 'inline; filename="circles-media"',
  });
}

async function requester(req: Request): Promise<number | null> {
  try {
    return (await sdk.authenticateRequest(req)).id;
  } catch {
    // Avatar/cover and public-post references are deliberately readable without a session.
    return null;
  }
}

export type MediaAuthorization = {
  mimeType: string;
  bytes: number;
  /** A final parent-lock recheck is required immediately before any bytes are enqueued. */
  requiresFinalMembershipRecheck: boolean;
};

type MediaReferenceState = {
  upload: { userId: number; mimeType: string; bytes: number } | null;
  publicReference: boolean;
  directConversationIds: number[];
  circleMembershipIds: number[];
};

function sortedUniqueIds(ids: number[]): number[] {
  return [...new Set(ids)].sort((left, right) => left - right);
}

function safeUploadMetadata(
  state: MediaReferenceState,
): Pick<MediaAuthorization, "mimeType" | "bytes"> | null {
  const upload = state.upload;
  if (
    !upload ||
    !SAFE_MEDIA_MIME_TYPES.has(upload.mimeType) ||
    !Number.isSafeInteger(upload.bytes) ||
    upload.bytes < 1 ||
    upload.bytes > MAX_UPLOAD_BYTES
  ) {
    return null;
  }
  return { mimeType: upload.mimeType, bytes: upload.bytes };
}

async function isApprovedMember(
  db: MediaQueryDatabase,
  userId: number,
  circleIds: number[],
): Promise<boolean> {
  if (!circleIds.length) return false;
  const match = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        inArray(memberships.circleId, circleIds),
        inArray(memberships.role, APPROVED_ROLES),
      ),
    )
    .limit(1);
  return match.length > 0;
}

/** Reads only exact media references; it never accepts a caller-selected object URL or key. */
async function loadMediaReferenceState(
  db: MediaQueryDatabase,
  key: string,
): Promise<MediaReferenceState> {
  const uploadRows = await db
    .select({
      userId: socialUploads.userId,
      mimeType: socialUploads.mimeType,
      bytes: socialUploads.bytes,
    })
    .from(socialUploads)
    .where(eq(socialUploads.storageKey, key))
    .limit(1);
  const upload = uploadRows[0];
  if (!upload) {
    return {
      upload: null,
      publicReference: false,
      directConversationIds: [],
      circleMembershipIds: [],
    };
  }

  const mediaUrl = `/manus-storage/${key}`;
  const [
    profileReference,
    circleCoverReference,
    postRows,
    messageRows,
    rawStreams,
  ] = await Promise.all([
    db
      .select({ id: profiles.id })
      .from(profiles)
      .where(or(eq(profiles.avatar, mediaUrl), eq(profiles.cover, mediaUrl)))
      .limit(1),
    db
      .select({ id: circles.id })
      .from(circles)
      .where(eq(circles.image, mediaUrl))
      .limit(1),
    db
      .select({ circleId: posts.circleId })
      .from(posts)
      .where(eq(posts.media, mediaUrl)),
    db
      .select({ conversationId: messages.conversationId })
      .from(messages)
      .where(eq(messages.media, mediaUrl)),
    db
      .select({
        circleId: streams.circleId,
        status: streams.status,
        readyAt: streams.readyAt,
        lastHeartbeatAt: streams.lastHeartbeatAt,
      })
      .from(streams)
      .where(eq(streams.thumbnail, mediaUrl)),
  ]);

  const freshReadyStreams = rawStreams.filter(
    (stream) =>
      stream.status === "live" &&
      stream.readyAt !== null &&
      stream.lastHeartbeatAt !== null &&
      stream.lastHeartbeatAt.getTime() > Date.now() - HOST_LEASE_MS,
  );
  const postCircleIds = sortedUniqueIds(
    postRows.flatMap((post) => (post.circleId ? [post.circleId] : [])),
  );
  const streamCircleIds = sortedUniqueIds(
    freshReadyStreams.flatMap((stream) =>
      stream.circleId ? [stream.circleId] : [],
    ),
  );
  const conversationIds = sortedUniqueIds(
    messageRows.map((message) => message.conversationId),
  );
  const [referencedCircles, relatedConversations] = await Promise.all([
    postCircleIds.length || streamCircleIds.length
      ? db
          .select({ id: circles.id, privacy: circles.privacy })
          .from(circles)
          .where(
            inArray(
              circles.id,
              sortedUniqueIds([...postCircleIds, ...streamCircleIds]),
            ),
          )
      : Promise.resolve([]),
    conversationIds.length
      ? db
          .select({
            id: conversations.id,
            kind: conversations.kind,
            circleId: conversations.circleId,
          })
          .from(conversations)
          .where(inArray(conversations.id, conversationIds))
      : Promise.resolve([]),
  ]);
  const circlePrivacy = new Map(
    referencedCircles.map((circle) => [circle.id, circle.privacy]),
  );
  const privatePostCircleIds = postCircleIds.filter(
    (circleId) => circlePrivacy.get(circleId) === "private",
  );
  const privateStreamCircleIds = streamCircleIds.filter(
    (circleId) => circlePrivacy.get(circleId) === "private",
  );
  const directConversationIds = relatedConversations
    .filter((conversation) => conversation.kind === "direct")
    .map((conversation) => conversation.id);
  const messageCircleIds = relatedConversations.flatMap((conversation) =>
    conversation.kind === "circle" && conversation.circleId
      ? [conversation.circleId]
      : [],
  );

  return {
    upload,
    // Profile/circle covers, global posts, public-circle posts, and fresh global/public streams
    // remain intentional discovery references. A deleted reference drops out of this exact read.
    publicReference:
      profileReference.length > 0 ||
      circleCoverReference.length > 0 ||
      postRows.some((post) => post.circleId === null) ||
      postCircleIds.some(
        (circleId) => circlePrivacy.get(circleId) === "public",
      ) ||
      freshReadyStreams.some((stream) => stream.circleId === null) ||
      streamCircleIds.some(
        (circleId) => circlePrivacy.get(circleId) === "public",
      ),
    directConversationIds: sortedUniqueIds(directConversationIds),
    // Circle conversations require membership even when their parent circle is public. Every
    // member-gated path participates in the same parent lock as removeMember.
    circleMembershipIds: sortedUniqueIds([
      ...privatePostCircleIds,
      ...messageCircleIds,
      ...privateStreamCircleIds,
    ]),
  };
}

async function unrestrictedMediaAuthorization(
  db: MediaQueryDatabase,
  state: MediaReferenceState,
  userId: number | null,
): Promise<MediaAuthorization | null> {
  const metadata = safeUploadMetadata(state);
  if (!metadata || !state.upload) return null;
  if (userId === state.upload.userId || state.publicReference) {
    return { ...metadata, requiresFinalMembershipRecheck: false };
  }
  if (!userId || !state.directConversationIds.length) return null;

  const participant = await db
    .select({ id: conversationParticipants.id })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.userId, userId),
        inArray(
          conversationParticipants.conversationId,
          state.directConversationIds,
        ),
      ),
    )
    .limit(1);
  return participant.length
    ? { ...metadata, requiresFinalMembershipRecheck: false }
    : null;
}

/**
 * Membership-based authorization linearizes on the final `FOR SHARE` parent-lock recheck. It is
 * deliberately released before storage I/O; removal wins if it commits before that final recheck,
 * while bytes already enqueued after a successful recheck cannot be recalled by a later removal.
 */
async function withAuthorizedSocialMedia<T>(
  db: Database,
  key: string,
  userId: number | null,
  project: (authorization: MediaAuthorization) => T,
): Promise<T | null> {
  const initial = await loadMediaReferenceState(db, key);
  const initialUnrestricted = await unrestrictedMediaAuthorization(
    db,
    initial,
    userId,
  );
  if (initialUnrestricted) return project(initialUnrestricted);
  if (!userId || !initial.circleMembershipIds.length) return null;

  return db.transaction(async (tx) => {
    const beforeLock = await loadMediaReferenceState(tx, key);
    const beforeLockUnrestricted = await unrestrictedMediaAuthorization(
      tx,
      beforeLock,
      userId,
    );
    if (beforeLockUnrestricted) return project(beforeLockUnrestricted);
    if (!beforeLock.circleMembershipIds.length) return null;

    const lockedRows = await tx
      .select({ id: circles.id })
      .from(circles)
      .where(inArray(circles.id, beforeLock.circleMembershipIds))
      .orderBy(asc(circles.id))
      .for("share");
    const lockedCircleIds = new Set(lockedRows.map((circle) => circle.id));
    if (!lockedCircleIds.size) return null;

    // Re-read exact upload references only after every compatible parent SHARE lock is held. A
    // new unheld parent cannot authorize this request; a deleted or revoked old reference fails.
    const current = await loadMediaReferenceState(tx, key);
    const currentUnrestricted = await unrestrictedMediaAuthorization(
      tx,
      current,
      userId,
    );
    if (currentUnrestricted) return project(currentUnrestricted);
    const lockedCurrentCircleIds = current.circleMembershipIds.filter(
      (circleId) => lockedCircleIds.has(circleId),
    );
    if (
      !lockedCurrentCircleIds.length ||
      !(await isApprovedMember(tx, userId, lockedCurrentCircleIds))
    ) {
      return null;
    }

    const metadata = safeUploadMetadata(current);
    return metadata
      ? project({ ...metadata, requiresFinalMembershipRecheck: true })
      : null;
  });
}

async function isAuthorizedSocialMedia(
  db: Database,
  key: string,
  userId: number | null,
): Promise<MediaAuthorization | null> {
  return withAuthorizedSocialMedia(
    db,
    key,
    userId,
    (authorization) => authorization,
  );
}

export async function enqueueAuthorizedSocialMedia<T>(
  db: Database,
  key: string,
  userId: number | null,
  enqueue: (authorization: MediaAuthorization) => T,
): Promise<T | null> {
  // Callback is synchronous: res.send only queues already-buffered verified bytes. Parent SHARE
  // locks remain held through enqueue; neither fetch/decryption nor response drain occurs here.
  return withAuthorizedSocialMedia(db, key, userId, enqueue);
}

/**
 * Keeps final authorization and the synchronous response enqueue adjacent. A removal fixture can
 * make `finalCheck` fail deterministically; in that case `enqueue` is never called.
 */
export async function enqueueAfterFinalMediaAuthorization<T>(
  finalCheck: () => Promise<MediaAuthorization | null>,
  enqueue: (authorization: MediaAuthorization) => T,
): Promise<T | null> {
  const authorization = await finalCheck();
  return authorization ? enqueue(authorization) : null;
}

async function sendDecryptedSocialMedia(req: Request, res: Response) {
  const key = String(
    (req.params as Record<string, string | undefined>)["0"] ?? "",
  );
  if (!ENCRYPTED_SOCIAL_KEY.test(key)) {
    res.status(404).send("Media not found");
    return;
  }

  const db = await getDb();
  if (!db) {
    res.status(503).send("Media service unavailable");
    return;
  }

  const cancellation = requestCancellation(req, res);
  try {
    const userId = await requester(req);
    const upload = await isAuthorizedSocialMedia(db, key, userId);
    if (!upload) {
      res.status(404).send("Media not found");
      return;
    }
    if (
      !Number.isSafeInteger(upload.bytes) ||
      upload.bytes < 1 ||
      upload.bytes > MAX_UPLOAD_BYTES
    ) {
      res.status(502).send("Invalid media metadata");
      return;
    }

    const range = parseSingleRange(
      typeof req.headers.range === "string" ? req.headers.range : undefined,
      upload.bytes,
    );
    if (range === false) {
      const enqueued = await enqueueAuthorizedSocialMedia(
        db,
        key,
        userId,
        (finalUpload) => {
          if (finalUpload.bytes !== upload.bytes) return false;
          setMediaResponseHeaders(res, finalUpload.mimeType);
          res.set("Content-Range", `bytes */${finalUpload.bytes}`);
          res.status(416).end();
          return true;
        },
      );
      if (!enqueued) {
        res.status(404).send("Media not found");
        return;
      }
      return;
    }

    // GCM frames must be fetched and authenticated as a whole. Charge the declared full plaintext
    // size for every request (including bytes=0-0) before asking storage for a signed URL.
    const admission = mediaWorkAdmission.tryAcquire(
      mediaWorkClientKey(req, userId),
      upload.bytes,
    );
    if (admission.kind !== "allowed") {
      res
        .set({
          "Cache-Control": "private, no-store",
          "Retry-After": String(admission.retryAfterSeconds),
        })
        .status(429)
        .send("Media request limit reached");
      return;
    }

    try {
      const expectedEncryptedBytes = upload.bytes + SOCIAL_MEDIA_FRAME_OVERHEAD;
      let encrypted: Buffer;
      if (privateMediaStoreActive()) {
        const { readPrivateMedia } = await import("../private-media-store");
        encrypted = await readPrivateMedia(key);
        if (encrypted.length !== expectedEncryptedBytes) {
          throw new Error("Invalid encrypted media length");
        }
      } else {
        const signedUrl = await storageGetSignedUrl(key, {
          signal: cancellation.signal,
        });
        encrypted = await fetchBoundedEncryptedMedia(
          signedUrl,
          expectedEncryptedBytes,
          cancellation.signal,
        );
      }
      const plaintext = decryptSocialMedia(encrypted);
      if (plaintext.length !== upload.bytes) {
        res.status(502).send("Invalid decrypted media");
        return;
      }

      // This is the response linearization point for private-circle media. The recheck locks every
      // relevant parent SHARE row and confirms the exact current reference/member state, then
      // holds the parent lock through this synchronous enqueue. No lock spans storage I/O or response drain.
      const enqueued = await enqueueAuthorizedSocialMedia(
        db,
        key,
        userId,
        (finalUpload) => {
          if (finalUpload.bytes !== plaintext.length) return false;
          setMediaResponseHeaders(res, finalUpload.mimeType);
          if (range) {
            const body = plaintext.subarray(range.start, range.end + 1);
            res
              .status(206)
              .set({
                "Content-Range": `bytes ${range.start}-${range.end}/${plaintext.length}`,
                "Content-Length": String(body.length),
              })
              .send(body);
            return true;
          }
          res.set("Content-Length", String(plaintext.length)).send(plaintext);
          return true;
        },
      );
      if (!enqueued) {
        res.status(404).send("Media not found");
        return;
      }
    } finally {
      admission.release();
    }
  } catch (error) {
    if (cancellation.signal.aborted || res.destroyed || res.writableEnded)
      return;
    const status =
      error instanceof MediaFetchTimeoutError
        ? 504
        : error instanceof Error &&
            error.message === "Social media encryption is unavailable"
          ? 503
          : 502;
    res
      .status(status)
      .send(
        status === 504
          ? "Media backend timed out"
          : status === 503
            ? "Media service unavailable"
            : "Media unavailable",
      );
  } finally {
    cancellation.dispose();
  }
}

export function registerStorageProxy(app: Express) {
  // No generic `/manus-storage/*` presigning route: the platform gateway can at most return the
  // ciphertext object there; this endpoint alone decrypts it after reference-aware authorization.
  app.get("/api/media/*", sendDecryptedSocialMedia);
}
