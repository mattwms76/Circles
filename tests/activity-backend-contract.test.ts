import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../server/_core/context";
import { activityRouter } from "../server/activity-router";
import { activityInternals } from "../server/activity-service";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getActivityPostTarget: vi.fn(),
}));
vi.mock("../server/db", () => ({ getDb: mocks.getDb }));
vi.mock("../server/social-service", () => ({
  getActivityPostTarget: mocks.getActivityPostTarget,
}));

function context(id = 71): TrpcContext {
  const now = new Date("2026-10-23T12:00:00.000Z");
  return {
    user: {
      id,
      openId: "synthetic-activity-user",
      name: "Synthetic",
      email: null,
      loginMethod: null,
      role: "user",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("activity backend authority and bounds", () => {
  it("rejects stale account scope before any database access", async () => {
    mocks.getDb.mockReset();
    const caller = activityRouter.createCaller(context(71));
    await expect(caller.unreadCount({ viewerScope: 72 })).rejects.toMatchObject(
      {
        code: "CONFLICT",
      },
    );
    await expect(
      caller.list({ viewerScope: 72, limit: 20 }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("uses the protected context rather than a caller ID and rejects malformed extra fields", async () => {
    mocks.getDb.mockReset();
    const caller = activityRouter.createCaller(context(71));
    await expect(
      caller.markRead({ id: 9, viewerScope: 71, recipientId: 72 } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.updateCategories({ viewerScope: 71 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.markAllRead({ viewerScope: 71 } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("retains descending-ID keyset and 40-item hard bounds in the direct service guard", () => {
    expect(activityInternals.normalizeList({})).toEqual({ limit: 20 });
    expect(
      activityInternals.normalizeList({ limit: 40, cursor: { beforeId: 99 } }),
    ).toEqual({
      limit: 40,
      beforeId: 99,
    });
    expect(() => activityInternals.normalizeList({ limit: 41 })).toThrow(
      /page size/i,
    );
    expect(() =>
      activityInternals.normalizeList({ cursor: { beforeId: 0 } }),
    ).toThrow(/cursor/i);
  });
});
