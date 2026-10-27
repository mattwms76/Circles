import { describe, expect, it } from "vitest";
import { circles, memberships } from "../drizzle/schema";
import {
  collectAuthorizedFeedPage,
  collectEligibleFeedPage,
  getCircleContentAccessForProtectedRead,
} from "../server/social-service";

type Candidate = {
  id: number;
  circleId: number | null;
  createdAt: Date;
};

function cursorReadPage(candidates: Candidate[]) {
  return async (cursor: { createdAt: Date; id: number } | null) => {
    const start = cursor
      ? candidates.findIndex(
          (candidate) =>
            candidate.createdAt.getTime() < cursor.createdAt.getTime() ||
            (candidate.createdAt.getTime() === cursor.createdAt.getTime() &&
              candidate.id < cursor.id),
        )
      : 0;
    return start === -1 ? [] : candidates.slice(start, start + 200);
  };
}

describe("SOC-002 paged feed continuation", () => {
  it("SEC27-012 keeps inaccessible scan cursors internal while continuing to an eligible page", async () => {
    const createdAt = new Date("2026-10-23T12:00:00.000Z");
    const inaccessible = Array.from({ length: 2_000 }, (_, index) => ({
      id: 2_200 - index,
      circleId: 700,
      createdAt,
    }));
    const visible = Array.from({ length: 200 }, (_, index) => ({
      id: 200 - index,
      circleId: null,
      createdAt,
    }));
    const readPage = cursorReadPage([...inaccessible, ...visible]);

    const first = await collectAuthorizedFeedPage(
      readPage,
      async (candidate) => (candidate.circleId === null ? candidate.id : null),
      { limit: 2 },
    );
    expect(first).toEqual({
      items: [200, 199],
      nextCursor: { createdAt, id: 199 },
      hasMore: true,
    });
    expect(first.nextCursor?.id).not.toBe(201);

    const second = await collectAuthorizedFeedPage(
      readPage,
      async (candidate) => (candidate.circleId === null ? candidate.id : null),
      { cursor: first.nextCursor ?? undefined, limit: 2 },
    );
    expect(second.items).toEqual([198, 197]);
    expect(second.nextCursor).toEqual({ createdAt, id: 197 });
    expect(second.hasMore).toBe(true);
  });

  it("SEC27-012 continues after a private candidate loses membership during locked mapping", async () => {
    const createdAt = new Date("2026-10-23T12:00:00.000Z");
    const readPage = cursorReadPage([
      { id: 30, circleId: 7, createdAt },
      { id: 29, circleId: null, createdAt },
      { id: 28, circleId: null, createdAt },
    ]);

    const first = await collectAuthorizedFeedPage(
      readPage,
      async (candidate) => (candidate.id === 30 ? null : candidate.id),
      { limit: 1 },
    );

    // A removal wins the protected mapper for id 30. The visible continuation is instead bound
    // to id 29, so a caller neither learns nor needs the private candidate position.
    expect(first).toEqual({
      items: [29],
      nextCursor: { createdAt, id: 29 },
      hasMore: true,
    });
    await expect(
      collectAuthorizedFeedPage(
        readPage,
        async (candidate) => (candidate.id === 30 ? null : candidate.id),
        { cursor: first.nextCursor ?? undefined, limit: 1 },
      ),
    ).resolves.toEqual({ items: [28], nextCursor: null, hasMore: false });
  });

  it("uses the ID tie-breaker and does not invent a continuation at an exact known end", async () => {
    const createdAt = new Date("2026-10-23T12:00:00.000Z");
    const readPage = cursorReadPage([
      { id: 12, circleId: null, createdAt },
      { id: 11, circleId: null, createdAt },
    ]);

    const page = await collectEligibleFeedPage(readPage, async () => true, {
      limit: 2,
    });

    expect(page).toEqual({ items: [12, 11], nextCursor: null, hasMore: false });
  });

  it("keeps a continuation at a full page boundary when an older candidate remains", async () => {
    const createdAt = new Date("2026-10-23T12:00:00.000Z");
    const readPage = cursorReadPage([
      { id: 12, circleId: null, createdAt },
      { id: 11, circleId: null, createdAt },
      { id: 10, circleId: null, createdAt },
    ]);

    const first = await collectEligibleFeedPage(readPage, async () => true, {
      limit: 2,
    });
    const second = await collectEligibleFeedPage(readPage, async () => true, {
      cursor: first.nextCursor ?? undefined,
      limit: 2,
    });

    expect(first).toEqual({
      items: [12, 11],
      nextCursor: { createdAt, id: 11 },
      hasMore: true,
    });
    expect(second).toEqual({ items: [10], nextCursor: null, hasMore: false });
  });

  it("SEC27-013 takes the parent SHARE lock and denies a private DTO after removal wins", async () => {
    const lockModes: string[] = [];
    const removedMemberTransaction = {
      select: () => ({
        from: (table: unknown) => {
          if (table === circles) {
            return {
              where: () => ({
                limit: () => ({
                  for: (mode: string) => {
                    lockModes.push(mode);
                    return Promise.resolve([{ privacy: "private" }]);
                  },
                }),
              }),
            };
          }
          if (table === memberships) {
            return {
              where: () => ({ limit: async () => [] }),
            };
          }
          throw new Error("Unexpected SEC27 locked-read query");
        },
      }),
    };

    await expect(
      getCircleContentAccessForProtectedRead(
        removedMemberTransaction as never,
        42,
        7,
      ),
    ).resolves.toBeNull();
    expect(lockModes).toEqual(["share"]);
  });
});
