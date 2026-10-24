import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liveRouter } from "../server/live-router";

const mocks = vi.hoisted(() => ({
  assertPlatformFeature: vi.fn(),
  canAccessCircle: vi.fn(),
  getDb: vi.fn(),
  getDisplayProfile: vi.fn(),
  getProfile: vi.fn(),
  loadTurnConfiguration: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../server/db", () => ({ getDb: mocks.getDb }));
vi.mock("../server/platform-settings", () => ({
  assertPlatformFeature: mocks.assertPlatformFeature,
}));
vi.mock("../server/social-service", () => ({
  canAccessCircle: mocks.canAccessCircle,
  getDisplayProfile: mocks.getDisplayProfile,
  getProfile: mocks.getProfile,
}));
vi.mock("../server/turn-config", () => ({
  createTurnIceConfiguration: () => null,
  loadTurnConfiguration: mocks.loadTurnConfiguration,
  TurnConfigurationError: class TurnConfigurationError extends Error {},
}));

function caller() {
  return liveRouter.createCaller({
    user: { id: 17 },
    req: {},
    res: {},
  } as never);
}

beforeEach(() => {
  mocks.assertPlatformFeature.mockReset();
  mocks.getDb.mockReset();
  mocks.loadTurnConfiguration.mockReset();
  mocks.transaction.mockReset();
  mocks.loadTurnConfiguration.mockReturnValue(null);
});

afterEach(() => vi.clearAllMocks());

describe("platform live admission", () => {
  it("blocks create before TURN configuration or any lifecycle write when the outer feature check fails", async () => {
    const db = { transaction: mocks.transaction };
    mocks.getDb.mockResolvedValue(db);
    mocks.assertPlatformFeature.mockRejectedValue(
      new TRPCError({ code: "FORBIDDEN", message: "Feature is disabled." }),
    );

    await expect(
      caller().create({ title: "Blocked live" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    expect(mocks.assertPlatformFeature).toHaveBeenCalledWith(
      db,
      "liveStreamingEnabled",
    );
    expect(mocks.loadTurnConfiguration).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rechecks inside the lifecycle transaction before host lease or stream locks", async () => {
    const tx = {};
    const db = {
      transaction: mocks.transaction.mockImplementation(async (work) =>
        work(tx),
      ),
    };
    mocks.getDb.mockResolvedValue(db);
    mocks.assertPlatformFeature
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new TRPCError({ code: "FORBIDDEN", message: "Feature is disabled." }),
      );

    await expect(
      caller().create({ title: "Rechecked live" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    expect(mocks.loadTurnConfiguration).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.assertPlatformFeature).toHaveBeenNthCalledWith(
      1,
      db,
      "liveStreamingEnabled",
    );
    expect(mocks.assertPlatformFeature).toHaveBeenNthCalledWith(
      2,
      tx,
      "liveStreamingEnabled",
    );
  });
});
