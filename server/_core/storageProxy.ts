import type { Express, Request, Response } from "express";
import { and, eq, inArray, or } from "drizzle-orm";
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
import { getDb } from "../db";
import { storageGetSignedUrl } from "../storage";
import { decryptSocialMedia, SOCIAL_MEDIA_FRAME_OVERHEAD } from "../social-service";
import { previewLimiterIdentityFromRequest } from "./runtimeSecurity";
import { sdk } from "./sdk";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const HOST_LEASE_MS = 45_000;
const APPROVED_ROLES = ["owner", "moderator", "member"] as const;
const ENCRYPTED_SOCIAL_KEY = /^social-encrypted\/[1-9]\d*\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp|mp4)\.enc$/;
const MEDIA_FETCH_TIMEOUT_MS = 15_000;
const MAX_CONCURRENT_MEDIA_DOWNLOADS = 4;
const MAX_CONCURRENT_MEDIA_DOWNLOADS_PER_CLIENT = 2;
const MEDIA_BUDGET_WINDOW_MS = 60_000;
const MEDIA_BUDGET_BYTES_PER_WINDOW = 40 * 1024 * 1024;
const MAX_TRACKED_MEDIA_CLIENTS = 512;

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
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

  const retryAfterSeconds = (remainingMs: number) => Math.max(1, Math.ceil(remainingMs / 1000));

  const pruneExpiredClients = (now: number) => {
    for (const [clientKey, budget] of clientBudgets) {
      if (budget.activeRequests === 0 && now - budget.windowStartedAt >= options.budgetWindowMs) {
        clientBudgets.delete(clientKey);
      }
    }
  };

  return {
    tryAcquire(clientKey: string, bytes: number, now = Date.now()): MediaWorkAdmission {
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
      if (budget?.activeRequests && budget.activeRequests >= options.maxConcurrentDownloadsPerClient) {
        return { kind: "concurrency_limited", retryAfterSeconds: 1 };
      }
      if (budget && budget.usedBytes + bytes > options.maxBytesPerClientWindow) {
        return {
          kind: "rate_limited",
          retryAfterSeconds: retryAfterSeconds(budget.windowStartedAt + options.budgetWindowMs - now),
        };
      }
      if (!budget) {
        if (clientBudgets.size >= options.maxTrackedClients || bytes > options.maxBytesPerClientWindow) {
          return { kind: "rate_limited", retryAfterSeconds: retryAfterSeconds(options.budgetWindowMs) };
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
          if (budget.activeRequests === 0 && Date.now() - budget.windowStartedAt >= options.budgetWindowMs) {
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

function parseSingleRange(value: string | undefined, total: number): ByteRange | null | false {
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

async function fetchBoundedEncryptedMedia(signedUrl: string, expectedBytes: number): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MEDIA_FETCH_TIMEOUT_MS);
  try {
    const storageResponse = await fetch(signedUrl, { signal: controller.signal });
    if (!storageResponse.ok) {
      await storageResponse.body?.cancel().catch(() => undefined);
      throw new Error("Media backend error");
    }
    const contentLengthHeader = storageResponse.headers.get("content-length");
    const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
    if (
      contentLength !== null &&
      (!Number.isSafeInteger(contentLength) || contentLength !== expectedBytes)
    ) {
      await storageResponse.body?.cancel().catch(() => undefined);
      throw new Error("Invalid encrypted media length");
    }
    return await readBoundedEncryptedMediaBody(storageResponse.body, expectedBytes);
  } catch (error) {
    if (controller.signal.aborted) throw new MediaFetchTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
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

async function isApprovedMember(db: Database, userId: number, circleIds: number[]): Promise<boolean> {
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

async function isAuthorizedSocialMedia(
  db: Database,
  key: string,
  userId: number | null,
): Promise<{ mimeType: string; bytes: number } | null> {
  // The route only ever looks up this exact validated socialUploads storage key. It cannot sign
  // arbitrary caller-provided object keys.
  const uploadRows = await db
    .select({ userId: socialUploads.userId, mimeType: socialUploads.mimeType, bytes: socialUploads.bytes })
    .from(socialUploads)
    .where(eq(socialUploads.storageKey, key))
    .limit(1);
  const upload = uploadRows[0];
  if (!upload) return null;
  if (userId === upload.userId) return { mimeType: upload.mimeType, bytes: upload.bytes };

  const mediaUrl = `/manus-storage/${key}`;
  const [profileReference, circleCoverReference] = await Promise.all([
    db
      .select({ id: profiles.id })
      .from(profiles)
      .where(or(eq(profiles.avatar, mediaUrl), eq(profiles.cover, mediaUrl)))
      .limit(1),
    db.select({ id: circles.id }).from(circles).where(eq(circles.image, mediaUrl)).limit(1),
  ]);
  // Avatars and circle covers are intentional public discovery references.
  if (profileReference.length || circleCoverReference.length) {
    return { mimeType: upload.mimeType, bytes: upload.bytes };
  }

  const postRows = await db
    .select({ circleId: posts.circleId })
    .from(posts)
    .where(eq(posts.media, mediaUrl));
  // A post is deleted by removing its row, so only extant post references can authorize.
  if (postRows.some((post) => post.circleId === null)) {
    return { mimeType: upload.mimeType, bytes: upload.bytes };
  }
  const postCircleIds = [...new Set(postRows.flatMap((post) => (post.circleId ? [post.circleId] : [])))];
  if (postCircleIds.length) {
    const postCircles = await db
      .select({ id: circles.id, privacy: circles.privacy })
      .from(circles)
      .where(inArray(circles.id, postCircleIds));
    if (postCircles.some((circle) => circle.privacy === "public")) {
      return { mimeType: upload.mimeType, bytes: upload.bytes };
    }
    if (userId && (await isApprovedMember(db, userId, postCircleIds))) {
      return { mimeType: upload.mimeType, bytes: upload.bytes };
    }
  }

  const messageRows = await db
    .select({ conversationId: messages.conversationId })
    .from(messages)
    .where(eq(messages.media, mediaUrl));
  if (userId && messageRows.length) {
    const conversationIds = [...new Set(messageRows.map((message) => message.conversationId))];
    const relatedConversations = await db
      .select({ id: conversations.id, kind: conversations.kind, circleId: conversations.circleId })
      .from(conversations)
      .where(inArray(conversations.id, conversationIds));
    const directIds = relatedConversations
      .filter((conversation) => conversation.kind === "direct")
      .map((conversation) => conversation.id);
    if (directIds.length) {
      const directParticipant = await db
        .select({ id: conversationParticipants.id })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.userId, userId),
            inArray(conversationParticipants.conversationId, directIds),
          ),
        )
        .limit(1);
      if (directParticipant.length) return { mimeType: upload.mimeType, bytes: upload.bytes };
    }
    const messageCircleIds = relatedConversations.flatMap((conversation) =>
      conversation.kind === "circle" && conversation.circleId ? [conversation.circleId] : [],
    );
    if (await isApprovedMember(db, userId, [...new Set(messageCircleIds)])) {
      return { mimeType: upload.mimeType, bytes: upload.bytes };
    }
  }

  // A thumbnail becomes public only for a ready, fresh global/public-circle live stream. Private
  // circle stream thumbnails require an approved current membership; an uploader matched above.
  const thumbnailStreams = await db
    .select({
      circleId: streams.circleId,
      status: streams.status,
      readyAt: streams.readyAt,
      lastHeartbeatAt: streams.lastHeartbeatAt,
    })
    .from(streams)
    .where(eq(streams.thumbnail, mediaUrl));
  const freshReadyStreams = thumbnailStreams.filter(
    (stream) =>
      stream.status === "live" &&
      stream.readyAt !== null &&
      stream.lastHeartbeatAt !== null &&
      stream.lastHeartbeatAt.getTime() > Date.now() - HOST_LEASE_MS,
  );
  if (freshReadyStreams.some((stream) => stream.circleId === null)) {
    return { mimeType: upload.mimeType, bytes: upload.bytes };
  }
  const streamCircleIds = [
    ...new Set(freshReadyStreams.flatMap((stream) => (stream.circleId ? [stream.circleId] : []))),
  ];
  if (streamCircleIds.length) {
    const streamCircles = await db
      .select({ id: circles.id, privacy: circles.privacy })
      .from(circles)
      .where(inArray(circles.id, streamCircleIds));
    if (streamCircles.some((circle) => circle.privacy === "public")) {
      return { mimeType: upload.mimeType, bytes: upload.bytes };
    }
    if (userId && (await isApprovedMember(db, userId, streamCircleIds))) {
      return { mimeType: upload.mimeType, bytes: upload.bytes };
    }
  }

  return null;
}

async function sendDecryptedSocialMedia(req: Request, res: Response) {
  const key = String((req.params as Record<string, string | undefined>)["0"] ?? "");
  if (!ENCRYPTED_SOCIAL_KEY.test(key)) {
    res.status(404).send("Media not found");
    return;
  }

  const db = await getDb();
  if (!db) {
    res.status(503).send("Media service unavailable");
    return;
  }

  try {
    const userId = await requester(req);
    const upload = await isAuthorizedSocialMedia(db, key, userId);
    if (!upload) {
      res.status(404).send("Media not found");
      return;
    }
    if (!Number.isSafeInteger(upload.bytes) || upload.bytes < 1 || upload.bytes > MAX_UPLOAD_BYTES) {
      res.status(502).send("Invalid media metadata");
      return;
    }

    const range = parseSingleRange(
      typeof req.headers.range === "string" ? req.headers.range : undefined,
      upload.bytes,
    );
    if (range === false) {
      setMediaResponseHeaders(res, upload.mimeType);
      res.set("Content-Range", `bytes */${upload.bytes}`);
      res.status(416).end();
      return;
    }

    // GCM frames must be fetched and authenticated as a whole. Charge the declared full plaintext
    // size for every request (including bytes=0-0) before asking storage for a signed URL.
    const admission = mediaWorkAdmission.tryAcquire(mediaWorkClientKey(req, userId), upload.bytes);
    if (admission.kind !== "allowed") {
      res
        .set({ "Cache-Control": "private, no-store", "Retry-After": String(admission.retryAfterSeconds) })
        .status(429)
        .send("Media request limit reached");
      return;
    }

    try {
      const expectedEncryptedBytes = upload.bytes + SOCIAL_MEDIA_FRAME_OVERHEAD;
      const signedUrl = await storageGetSignedUrl(key);
      const encrypted = await fetchBoundedEncryptedMedia(signedUrl, expectedEncryptedBytes);
      const plaintext = decryptSocialMedia(encrypted);
      if (plaintext.length !== upload.bytes) {
        res.status(502).send("Invalid decrypted media");
        return;
      }

      setMediaResponseHeaders(res, upload.mimeType);
      if (range) {
        const body = plaintext.subarray(range.start, range.end + 1);
        res
          .status(206)
          .set({
            "Content-Range": `bytes ${range.start}-${range.end}/${plaintext.length}`,
            "Content-Length": String(body.length),
          })
          .send(body);
        return;
      }
      res.set("Content-Length", String(plaintext.length)).send(plaintext);
    } finally {
      admission.release();
    }
  } catch (error) {
    const status =
      error instanceof MediaFetchTimeoutError
        ? 504
        : error instanceof Error && error.message === "Social media encryption is unavailable"
          ? 503
          : 502;
    res.status(status).send(
      status === 504 ? "Media backend timed out" : status === 503 ? "Media service unavailable" : "Media unavailable",
    );
  }
}

export function registerStorageProxy(app: Express) {
  // No generic `/manus-storage/*` presigning route: the platform gateway can at most return the
  // ciphertext object there; this endpoint alone decrypts it after reference-aware authorization.
  app.get("/api/media/*", sendDecryptedSocialMedia);
}
