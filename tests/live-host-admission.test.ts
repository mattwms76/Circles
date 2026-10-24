import { describe, expect, it } from "vitest";
import {
  hasActiveHostLease,
  hostLeaseBelongsToStream,
  HOST_LEASE_MS,
} from "../server/live-router";

type SyntheticStream = {
  id: number;
  hostId: number;
  status: "live" | "ended";
  lastHeartbeatAt: Date;
};

type SyntheticHostLease = {
  streamId: number | null;
  lastHeartbeatAt: Date | null;
};

/**
 * A no-I/O fixture that models the transactionally locked activeHostLeases
 * row. It intentionally serializes only operations for the same host, which
 * is the concurrency boundary the production primary-key lease establishes.
 */
class SyntheticActiveHostLeaseFixture {
  private readonly leases = new Map<number, SyntheticHostLease>();
  private readonly streams: SyntheticStream[] = [];
  private readonly hostLockTails = new Map<number, Promise<void>>();
  private nextStreamId = 1;
  private readonly now = Date.UTC(2026, 0, 1, 12, 0, 0);

  async create(hostId: number): Promise<SyntheticStream | null> {
    return this.withHostLeaseTransaction(hostId, async () => {
      const now = new Date(this.now);
      const liveStreams = this.streams.filter(
        (stream) => stream.hostId === hostId && stream.status === "live",
      );
      const active = liveStreams.find((stream) =>
        hasActiveHostLease(stream.lastHeartbeatAt, this.now),
      );
      for (const expired of liveStreams.filter(
        (stream) => !hasActiveHostLease(stream.lastHeartbeatAt, this.now),
      )) {
        expired.status = "ended";
      }
      if (active) {
        this.leases.set(hostId, {
          streamId: active.id,
          lastHeartbeatAt: active.lastHeartbeatAt,
        });
        return null;
      }

      const stream: SyntheticStream = {
        id: this.nextStreamId++,
        hostId,
        status: "live",
        lastHeartbeatAt: now,
      };
      this.streams.push(stream);
      this.leases.set(hostId, {
        streamId: stream.id,
        lastHeartbeatAt: now,
      });
      return stream;
    });
  }

  async end(hostId: number, streamId: number): Promise<void> {
    await this.withHostLeaseTransaction(hostId, async () => {
      const stream = this.streams.find(
        (candidate) => candidate.id === streamId,
      );
      if (!stream || stream.hostId !== hostId || stream.status !== "live") {
        throw new Error("Synthetic stream is not an active host stream.");
      }
      stream.status = "ended";
      const lease = this.leases.get(hostId);
      if (lease && hostLeaseBelongsToStream(lease.streamId, streamId)) {
        this.leases.set(hostId, { streamId: null, lastHeartbeatAt: null });
      }
    });
  }

  currentLease(hostId: number): SyntheticHostLease | undefined {
    return this.leases.get(hostId);
  }

  streamsFor(hostId: number): SyntheticStream[] {
    return this.streams.filter((stream) => stream.hostId === hostId);
  }

  private async withHostLeaseTransaction<T>(
    hostId: number,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.hostLockTails.get(hostId) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = previous.then(() => current);
    this.hostLockTails.set(hostId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      releaseCurrent();
      if (this.hostLockTails.get(hostId) === tail) {
        this.hostLockTails.delete(hostId);
      }
    }
  }
}

describe("LIV-002 active host admission", () => {
  it("serializes concurrent creates so exactly one live stream owns a host slot", async () => {
    const fixture = new SyntheticActiveHostLeaseFixture();

    const results = await Promise.all([fixture.create(42), fixture.create(42)]);
    const created = results.filter(
      (stream): stream is SyntheticStream => stream !== null,
    );

    expect(created).toHaveLength(1);
    expect(fixture.streamsFor(42)).toEqual([
      expect.objectContaining({ id: created[0].id, status: "live" }),
    ]);
    expect(fixture.currentLease(42)).toEqual({
      streamId: created[0].id,
      lastHeartbeatAt: expect.any(Date),
    });
  });

  it("releases the matching lease atomically before a queued replacement create", async () => {
    const fixture = new SyntheticActiveHostLeaseFixture();
    const first = await fixture.create(42);
    if (!first) throw new Error("Synthetic initial stream was not created.");

    const [, replacement] = await Promise.all([
      fixture.end(42, first.id),
      fixture.create(42),
    ]);

    expect(replacement).toEqual(
      expect.objectContaining({ hostId: 42, status: "live" }),
    );
    expect(replacement?.id).not.toBe(first.id);
    expect(fixture.streamsFor(42)).toEqual([
      expect.objectContaining({ id: first.id, status: "ended" }),
      expect.objectContaining({ id: replacement?.id, status: "live" }),
    ]);
    expect(fixture.currentLease(42)?.streamId).toBe(replacement?.id);
  });

  it("does not let historical ended streams reserve the host slot", async () => {
    const fixture = new SyntheticActiveHostLeaseFixture();
    const first = await fixture.create(42);
    if (!first) throw new Error("Synthetic initial stream was not created.");

    await fixture.end(42, first.id);
    const next = await fixture.create(42);

    expect(next?.id).toBeGreaterThan(first.id);
    expect(
      fixture.streamsFor(42).filter((stream) => stream.status === "live"),
    ).toHaveLength(1);
    expect(HOST_LEASE_MS).toBe(45_000);
  });
});
