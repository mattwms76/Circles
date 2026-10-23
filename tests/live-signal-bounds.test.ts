import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_ICE_CANDIDATE_BYTES,
  MAX_ICE_SDP_MID_BYTES,
  MAX_LIVE_SIGNALS_PER_PARTICIPANT,
  MAX_LIVE_SIGNALS_PER_PARTICIPANT_PER_WINDOW,
  MAX_LIVE_SIGNALS_PER_STREAM,
  P2P_VIEWER_LIMIT,
  isP2pAudienceAtCapacity,
  signalPayloadIsValid,
  wouldExceedLiveSignalQuota,
} from "../server/live-router";

const liveRouterSource = readFileSync(
  new URL("../server/live-router.ts", import.meta.url),
  "utf8",
);

function icePayload(input: Record<string, unknown>): string {
  return JSON.stringify({ candidate: "candidate:1 1 udp 1 127.0.0.1 9 typ host", ...input });
}

describe("LIV-BOUNDS-001 locked audience and signal quotas", () => {
  it("admits only the small direct audience and rejects all three quota boundaries", () => {
    expect(isP2pAudienceAtCapacity(P2P_VIEWER_LIMIT - 1)).toBe(false);
    expect(isP2pAudienceAtCapacity(P2P_VIEWER_LIMIT)).toBe(true);

    expect(
      wouldExceedLiveSignalQuota({
        streamSignals: MAX_LIVE_SIGNALS_PER_STREAM - 1,
        participantSignals: MAX_LIVE_SIGNALS_PER_PARTICIPANT - 1,
        recentParticipantSignals: MAX_LIVE_SIGNALS_PER_PARTICIPANT_PER_WINDOW - 1,
      }),
    ).toBe(false);
    expect(
      wouldExceedLiveSignalQuota({
        streamSignals: MAX_LIVE_SIGNALS_PER_STREAM,
        participantSignals: 0,
        recentParticipantSignals: 0,
      }),
    ).toBe(true);
    expect(
      wouldExceedLiveSignalQuota({
        streamSignals: 0,
        participantSignals: MAX_LIVE_SIGNALS_PER_PARTICIPANT,
        recentParticipantSignals: 0,
      }),
    ).toBe(true);
    expect(
      wouldExceedLiveSignalQuota({
        streamSignals: 0,
        participantSignals: 0,
        recentParticipantSignals: MAX_LIVE_SIGNALS_PER_PARTICIPANT_PER_WINDOW,
      }),
    ).toBe(true);
  });

  it("takes the stream row lock before counting audience or signal capacity", () => {
    const joinStart = liveRouterSource.indexOf("join: protectedProcedure");
    const leaveStart = liveRouterSource.indexOf("leave: protectedProcedure", joinStart);
    const join = liveRouterSource.slice(joinStart, leaveStart);
    expect(join.indexOf("const stream = await lockLiveStream")).toBeGreaterThan(-1);
    expect(join.indexOf("const stream = await lockLiveStream")).toBeLessThan(
      join.indexOf("activeViewerTotal"),
    );

    const signalStart = liveRouterSource.indexOf("signal: protectedProcedure");
    const chatStart = liveRouterSource.indexOf("chat: protectedProcedure", signalStart);
    const signal = liveRouterSource.slice(signalStart, chatStart);
    expect(signal.indexOf("const stream = await lockLiveStream")).toBeGreaterThan(-1);
    expect(signal.indexOf("const stream = await lockLiveStream")).toBeLessThan(
      signal.indexOf("assertLiveSignalCapacityInTransaction"),
    );
  });
});

describe("LIV-BOUNDS-002 signal payload limits", () => {
  it("accepts a bounded valid epoch-tagged ICE candidate", () => {
    expect(
      signalPayloadIsValid(
        "ice",
        icePayload({ sdpMid: "0", sdpMLineIndex: 0, liveOfferEpoch: 3 }),
      ),
    ).toBe(true);
  });

  it("rejects oversized UTF-8 ICE fields and invalid candidate coordinates", () => {
    expect(
      signalPayloadIsValid(
        "ice",
        icePayload({ candidate: "x".repeat(MAX_ICE_CANDIDATE_BYTES + 1) }),
      ),
    ).toBe(false);
    // This string has fewer code units than the byte cap but exceeds it in UTF-8.
    expect(
      signalPayloadIsValid(
        "ice",
        icePayload({ candidate: "€".repeat(Math.ceil((MAX_ICE_CANDIDATE_BYTES + 1) / 3)) }),
      ),
    ).toBe(false);
    expect(
      signalPayloadIsValid(
        "ice",
        icePayload({ sdpMid: "m".repeat(MAX_ICE_SDP_MID_BYTES + 1) }),
      ),
    ).toBe(false);
    expect(signalPayloadIsValid("ice", icePayload({ sdpMLineIndex: -1 }))).toBe(
      false,
    );
  });
});
