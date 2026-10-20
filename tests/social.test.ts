import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../server/_core/context";
import { sendMessageInput, socialRouter } from "../server/social-router";
import {
  canModerateCircle,
  canReadCircleContent,
  canRemoveCircleMember,
  canSetCircleRole,
  canViewPendingMembers,
  decryptSocialMedia,
  encryptSocialMedia,
  hasMessageContent,
  isApprovedCircleRole,
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
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const after = new Date("2026-01-01T00:00:01.000Z");
  const before = new Date("2025-12-31T23:59:59.000Z");

  it("accepts a media-only message but not an empty/whitespace one", () => {
    expect(hasMessageContent("", "/manus-storage/social-encrypted/1/a.jpg.enc")).toBe(true);
    expect(hasMessageContent("  ", " ")).toBe(false);
    expect(hasMessageContent("hello", undefined)).toBe(true);
    expect(
      sendMessageInput.safeParse({
        conversationId: 1,
        text: "  ",
        media: "/manus-storage/social-encrypted/1/a.jpg.enc",
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
        createdAt,
        viewerLastReadAt: after,
        participants: [
          { userId: 1, lastReadAt: after },
          { userId: 2, lastReadAt: null },
        ],
      }),
    ).toBe(false);
    expect(
      messageReadForViewer({
        authorId: 1,
        viewerId: 1,
        kind: "direct",
        createdAt,
        viewerLastReadAt: null,
        participants: [{ userId: 2, lastReadAt: after }],
      }),
    ).toBe(true);
  });

  it("uses an actual other active member receipt for authored group messages", () => {
    const base = {
      authorId: 1,
      viewerId: 1,
      kind: "circle" as const,
      createdAt,
      viewerLastReadAt: null,
    };
    expect(
      messageReadForViewer({
        ...base,
        participants: [{ userId: 2, lastReadAt: after, approved: false }],
      }),
    ).toBe(false);
    expect(
      messageReadForViewer({
        ...base,
        participants: [{ userId: 2, lastReadAt: before, approved: true }],
      }),
    ).toBe(false);
    expect(
      messageReadForViewer({
        ...base,
        participants: [{ userId: 2, lastReadAt: after, approved: true }],
      }),
    ).toBe(true);
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
