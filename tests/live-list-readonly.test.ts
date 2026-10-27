import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../server/_core/context";
import { liveViewers, streams } from "../drizzle/live-schema";
import { liveRouter } from "../server/live-router";

const liv005ListMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getCircleContentAccessForProtectedRead: vi.fn(),
  getDisplayProfileWithDb: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock("../server/db", () => ({
  getDb: liv005ListMocks.getDb,
}));

vi.mock("../server/social-service", () => ({
  getCircleContentAccessForProtectedRead:
    liv005ListMocks.getCircleContentAccessForProtectedRead,
  getDisplayProfileWithDb: liv005ListMocks.getDisplayProfileWithDb,
  getProfile: liv005ListMocks.getProfile,
}));

beforeEach(() => {
  liv005ListMocks.getDb.mockReset();
  liv005ListMocks.getCircleContentAccessForProtectedRead.mockReset();
  liv005ListMocks.getDisplayProfileWithDb.mockReset();
  liv005ListMocks.getProfile.mockReset();
});

function liv005ReadonlyListDb(streamRows: unknown[]) {
  const streamLimit = vi.fn().mockResolvedValue(streamRows);
  const insert = vi.fn();
  const update = vi.fn();
  const remove = vi.fn();

  const database = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        if (table === streams) {
          return {
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({ limit: streamLimit })),
            })),
          };
        }
        if (table === liveViewers) {
          return { where: vi.fn().mockResolvedValue([{ total: 0 }]) };
        }
        throw new Error("Unexpected LIV-005 list table query");
      }),
    })),
    insert,
    update,
    delete: remove,
    transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) =>
      work(database),
    ),
  };
  return database;
}

describe("LIV-005 public live discovery", () => {
  it("formats a public stream through the read-only display helper without writing", async () => {
    const now = new Date();
    const database = liv005ReadonlyListDb([
      {
        id: 91,
        hostId: 73,
        title: "Public studio",
        circleId: null,
        thumbnail: "",
        status: "live",
        readyAt: now,
        lastHeartbeatAt: now,
        createdAt: now,
        endedAt: null,
      },
    ]);
    liv005ListMocks.getDb.mockResolvedValue(database);
    liv005ListMocks.getDisplayProfileWithDb.mockResolvedValue({
      id: 73,
      name: "Host without a profile row",
      handle: "member-73",
      bio: "",
      avatar: "",
      followers: 0,
      following: 0,
    });
    liv005ListMocks.getProfile.mockImplementation(() => {
      throw new Error("live.list must not materialize profiles");
    });

    const caller = liveRouter.createCaller({
      user: null,
      req: {} as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    });

    await expect(caller.list()).resolves.toMatchObject([
      { id: 91, host: { id: 73, handle: "member-73" }, viewers: 0 },
    ]);
    expect(liv005ListMocks.getDisplayProfileWithDb).toHaveBeenCalledWith(
      database,
      73,
    );
    expect(liv005ListMocks.getProfile).not.toHaveBeenCalled();
    expect(database.insert).not.toHaveBeenCalled();
    expect(database.update).not.toHaveBeenCalled();
    expect(database.delete).not.toHaveBeenCalled();
  });

  it("SEC27-013 omits a private live card when removal wins before protected DTO mapping", async () => {
    const now = new Date();
    const database = liv005ReadonlyListDb([
      {
        id: 92,
        hostId: 74,
        title: "Private studio",
        circleId: 55,
        thumbnail: "",
        status: "live",
        readyAt: now,
        lastHeartbeatAt: now,
        createdAt: now,
        endedAt: null,
      },
    ]);
    liv005ListMocks.getDb.mockResolvedValue(database);
    // This is the parent-SHARE-lock recheck result after removeMember held and committed its
    // compatible parent UPDATE lock. No private stream fields may reach the mapper afterward.
    liv005ListMocks.getCircleContentAccessForProtectedRead.mockResolvedValue(
      null,
    );

    const caller = liveRouter.createCaller({
      user: { id: 42 } as TrpcContext["user"],
      req: {} as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    });

    await expect(caller.list()).resolves.toEqual([]);
    expect(
      liv005ListMocks.getCircleContentAccessForProtectedRead,
    ).toHaveBeenCalledWith(database, 42, 55);
    expect(liv005ListMocks.getDisplayProfileWithDb).not.toHaveBeenCalled();
    expect(liv005ListMocks.getProfile).not.toHaveBeenCalled();
  });
});
