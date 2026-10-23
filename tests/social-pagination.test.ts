import { describe, expect, it } from "vitest";
import { collectEligibleFeedPage } from "../server/social-service";

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
  it("continues after ten inaccessible equal-timestamp batches instead of reporting a false end", async () => {
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

    const first = await collectEligibleFeedPage(
      readPage,
      async (candidate) => candidate.circleId === null,
      { limit: 20 },
    );
    expect(first).toEqual({
      items: [],
      nextCursor: { createdAt, id: 201 },
      hasMore: true,
    });

    const second = await collectEligibleFeedPage(
      readPage,
      async (candidate) => candidate.circleId === null,
      { cursor: first.nextCursor ?? undefined, limit: 2 },
    );
    expect(second.items).toEqual([200, 199]);
    expect(second.nextCursor).toEqual({ createdAt, id: 199 });
    expect(second.hasMore).toBe(true);
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
});
