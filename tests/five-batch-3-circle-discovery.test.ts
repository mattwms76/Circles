import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { circles, memberships } from "../drizzle/schema";
import { circlesPageInput } from "../server/social-router";
import { listCirclesPage } from "../server/social-service";
import {
  batch3AccountResourceScope,
  isCurrentBatch3AccountResourceScope,
} from "../lib/batch3-account-resource-scope";

const dbMock = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock("../server/db", () => ({ getDb: dbMock.getDb }));

const circlesScreen = readFileSync("app/(tabs)/circles.tsx", "utf8");
const discoverScreen = readFileSync("app/(tabs)/discover.tsx", "utf8");
const circleScreen = readFileSync("app/circle/[id].tsx", "utf8");
const circleCard = readFileSync("components/circle-card.tsx", "utf8");

type SyntheticCircle = {
  id: number;
  name: string;
  description: string;
  category: string;
  image: string;
  color: string;
  ownerId: number;
  privacy: "public" | "private";
  createdAt: Date;
};

function rows<T>(value: T[]) {
  return {
    limit: () => rows(value),
    then: <Output>(
      resolve: (result: T[]) => Output | PromiseLike<Output>,
      reject?: (reason: unknown) => Output | PromiseLike<Output>,
    ) => Promise.resolve(value).then(resolve, reject),
  };
}

function createJoinedCirclesFixture() {
  const createdAt = new Date("2026-10-26T08:00:00.000Z");
  const first: SyntheticCircle = {
    id: 71,
    name: "Joined private circle",
    description: "A private circle the authenticated viewer can join.",
    category: "Outdoors",
    image: "",
    color: "#506744",
    ownerId: 8,
    privacy: "private",
    createdAt,
  };
  const second: SyntheticCircle = {
    ...first,
    id: 70,
    name: "Older joined circle",
  };
  let membershipPredicate: SQL | undefined;
  let pageLimit = 0;

  const membershipResult = {
    limit: () => rows([{ role: "member" }]),
    then: <Output>(
      resolve: (result: { circleId: number }[]) => Output | PromiseLike<Output>,
      reject?: (reason: unknown) => Output | PromiseLike<Output>,
    ) => {
      return Promise.resolve([{ circleId: first.id }]).then(resolve, reject);
    },
  };

  const db = {
    select: () => ({
      from: (table: unknown) => {
        if (table === memberships) {
          return { where: () => membershipResult };
        }
        if (table === circles) {
          return {
            where: (predicate?: SQL) => {
              membershipPredicate ??= predicate;
              return {
                orderBy: () => ({
                  limit: (value: number) => {
                    pageLimit = value;
                    return rows([first, second].slice(0, value));
                  },
                }),
                limit: () => rows([first]),
              };
            },
          };
        }
        throw new Error("Unexpected synthetic directory query");
      },
    }),
  };

  return {
    db,
    createdAt,
    pageLimit: () => pageLimit,
    predicate: () => membershipPredicate,
  };
}

describe("Batch 3 Circle and Discover integrity", () => {
  beforeEach(() => dbMock.getDb.mockReset());

  it("keeps the existing circles page input compatible while bounding search, limit, and optional joined filtering", () => {
    const legacy = circlesPageInput.parse({
      search: "outdoors",
      category: "Outdoors",
      limit: 20,
    });

    expect(legacy.joinedOnly).toBeUndefined();
    expect(
      circlesPageInput.safeParse({
        search: "x".repeat(121),
        limit: 20,
      }).success,
    ).toBe(false);
    expect(
      circlesPageInput.safeParse({ joinedOnly: true, limit: 20 }).success,
    ).toBe(true);
    expect(
      circlesPageInput.parse({
        joinedOnly: true,
        cursor: { createdAt: "2026-10-26T08:00:00.000Z", id: 71 },
        limit: 20,
      }),
    ).toMatchObject({
      joinedOnly: true,
      cursor: { createdAt: "2026-10-26T08:00:00.000Z", id: 71 },
    });
    expect(circlesPageInput.safeParse({ limit: 51 }).success).toBe(false);
  });

  it("returns no joined-circle page to a guest without opening a database read", async () => {
    await expect(
      listCirclesPage(null, { joinedOnly: true, limit: 20 }),
    ).resolves.toEqual({ items: [], nextCursor: null, hasMore: false });

    expect(dbMock.getDb).not.toHaveBeenCalled();
  });

  it("applies approved membership before a joined-circle page and preserves a limit-plus-one keyset continuation", async () => {
    const fixture = createJoinedCirclesFixture();
    dbMock.getDb.mockResolvedValue(fixture.db);

    await expect(
      listCirclesPage(12, { joinedOnly: true, limit: 1 }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: 71,
          joined: true,
          privacy: "private",
          role: "member",
        }),
      ],
      nextCursor: { createdAt: fixture.createdAt, id: 71 },
      hasMore: true,
    });

    expect(fixture.pageLimit()).toBe(2);
    const predicate = fixture.predicate();
    expect(predicate).toBeTruthy();
    const compiled = new PgDialect().sqlToQuery(predicate!);
    expect(compiled.sql).toContain("exists (");
    expect(compiled.sql).toContain('"circles_app"."memberships"');
    expect(compiled.sql).toContain('"circleId" =');
    expect(compiled.sql).toContain('"userId" =');
    expect(compiled.sql).toContain("in ('owner', 'moderator', 'member')");
    expect(compiled.params).toContain(12);
  });

  it("rejects stale account, resource, and unmounted completion scopes", () => {
    const scope = batch3AccountResourceScope(12, "circle:71");

    expect(scope).toBe("12:circle:71");
    expect(batch3AccountResourceScope(null, "discover")).toBeNull();
    expect(isCurrentBatch3AccountResourceScope(scope, scope, scope)).toBe(true);
    expect(
      isCurrentBatch3AccountResourceScope(scope, "13:circle:71", scope),
    ).toBe(false);
    expect(isCurrentBatch3AccountResourceScope(scope, scope, null)).toBe(false);
  });

  it("keeps the owned search, control, and responsive layout protections in source", () => {
    expect(circlesScreen).toContain("joinedOnly,");
    expect(circlesScreen).not.toContain("circleItems.filter");
    expect(circlesScreen).toContain("maxLength={120}");
    expect(circlesScreen).toContain("minHeight: 174");
    expect(circlesScreen).toContain(
      'accessibilityLabel="Explore outdoor circles"',
    );

    expect(discoverScreen).toContain("maxLength={80}");
    expect(discoverScreen).toContain("following: !currentlyFollowing");
    expect(discoverScreen).toContain("isFetchingNextPage");
    expect(discoverScreen).toContain("isCurrentDiscoverScope(capturedScope)");
    expect(discoverScreen).toContain('accessibilityRole="alert"');

    expect(circleCard).toContain("isCurrentCircleScope(capturedScope)");
    expect(circleCard).toContain("accessibilityLabel={`Open ${circle.name}`}");
    expect(circleCard).toContain('maxWidth: "78%"');
    expect(circleCard).toContain("minHeight: 44");

    expect(circleScreen).toContain("isCurrentCircleActionScope(capturedScope)");
    expect(circleScreen).toContain('flexWrap: "wrap"');
    expect(circleScreen).toContain('maxWidth: "80%"');
    expect(circleScreen).toContain('accessibilityLabel="Back to your people"');
  });
});

describe("Circle cursor microsecond compatibility", () => {
  it("round-trips exact precision while rejecting mismatch, malformed precision and invalid date injection", () => {
    const cursor = {
      id: 71,
      createdAt: "2026-10-26T08:00:00.123Z",
      createdAtExact: "2026-10-26T08:00:00.123456Z",
    };
    expect(circlesPageInput.parse({ cursor }).cursor).toEqual(cursor);
    for (const exact of [
      "2026-10-26T08:00:00.124456Z",
      "2026-10-26T08:00:00.123Z",
      "now()",
      "2026-10-26T08:00:00.123456Z'; select 1",
    ]) {
      expect(
        circlesPageInput.safeParse({
          cursor: { ...cursor, createdAtExact: exact },
        }).success,
      ).toBe(false);
    }
    expect(
      circlesPageInput.parse({
        cursor: { id: 71, createdAt: cursor.createdAt },
      }).cursor,
    ).toEqual({ id: 71, createdAt: cursor.createdAt });
  });
});
