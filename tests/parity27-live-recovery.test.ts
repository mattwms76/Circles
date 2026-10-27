import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createA26LiveMediaState,
  isA26LiveParticipantReady,
  transitionA26LiveMediaState,
} from "../lib/a26-live-media-state";
import { shouldPreserveLiveParticipantReadiness } from "../lib/parity27-live-media-recovery";
import { terminateLiveTransportForError } from "../components/live-media-terminal";

const webAdapterSource = readFileSync(
  new URL("../components/live-media.web.tsx", import.meta.url),
  "utf8",
);
const nativeAdapterSource = readFileSync(
  new URL("../components/live-media.native.tsx", import.meta.url),
  "utf8",
);
const liveRouterSource = readFileSync(
  new URL("../server/live-router.ts", import.meta.url),
  "utf8",
);

function viewerRestartSource(source: string): string {
  const start = source.indexOf("const restartViewer = async");
  const end = source.indexOf("const handleSignal", start);
  if (start < 0 || end < 0) {
    throw new Error("Expected viewer restart implementation was not found.");
  }
  return source.slice(start, end);
}

function handlerSource(startMarker: string, endMarker: string): string {
  const start = liveRouterSource.indexOf(startMarker);
  const end = liveRouterSource.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(`Expected live handler ${startMarker} was not found.`);
  }
  return liveRouterSource.slice(start, end);
}

describe("PARITY27-LIVE generation and recoverable signaling", () => {
  it("admits a replacement viewer generation before accepting its first ready track", () => {
    let state = transitionA26LiveMediaState(createA26LiveMediaState(), {
      phase: "admitted",
      generation: 7,
    });
    state = transitionA26LiveMediaState(state, {
      phase: "ready",
      generation: 7,
    });
    state = transitionA26LiveMediaState(state, {
      phase: "joining",
      generation: 7,
    });
    state = transitionA26LiveMediaState(state, {
      phase: "admitted",
      generation: 8,
    });

    expect(
      transitionA26LiveMediaState(state, {
        phase: "ready",
        generation: 7,
      }),
    ).toBe(state);

    state = transitionA26LiveMediaState(state, {
      phase: "ready",
      generation: 8,
    });
    expect(state).toEqual({ phase: "ready", generation: 8, error: null });
    expect(isA26LiveParticipantReady(state)).toBe(true);

    for (const source of [webAdapterSource, nativeAdapterSource]) {
      const restart = viewerRestartSource(source);
      expect(
        restart.indexOf("generation = session.generation;"),
      ).toBeGreaterThan(-1);
      expect(restart.indexOf('emitMediaPhase("admitted");')).toBeGreaterThan(
        restart.indexOf("generation = session.generation;"),
      );
      expect(restart.indexOf('emitMediaPhase("admitted");')).toBeLessThan(
        restart.indexOf("await applyRelayCredentials(session.ice, false);"),
      );
    }
  });

  it("keeps an established participant ready for recoverable signaling warnings but keeps explicit denial terminal", () => {
    expect(
      shouldPreserveLiveParticipantReadiness({
        host: false,
        hostMediaReady: false,
        viewerMediaReady: true,
      }),
    ).toBe(true);
    expect(
      shouldPreserveLiveParticipantReadiness({
        host: false,
        hostMediaReady: false,
        viewerMediaReady: false,
      }),
    ).toBe(false);
    expect(
      shouldPreserveLiveParticipantReadiness({
        host: true,
        hostMediaReady: true,
        viewerMediaReady: false,
      }),
    ).toBe(true);

    for (const source of [webAdapterSource, nativeAdapterSource]) {
      expect(source).toContain("shouldPreserveLiveParticipantReadiness");
      expect(source).toContain(
        "if (terminateLiveTransportForError(error, terminate)) return;",
      );
    }

    let terminalMessage: string | null = null;
    expect(
      terminateLiveTransportForError(
        { data: { code: "FORBIDDEN" } },
        (state) => {
          terminalMessage = state.message;
        },
      ),
    ).toBe(true);
    expect(terminalMessage).toBe(
      "Your access to this live moment has been revoked.",
    );
  });
});

describe("PARITY27-LIVE parent-circle admission boundary", () => {
  it("locks the parent circle and rereads role before live lease or stream work", () => {
    const accessHelper = handlerSource(
      "async function lockLiveCircleAccess",
      "function assertCurrentLiveHostRole",
    );
    expect(accessHelper).toContain(".from(circles)");
    expect(accessHelper).toContain('.for("update")');
    expect(accessHelper).toContain(".from(memberships)");

    const create = handlerSource(
      "create: protectedProcedure",
      "end: protectedProcedure",
    );
    expect(create.indexOf("lockLiveCircleAccess")).toBeLessThan(
      create.indexOf("lockActiveHostLease"),
    );

    for (const [start, end] of [
      [
        "async function endHostStreamAtomically",
        "async function renewHostLeaseAtomically",
      ],
      [
        "async function renewHostLeaseAtomically",
        "async function getActiveViewerGenerationInTransaction",
      ],
    ] as const) {
      const helper = handlerSource(start, end);
      expect(helper.indexOf("lockLiveCircleAccess")).toBeLessThan(
        helper.indexOf("lockActiveHostLease"),
      );
    }

    for (const [start, end] of [
      ["heartbeat: protectedProcedure", "join: protectedProcedure"],
      ["join: protectedProcedure", "relay: protectedProcedure"],
      ["relay: protectedProcedure", "leave: protectedProcedure"],
      ["leave: protectedProcedure", "signals: protectedProcedure"],
      ["signals: protectedProcedure", "signal: protectedProcedure"],
      ["chat: protectedProcedure", "sendChat: protectedProcedure"],
      ["sendChat: protectedProcedure", "react: protectedProcedure"],
    ] as const) {
      const handler = handlerSource(start, end);
      expect(handler.indexOf("lockLiveCircleAccess")).toBeGreaterThan(-1);
      expect(handler.indexOf("lockLiveCircleAccess")).toBeLessThan(
        handler.indexOf("lockLiveStream"),
      );
      expect(handler).toContain("assertLockedLiveStreamCircle");
    }

    const signal = handlerSource(
      "signal: protectedProcedure",
      "chat: protectedProcedure",
    );
    expect(signal).toContain("const senderCircleAccess");
    expect(signal).toContain("const recipientCircleAccess");
    expect(signal.indexOf("lockLiveCircleAccess")).toBeLessThan(
      signal.indexOf("lockLiveStream"),
    );
  });
});
