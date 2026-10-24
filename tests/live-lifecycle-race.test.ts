import { describe, expect, it, vi } from "vitest";
import { HOST_SETUP_DEADLINE_MS, liveRouter } from "../server/live-router";
import {
  LiveLifecycleRaceFixture,
  type FixtureStream,
  type FixtureViewer,
} from "./helpers/live-lifecycle-race";

const lifecycleMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  canAccessCircle: vi.fn(),
  getDisplayProfile: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock("../server/db", () => ({ getDb: lifecycleMocks.getDb }));
vi.mock("../server/social-service", () => ({
  canAccessCircle: lifecycleMocks.canAccessCircle,
  getDisplayProfile: lifecycleMocks.getDisplayProfile,
  getProfile: lifecycleMocks.getProfile,
}));
vi.mock("../server/turn-config", () => ({
  createTurnIceConfiguration: () => null,
  loadTurnConfiguration: () => null,
  TurnConfigurationError: class TurnConfigurationError extends Error {},
}));

function stream(hostGeneration = 1): FixtureStream {
  const now = new Date();
  return {
    id: 71,
    hostId: 10,
    title: "Race-safe live",
    circleId: null,
    thumbnail: "",
    status: "live",
    readyAt: now,
    lastHeartbeatAt: now,
    hostGeneration,
    createdAt: now,
    endedAt: null,
  };
}

function viewer(generation: number): FixtureViewer {
  const now = new Date();
  return {
    streamId: 71,
    userId: 20,
    joinedAt: now,
    lastSeenAt: now,
    generation,
    leftAt: null,
  };
}

function caller(userId: number) {
  return liveRouter.createCaller({
    user: { id: userId },
    req: {},
    res: {},
  } as never);
}

function useFixture(fixture: LiveLifecycleRaceFixture): void {
  lifecycleMocks.getDb.mockResolvedValue(fixture.db);
  lifecycleMocks.canAccessCircle.mockResolvedValue(true);
  lifecycleMocks.getDisplayProfile.mockResolvedValue({});
  lifecycleMocks.getProfile.mockResolvedValue({});
}

describe("LIV-RACE stream-row lifecycle serialization", () => {
  it("allocates distinct committed host generations for overlapping host joins", async () => {
    const fixture = new LiveLifecycleRaceFixture({
      stream: stream(),
      freezeOutsideStreamReads: true,
    });
    useFixture(fixture);

    const [first, second] = await Promise.all([
      caller(10).join({ streamId: 71 }),
      caller(10).join({ streamId: 71 }),
    ]);

    expect([first.generation, second.generation].sort((a, b) => a - b)).toEqual(
      [2, 3],
    );
    expect(fixture.stream.hostGeneration).toBe(3);
    expect(fixture.streamLockCount).toBe(2);
  });

  it("allocates distinct viewer generations for overlapping joins from one account", async () => {
    const fixture = new LiveLifecycleRaceFixture({
      stream: stream(4),
      viewer: viewer(8),
      freezeOutsideStreamReads: true,
    });
    useFixture(fixture);

    const [first, second] = await Promise.all([
      caller(20).join({ streamId: 71 }),
      caller(20).join({ streamId: 71 }),
    ]);

    expect([first.generation, second.generation].sort((a, b) => a - b)).toEqual(
      [9, 10],
    );
    expect(fixture.viewer).toMatchObject({ generation: 10, leftAt: null });
    expect(fixture.viewerUpsertCount).toBe(2);
    expect(fixture.streamLockCount).toBe(2);
  });

  it("targets the committed host generation when a viewer read is stale across a host restart", async () => {
    const fixture = new LiveLifecycleRaceFixture({
      stream: stream(1),
      freezeOutsideStreamReads: true,
      holdFirstOutsideStreamRead: true,
    });
    useFixture(fixture);

    const viewerJoin = caller(20).join({ streamId: 71 });
    await fixture.waitForFirstOutsideStreamRead();
    const hostReload = await caller(10).join({ streamId: 71 });
    fixture.releaseFirstOutsideStreamRead();
    const freshViewer = await viewerJoin;

    const viewerSystemJoin = fixture.signals.find(
      (signal) => signal.kind === "join" && signal.fromId === 20,
    );
    expect(hostReload.hostGeneration).toBe(2);
    expect(freshViewer.hostGeneration).toBe(2);
    expect(viewerSystemJoin).toMatchObject({
      fromGeneration: freshViewer.generation,
      toGeneration: 2,
    });
  });

  it("rejects an old cleanup generation without purging or leaving the replacement lifecycle", async () => {
    const fixture = new LiveLifecycleRaceFixture({
      stream: stream(3),
      viewer: viewer(12),
    });
    useFixture(fixture);

    await expect(
      caller(20).leave({ streamId: 71, generation: 11 }),
    ).rejects.toThrow("replaced");
    expect(fixture.viewer).toMatchObject({ generation: 12, leftAt: null });
    expect(fixture.viewerLeaveUpdateCount).toBe(0);
    expect(fixture.signalPurgeCount).toBe(0);
    expect(fixture.signals).toHaveLength(0);

    await expect(
      caller(20).leave({ streamId: 71, generation: 12 }),
    ).resolves.toEqual({
      success: true,
    });
    expect(fixture.viewer).toMatchObject({
      generation: 12,
      leftAt: expect.any(Date),
    });
    expect(fixture.viewerLeaveUpdateCount).toBe(1);
    expect(fixture.signalPurgeCount).toBe(1);
    expect(fixture.signals).toEqual([
      expect.objectContaining({
        kind: "leave",
        fromGeneration: 12,
        toGeneration: 3,
      }),
    ]);
  });

  it("rejects delayed host end and legacy or stale heartbeat after a replacement join", async () => {
    const fixture = new LiveLifecycleRaceFixture({
      stream: stream(1),
      freezeOutsideStreamReads: true,
      holdFirstOutsideStreamRead: true,
    });
    useFixture(fixture);

    // The barrier represents a stale host lifecycle that already knows its
    // generation while the replacement joins and commits under the row lock.
    const replacementJoin = caller(10).join({ streamId: 71 });
    await fixture.waitForFirstOutsideStreamRead();
    fixture.releaseFirstOutsideStreamRead();
    const replacement = await replacementJoin;
    const heartbeatBeforeRejectedCalls = fixture.stream.lastHeartbeatAt;
    const leaseBeforeRejectedCalls = fixture.hostLease.lastHeartbeatAt;

    expect(replacement.generation).toBe(2);
    await expect(
      caller(10).end({ streamId: 71, generation: 1 }),
    ).rejects.toThrow("replaced");
    await expect(
      caller(10).heartbeat({ streamId: 71, generation: 1 }),
    ).rejects.toThrow("replaced");
    await expect(
      caller(10).heartbeat({ streamId: 71 } as never),
    ).rejects.toThrow();

    expect(fixture.stream).toMatchObject({
      status: "live",
      hostGeneration: replacement.generation,
      lastHeartbeatAt: heartbeatBeforeRejectedCalls,
    });
    expect(fixture.hostLease.lastHeartbeatAt).toBe(leaseBeforeRejectedCalls);

    await expect(
      caller(10).heartbeat({
        streamId: 71,
        generation: replacement.generation,
      }),
    ).resolves.toEqual({ success: true });
    expect(fixture.stream.lastHeartbeatAt).not.toBe(
      heartbeatBeforeRejectedCalls,
    );
  });

  it("requires a provisional setup heartbeat, keeps readyAt null, and only publishes after ready", async () => {
    const preparingStream = stream();
    preparingStream.readyAt = null;
    const fixture = new LiveLifecycleRaceFixture({ stream: preparingStream });
    useFixture(fixture);

    await expect(
      caller(10).heartbeat({ streamId: 71, generation: 1 }),
    ).rejects.toThrow("provisional heartbeat");
    expect(fixture.stream.readyAt).toBeNull();

    await expect(
      caller(10).heartbeat({ streamId: 71, generation: 1, setup: true }),
    ).resolves.toEqual({ success: true });
    expect(fixture.stream.readyAt).toBeNull();

    await expect(
      caller(10).heartbeat({ streamId: 71, generation: 1, ready: true }),
    ).resolves.toEqual({ success: true });
    expect(fixture.stream.readyAt).toBeInstanceOf(Date);
  });

  it("does not let setup heartbeats revive camera setup after the server deadline", async () => {
    const expiredSetup = stream();
    expiredSetup.readyAt = null;
    expiredSetup.createdAt = new Date(Date.now() - HOST_SETUP_DEADLINE_MS * 2);
    const fixture = new LiveLifecycleRaceFixture({ stream: expiredSetup });
    useFixture(fixture);

    await expect(
      caller(10).heartbeat({ streamId: 71, generation: 1, setup: true }),
    ).rejects.toThrow("setup timed out");
    expect(fixture.stream.readyAt).toBeNull();
  });

  it("serializes a committed host join, viewer leave, and current host end", async () => {
    const fixture = new LiveLifecycleRaceFixture({ stream: stream(1) });
    useFixture(fixture);

    const hostSession = await caller(10).join({ streamId: 71 });
    const viewerSession = await caller(20).join({ streamId: 71 });

    await expect(
      caller(20).leave({ streamId: 71, generation: viewerSession.generation }),
    ).resolves.toEqual({ success: true });
    await expect(
      caller(10).end({ streamId: 71, generation: hostSession.generation }),
    ).resolves.toEqual({ success: true });

    expect(fixture.viewer).toMatchObject({
      generation: viewerSession.generation,
      leftAt: expect.any(Date),
    });
    expect(fixture.stream).toMatchObject({
      status: "ended",
      hostGeneration: hostSession.generation,
      endedAt: expect.any(Date),
    });
    expect(fixture.streamLockCount).toBe(4);
  });

  it("refuses an ended stream before inserting a viewer lifecycle or system signal", async () => {
    const ended = stream();
    ended.status = "ended";
    ended.endedAt = new Date();
    const fixture = new LiveLifecycleRaceFixture({ stream: ended });
    useFixture(fixture);

    await expect(caller(20).join({ streamId: 71 })).rejects.toThrow(
      "not found",
    );
    expect(fixture.viewer).toBeNull();
    expect(fixture.viewerUpsertCount).toBe(0);
    expect(fixture.signals).toHaveLength(0);
  });
});
