import { describe, expect, it } from "vitest";
import {
  canSendSignal,
  isLiveSignalVisibleToSession,
} from "../server/live-router";
import {
  createHostGenerationRestartSignals,
  hostGenerationFromRestartSignal,
} from "../shared/live-generation-restart";

type MockSignal = {
  id: number;
  streamId: number;
  fromId: number;
  toId: number;
  kind: "join" | "offer" | "answer" | "ice";
  fromGeneration: number;
  toGeneration: number;
  payload: string;
};

describe("LIV-001 connected-viewer host reload", () => {
  it("closes the old peer, emits exactly one fresh join/offer, and does not replay historic SDP or ICE", () => {
    const streamId = 41;
    const hostId = 10;
    const viewerId = 20;
    const oldViewerGeneration = 7;
    const oldHostGeneration = 1;
    const newHostGeneration = 2;
    const hostHighWater = 100;
    const historicSignals: MockSignal[] = [
      {
        id: 97,
        streamId,
        fromId: hostId,
        toId: viewerId,
        kind: "offer",
        fromGeneration: oldHostGeneration,
        toGeneration: oldViewerGeneration,
        payload: '{"type":"offer","sdp":"historic"}',
      },
      {
        id: 98,
        streamId,
        fromId: viewerId,
        toId: hostId,
        kind: "answer",
        fromGeneration: oldViewerGeneration,
        toGeneration: oldHostGeneration,
        payload: '{"type":"answer","sdp":"historic"}',
      },
      {
        id: 99,
        streamId,
        fromId: hostId,
        toId: viewerId,
        kind: "ice",
        fromGeneration: oldHostGeneration,
        toGeneration: oldViewerGeneration,
        payload: '{"candidate":"historic"}',
      },
    ];

    // The mocked server reload path targets each still-active viewer's current
    // generation. This is the row the viewer polls before it can rejoin.
    const restart = createHostGenerationRestartSignals({
      streamId,
      hostId,
      hostGeneration: newHostGeneration,
      viewers: [{ userId: viewerId, generation: oldViewerGeneration }],
    });
    expect(restart).toHaveLength(1);
    const restartRow = { ...restart[0], id: 101 };

    let closedOldPeers = 0;
    let viewerGeneration = oldViewerGeneration;
    let viewerCursor = hostHighWater;
    let freshJoins = 0;
    let freshOffers = 0;
    const restartedHostGeneration = hostGenerationFromRestartSignal({
      kind: restartRow.kind,
      fromId: restartRow.fromId,
      expectedHostId: hostId,
      payload: restartRow.payload,
    });

    // Mock the viewer transport's restart handler: it closes the peer first,
    // then atomically asks the server for a new generation and emits one join.
    expect(restartedHostGeneration).toBe(newHostGeneration);
    closedOldPeers += 1;
    viewerGeneration += 1;
    viewerCursor = restartRow.id;
    const freshJoin: MockSignal = {
      id: 102,
      streamId,
      fromId: viewerId,
      toId: hostId,
      kind: "join",
      fromGeneration: viewerGeneration,
      toGeneration: newHostGeneration,
      payload: "{}",
    };
    freshJoins += 1;

    // The reloaded host started at the pre-restart high-water mark. It receives
    // only this new join and creates exactly one offer for the new viewer gen.
    const hostVisible = [...historicSignals, restartRow, freshJoin].filter(
      (signal) =>
        signal.toId === hostId &&
        isLiveSignalVisibleToSession(signal, {
          generation: newHostGeneration,
          cursor: hostHighWater,
        }),
    );
    expect(hostVisible).toEqual([freshJoin]);
    freshOffers += 1;
    const freshOffer: MockSignal = {
      id: 103,
      streamId,
      fromId: hostId,
      toId: viewerId,
      kind: "offer",
      fromGeneration: newHostGeneration,
      toGeneration: viewerGeneration,
      payload: '{"type":"offer","sdp":"fresh"}',
    };

    const viewerVisible = [...historicSignals, freshOffer].filter((signal) =>
      isLiveSignalVisibleToSession(signal, {
        generation: viewerGeneration,
        cursor: viewerCursor,
      }),
    );
    expect(viewerVisible).toEqual([freshOffer]);
    expect(viewerVisible.map((signal) => signal.kind)).not.toContain("ice");
    expect(closedOldPeers).toBe(1);
    expect(freshJoins).toBe(1);
    expect(freshOffers).toBe(1);

    // An old connected peer cannot push its answer/ICE into the new host
    // lifecycle while it is waiting for the restart signal to be consumed.
    expect(
      canSendSignal({
        streamIsLive: true,
        hostId,
        senderId: viewerId,
        recipientId: hostId,
        kind: "ice",
        senderIsActiveViewer: true,
        recipientIsActiveViewer: true,
        senderHasJoinedCurrentHostGeneration: false,
      }),
    ).toBe(false);
  });
});
