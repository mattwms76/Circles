import { readFileSync } from "node:fs";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../server/_core/context";
import {
  collectEligibleFeedPage,
  type FeedScanCursor,
} from "../server/social-service";
import { conversationsInput, socialRouter } from "../server/social-router";
import { liveRouter } from "../server/live-router";

const liveDeps = vi.hoisted(() => ({
  assertImageOwnership: vi.fn(),
  assertPlatformFeature: vi.fn(),
  getDb: vi.fn(),
  getProfile: vi.fn(),
  loadTurnConfiguration: vi.fn(),
}));

vi.mock("../server/db", () => ({
  getDb: liveDeps.getDb,
}));

vi.mock("../server/social-service", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../server/social-service")>();
  return {
    ...original,
    assertCircleCoverImageOwnership: liveDeps.assertImageOwnership,
    canAccessCircle: vi.fn(),
    getDisplayProfile: vi.fn(),
    getProfile: liveDeps.getProfile,
  };
});

vi.mock("../server/platform-settings", () => ({
  assertPlatformFeature: liveDeps.assertPlatformFeature,
}));

vi.mock("../server/turn-config", () => ({
  TurnConfigurationError: class TurnConfigurationError extends Error {},
  createTurnIceConfiguration: vi.fn(),
  loadTurnConfiguration: liveDeps.loadTurnConfiguration,
}));

describe("A26 backend repair contract", () => {
  it("A26-017 preserves an optional PostgreSQL microsecond cursor through a scan continuation", async () => {
    const displayDate = new Date("2026-10-26T12:00:00.123Z");
    const exact = "2026-10-26T12:00:00.123456Z";
    const candidates = [
      { id: 2, circleId: null, createdAt: displayDate, createdAtExact: exact },
      { id: 1, circleId: null, createdAt: displayDate, createdAtExact: exact },
    ];
    const cursors: (FeedScanCursor | null)[] = [];

    const readPage = async (cursor: FeedScanCursor | null) => {
      cursors.push(cursor);
      if (!cursor) return candidates;
      return cursor.createdAtExact === exact ? [candidates[1]] : [];
    };

    const first = await collectEligibleFeedPage(readPage, async () => true, {
      limit: 1,
    });
    expect(first.nextCursor).toEqual({
      createdAt: displayDate,
      id: 2,
      createdAtExact: exact,
    });

    const second = await collectEligibleFeedPage(readPage, async () => true, {
      cursor: first.nextCursor ?? undefined,
      limit: 1,
    });
    expect(cursors[1]).toEqual(first.nextCursor);
    expect(second.items).toEqual([1]);
  });

  it("A26-038 accepts legacy undefined input but rejects a foreign viewer scope before database work", async () => {
    expect(conversationsInput.safeParse(undefined).success).toBe(true);
    expect(
      conversationsInput.safeParse({ conversationId: 42, viewerScope: 7 })
        .success,
    ).toBe(true);
    expect(
      conversationsInput.safeParse({ conversationId: 0, viewerScope: 7 })
        .success,
    ).toBe(false);

    const ctx: TrpcContext = {
      user: { id: 7 } as TrpcContext["user"],
      req: {} as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };
    await expect(
      socialRouter.createCaller(ctx).conversations({
        conversationId: 42,
        viewerScope: 8,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("A26-001 finalizes circle previews and message-page reads under the established parent-circle lock", () => {
    const source = readFileSync("server/social-service.ts", "utf8");
    expect(source).toContain("authorizedConversationOutputWithDb");
    expect(source).toContain("lockCircleForProtectedMutation: true");
    expect(source).toContain("return db.transaction(async (tx) => {");
    expect(source).toContain("and ${memberships.userId} = ${userId}");
    expect(source).toContain(
      "assertConversationAccess(tx, userId, conversationId",
    );
  });

  it("A26-006 excludes the current actor in the paged directory SQL predicate", () => {
    const source = readFileSync("server/social-service.ts", "utf8");
    const page = source.slice(
      source.indexOf("export async function listProfilesPage("),
      source.indexOf("async function assertCircleContentAccess("),
    );
    expect(page).toContain('candidate."userId" <> ${viewerId}::integer');
    expect(
      page.indexOf('candidate."userId" <> ${viewerId}::integer'),
    ).toBeLessThan(page.indexOf("cursor_anchor AS"));
  });

  it("A26-002 routes a hostile thumbnail to the shared image-ownership policy before any stream write", async () => {
    const denied = new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Media must be a canonical managed upload or an approved starter asset",
    });
    const transaction = vi.fn(
      async (callback: (tx: object) => Promise<unknown>) => callback({}),
    );
    liveDeps.getDb.mockResolvedValue({ transaction });
    liveDeps.assertPlatformFeature.mockResolvedValue(undefined);
    liveDeps.loadTurnConfiguration.mockReturnValue({});
    liveDeps.assertImageOwnership.mockRejectedValue(denied);

    const ctx: TrpcContext = {
      user: { id: 22 } as TrpcContext["user"],
      req: {} as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };
    await expect(
      liveRouter.createCaller(ctx).create({
        title: "Hosted session",
        thumbnail: "https://attacker.example/pixel.png",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(liveDeps.assertImageOwnership).toHaveBeenCalledWith(
      expect.any(Object),
      22,
      "https://attacker.example/pixel.png",
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
