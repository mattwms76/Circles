import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liveViewers, streams } from "../drizzle/live-schema";
import { memberships } from "../drizzle/schema";
import { HOST_LEASE_MS, liveRouter } from "../server/live-router";

const avatarMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  canAccessCircle: vi.fn(),
  getDisplayProfile: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock("../server/db", () => ({ getDb: avatarMocks.getDb }));
vi.mock("../server/social-service", () => ({
  canAccessCircle: avatarMocks.canAccessCircle,
  getDisplayProfile: avatarMocks.getDisplayProfile,
  getProfile: avatarMocks.getProfile,
}));

type SyntheticStream = {
  id: number;
  hostId: number;
  title: string;
  circleId: number | null;
  thumbnail: string;
  status: "live" | "ended";
  readyAt: Date | null;
  lastHeartbeatAt: Date;
  hostGeneration: number;
  createdAt: Date;
  endedAt: Date | null;
};

const now = new Date("2026-10-26T12:00:00.000Z");

function stream(overrides: Partial<SyntheticStream> = {}): SyntheticStream {
  return {
    id: 91,
    hostId: 40,
    title: "Studio morning",
    circleId: null,
    thumbnail: "",
    status: "live",
    readyAt: new Date(now),
    lastHeartbeatAt: new Date(now),
    hostGeneration: 1,
    createdAt: new Date(now.getTime() - 1_000),
    endedAt: null,
    ...overrides,
  };
}

function caller(userId: number | null) {
  return liveRouter.createCaller({
    user: userId === null ? null : { id: userId },
    req: {},
    res: {},
  } as never);
}

function listFixture(input: {
  streamRows: SyntheticStream[];
  hostRoles?: ("owner" | "moderator" | "member" | "pending" | null)[];
}) {
  let listPredicate: SQL | undefined;
  let listLimit: number | undefined;
  let hostMembershipReads = 0;
  const select = vi.fn(() => ({
    from: (table: unknown) => {
      if (table === streams) {
        return {
          where: (predicate: SQL) => {
            listPredicate = predicate;
            return {
              orderBy: () => ({
                limit: (value: number) => {
                  listLimit = value;
                  return Promise.resolve(input.streamRows);
                },
              }),
            };
          },
        };
      }
      if (table === liveViewers) {
        return { where: () => Promise.resolve([{ total: 0 }]) };
      }
      if (table === memberships) {
        return {
          where: () => ({
            limit: () => {
              const role = input.hostRoles?.[hostMembershipReads++] ?? null;
              return Promise.resolve(role ? [{ role }] : []);
            },
          }),
        };
      }
      throw new Error("Unexpected live avatar source query");
    },
  }));

  return {
    db: { select },
    hostMembershipReads: () => hostMembershipReads,
    listLimit: () => listLimit,
    listPredicate: () => listPredicate,
  };
}

describe("live avatar ready source", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    avatarMocks.getDb.mockReset();
    avatarMocks.canAccessCircle.mockReset();
    avatarMocks.getDisplayProfile.mockReset();
    avatarMocks.getProfile.mockReset();
    avatarMocks.canAccessCircle.mockResolvedValue(true);
    avatarMocks.getDisplayProfile.mockImplementation(async (id: number) => ({
      id,
      name: `Host ${id}`,
      handle: `host-${id}`,
      bio: "",
      avatar: "",
      followers: 0,
      following: 0,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("bounds the ready-only host set in SQL and derives a 45-second expiry", async () => {
    const fixture = listFixture({ streamRows: [stream()] });
    avatarMocks.getDb.mockResolvedValue(fixture.db);

    await expect(
      caller(7).list({
        search: "studio",
        hostIds: [40, 40, 41],
        readyOnly: true,
        viewerScope: 7,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 91,
        liveReady: true,
        liveExpiresAt: new Date(now.getTime() + HOST_LEASE_MS).toISOString(),
      }),
    ]);

    expect(fixture.listLimit()).toBe(100);
    const predicate = fixture.listPredicate();
    expect(predicate).toBeTruthy();
    const compiled = new PgDialect().sqlToQuery(predicate!);
    expect(compiled.sql).toContain('"status" =');
    expect(compiled.sql).toContain('"readyAt" is not null');
    expect(compiled.sql).toContain('"lastHeartbeatAt" >');
    expect(compiled.sql).toContain('"hostId" in');
    expect(compiled.params).toEqual(
      expect.arrayContaining(["live", "%studio%", 40, 41]),
    );
    expect(compiled.params.filter((value) => value === 40)).toHaveLength(1);
  });

  it("preserves legacy own preparing visibility but never exposes it through ready-only discovery", async () => {
    const preparing = stream({ hostId: 7, readyAt: null });
    const legacy = listFixture({ streamRows: [preparing] });
    avatarMocks.getDb.mockResolvedValue(legacy.db);

    await expect(caller(7).list({ viewerScope: 7 })).resolves.toEqual([
      expect.objectContaining({
        id: preparing.id,
        liveReady: false,
        liveExpiresAt: null,
      }),
    ]);

    const readyOnly = listFixture({ streamRows: [preparing] });
    avatarMocks.getDb.mockResolvedValue(readyOnly.db);
    avatarMocks.getDisplayProfile.mockClear();

    await expect(
      caller(7).list({ hostIds: [7], readyOnly: true, viewerScope: 7 }),
    ).resolves.toEqual([]);
    await expect(
      caller(null).list({ hostIds: [7], readyOnly: true, viewerScope: null }),
    ).resolves.toEqual([]);
    expect(avatarMocks.getDisplayProfile).not.toHaveBeenCalled();
  });

  it("fails closed for ended, stale, and malformed readiness data", async () => {
    const fixture = listFixture({
      streamRows: [
        stream({ id: 1, status: "ended" }),
        stream({
          id: 2,
          lastHeartbeatAt: new Date(now.getTime() - HOST_LEASE_MS),
        }),
        stream({ id: 3, readyAt: new Date("invalid") }),
        stream({ id: 4, lastHeartbeatAt: new Date("invalid") }),
      ],
    });
    avatarMocks.getDb.mockResolvedValue(fixture.db);

    await expect(
      caller(null).list({ readyOnly: true, viewerScope: null }),
    ).resolves.toEqual([]);
    expect(avatarMocks.getDisplayProfile).not.toHaveBeenCalled();
  });

  it("keeps public/current-host circles visible while denying pending private viewers and removed hosts", async () => {
    const fixture = listFixture({
      streamRows: [
        stream({ id: 1, hostId: 21, circleId: 201 }),
        stream({ id: 2, hostId: 22, circleId: 202 }),
        stream({ id: 3, hostId: 23, circleId: 203 }),
      ],
      hostRoles: ["member", null],
    });
    avatarMocks.getDb.mockResolvedValue(fixture.db);
    avatarMocks.canAccessCircle.mockImplementation(
      async (_viewerId: number | null, circleId: number) => circleId !== 202,
    );

    await expect(
      caller(7).list({ readyOnly: true, viewerScope: 7 }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 1,
        host: expect.objectContaining({ id: 21 }),
      }),
    ]);

    expect(avatarMocks.canAccessCircle).toHaveBeenCalledWith(7, 201);
    expect(avatarMocks.canAccessCircle).toHaveBeenCalledWith(7, 202);
    expect(avatarMocks.canAccessCircle).toHaveBeenCalledWith(7, 203);
    expect(fixture.hostMembershipReads()).toBe(2);
    expect(avatarMocks.getDisplayProfile).toHaveBeenCalledTimes(1);
    expect(avatarMocks.getDisplayProfile).toHaveBeenCalledWith(21);
  });

  it("returns only the newest eligible ready-only stream for a duplicate host", async () => {
    const fixture = listFixture({
      streamRows: [
        stream({ id: 101, hostId: 31 }),
        stream({ id: 100, hostId: 31 }),
      ],
    });
    avatarMocks.getDb.mockResolvedValue(fixture.db);

    await expect(
      caller(null).list({ readyOnly: true, viewerScope: null }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 101,
        host: expect.objectContaining({ id: 31 }),
      }),
    ]);
    expect(avatarMocks.getDisplayProfile).toHaveBeenCalledTimes(1);
  });

  it("rejects stale account scopes before opening a database read", async () => {
    await expect(caller(7).list({ viewerScope: 8 })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "You are not allowed to access live streams.",
    });
    await expect(caller(null).list({ viewerScope: 7 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "You are not allowed to access live streams.",
    });
    expect(avatarMocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects empty, oversized, and non-positive host sets before database access", async () => {
    const current = caller(7);
    for (const hostIds of [
      [],
      [0],
      Array.from({ length: 101 }, (_, i) => i + 1),
    ]) {
      await expect(current.list({ hostIds })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
    expect(avatarMocks.getDb).not.toHaveBeenCalled();
  });
});
