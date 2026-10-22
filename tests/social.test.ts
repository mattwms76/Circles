import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../server/_core/context";
import { markReadInput, sendMessageInput, socialRouter } from "../server/social-router";
import {
  advanceMessageReadWatermark,
  canModerateCircle,
  canReadCircleContent,
  canRemoveCircleMember,
  canSetCircleRole,
  canViewPendingMembers,
  collectEligibleFeedPostIds,
  decryptSocialMedia,
  encryptSocialMedia,
  hasMessageContent,
  isApprovedCircleRole,
  messageIsReadThroughWatermark,
  messageReadForViewer,
} from "../server/social-service";

describe("circle role policy", () => {
  it("keeps pending requests out of private content", () => {
    expect(isApprovedCircleRole("owner")).toBe(true);
    expect(isApprovedCircleRole("moderator")).toBe(true);
    expect(isApprovedCircleRole("member")).toBe(true);
    expect(isApprovedCircleRole("pending")).toBe(false);
    expect(canReadCircleContent("private", "pending")).toBe(false);
    expect(canReadCircleContent("private", null)).toBe(false);
    expect(canReadCircleContent("private", "member")).toBe(true);
    expect(canReadCircleContent("public", null)).toBe(true);
  });

  it("preserves owner control and prevents moderator peer removal", () => {
    expect(canModerateCircle("owner")).toBe(true);
    expect(canModerateCircle("moderator")).toBe(true);
    expect(canModerateCircle("member")).toBe(false);

    expect(canSetCircleRole("owner", "member")).toBe(true);
    expect(canSetCircleRole("moderator", "member")).toBe(false);
    expect(canSetCircleRole("owner", "owner")).toBe(false);

    expect(canRemoveCircleMember("owner", "moderator")).toBe(true);
    expect(canRemoveCircleMember("owner", "owner")).toBe(false);
    expect(canRemoveCircleMember("moderator", "member")).toBe(true);
    expect(canRemoveCircleMember("moderator", "pending")).toBe(true);
    expect(canRemoveCircleMember("moderator", "moderator")).toBe(false);
    expect(canRemoveCircleMember("moderator", "owner")).toBe(false);
  });

  it("shows pending applications only to moderators and owners", () => {
    expect(canViewPendingMembers("owner")).toBe(true);
    expect(canViewPendingMembers("moderator")).toBe(true);
    expect(canViewPendingMembers("member")).toBe(false);
    expect(canViewPendingMembers("pending")).toBe(false);
    expect(canViewPendingMembers(null)).toBe(false);
  });
});

describe("SOC-002 feed visibility scanning", () => {
  it("continues past a private candidate batch and retains compound-cursor ordering", async () => {
    const sharedCreatedAt = new Date("2026-10-22T12:00:00.000Z");
    const inaccessiblePrivatePosts = Array.from({ length: 200 }, (_, index) => ({
      id: 300 - index,
      circleId: 900,
      createdAt: sharedCreatedAt,
    }));
    const olderPublicPosts = Array.from({ length: 100 }, (_, index) => ({
      id: 100 - index,
      circleId: null,
      createdAt: sharedCreatedAt,
    }));
    const newestFirstCandidates = [...inaccessiblePrivatePosts, ...olderPublicPosts];
    const requestedCursorIds: (number | null)[] = [];

    const ids = await collectEligibleFeedPostIds(
      async (cursor) => {
        requestedCursorIds.push(cursor?.id ?? null);
        const start = cursor
          ? newestFirstCandidates.findIndex(
              (candidate) =>
                candidate.createdAt.getTime() < cursor.createdAt.getTime() ||
                (candidate.createdAt.getTime() === cursor.createdAt.getTime() &&
                  candidate.id < cursor.id),
            )
          : 0;
        return start === -1 ? [] : newestFirstCandidates.slice(start, start + 200);
      },
      async (candidate) => candidate.circleId === null,
    );

    expect(ids).toEqual(olderPublicPosts.map((post) => post.id));
    expect(requestedCursorIds).toEqual([null, 101]);
  });
});

describe("encrypted social upload frames", () => {
  const secret = "test-only-media-secret";

  it("round-trips bytes and uses a randomized authenticated frame", () => {
    const source = Buffer.from("private upload bytes\u0000\u00ff", "utf8");
    const first = encryptSocialMedia(source, secret);
    const second = encryptSocialMedia(source, secret);
    expect(first.equals(source)).toBe(false);
    expect(first.equals(second)).toBe(false);
    expect(decryptSocialMedia(first, secret)).toEqual(source);
  });

  it("rejects a tampered ciphertext or authentication tag", () => {
    const encrypted = encryptSocialMedia(Buffer.from("do not disclose"), secret);
    encrypted[encrypted.length - 1] ^= 0x01;
    expect(() => decryptSocialMedia(encrypted, secret)).toThrow();
  });

  it("fails closed without the required encryption secret", () => {
    expect(() => encryptSocialMedia(Buffer.from("not stored"), "")).toThrow();
  });
});

describe("message content and read-receipt policy", () => {
  it("accepts a media-only message but not an empty/whitespace one", () => {
    expect(hasMessageContent("", "/manus-storage/social-encrypted/1/a.jpg.enc")).toBe(true);
    expect(hasMessageContent("  ", " ")).toBe(false);
    expect(hasMessageContent("hello", undefined)).toBe(true);
    expect(
      sendMessageInput.safeParse({
        conversationId: 1,
        text: "  ",
        media: "/manus-storage/social-encrypted/1/123e4567-e89b-42d3-a456-426614174000.jpg.enc",
      }).success,
    ).toBe(true);
    expect(sendMessageInput.safeParse({ conversationId: 1, text: "  " }).success).toBe(false);
  });

  it("marks authored direct messages read only after the other participant reads", () => {
    expect(
      messageReadForViewer({
        authorId: 1,
        viewerId: 1,
        kind: "direct",
        messageId: 17,
        viewerLastReadMessageId: 17,
        participants: [
          { userId: 1, lastReadMessageId: 17 },
          { userId: 2, lastReadMessageId: 16 },
        ],
      }),
    ).toBe(false);
    expect(
      messageReadForViewer({
        authorId: 1,
        viewerId: 1,
        kind: "direct",
        messageId: 17,
        viewerLastReadMessageId: 0,
        participants: [{ userId: 2, lastReadMessageId: 17 }],
      }),
    ).toBe(true);
  });

  it("uses an actual other active member receipt for authored group messages", () => {
    const base = {
      authorId: 1,
      viewerId: 1,
      kind: "circle" as const,
      messageId: 17,
      viewerLastReadMessageId: 0,
    };
    expect(
      messageReadForViewer({
        ...base,
        participants: [{ userId: 2, lastReadMessageId: 17, approved: false }],
      }),
    ).toBe(false);
    expect(
      messageReadForViewer({
        ...base,
        participants: [{ userId: 2, lastReadMessageId: 16, approved: true }],
      }),
    ).toBe(false);
    expect(
      messageReadForViewer({
        ...base,
        participants: [{ userId: 2, lastReadMessageId: 17, approved: true }],
      }),
    ).toBe(true);
  });

  it("MSG-002 keeps a same-timestamp insertion unread when acking only the listed page", () => {
    const tiedTimestamp = new Date("2026-01-01T00:00:00.000Z");
    const deliveredPageLastMessage = { id: 120, createdAt: tiedTimestamp };
    const insertedAfterList = { id: 121, createdAt: tiedTimestamp };
    const watermark = advanceMessageReadWatermark(0, deliveredPageLastMessage.id);

    expect(deliveredPageLastMessage.createdAt).toEqual(insertedAfterList.createdAt);
    expect(messageIsReadThroughWatermark(deliveredPageLastMessage.id, watermark)).toBe(true);
    expect(
      messageReadForViewer({
        authorId: 2,
        viewerId: 1,
        kind: "direct",
        messageId: insertedAfterList.id,
        viewerLastReadMessageId: watermark,
        participants: [],
      }),
    ).toBe(false);
  });

  it("MSG-002 never moves a delivered watermark backward for delayed acknowledgements", () => {
    const newestDeliveredId = advanceMessageReadWatermark(120, 121);
    expect(advanceMessageReadWatermark(newestDeliveredId, 120)).toBe(121);
    expect(messageIsReadThroughWatermark(121, newestDeliveredId)).toBe(true);
    expect(messageIsReadThroughWatermark(122, newestDeliveredId)).toBe(false);
  });

  it("MSG-002 requires an explicit positive delivered message id for mark-read", () => {
    expect(markReadInput.safeParse({ conversationId: 1 }).success).toBe(false);
    expect(markReadInput.safeParse({ conversationId: 1, throughMessageId: 0 }).success).toBe(false);
    expect(markReadInput.safeParse({ conversationId: 1, throughMessageId: 120 }).success).toBe(true);
  });
});

describe("social router authentication", () => {
  it("uses protectedProcedure for a personal follow mutation", async () => {
    const ctx: TrpcContext = {
      user: null,
      req: {} as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };
    const caller = socialRouter.createCaller(ctx);

    await expect(caller.follow({ userId: 42 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
