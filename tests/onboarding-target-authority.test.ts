import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { TrpcContext } from "../server/_core/context";
import { onboardingRouter } from "../server/onboarding-router";
import { circles, memberships, profiles } from "../drizzle/schema";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), getProfile: vi.fn() }));
vi.mock("../server/db", () => ({ getDb: mocks.getDb }));
vi.mock("../server/social-service", () => ({ getProfile: mocks.getProfile }));

function context(id = 71): TrpcContext {
  const now = new Date("2026-10-23T12:00:00Z");
  return {
    user: {
      id,
      openId: "synthetic",
      name: null,
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

describe("server-authoritative introduction target", () => {
  it("denies guests and malformed targets before any datastore access", async () => {
    mocks.getDb.mockReset();
    const guest = onboardingRouter.createCaller({ ...context(), user: null });
    await expect(
      guest.introductionTarget({ circleId: 7 }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const caller = onboardingRouter.createCaller(context());
    await expect(
      caller.introductionTarget({ circleId: -1 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("binds own account, public target, approved roles and completion in one read-only statement", async () => {
    mocks.getProfile.mockReset();
    const predicates: SQL[] = [];
    const tables: unknown[] = [];
    const limit = vi.fn().mockResolvedValue([{ id: 7 }]);
    const chain = {
      innerJoin(table: unknown, predicate: SQL) {
        tables.push(table);
        predicates.push(predicate);
        return chain;
      },
      where(predicate: SQL) {
        predicates.push(predicate);
        return { limit };
      },
    };
    const select = vi.fn(() => ({
      from(table: unknown) {
        tables.push(table);
        return chain;
      },
    }));
    mocks.getDb.mockResolvedValue({ select });
    const caller = onboardingRouter.createCaller(context());
    await expect(caller.introductionTarget({ circleId: 7 })).resolves.toEqual({
      userId: 71,
      circleId: 7,
      eligible: true,
    });
    expect(tables).toEqual([circles, memberships, profiles]);
    expect(limit).toHaveBeenCalledWith(1);
    const parameters = predicates.flatMap(
      (predicate) => new PgDialect().sqlToQuery(predicate).params,
    );
    expect(parameters).toEqual(
      expect.arrayContaining([
        71,
        "owner",
        "moderator",
        "member",
        "complete",
        7,
        "public",
      ]),
    );
    expect(mocks.getProfile).not.toHaveBeenCalled();
    limit.mockResolvedValueOnce([]);
    await expect(caller.introductionTarget({ circleId: 7 })).resolves.toEqual({
      userId: 71,
      circleId: 7,
      eligible: false,
    });
  });
});
