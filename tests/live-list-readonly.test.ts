import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../server/_core/context";
import { liveViewers, streams } from "../drizzle/live-schema";
import { liveRouter } from "../server/live-router";

const liv005ListMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  canAccessCircle: vi.fn(),
  getDisplayProfile: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock("../server/db", () => ({
  getDb: liv005ListMocks.getDb,
}));

vi.mock("../server/social-service", () => ({
  canAccessCircle: liv005ListMocks.canAccessCircle,
  getDisplayProfile: liv005ListMocks.getDisplayProfile,
  getProfile: liv005ListMocks.getProfile,
}));

function liv005ReadonlyListDb(streamRows: unknown[]) {
  const streamLimit = vi.fn().mockResolvedValue(streamRows);
  const insert = vi.fn();
  const update = vi.fn();
  const remove = vi.fn();

  return {
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
  };
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
    liv005ListMocks.getDisplayProfile.mockResolvedValue({
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
    expect(liv005ListMocks.getDisplayProfile).toHaveBeenCalledWith(73);
    expect(liv005ListMocks.getProfile).not.toHaveBeenCalled();
    expect(database.insert).not.toHaveBeenCalled();
    expect(database.update).not.toHaveBeenCalled();
    expect(database.delete).not.toHaveBeenCalled();
  });
});
