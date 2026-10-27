import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { isAllowedMediaAttachmentReference } from "../shared/media";
import { inspectRecordedMp4 } from "../shared/recorded-video";
import type {
  Circle,
  Comment,
  Conversation,
  Member,
  Message,
  Post,
  Profile,
} from "../shared/social";
import {
  MESSAGE_PAGE_DEFAULT_LIMIT,
  MESSAGE_PAGE_MAX_LIMIT,
} from "../shared/message-pagination";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { requestCancellation } from "./_core/bounded-network";
import { getDb } from "./db";
import {
  assertPlatformUploadSize,
  assertPlatformUploadSizeWithLimit,
} from "./platform-settings";
import {
  Mp4ValidationError,
  validateMp4Upload,
} from "./sec27-video-validation";
import { storagePut } from "./storage";
import {
  approveMember,
  createCircle,
  createComment,
  createPost,
  deletePost,
  discardUnusedUpload,
  encryptSocialMedia,
  feed,
  feedPage,
  findProfile,
  getCircle,
  getPostPublicationStatus,
  getProfile,
  joinCircle,
  leaveCircle,
  listCircles,
  listCirclesPage,
  listComments,
  listConversations,
  listMembers,
  listMembersPage,
  listMessages,
  listProfiles,
  listProfilesPage,
  markConversationRead,
  openCircleChat,
  openDirect,
  recordUpload,
  removeMember,
  reportPost,
  sendMessage,
  setCircleMembership,
  setMemberRole,
  toggleFollow,
  toggleLike,
  toggleSave,
  updateProfile,
} from "./social-service";

const id = z.number().int().positive();
const dateIdCursor = z.object({
  createdAt: z.string().datetime({ offset: true }),
  id,
});
const feedPageCursor = dateIdCursor
  .extend({
    // JS Date truncates PostgreSQL microseconds; legacy callers may omit this exact companion.
    createdAtExact: z
      .string()
      .datetime({ offset: true })
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
      .optional(),
  })
  .refine(
    (cursor) =>
      !cursor.createdAtExact ||
      new Date(cursor.createdAtExact).getTime() ===
        new Date(cursor.createdAt).getTime(),
    {
      message: "Exact timestamp must match the cursor's displayed timestamp",
    },
  );
const pageLimit = z.number().int().positive().max(50).default(20);
const shortText = z.string().trim().min(1).max(10_000);
const optionalMediaUrl = z
  .string()
  .trim()
  .max(2_048)
  .refine(isAllowedMediaAttachmentReference, {
    message:
      "Media must be a canonical managed upload or an approved starter asset",
  })
  .optional();
export const sendMessageInput = z
  .object({
    conversationId: id,
    text: z.string().trim().max(10_000),
    media: optionalMediaUrl,
    // Optional for staged native clients. When supplied it makes retries durable and exact.
    clientMessageId: z
      .string()
      .min(16)
      .max(96)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
      .optional(),
  })
  .superRefine((value, issue) => {
    if (!value.text && !value.media) {
      issue.addIssue({
        code: "custom",
        message: "A message needs text or media",
        path: ["text"],
      });
    }
  });
export const messagesInput = z.object({
  conversationId: id,
  /** Fetches messages strictly older than this immutable message ID. */
  cursor: id.optional(),
  limit: z
    .number()
    .int()
    .positive()
    .max(MESSAGE_PAGE_MAX_LIMIT)
    .default(MESSAGE_PAGE_DEFAULT_LIMIT),
});
/** Acknowledgements must name an actually delivered message, never infer a wall-clock cursor. */
export const markReadInput = z.object({
  conversationId: id,
  throughMessageId: id,
});
export const conversationsInput = z
  .object({
    /** Optional exact thread metadata lookup; omitted input preserves the inbox array contract. */
    conversationId: id.optional(),
    /** Optional actor affinity check; request context remains the identity authority. */
    viewerScope: id.optional(),
  })
  .optional();
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
] as const;
// Keep the client contract as `mimeType: string`, then reject every value outside this allowlist.
// Expo's asset picker correctly exposes MIME values at runtime but types them as a general string.
const mimeType = z
  .string()
  .refine(
    (value) =>
      ALLOWED_MIME_TYPES.includes(value as (typeof ALLOWED_MIME_TYPES)[number]),
    {
      message: "Only JPEG, PNG, WEBP, and MP4 uploads are allowed",
    },
  );
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_BASE64_CHARACTERS = Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 4;
const MAX_RASTER_PIXELS = 16 * 1024 * 1024;
const MAX_RASTER_OUTPUT_BYTES = MAX_UPLOAD_BYTES;
const RASTER_PROCESSING_TIMEOUT_SECONDS = 5;
const RASTER_FORMAT_BY_MIME = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

type RasterMimeType = keyof typeof RASTER_FORMAT_BY_MIME;
type VerifiedMediaMimeType = RasterMimeType | "video/mp4";

export type VerifiedMediaUpload = {
  bytes: Buffer;
  mimeType: VerifiedMediaMimeType;
};

const clientPublishId = z
  .string()
  .min(16)
  .max(96)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const recordingUpload = z.object({
  maxDurationSeconds: z.union([z.literal(30), z.literal(60)]),
});

export const createPostInput = z
  .object({
    text: z.string().trim().max(10_000),
    media: optionalMediaUrl,
    mediaType: z.enum(["text", "photo", "video"]),
    circleId: id.optional(),
    // Omission preserves legacy callers; the client owns retrying one generated operation ID.
    clientPublishId: clientPublishId.optional(),
  })
  .superRefine((value, issue) => {
    if (!value.text && !value.media) {
      issue.addIssue({
        code: "custom",
        message: "A post needs text or media",
        path: ["text"],
      });
    }
    if (value.mediaType !== "text" && !value.media) {
      issue.addIssue({
        code: "custom",
        message: "Photo and video posts need media",
        path: ["media"],
      });
    }
    if (value.mediaType === "text" && value.media) {
      issue.addIssue({
        code: "custom",
        message: "Text posts cannot include media",
        path: ["media"],
      });
    }
  });

function decodeBase64(base64: string): Buffer {
  const value = base64.trim();
  if (
    !value ||
    value.length > MAX_BASE64_CHARACTERS ||
    value.length % 4 !== 0
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid or oversized base64 upload",
    });
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid base64 upload",
    });
  }
  const decoded = Buffer.from(value, "base64");
  if (!decoded.length || decoded.length > MAX_UPLOAD_BYTES) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Upload must be between 1 byte and 20 MB",
    });
  }
  // Buffer accepts some malformed padded values, so require a canonical round trip as well.
  if (decoded.toString("base64") !== value) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid base64 upload",
    });
  }
  return decoded;
}

function mediaValidationError(message: string): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message });
}

/**
 * Performs the only accepted image admission path. Sharp fully decodes untrusted raster input,
 * rejects warnings/truncation, caps source pixels/channels and processing time, then emits a fresh
 * JPEG, PNG, or WebP buffer without caller-supplied metadata. The persisted MIME comes from this
 * verified exact-format result, never an untrusted file prefix.
 */
export async function validateMediaUpload(
  bytes: Buffer,
  declaredMimeType: string,
): Promise<VerifiedMediaUpload> {
  if (declaredMimeType === "video/mp4") {
    try {
      await validateMp4Upload(bytes);
      return { bytes, mimeType: "video/mp4" };
    } catch (error) {
      if (error instanceof Mp4ValidationError) {
        throw mediaValidationError(error.message);
      }
      throw mediaValidationError("MP4 upload could not be structurally parsed");
    }
  }

  if (!(declaredMimeType in RASTER_FORMAT_BY_MIME)) {
    throw mediaValidationError(
      "Only JPEG, PNG, WEBP, and MP4 uploads are allowed",
    );
  }
  const mimeType = declaredMimeType as RasterMimeType;
  const expectedFormat = RASTER_FORMAT_BY_MIME[mimeType];

  try {
    const image = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: MAX_RASTER_PIXELS,
      limitInputChannels: 4,
      pages: 1,
      sequentialRead: true,
      unlimited: false,
    })
      .rotate()
      .timeout({ seconds: RASTER_PROCESSING_TIMEOUT_SECONDS });
    const metadata = await image.metadata();
    if (
      metadata.format !== expectedFormat ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > MAX_RASTER_PIXELS
    ) {
      throw mediaValidationError(
        "Upload bytes do not match the declared MIME type",
      );
    }

    const normalized = await image
      .toFormat(
        expectedFormat,
        expectedFormat === "jpeg"
          ? { quality: 85, mozjpeg: true }
          : expectedFormat === "png"
            ? { adaptiveFiltering: true, compressionLevel: 9 }
            : { quality: 85, smartSubsample: true },
      )
      .toBuffer({ resolveWithObject: true });
    if (
      normalized.info.format !== expectedFormat ||
      !normalized.data.length ||
      normalized.data.length > MAX_RASTER_OUTPUT_BYTES
    ) {
      throw mediaValidationError("Normalized media exceeds the 20 MB limit");
    }

    return { bytes: normalized.data, mimeType };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw mediaValidationError("Upload is not a valid supported raster image");
  }
}

/**
 * Circles API. Public procedures expose only public content; every user-owned mutation uses
 * the starter's real session-backed protectedProcedure rather than accepting a caller user id.
 */
export const circlesPageInput = z.object({
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  // Optional preserves every legacy directory caller while making the complete joined
  // collection, rather than only the loaded client page, an explicit server filter.
  joinedOnly: z.boolean().optional(),
  cursor: dateIdCursor
    .extend({
      createdAtExact: z
        .string()
        .datetime({ offset: true })
        .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
        .optional(),
    })
    .refine(
      (cursor) =>
        !cursor.createdAtExact ||
        new Date(cursor.createdAtExact).getTime() ===
          new Date(cursor.createdAt).getTime(),
      {
        message: "Exact timestamp must match the cursor's displayed timestamp",
      },
    )
    .optional(),
  limit: pageLimit,
});

export const socialRouter = router({
  feed: publicProcedure
    .input(
      z.object({
        filter: z.enum(["for-you", "following", "circles", "saved"]),
        circleId: id.optional(),
        authorId: id.optional(),
        cursor: z
          .object({ createdAt: z.string().datetime({ offset: true }), id })
          .optional(),
        limit: z.number().int().positive().max(100).optional(),
      }),
    )
    .query(
      async ({ ctx, input }): Promise<Post[]> =>
        feed(
          ctx.user?.id ?? null,
          input.filter,
          input.circleId,
          input.authorId,
          {
            ...(input.cursor
              ? {
                  cursor: {
                    createdAt: new Date(input.cursor.createdAt),
                    id: input.cursor.id,
                  },
                }
              : {}),
            ...(input.limit ? { limit: input.limit } : {}),
          },
        ),
    ),

  feedPage: publicProcedure
    .input(
      z.object({
        filter: z.enum(["for-you", "following", "circles", "saved"]),
        circleId: id.optional(),
        authorId: id.optional(),
        search: z.string().trim().max(120).optional(),
        cursor: feedPageCursor.optional(),
        limit: pageLimit,
      }),
    )
    .query(async ({ ctx, input }) => {
      const page = await feedPage(
        ctx.user?.id ?? null,
        input.filter,
        input.circleId,
        input.authorId,
        {
          search: input.search,
          ...(input.cursor
            ? {
                cursor: {
                  createdAt: new Date(input.cursor.createdAt),
                  id: input.cursor.id,
                  createdAtExact: input.cursor.createdAtExact,
                },
              }
            : {}),
          limit: input.limit,
        },
      );
      return {
        ...page,
        nextCursor: page.nextCursor
          ? {
              createdAt: page.nextCursor.createdAt.toISOString(),
              id: page.nextCursor.id,
              createdAtExact: page.nextCursor.createdAtExact,
            }
          : null,
      };
    }),

  circles: publicProcedure
    .input(
      z.object({
        search: z.string().trim().max(120).optional(),
        category: z.string().trim().max(80).optional(),
      }),
    )
    .query(
      async ({ ctx, input }): Promise<Circle[]> =>
        listCircles(ctx.user?.id ?? null, input),
    ),

  circlesPage: publicProcedure
    .input(circlesPageInput)
    .query(async ({ ctx, input }) => {
      const page = await listCirclesPage(ctx.user?.id ?? null, {
        search: input.search,
        category: input.category,
        joinedOnly: input.joinedOnly,
        ...(input.cursor
          ? {
              cursor: {
                createdAt: new Date(input.cursor.createdAt),
                id: input.cursor.id,
                createdAtExact: input.cursor.createdAtExact,
              },
            }
          : {}),
        limit: input.limit,
      });
      return {
        ...page,
        nextCursor: page.nextCursor
          ? {
              createdAt: page.nextCursor.createdAt.toISOString(),
              id: page.nextCursor.id,
              createdAtExact: page.nextCursor.createdAtExact,
            }
          : null,
      };
    }),

  circle: publicProcedure
    .input(z.object({ id }))
    .query(
      async ({ ctx, input }): Promise<Circle> =>
        getCircle(ctx.user?.id ?? null, input.id),
    ),

  profiles: publicProcedure
    .input(z.object({ search: z.string().trim().max(120).optional() }))
    .query(
      async ({ ctx, input }): Promise<Profile[]> =>
        listProfiles(ctx.user?.id ?? null, input.search),
    ),

  profilesPage: publicProcedure
    .input(
      z.object({
        search: z.string().trim().max(120).optional(),
        cursor: z.object({ id }).optional(),
        limit: pageLimit,
      }),
    )
    .query(({ ctx, input }) =>
      listProfilesPage(ctx.user?.id ?? null, {
        search: input.search,
        cursor: input.cursor,
        limit: input.limit,
      }),
    ),

  profile: publicProcedure
    .input(z.object({ id: id.optional() }).optional())
    .query(async ({ ctx, input }): Promise<Profile | null> => {
      if (input?.id) return findProfile(input.id, ctx.user?.id ?? null);
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Sign in to view your profile",
        });
      }
      return getProfile(ctx.user.id);
    }),

  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        handle: z
          .string()
          .trim()
          .min(2)
          .max(48)
          .regex(
            /^@?[a-zA-Z0-9_.-]+$/,
            "Handle may contain letters, numbers, _, ., and -",
          ),
        bio: z.string().trim().max(2_000),
        avatar: optionalMediaUrl,
      }),
    )
    .mutation(
      ({ ctx, input }): Promise<Profile> => updateProfile(ctx.user.id, input),
    ),

  follow: protectedProcedure
    .input(z.object({ userId: id, following: z.boolean().optional() }))
    .mutation(({ ctx, input }) =>
      toggleFollow(ctx.user.id, input.userId, input.following),
    ),

  createCircle: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(2).max(140),
        description: z.string().trim().min(1).max(5_000),
        category: z.string().trim().min(1).max(80),
        privacy: z.enum(["public", "private"]),
        image: optionalMediaUrl,
        color: z.string().trim().max(32).optional(),
      }),
    )
    .mutation(
      ({ ctx, input }): Promise<Circle> => createCircle(ctx.user.id, input),
    ),

  joinCircle: protectedProcedure
    .input(z.object({ circleId: id }))
    .mutation(({ ctx, input }) => joinCircle(ctx.user.id, input.circleId)),

  leaveCircle: protectedProcedure
    .input(z.object({ circleId: id }))
    .mutation(({ ctx, input }) => leaveCircle(ctx.user.id, input.circleId)),

  setMembership: protectedProcedure
    .input(z.object({ circleId: id, joined: z.boolean() }))
    .mutation(({ ctx, input }) =>
      setCircleMembership(ctx.user.id, input.circleId, input.joined),
    ),

  members: publicProcedure
    .input(z.object({ circleId: id }))
    .query(
      ({ ctx, input }): Promise<Member[]> =>
        listMembers(ctx.user?.id ?? null, input.circleId),
    ),

  membersPage: publicProcedure
    .input(
      z.object({
        circleId: id,
        // JS Date truncates PostgreSQL microseconds; accept the exact companion when supplied.
        cursor: feedPageCursor.optional(),
        limit: pageLimit,
      }),
    )
    .query(async ({ ctx, input }) => {
      const page = await listMembersPage(ctx.user?.id ?? null, input.circleId, {
        ...(input.cursor
          ? {
              cursor: {
                createdAt: new Date(input.cursor.createdAt),
                id: input.cursor.id,
                createdAtExact: input.cursor.createdAtExact,
              },
            }
          : {}),
        limit: input.limit,
      });
      return {
        ...page,
        nextCursor: page.nextCursor
          ? {
              createdAt: page.nextCursor.createdAt.toISOString(),
              id: page.nextCursor.id,
              createdAtExact: page.nextCursor.createdAtExact,
            }
          : null,
      };
    }),

  setRole: protectedProcedure
    .input(
      z.object({
        circleId: id,
        userId: id,
        role: z.enum(["moderator", "member"]),
      }),
    )
    .mutation(({ ctx, input }) =>
      setMemberRole(ctx.user.id, input.circleId, input.userId, input.role),
    ),

  removeMember: protectedProcedure
    .input(z.object({ circleId: id, userId: id }))
    .mutation(({ ctx, input }) =>
      removeMember(ctx.user.id, input.circleId, input.userId),
    ),

  approveMember: protectedProcedure
    .input(z.object({ circleId: id, userId: id }))
    .mutation(({ ctx, input }) =>
      approveMember(ctx.user.id, input.circleId, input.userId),
    ),

  createPost: protectedProcedure
    .input(createPostInput)
    .mutation(
      ({ ctx, input }): Promise<Post> => createPost(ctx.user.id, input),
    ),

  /** Catalog-only preflight for a composer that will send a retry-safe clientPublishId. */
  publicationStatus: protectedProcedure.query(() => getPostPublicationStatus()),

  likePost: protectedProcedure
    .input(z.object({ postId: id, liked: z.boolean().optional() }))
    .mutation(({ ctx, input }) =>
      toggleLike(ctx.user.id, input.postId, input.liked),
    ),

  savePost: protectedProcedure
    .input(z.object({ postId: id, saved: z.boolean().optional() }))
    .mutation(({ ctx, input }) =>
      toggleSave(ctx.user.id, input.postId, input.saved),
    ),

  comments: publicProcedure
    .input(z.object({ postId: id }))
    .query(
      ({ ctx, input }): Promise<Comment[]> =>
        listComments(ctx.user?.id ?? null, input.postId),
    ),

  comment: protectedProcedure
    .input(z.object({ postId: id, text: shortText }))
    .mutation(
      ({ ctx, input }): Promise<Comment> =>
        createComment(ctx.user.id, input.postId, input.text),
    ),

  deletePost: protectedProcedure
    .input(z.object({ postId: id }))
    .mutation(({ ctx, input }) => deletePost(ctx.user.id, input.postId)),

  report: protectedProcedure
    .input(z.object({ postId: id, reason: z.string().trim().min(2).max(500) }))
    .mutation(({ ctx, input }) =>
      reportPost(ctx.user.id, input.postId, input.reason),
    ),

  conversations: protectedProcedure
    .input(conversationsInput)
    .query(({ ctx, input }): Promise<Conversation[]> => {
      if (
        input?.viewerScope !== undefined &&
        input.viewerScope !== ctx.user.id
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not allowed to access these conversations",
        });
      }
      return listConversations(ctx.user.id, input?.conversationId);
    }),

  openDirect: protectedProcedure
    .input(z.object({ userId: id }))
    .mutation(({ ctx, input }) => openDirect(ctx.user.id, input.userId)),

  openCircleChat: protectedProcedure
    .input(z.object({ circleId: id }))
    .mutation(({ ctx, input }) => openCircleChat(ctx.user.id, input.circleId)),

  messages: protectedProcedure.input(messagesInput).query(
    ({ ctx, input }): Promise<Message[]> =>
      listMessages(ctx.user.id, input.conversationId, {
        cursor: input.cursor,
        limit: input.limit,
      }),
  ),

  sendMessage: protectedProcedure.input(sendMessageInput).mutation(
    ({ ctx, input }): Promise<Message> =>
      sendMessage(ctx.user.id, input.conversationId, {
        text: input.text,
        media: input.media,
        clientMessageId: input.clientMessageId,
      }),
  ),

  markRead: protectedProcedure
    .input(markReadInput)
    .mutation(({ ctx, input }) =>
      markConversationRead(
        ctx.user.id,
        input.conversationId,
        input.throughMessageId,
      ),
    ),

  upload: protectedProcedure
    .input(
      z.object({
        base64: z.string().max(MAX_BASE64_CHARACTERS),
        mimeType,
        /** Only explicit recorder submissions receive authoritative MP4 metadata inspection. */
        recording: recordingUpload.optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ url: string }> => {
      const cancellation = requestCancellation(ctx.req, ctx.res);
      try {
        const bytes = decodeBase64(input.base64);
        const db = await getDb().catch(() => null);
        let effectiveMaxBytes = MAX_UPLOAD_BYTES;
        if (!db) {
          if (process.env.CIRCLES_PLATFORM_SETTINGS_ENABLED === "true") {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Database is unavailable",
            });
          }
        } else {
          effectiveMaxBytes = await assertPlatformUploadSizeWithLimit(
            db,
            bytes.length,
          );
        }
        if (input.recording) {
          if (input.mimeType !== "video/mp4") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Recorded video uploads must use video/mp4",
            });
          }
          try {
            inspectRecordedMp4(bytes, {
              maxDurationSeconds: input.recording.maxDurationSeconds,
              maxBytes: effectiveMaxBytes,
            });
          } catch (error) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                error instanceof Error && error.message
                  ? error.message
                  : "Recorded video is invalid or unsupported",
            });
          }
        }
        const verified = await validateMediaUpload(bytes, input.mimeType);
        if (db && verified.bytes.length !== bytes.length) {
          await assertPlatformUploadSize(db, verified.bytes.length);
        }
        const extension =
          verified.mimeType === "image/jpeg"
            ? "jpg"
            : verified.mimeType === "image/png"
              ? "png"
              : verified.mimeType === "image/webp"
                ? "webp"
                : "mp4";
        let encrypted: Buffer;
        try {
          encrypted = encryptSocialMedia(verified.bytes);
        } catch {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Secure media upload is unavailable",
          });
        }
        const key = `social-encrypted/${ctx.user.id}/${randomUUID()}.${extension}.enc`;
        const uploaded = await storagePut(
          key,
          encrypted,
          "application/octet-stream",
          {
            stableKey: true,
            signal: cancellation.signal,
          },
        );
        return recordUpload(ctx.user.id, {
          key: uploaded.key,
          url: uploaded.url,
          mimeType: verified.mimeType,
          bytes: verified.bytes.length,
        });
      } finally {
        cancellation.dispose();
      }
    }),

  /** Revokes an unused caller-owned upload so retries can reuse or explicitly abandon it safely. */
  discardUpload: protectedProcedure
    .input(
      z.object({
        url: z
          .string()
          .trim()
          .max(2_048)
          .refine(isAllowedMediaAttachmentReference, {
            message: "Upload must be a canonical managed media URL",
          }),
      }),
    )
    .mutation(({ ctx, input }) => discardUnusedUpload(ctx.user.id, input.url)),
});
