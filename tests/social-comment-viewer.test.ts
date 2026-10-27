import { afterEach, describe, expect, it, vi } from "vitest";
import { comments, follows, posts, profiles } from "../drizzle/schema";

import { listComments } from "../server/social-service";

const commentViewerDbMock = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../server/db", () => ({ getDb: commentViewerDbMock.getDb }));

afterEach(() => commentViewerDbMock.getDb.mockReset());

function conditionContains(
  value: unknown,
  expected: number,
  seen = new Set<unknown>(),
): boolean {
  if (value === expected) return true;
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value as Record<string, unknown>).some((entry) =>
    conditionContains(entry, expected, seen),
  );
}

function createCommentViewerDb() {
  const result = <T>(rows: T[]) => ({
    limit: async () => rows,
    orderBy: async () => rows,
    then: <Output>(
      resolve: (value: T[]) => Output | PromiseLike<Output>,
      reject?: (reason: unknown) => Output | PromiseLike<Output>,
    ) => Promise.resolve(rows).then(resolve, reject),
  });

  const db = {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: (condition: unknown) => {
          if (table === posts) {
            return result([{ id: 10, circleId: null }]);
          }
          if (table === comments) {
            return result([
              {
                id: 20,
                authorId: 2,
                text: "A viewer-aware comment",
                createdAt: new Date("2026-10-23T12:00:00.000Z"),
              },
            ]);
          }
          if (table === profiles) {
            return result([
              {
                userId: 2,
                name: "Comment author",
                handle: "author",
                bio: "",
                avatar: "",
                cover: null,
              },
            ]);
          }
          if (table === follows && fields && "id" in fields) {
            // The correct query includes requesting viewer 1, not comment author 2.
            return result(conditionContains(condition, 1) ? [{ id: 1 }] : []);
          }
          if (table === follows) return result([{ total: 0 }]);
          throw new Error("Unexpected comment viewer query");
        },
      }),
    }),
  };
  return {
    ...db,
    transaction: vi.fn(async (work: (tx: typeof db) => Promise<unknown>) =>
      work(db),
    ),
  };
}

describe("INT-003 comment profile viewer context", () => {
  it("returns isFollowing for viewer A following comment author B", async () => {
    commentViewerDbMock.getDb.mockResolvedValue(createCommentViewerDb());

    const result = await listComments(1, 10);

    expect(result).toMatchObject([
      {
        id: 20,
        author: { id: 2, isFollowing: true },
      },
    ]);
  });
});
