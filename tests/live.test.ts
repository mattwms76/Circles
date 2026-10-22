import { describe, expect, it } from "vitest";
import {
  canHostCircleRole,
  canSendSignal,
  hasActiveHostLease,
  hasActiveViewerLease,
  hasCurrentLiveSignalGeneration,
  HOST_LEASE_MS,
  isLiveSignalVisibleToSession,
  VIEWER_LEASE_MS,
} from "../server/live-router";

const base = {
  streamIsLive: true,
  hostId: 10,
  recipientIsActiveViewer: true,
  senderIsActiveViewer: true,
};

describe("live signaling permissions", () => {
  it("permits only the host to offer to an active viewer", () => {
    expect(
      canSendSignal({ ...base, senderId: 10, recipientId: 20, kind: "offer" }),
    ).toBe(true);
    expect(
      canSendSignal({ ...base, senderId: 20, recipientId: 10, kind: "offer" }),
    ).toBe(false);
  });

  it("permits only an active viewer to answer the host", () => {
    expect(
      canSendSignal({ ...base, senderId: 20, recipientId: 10, kind: "answer" }),
    ).toBe(true);
    expect(
      canSendSignal({ ...base, senderId: 10, recipientId: 20, kind: "answer" }),
    ).toBe(false);
    expect(
      canSendSignal({
        ...base,
        senderId: 30,
        recipientId: 10,
        kind: "answer",
        senderIsActiveViewer: false,
      }),
    ).toBe(false);
  });

  it("allows ICE only along an established host/viewer participant boundary", () => {
    expect(
      canSendSignal({ ...base, senderId: 10, recipientId: 20, kind: "ice" }),
    ).toBe(true);
    expect(
      canSendSignal({ ...base, senderId: 20, recipientId: 10, kind: "ice" }),
    ).toBe(true);
    expect(
      canSendSignal({
        ...base,
        senderId: 10,
        recipientId: 30,
        kind: "ice",
        recipientIsActiveViewer: false,
      }),
    ).toBe(false);
    expect(
      canSendSignal({ ...base, senderId: 20, recipientId: 30, kind: "ice" }),
    ).toBe(false);
  });

  it("rejects all signals after a stream ends", () => {
    expect(
      canSendSignal({
        ...base,
        streamIsLive: false,
        senderId: 10,
        recipientId: 20,
        kind: "offer",
      }),
    ).toBe(false);
  });
});

describe("live signaling session boundaries", () => {
  it("does not replay historical rows into a reloaded media lifecycle", () => {
    const reloadedSession = { generation: 2, cursor: 40 };
    const syntheticSignals = [
      { id: 12, toGeneration: 1 },
      { id: 40, toGeneration: 2 },
      { id: 41, toGeneration: 1 },
      { id: 42, toGeneration: 2 },
    ];

    expect(
      syntheticSignals
        .filter((signal) =>
          isLiveSignalVisibleToSession(signal, reloadedSession),
        )
        .map((signal) => signal.id),
    ).toEqual([42]);
  });

  it("rejects a rejoined viewer's superseded generation", () => {
    const rejoinedViewerGeneration = 3;

    expect(
      hasCurrentLiveSignalGeneration(2, rejoinedViewerGeneration),
    ).toBe(false);
    expect(
      hasCurrentLiveSignalGeneration(3, rejoinedViewerGeneration),
    ).toBe(true);
  });

  it("requires a cursor to advance past the join high-water mark", () => {
    const joinedSession = { generation: 4, cursor: 99 };

    expect(
      isLiveSignalVisibleToSession(
        { id: 99, toGeneration: 4 },
        joinedSession,
      ),
    ).toBe(false);
    expect(
      isLiveSignalVisibleToSession(
        { id: 100, toGeneration: 4 },
        joinedSession,
      ),
    ).toBe(true);
  });
});

describe("live presence leases", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);

  it("expires host leases at the 45-second boundary", () => {
    expect(hasActiveHostLease(new Date(now - HOST_LEASE_MS + 1), now)).toBe(
      true,
    );
    expect(hasActiveHostLease(new Date(now - HOST_LEASE_MS), now)).toBe(false);
    expect(hasActiveHostLease(null, now)).toBe(false);
  });

  it("counts only non-left viewers with a fresh 30-second lease", () => {
    expect(
      hasActiveViewerLease(
        { leftAt: null, lastSeenAt: new Date(now - VIEWER_LEASE_MS + 1) },
        now,
      ),
    ).toBe(true);
    expect(
      hasActiveViewerLease(
        { leftAt: null, lastSeenAt: new Date(now - VIEWER_LEASE_MS) },
        now,
      ),
    ).toBe(false);
    expect(
      hasActiveViewerLease(
        { leftAt: new Date(now), lastSeenAt: new Date(now) },
        now,
      ),
    ).toBe(false);
  });
});

describe("live circle hosting roles", () => {
  it("requires an approved membership even for publicly readable circles", () => {
    expect(canHostCircleRole("owner")).toBe(true);
    expect(canHostCircleRole("moderator")).toBe(true);
    expect(canHostCircleRole("member")).toBe(true);
    expect(canHostCircleRole("pending")).toBe(false);
    expect(canHostCircleRole(null)).toBe(false);
  });
});
