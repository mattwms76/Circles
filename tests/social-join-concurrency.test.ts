import { beforeEach, describe, expect, it, vi } from "vitest";
import { circles, memberships } from "../drizzle/schema";
import { joinCircle, setCircleMembership } from "../server/social-service";

const socialJoinDbMock = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("../server/db", () => ({
  getDb: socialJoinDbMock.getDb,
}));

type SyntheticJoinRole = "member" | "pending" | "owner";
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
  let deleteWrites = 0;

  const rows = <T>(value: T[]) => ({
    for: async () => value,
    then: <Result>(
      resolve: (rows: T[]) => Result | PromiseLike<Result>,
      reject?: (error: unknown) => Result | PromiseLike<Result>,
    ) => Promise.resolve(value).then(resolve, reject),
  });

  let db: object;
  const transaction = async <T>(callback: (tx: object) => Promise<T>) =>
    callback(db);
  db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: () => {
            if (table === circles) {
              return rows([{ id: SYNTHETIC_CIRCLE_ID, privacy }]);
            }
            if (table === memberships) {
              return rows(membershipRole ? [{ role: membershipRole }] : []);
            }
            throw new Error("Unexpected synthetic join query");
          },
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (value: {
        circleId: number;
        userId: number;
        role: SyntheticJoinRole;
      }) => {
        if (table !== memberships)
          throw new Error("Unexpected synthetic join insert");
        if (
          value.circleId !== SYNTHETIC_CIRCLE_ID ||
          value.userId !== SYNTHETIC_USER_ID
        ) {
          throw new Error("Unexpected synthetic join identity");
        }

        return {
          onConflictDoNothing: async (config: {
            target?: unknown | unknown[];
          }) => {
            const target = Array.isArray(config.target)
              ? config.target
              : [config.target];
            if (
              !target.includes(memberships.circleId) ||
              !target.includes(memberships.userId)
            ) {
              throw new Error(
                "Expected the circle/user membership conflict target",
              );
            }
            conflictWrites += 1;
            await Promise.resolve();
            membershipRole ??= value.role;
          },
        };
      },
    }),
    delete: (table: unknown) => ({
      where: async () => {
        if (table !== memberships)
          throw new Error("Unexpected synthetic membership deletion");
        deleteWrites += 1;
        membershipRole = undefined;
      },
    }),
    transaction,
  };

  return {
    db,
    conflictWrites: () => conflictWrites,
    deleteWrites: () => deleteWrites,
    membershipRole: () => membershipRole,
    setMembershipRole: (role: SyntheticJoinRole | undefined) => {
      membershipRole = role;
    },
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

  it("cancels a private pending request idempotently under the same circle lock", async () => {
    const fixture = createSyntheticConcurrentJoinFixture("private");
    socialJoinDbMock.getDb.mockResolvedValue(fixture.db);

    await expect(
      setCircleMembership(SYNTHETIC_USER_ID, SYNTHETIC_CIRCLE_ID, true),
    ).resolves.toEqual({ role: "pending", joined: false });
    await expect(
      setCircleMembership(SYNTHETIC_USER_ID, SYNTHETIC_CIRCLE_ID, false),
    ).resolves.toEqual({ role: null, joined: false });
    await expect(
      setCircleMembership(SYNTHETIC_USER_ID, SYNTHETIC_CIRCLE_ID, false),
    ).resolves.toEqual({ role: null, joined: false });

    expect(fixture.membershipRole()).toBeUndefined();
    expect(fixture.deleteWrites()).toBe(1);
  });

  it("keeps the owner terminal when asked to leave", async () => {
    const fixture = createSyntheticConcurrentJoinFixture("public");
    fixture.setMembershipRole("owner");
    socialJoinDbMock.getDb.mockResolvedValue(fixture.db);

    await expect(
      setCircleMembership(SYNTHETIC_USER_ID, SYNTHETIC_CIRCLE_ID, false),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.membershipRole()).toBe("owner");
  });
});
