import { describe, expect, it } from "vitest";
import {
  terminalLiveStateForError,
  terminateLiveTransportForError,
} from "../components/live-media-terminal";

type SyntheticEstablishedTransport = {
  heartbeatTimerRunning: boolean;
  signalTimerRunning: boolean;
  peerClosed: boolean;
  localTracksStopped: boolean;
  remoteMediaAttached: boolean;
  terminalMessage: string | null;
};

function makeSyntheticEstablishedTransport(): SyntheticEstablishedTransport {
  return {
    heartbeatTimerRunning: true,
    signalTimerRunning: true,
    peerClosed: false,
    localTracksStopped: false,
    remoteMediaAttached: true,
    terminalMessage: null,
  };
}

function stopSyntheticEstablishedTransport(
  transport: SyntheticEstablishedTransport,
  message: string,
): void {
  transport.heartbeatTimerRunning = false;
  transport.signalTimerRunning = false;
  transport.peerClosed = true;
  transport.localTracksStopped = true;
  transport.remoteMediaAttached = false;
  transport.terminalMessage = message;
}

describe("live terminal access teardown", () => {
  it("immediately tears down an established direct peer after synthetic membership removal", () => {
    const transport = makeSyntheticEstablishedTransport();

    const handled = terminateLiveTransportForError(
      { data: { code: "FORBIDDEN" } },
      (state) => stopSyntheticEstablishedTransport(transport, state.message),
    );

    expect(handled).toBe(true);
    expect(transport).toEqual({
      heartbeatTimerRunning: false,
      signalTimerRunning: false,
      peerClosed: true,
      localTracksStopped: true,
      remoteMediaAttached: false,
      terminalMessage: "Your access to this live moment has been revoked.",
    });
  });

  it("immediately tears down an established direct peer after synthetic host lease expiry", () => {
    const transport = makeSyntheticEstablishedTransport();

    const handled = terminateLiveTransportForError(
      { data: { code: "NOT_FOUND" } },
      (state) => stopSyntheticEstablishedTransport(transport, state.message),
    );

    expect(handled).toBe(true);
    expect(transport).toEqual({
      heartbeatTimerRunning: false,
      signalTimerRunning: false,
      peerClosed: true,
      localTracksStopped: true,
      remoteMediaAttached: false,
      terminalMessage: "This live moment has ended.",
    });
  });

  it("recognizes the tRPC error shape used for expired authentication", () => {
    expect(terminalLiveStateForError({ code: "UNAUTHORIZED" })).toEqual({
      kind: "access-revoked",
      message: "Your access to this live moment has been revoked.",
    });
  });

  it("preserves an established peer for a temporary transport failure", () => {
    const transport = makeSyntheticEstablishedTransport();

    const handled = terminateLiveTransportForError(
      new Error("synthetic offline network"),
      (state) => stopSyntheticEstablishedTransport(transport, state.message),
    );

    expect(handled).toBe(false);
    expect(transport).toEqual(makeSyntheticEstablishedTransport());
  });
});
