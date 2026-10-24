import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const nativeSource = readFileSync(
  new URL("../components/live-media.native.tsx", import.meta.url),
  "utf8",
);
const webSource = readFileSync(
  new URL("../components/live-media.web.tsx", import.meta.url),
  "utf8",
);

function expectEpochTransportParity(source: string): void {
  expect(source).toContain("localOfferEpoch: 0");
  expect(source).toContain("remoteOfferEpoch: null");
  expect(source).toContain(
    "peer.remoteOfferEpoch = offer.liveOfferEpoch ?? null",
  );
  expect(source).toContain("withLiveOfferEpoch(");
  expect(source).toContain("planLiveViewerRecovery(");
  expect(source).toContain("splitPendingLiveIceForOfferEpoch(");
  expect(source).toContain(
    "signalIce(hostId, event.candidate, peer.remoteOfferEpoch)",
  );
}

describe("LIV-ADAPTER-001 live-media transport parity", () => {
  it("keeps both adapters on the exact epoch and bounded recovery helpers", () => {
    expectEpochTransportParity(nativeSource);
    expectEpochTransportParity(webSource);
  });

  it("has native failed-viewer cleanup release the owned generation before rejoin and cancel all owned timers", () => {
    const restartStart = nativeSource.indexOf("const restartViewer = async");
    const restartEnd = nativeSource.indexOf("const handleSignal", restartStart);
    const recovery = nativeSource.slice(restartStart, restartEnd);

    expect(recovery.indexOf("api.live.leave")).toBeGreaterThan(-1);
    expect(recovery.indexOf("api.live.leave")).toBeLessThan(
      recovery.indexOf("api.live.join.mutate"),
    );
    expect(nativeSource).toContain(
      "if (viewerRecoveryTimer) clearTimeout(viewerRecoveryTimer)",
    );
    expect(nativeSource).toContain(
      "if (setupDeadlineTimer) clearTimeout(setupDeadlineTimer)",
    );
    expect(nativeSource).toContain("void restartViewer(hostId, null)");
    expect(nativeSource).toContain("viewerRecoveryAttempts = 0;");
  });

  it("keeps native camera setup provisional and bounded until the ready heartbeat succeeds", () => {
    const hostSetupStart = nativeSource.indexOf("const renewHostHeartbeat");
    const hostSetupEnd = nativeSource.indexOf(
      "const stream = await webRtc.mediaDevices.getUserMedia",
      hostSetupStart,
    );
    const setup = nativeSource.slice(hostSetupStart, hostSetupEnd);

    expect(setup).toContain("{ setup: true }");
    expect(setup).toContain("HOST_SETUP_CLIENT_DEADLINE_MS");
    expect(nativeSource.indexOf("ready: true")).toBeGreaterThan(hostSetupEnd);
    expect(nativeSource.indexOf("hostMediaReady = true")).toBeGreaterThan(
      nativeSource.indexOf("ready: true"),
    );
  });
});
