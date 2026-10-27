import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  circles,
  comments,
  memberships,
  posts,
  profiles,
  reactions,
  users,
} from "../drizzle/schema";
import {
  escapePostSearchLikePattern,
  feedPage,
} from "../server/social-service";

const dbMocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../server/db", () => ({ getDb: dbMocks.getDb }));

const matchedAt = new Date("2026-10-24T10:00:00.000Z");

type SyntheticPost = {
  id: number;
  authorId: number;
  circleId: number | null;
  text: string;
  media: string | null;
  mediaType: "text";
  createdAt: Date;
};

function conditionIncludesPostId(
  value: unknown,
  id: number,
  seen = new Set<unknown>(),
): boolean {
  if (value === id) return true;
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value as Record<string, unknown>).some((child) =>
    conditionIncludesPostId(child, id, seen),
  );
}

function thenableRows<T>(rows: T[]) {
  return {
    for: async () => rows,
    limit: () => thenableRows(rows),
    orderBy: () => thenableRows(rows),
    then: <Output>(
      resolve: (value: T[]) => Output | PromiseLike<Output>,
      reject?: (reason: unknown) => Output | PromiseLike<Output>,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
}

/**
 * Models the database result after its SQL post-text predicate has run. The fixture purposely
 * returns 21 matching rows so page two proves discovery is not filtering only page one locally.
 */
function searchableFeedFixture() {
  const matchingPosts: SyntheticPost[] = Array.from(
    { length: 21 },
    (_, index) => ({
      id: 121 - index,
      authorId: 7,
      circleId: null,
      text: `needle result ${index + 1}`,
      media: null,
      mediaType: "text",
      createdAt: new Date(matchedAt.getTime() - index),
    }),
  );
  let candidateReadCount = 0;
  const postOutputReads: SyntheticPost[] = [];

  const db = {
    select: () => ({
      from: (table: unknown) => {
        if (table === posts) {
          return {
            where: (condition: unknown) => {
              return {
                orderBy: () => ({
                  limit: async () => {
                    candidateReadCount += 1;
                    return candidateReadCount === 1
                      ? matchingPosts
                      : [matchingPosts[matchingPosts.length - 1]];
                  },
                }),
                limit: async () => {
                  const post = postOutputReads.find((candidate) =>
                    conditionIncludesPostId(condition, candidate.id),
                  );
                  return post ? [post] : [];
                },
              };
            },
          };
        }
        if (table === profiles) {
          return { where: () => ({ limit: () => thenableRows([]) }) };
        }
        if (table === users) {
          return {
            where: () => ({
              limit: () => thenableRows([{ name: "Search author" }]),
            }),
          };
        }
        if (table === reactions || table === comments) {
          return { where: () => thenableRows([{ total: 0 }]) };
        }
        throw new Error("Unexpected synthetic search query");
      },
    }),
  };

  return {
    db: {
      ...db,
      transaction: vi.fn(async (work: (tx: typeof db) => Promise<unknown>) =>
        work(db),
      ),
    },
    beginPageOutput(page: SyntheticPost[]) {
      postOutputReads.push(...page);
    },
    matchingPosts,
  };
}

/** A matching private candidate must be rejected by the normal eligibility check before DTO work. */
function privateCandidateFixture() {
  const privatePost: SyntheticPost = {
    id: 44,
    authorId: 8,
    circleId: 9,
    text: "needle in a private circle",
    media: null,
    mediaType: "text",
    createdAt: matchedAt,
  };

  return {
    select: () => ({
      from: (table: unknown) => {
        if (table === posts) {
          return {
            where: () => ({
              orderBy: () => ({ limit: async () => [privatePost] }),
              limit: () => thenableRows([privatePost]),
            }),
          };
        }
        if (table === circles) {
          return {
            where: () => ({
              limit: () => thenableRows([{ id: 9, privacy: "private" }]),
            }),
          };
        }
        if (table === memberships) {
          return {
            where: () => ({ limit: () => thenableRows([]) }),
          };
        }
        throw new Error("Unexpected synthetic private-search query");
      },
    }),
  };
}

afterEach(() => dbMocks.getDb.mockReset());

describe("admin parity post search", () => {
  it("escapes literal LIKE wildcard input and applies the predicate before paged eligibility scanning", () => {
    expect(escapePostSearchLikePattern("100%_\\literal")).toBe(
      "100\\%\\_\\\\literal",
    );

    const source = readFileSync("server/social-service.ts", "utf8");
    const pagedFeed = source.slice(
      source.indexOf("export async function feedPage"),
      source.indexOf("async function assertMediaOwnership"),
    );
    expect(
      pagedFeed.indexOf("escapePostSearchLikePattern(search)"),
    ).toBeGreaterThan(-1);
    expect(
      pagedFeed.indexOf("escapePostSearchLikePattern(search)"),
    ).toBeLessThan(pagedFeed.indexOf("collectEligibleFeedPage"));
  });

  it("returns server-matched posts beyond the first discover page with a stable compound cursor", async () => {
    const fixture = searchableFeedFixture();
    dbMocks.getDb.mockResolvedValue(fixture.db);

    fixture.beginPageOutput(fixture.matchingPosts.slice(0, 20));
    const first = await feedPage(null, "for-you", undefined, undefined, {
      search: "  needle  ",
      limit: 20,
    });

    expect(fixture.db.transaction).toHaveBeenCalledTimes(20);
    expect(first.items.map((post) => post.id)).toEqual(
      fixture.matchingPosts.slice(0, 20).map((post) => post.id),
    );
    expect(first.nextCursor).toEqual({
      createdAt: fixture.matchingPosts[19].createdAt,
      id: fixture.matchingPosts[19].id,
    });
    expect(first.hasMore).toBe(true);

    fixture.beginPageOutput([fixture.matchingPosts[20]]);
    const second = await feedPage(null, "for-you", undefined, undefined, {
      search: "needle",
      cursor: first.nextCursor ?? undefined,
      limit: 20,
    });

    expect(second.items.map((post) => post.id)).toEqual([
      fixture.matchingPosts[20].id,
    ]);
    expect(second).toMatchObject({ nextCursor: null, hasMore: false });
  });

  it("does not expose a matching private-circle post to a non-member", async () => {
    dbMocks.getDb.mockResolvedValue(privateCandidateFixture());

    await expect(
      feedPage(null, "for-you", undefined, undefined, {
        search: "needle",
        limit: 20,
      }),
    ).resolves.toEqual({ items: [], nextCursor: null, hasMore: false });
  });

  it("uses search as the Discover feed query input rather than filtering already-loaded cards", () => {
    const discover = readFileSync("app/(tabs)/discover.tsx", "utf8");
    expect(discover).toContain(
      '{ filter: "for-you", search, limit: UI_COLLECTION_PAGE_SIZE }',
    );
    expect(discover).not.toContain("const posts = feedItems.filter");
    expect(discover).toContain("feedItems.map((post)");
  });
});
