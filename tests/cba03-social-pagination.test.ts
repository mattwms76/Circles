import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { commentsPageInput } from "../server/social-router";
import {
  mapBoundedDateIdPage,
  SOCIAL_LEGACY_LIST_MAX_LIMIT,
} from "../server/social-service";

const serviceSource = readFileSync("server/social-service.ts", "utf8");
const routerSource = readFileSync("server/social-router.ts", "utf8");

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`CBA-03 source section is unavailable: ${start}`);
  }
  return source.slice(startIndex, endIndex);
}

describe("CBA-03 bounded member and comment pagination", () => {
  it("maps only an admitted page, preserves the exact timestamp cursor, and retains a continuation", async () => {
    const sharedTime = new Date("2026-10-29T12:34:56.123Z");
    const rows = Array.from(
      { length: SOCIAL_LEGACY_LIST_MAX_LIMIT + 1 },
      (_, index) => ({
        id: index + 1,
        createdAt: sharedTime,
        preciseCreatedAt: "2026-10-29T12:34:56.123456Z",
      }),
    );
    let projected = 0;

    const page = await mapBoundedDateIdPage(
      rows,
      SOCIAL_LEGACY_LIST_MAX_LIMIT,
      async (row) => {
        projected += 1;
        return row.id;
      },
    );

    expect(page.items).toHaveLength(SOCIAL_LEGACY_LIST_MAX_LIMIT);
    expect(projected).toBe(SOCIAL_LEGACY_LIST_MAX_LIMIT);
    expect(page.items.at(-1)).toBe(SOCIAL_LEGACY_LIST_MAX_LIMIT);
    expect(page).toMatchObject({
      hasMore: true,
      nextCursor: {
        id: SOCIAL_LEGACY_LIST_MAX_LIMIT,
        createdAt: sharedTime,
        createdAtExact: "2026-10-29T12:34:56.123456Z",
      },
    });
  });

  it("accepts only bounded, precise commentsPage inputs", () => {
    expect(
      commentsPageInput.safeParse({
        postId: 41,
        limit: SOCIAL_LEGACY_LIST_MAX_LIMIT,
        cursor: {
          id: 50,
          createdAt: "2026-10-29T12:34:56.123Z",
          createdAtExact: "2026-10-29T12:34:56.123456Z",
        },
      }).success,
    ).toBe(true);
    expect(
      commentsPageInput.safeParse({
        postId: 41,
        limit: SOCIAL_LEGACY_LIST_MAX_LIMIT + 1,
      }).success,
    ).toBe(false);
    expect(
      commentsPageInput.safeParse({
        postId: 41,
        cursor: {
          id: 50,
          createdAt: "2026-10-29T12:34:56.123Z",
          createdAtExact: "2026-10-29T12:34:56.124456Z",
        },
      }).success,
    ).toBe(false);
  });

  it("uses a capped compatibility prefix and limit-plus-one keyset readers before profile projection", () => {
    const members = section(
      serviceSource,
      "export async function listMembers(",
      "export async function listMembersPage(",
    );
    const membersPage = section(
      serviceSource,
      "export async function listMembersPage(",
      "async function getActorAndTargetRoles(",
    );
    const comments = section(
      serviceSource,
      "export async function listComments(",
      "export async function listCommentsPage(",
    );
    const commentsPage = section(
      serviceSource,
      "export async function listCommentsPage(",
      "export async function createComment(",
    );

    expect(members).toContain("listMembersPage(userId, circleId");
    expect(comments).toContain("listCommentsPage(userId, postId");
    expect(members).toContain("SOCIAL_LEGACY_LIST_MAX_LIMIT");
    expect(comments).toContain("SOCIAL_LEGACY_LIST_MAX_LIMIT");
    expect(membersPage).toContain(".limit(limit + 1)");
    expect(commentsPage).toContain(".limit(limit + 1)");
    expect(membersPage).toContain("mapBoundedDateIdPage(rows, limit");
    expect(commentsPage).toContain("mapBoundedDateIdPage(rows, limit");
    expect(commentsPage).toContain("gt(comments.createdAt, cursorCreatedAt)");
    expect(commentsPage).toContain("gt(comments.id, options.cursor.id)");
    expect(commentsPage).toContain("assertPostAccessForProtectedRead");
    expect(routerSource).toContain("commentsPage: publicProcedure");
  });
});
