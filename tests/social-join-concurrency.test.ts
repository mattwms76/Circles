import { beforeEach, describe, expect, it, vi } from "vitest";
import { circles, memberships } from "../drizzle/schema";
import { joinCircle } from "../server/social-service";

const socialJoinDbMock = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("../server/db", () => ({
  getDb: socialJoinDbMock.getDb,
}));

type SyntheticJoinRole = "member" | "pending";
type SyntheticCirclePrivacy = "public" | "private";

const SYNTHETIC_CIRCLE_ID = 41;
const SYNTHETIC_USER_ID = 99;

/**
 * A deliberately small in-memory Drizzle-shaped fixture. Its conflict-target method yields once
 * so both join calls reach the write before one insert wins and the other is retained.
 */
function createSyntheticConcurrentJoinFixture(privacy: SyntheticCirclePrivacy) {
  let membershipRole: SyntheticJoinRole | undefined;
  let conflictWrites = 0;

  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (table === circles) {
              return [{ id: SYNTHETIC_CIRCLE_ID, privacy }];
            }
            if (table === memberships) {
              return membershipRole ? [{ role: membershipRole }] : [];
            }
            throw new Error("Unexpected synthetic join query");
          },
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (value: { circleId: number; userId: number; role: SyntheticJoinRole }) => {
        if (table !== memberships) throw new Error("Unexpected synthetic join insert");
        if (value.circleId !== SYNTHETIC_CIRCLE_ID || value.userId !== SYNTHETIC_USER_ID) {
          throw new Error("Unexpected synthetic join identity");
        }

        return {
          onConflictDoNothing: async (config: { target?: unknown | unknown[] }) => {
            const target = Array.isArray(config.target)
              ? config.target
              : [config.target];
            if (
              !target.includes(memberships.circleId) ||
              !target.includes(memberships.userId)
            ) {
              throw new Error("Expected the circle/user membership conflict target");
            }
            conflictWrites += 1;
            await Promise.resolve();
            membershipRole ??= value.role;
          },
        };
      },
    }),
  };

  return {
    db,
    conflictWrites: () => conflictWrites,
    membershipRole: () => membershipRole,
  };
}

describe("SOC-003 idempotent circle joins", () => {
  beforeEach(() => {
    socialJoinDbMock.getDb.mockReset();
  });

  it("returns one public member role when two synthetic public joins overlap", async () => {
    const fixture = createSyntheticConcurrentJoinFixture("public");
    socialJoinDbMock.getDb.mockResolvedValue(fixture.db);

    const joined = await Promise.all([
      joinCircle(SYNTHETIC_USER_ID, SYNTHETIC_CIRCLE_ID),
      joinCircle(SYNTHETIC_USER_ID, SYNTHETIC_CIRCLE_ID),
    ]);

    expect(joined).toEqual([{ role: "member" }, { role: "member" }]);
    expect(fixture.membershipRole()).toBe("member");
    expect(fixture.conflictWrites()).toBe(2);
  });

  it("returns one pending role when two synthetic private joins overlap", async () => {
    const fixture = createSyntheticConcurrentJoinFixture("private");
    socialJoinDbMock.getDb.mockResolvedValue(fixture.db);

    const joined = await Promise.all([
      joinCircle(SYNTHETIC_USER_ID, SYNTHETIC_CIRCLE_ID),
      joinCircle(SYNTHETIC_USER_ID, SYNTHETIC_CIRCLE_ID),
    ]);

    expect(joined).toEqual([{ role: "pending" }, { role: "pending" }]);
    expect(fixture.membershipRole()).toBe("pending");
    expect(fixture.conflictWrites()).toBe(2);
  });
});
