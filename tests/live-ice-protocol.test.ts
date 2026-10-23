import { describe, expect, it } from "vitest";
import {
  MAX_PENDING_LIVE_ICE_CANDIDATES,
  planLiveViewerRecovery,
  queuePendingLiveIce,
  splitPendingLiveIceForOfferEpoch,
  withLiveOfferEpoch,
  type LiveIceCandidateEnvelope,
} from "../lib/live-ice";

function candidate(
  suffix: string,
  liveOfferEpoch?: number,
): LiveIceCandidateEnvelope {
  return {
    candidate: `candidate:${suffix}`,
    sdpMid: "0",
    sdpMLineIndex: 0,
    ...(liveOfferEpoch === undefined ? {} : { liveOfferEpoch }),
  };
}

describe("LIV-ICE-001 offer epoch protocol", () => {
  it("tags the initial offer and matching answer with the exact host offer epoch", () => {
    const offer = withLiveOfferEpoch(
      { type: "offer" as const, sdp: "offer-sdp" },
      1,
    );
    const answer = withLiveOfferEpoch(
      { type: "answer" as const, sdp: "answer-sdp" },
      offer.liveOfferEpoch,
    );

    expect(offer.liveOfferEpoch).toBe(1);
    expect(answer.liveOfferEpoch).toBe(1);
  });

  it("drains initial and restart ICE only against its exact remote offer epoch", () => {
    const pending = [candidate("initial", 1), candidate("restart", 2)];

    const initial = splitPendingLiveIceForOfferEpoch(pending, 1);
    expect(initial.apply).toEqual([candidate("initial", 1)]);
    expect(initial.retain).toEqual([candidate("restart", 2)]);

    const restart = splitPendingLiveIceForOfferEpoch(initial.retain, 2);
    expect(restart.apply).toEqual([candidate("restart", 2)]);
    expect(restart.retain).toEqual([]);
  });

  it("handles legacy ICE explicitly without guessing a tagged offer epoch", () => {
    const pending = [candidate("legacy"), candidate("tagged", 7)];

    const legacy = splitPendingLiveIceForOfferEpoch(pending, null);
    expect(legacy.apply).toEqual([candidate("legacy")]);
    expect(legacy.retain).toEqual([candidate("tagged", 7)]);
  });

  it("bounds and deduplicates ICE queued before a remote description", () => {
    let pending: LiveIceCandidateEnvelope[] = [];
    for (let index = 0; index < MAX_PENDING_LIVE_ICE_CANDIDATES; index += 1) {
      pending = queuePendingLiveIce(pending, candidate(String(index), 1));
    }
    const afterDuplicate = queuePendingLiveIce(pending, candidate("0", 1));
    const afterOverflow = queuePendingLiveIce(
      afterDuplicate,
      candidate("overflow", 1),
    );

    expect(afterDuplicate).toEqual(pending);
    expect(afterOverflow).toEqual(pending);
    expect(afterOverflow).toHaveLength(MAX_PENDING_LIVE_ICE_CANDIDATES);
  });
});

describe("LIV-ICE-002 bounded failed-viewer recovery", () => {
  it("permits exactly two generation-safe attempts with bounded backoff before terminal teardown", () => {
    expect(planLiveViewerRecovery(0, 2, 700)).toEqual({
      terminal: false,
      attempt: 1,
      retryDelayMs: 700,
    });
    expect(planLiveViewerRecovery(1, 2, 700)).toEqual({
      terminal: false,
      attempt: 2,
      retryDelayMs: 1400,
    });
    expect(planLiveViewerRecovery(2, 2, 700)).toEqual({ terminal: true });
  });
});
