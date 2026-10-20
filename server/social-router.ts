import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  Circle,
  Comment,
  Conversation,
  Member,
  Message,
  Post,
  Profile,
} from "../shared/social";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { storagePut } from "./storage";
import {
  approveMember,
  createCircle,
  createComment,
  createPost,
  deletePost,
  encryptSocialMedia,
  feed,
  findProfile,
  getCircle,
  getProfile,
  joinCircle,
  leaveCircle,
  listCircles,
  listComments,
  listConversations,
  listMembers,
  listMessages,
  listProfiles,
  markConversationRead,
  openCircleChat,
  openDirect,
  recordUpload,
  removeMember,
  reportPost,
  sendMessage,
  setMemberRole,
  toggleFollow,
  toggleLike,
  toggleSave,
  updateProfile,
} from "./social-service";

const id = z.number().int().positive();
const shortText = z.string().trim().min(1).max(10_000);
const mediaUrl = z.string().trim().url().max(2_048);
const managedRelativeMediaUrl = z.string().trim().startsWith("/manus-storage/").max(2_048);
const optionalMediaUrl = z.union([mediaUrl, managedRelativeMediaUrl]).optional();
export const sendMessageInput = z
  .object({ conversationId: id, text: z.string().trim().max(10_000), media: optionalMediaUrl })
  .superRefine((value, issue) => {
    if (!value.text && !value.media) {
      issue.addIssue({ code: "custom", message: "A message needs text or media", path: ["text"] });
    }
  });
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "video/mp4"] as const;
// Keep the client contract as `mimeType: string`, then reject every value outside this allowlist.
// Expo's asset picker correctly exposes MIME values at runtime but types them as a general string.
const mimeType = z.string().refine((value) => ALLOWED_MIME_TYPES.includes(value as (typeof ALLOWED_MIME_TYPES)[number]), {
  message: "Only JPEG, PNG, WEBP, and MP4 uploads are allowed",
});
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_BASE64_CHARACTERS = Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 4;

function decodeBase64(base64: string): Buffer {
  const value = base64.trim();
  if (!value || value.length > MAX_BASE64_CHARACTERS || value.length % 4 !== 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid or oversized base64 upload" });
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid base64 upload" });
  }
  const decoded = Buffer.from(value, "base64");
  if (!decoded.length || decoded.length > MAX_UPLOAD_BYTES) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Upload must be between 1 byte and 20 MB" });
  }
  // Buffer accepts some malformed padded values, so require a canonical round trip as well.
  if (decoded.toString("base64") !== value) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid base64 upload" });
  }
  return decoded;
}

function bytesMatchMime(bytes: Buffer, type: string): boolean {
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  }
  if (type === "image/webp") {
    return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  }
  // ISO base media files, including ordinary MP4, identify their first box as `ftyp`.
  return bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
}

/**
 * Circles API. Public procedures expose only public content; every user-owned mutation uses
 * the starter's real session-backed protectedProcedure rather than accepting a caller user id.
 */
export const socialRouter = router({
  feed: publicProcedure
    .input(
      z.object({
        filter: z.enum(["for-you", "following", "circles", "saved"]),
        circleId: id.optional(),
        authorId: id.optional(),
      }),
    )
    .query(async ({ ctx, input }): Promise<Post[]> =>
      feed(ctx.user?.id ?? null, input.filter, input.circleId, input.authorId),
    ),

  circles: publicProcedure
    .input(z.object({ search: z.string().trim().max(120).optional(), category: z.string().trim().max(80).optional() }))
    .query(async ({ ctx, input }): Promise<Circle[]> => listCircles(ctx.user?.id ?? null, input)),

  circle: publicProcedure
    .input(z.object({ id }))
    .query(async ({ ctx, input }): Promise<Circle> => getCircle(ctx.user?.id ?? null, input.id)),

  profiles: publicProcedure
    .input(z.object({ search: z.string().trim().max(120).optional() }))
    .query(async ({ ctx, input }): Promise<Profile[]> => listProfiles(ctx.user?.id ?? null, input.search)),

  profile: publicProcedure
    .input(z.object({ id: id.optional() }).optional())
    .query(async ({ ctx, input }): Promise<Profile | null> => {
      if (input?.id) return findProfile(input.id, ctx.user?.id ?? null);
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to view your profile" });
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
          .regex(/^@?[a-zA-Z0-9_.-]+$/, "Handle may contain letters, numbers, _, ., and -"),
        bio: z.string().trim().max(2_000),
        avatar: optionalMediaUrl,
      }),
    )
    .mutation(({ ctx, input }): Promise<Profile> => updateProfile(ctx.user.id, input)),

  follow: protectedProcedure
    .input(z.object({ userId: id }))
    .mutation(({ ctx, input }) => toggleFollow(ctx.user.id, input.userId)),

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
    .mutation(({ ctx, input }): Promise<Circle> => createCircle(ctx.user.id, input)),

  joinCircle: protectedProcedure
    .input(z.object({ circleId: id }))
    .mutation(({ ctx, input }) => joinCircle(ctx.user.id, input.circleId)),

  leaveCircle: protectedProcedure
    .input(z.object({ circleId: id }))
    .mutation(({ ctx, input }) => leaveCircle(ctx.user.id, input.circleId)),

  members: publicProcedure
    .input(z.object({ circleId: id }))
    .query(({ ctx, input }): Promise<Member[]> => listMembers(ctx.user?.id ?? null, input.circleId)),

  setRole: protectedProcedure
    .input(z.object({ circleId: id, userId: id, role: z.enum(["moderator", "member"]) }))
    .mutation(({ ctx, input }) => setMemberRole(ctx.user.id, input.circleId, input.userId, input.role)),

  removeMember: protectedProcedure
    .input(z.object({ circleId: id, userId: id }))
    .mutation(({ ctx, input }) => removeMember(ctx.user.id, input.circleId, input.userId)),

  approveMember: protectedProcedure
    .input(z.object({ circleId: id, userId: id }))
    .mutation(({ ctx, input }) => approveMember(ctx.user.id, input.circleId, input.userId)),

  createPost: protectedProcedure
    .input(
      z
        .object({
          text: z.string().trim().max(10_000),
          media: optionalMediaUrl,
          mediaType: z.enum(["text", "photo", "video"]),
          circleId: id.optional(),
        })
        .superRefine((value, issue) => {
          if (!value.text && !value.media) {
            issue.addIssue({ code: "custom", message: "A post needs text or media", path: ["text"] });
          }
          if (value.mediaType !== "text" && !value.media) {
            issue.addIssue({ code: "custom", message: "Photo and video posts need media", path: ["media"] });
          }
          if (value.mediaType === "text" && value.media) {
            issue.addIssue({ code: "custom", message: "Text posts cannot include media", path: ["media"] });
          }
        }),
    )
    .mutation(({ ctx, input }): Promise<Post> => createPost(ctx.user.id, input)),

  likePost: protectedProcedure
    .input(z.object({ postId: id }))
    .mutation(({ ctx, input }) => toggleLike(ctx.user.id, input.postId)),

  savePost: protectedProcedure
    .input(z.object({ postId: id }))
    .mutation(({ ctx, input }) => toggleSave(ctx.user.id, input.postId)),

  comments: publicProcedure
    .input(z.object({ postId: id }))
    .query(({ ctx, input }): Promise<Comment[]> => listComments(ctx.user?.id ?? null, input.postId)),

  comment: protectedProcedure
    .input(z.object({ postId: id, text: shortText }))
    .mutation(({ ctx, input }): Promise<Comment> => createComment(ctx.user.id, input.postId, input.text)),

  deletePost: protectedProcedure
    .input(z.object({ postId: id }))
    .mutation(({ ctx, input }) => deletePost(ctx.user.id, input.postId)),

  report: protectedProcedure
    .input(z.object({ postId: id, reason: z.string().trim().min(2).max(500) }))
    .mutation(({ ctx, input }) => reportPost(ctx.user.id, input.postId, input.reason)),

  conversations: protectedProcedure.query(({ ctx }): Promise<Conversation[]> => listConversations(ctx.user.id)),

  openDirect: protectedProcedure
    .input(z.object({ userId: id }))
    .mutation(({ ctx, input }) => openDirect(ctx.user.id, input.userId)),

  openCircleChat: protectedProcedure
    .input(z.object({ circleId: id }))
    .mutation(({ ctx, input }) => openCircleChat(ctx.user.id, input.circleId)),

  messages: protectedProcedure
    .input(z.object({ conversationId: id }))
    .query(({ ctx, input }): Promise<Message[]> => listMessages(ctx.user.id, input.conversationId)),

  sendMessage: protectedProcedure
    .input(sendMessageInput)
    .mutation(({ ctx, input }): Promise<Message> =>
      sendMessage(ctx.user.id, input.conversationId, { text: input.text, media: input.media }),
    ),

  markRead: protectedProcedure
    .input(z.object({ conversationId: id }))
    .mutation(({ ctx, input }) => markConversationRead(ctx.user.id, input.conversationId)),

  upload: protectedProcedure
    .input(z.object({ base64: z.string().max(MAX_BASE64_CHARACTERS), mimeType }))
    .mutation(async ({ ctx, input }): Promise<{ url: string }> => {
      const bytes = decodeBase64(input.base64);
      if (!bytesMatchMime(bytes, input.mimeType)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Upload bytes do not match the declared MIME type" });
      }
      const extension =
        input.mimeType === "image/jpeg"
          ? "jpg"
          : input.mimeType === "image/png"
            ? "png"
            : input.mimeType === "image/webp"
            ? "webp"
              : "mp4";
      let encrypted: Buffer;
      try {
        encrypted = encryptSocialMedia(bytes);
      } catch {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Secure media upload is unavailable" });
      }
      const key = `social-encrypted/${ctx.user.id}/${randomUUID()}.${extension}.enc`;
      const uploaded = await storagePut(key, encrypted, "application/octet-stream", { stableKey: true });
      return recordUpload(ctx.user.id, {
        key: uploaded.key,
        url: uploaded.url,
        mimeType: input.mimeType,
        bytes: bytes.length,
      });
    }),
});
