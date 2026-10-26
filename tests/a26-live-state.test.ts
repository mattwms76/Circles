import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createA26LiveMediaState,
  isA26LiveParticipantReady,
  transitionA26LiveMediaState,
} from "../lib/a26-live-media-state";
import { resolveA26LiveCreationAvailability } from "../lib/a26-live-lobby-state";

const liveScreenSource = readFileSync(
  new URL("../app/live/[id].tsx", import.meta.url),
  "utf8",
);
const liveLobbySource = readFileSync(
  new URL("../app/live/index.tsx", import.meta.url),
  "utf8",
);
const webAdapterSource = readFileSync(
  new URL("../components/live-media.web.tsx", import.meta.url),
  "utf8",
);
const nativeAdapterSource = readFileSync(
  new URL("../components/live-media.native.tsx", import.meta.url),
  "utf8",
);

describe("A26 Live media phase state", () => {
  it("gates participation until a current admitted generation has actual media readiness", () => {
    const joining = createA26LiveMediaState();
    expect(isA26LiveParticipantReady(joining)).toBe(false);

    const admitted = transitionA26LiveMediaState(joining, {
      phase: "admitted",
      generation: 14,
    });
    expect(isA26LiveParticipantReady(admitted)).toBe(false);

    const ready = transitionA26LiveMediaState(admitted, {
      phase: "ready",
      generation: 14,
    });
    expect(ready).toEqual({ phase: "ready", generation: 14, error: null });
    expect(isA26LiveParticipantReady(ready)).toBe(true);
  });

  it("invalidates LIVE on error and clears the route error only after current recovered media", () => {
    const ready = transitionA26LiveMediaState(
      transitionA26LiveMediaState(createA26LiveMediaState(), {
        phase: "admitted",
        generation: 14,
      }),
      { phase: "ready", generation: 14 },
    );
    const failed = transitionA26LiveMediaState(ready, {
      phase: "error",
      generation: 14,
      message: "Connection lost.",
    });
    expect(failed).toEqual({
      phase: "error",
      generation: 14,
      error: "Connection lost.",
    });
    expect(isA26LiveParticipantReady(failed)).toBe(false);

    const reconnecting = transitionA26LiveMediaState(failed, {
      phase: "joining",
      generation: 14,
    });
    const readmitted = transitionA26LiveMediaState(reconnecting, {
      phase: "admitted",
      generation: 15,
    });
    expect(readmitted.error).toBe("Connection lost.");
    expect(
      transitionA26LiveMediaState(readmitted, {
        phase: "ready",
        generation: 14,
      }),
    ).toBe(readmitted);

    expect(
      transitionA26LiveMediaState(readmitted, {
        phase: "ready",
        generation: 15,
      }),
    ).toEqual({ phase: "ready", generation: 15, error: null });
  });
});

describe("A26 Live lobby availability", () => {
  it("does not present a failed availability query as still checking", () => {
    expect(
      resolveA26LiveCreationAvailability({
        isLoading: false,
        isError: true,
        status: undefined,
      }),
    ).toEqual({
      kind: "error",
      message: "We couldn’t check live creation availability. Try again.",
    });
    expect(
      resolveA26LiveCreationAvailability({
        isLoading: true,
        isError: false,
        status: undefined,
      }),
    ).toEqual({
      kind: "checking",
      message: "Checking creation availability. Please try again shortly.",
    });
  });
});

describe("A26 Live route and adapter wiring", () => {
  it("uses current media phase for queries, controls, recovery, and synchronous reactions", () => {
    expect(liveScreenSource).toContain(
      "onMediaPhaseChange={handleLiveMediaPhaseChange}",
    );
    expect(liveScreenSource).toContain(
      "enabled: !!user && !!live && participantReady",
    );
    expect(liveScreenSource).toContain("liveReactionSubmitter.isBusy");
    expect(liveScreenSource).toContain("await react.mutateAsync({ streamId })");
    expect(liveScreenSource).toContain('phase: "error"');
    expect(liveScreenSource).not.toContain("handleLiveMediaReady");
    expect(liveScreenSource).not.toContain("onReady={");
  });

  it("requires both platform adapters to emit admitted and recovery-ready phase changes", () => {
    for (const source of [webAdapterSource, nativeAdapterSource]) {
      expect(source).toContain("onMediaPhaseChange?:");
      expect(source).toContain('emitMediaPhase("admitted")');
      expect(source).toContain('emitMediaPhase("joining")');
      expect(source).toContain('emitMediaPhase("ready")');
      expect(source).toContain('emitMediaPhase("error", message)');
    }
  });

  it("distinguishes current-host camera setup and availability failure in the lobby", () => {
    expect(liveLobbySource).toContain("resolveA26LiveCreationAvailability");
    expect(liveLobbySource).toContain(
      'creationAvailability.kind !== "available"',
    );
    expect(liveLobbySource).toContain("CAMERA SETUP");
    expect(liveLobbySource).toContain("Continue camera setup");
  });
});
