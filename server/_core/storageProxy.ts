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
import { sdk } from "./sdk";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const HOST_LEASE_MS = 45_000;
const APPROVED_ROLES = ["owner", "moderator", "member"] as const;
const ENCRYPTED_SOCIAL_KEY = /^social-encrypted\/[1-9]\d*\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp|mp4)\.enc$/;

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type ByteRange = { start: number; end: number };

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
    const upload = await isAuthorizedSocialMedia(db, key, await requester(req));
    if (!upload) {
      res.status(404).send("Media not found");
      return;
    }
    if (!Number.isSafeInteger(upload.bytes) || upload.bytes < 1 || upload.bytes > MAX_UPLOAD_BYTES) {
      res.status(502).send("Invalid media metadata");
      return;
    }

    const signedUrl = await storageGetSignedUrl(key);
    const storageResponse = await fetch(signedUrl);
    if (!storageResponse.ok) {
      await storageResponse.body?.cancel().catch(() => undefined);
      res.status(502).send("Media backend error");
      return;
    }
    const expectedEncryptedBytes = upload.bytes + SOCIAL_MEDIA_FRAME_OVERHEAD;
    const contentLengthHeader = storageResponse.headers.get("content-length");
    const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
    if (
      contentLength !== null &&
      (!Number.isSafeInteger(contentLength) || contentLength !== expectedEncryptedBytes)
    ) {
      await storageResponse.body?.cancel().catch(() => undefined);
      res.status(502).send("Invalid encrypted media");
      return;
    }
    const encrypted = Buffer.from(await storageResponse.arrayBuffer());
    if (encrypted.length !== expectedEncryptedBytes) {
      res.status(502).send("Invalid encrypted media");
      return;
    }
    const plaintext = decryptSocialMedia(encrypted);
    if (plaintext.length !== upload.bytes) {
      res.status(502).send("Invalid decrypted media");
      return;
    }

    const range = parseSingleRange(
      typeof req.headers.range === "string" ? req.headers.range : undefined,
      plaintext.length,
    );
    res.set({
      "Content-Type": upload.mimeType,
      "Cache-Control": "private, no-store",
      "Accept-Ranges": "bytes",
    });
    if (range === false) {
      res.set("Content-Range", `bytes */${plaintext.length}`);
      res.status(416).end();
      return;
    }
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
  } catch (error) {
    const status = error instanceof Error && error.message === "Social media encryption is unavailable" ? 503 : 502;
    res.status(status).send(status === 503 ? "Media service unavailable" : "Media unavailable");
  }
}

export function registerStorageProxy(app: Express) {
  // No generic `/manus-storage/*` presigning route: the platform gateway can at most return the
  // ciphertext object there; this endpoint alone decrypts it after reference-aware authorization.
  app.get("/api/media/*", sendDecryptedSocialMedia);
}
