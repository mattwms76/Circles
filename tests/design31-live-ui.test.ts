import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  acceptCurrentLiveHostLease,
  currentLiveHostEndInput,
  LIVE_MEDIA_STATUS_BACKPLATE,
  liveHostLeaseFromJoin,
  liveMediaStatusPresentation,
} from "../components/design31-live-ui";
import { contrastRatio, UI_ACCESSIBLE_COLORS } from "../lib/ui-accessibility";

const nativeSource = readFileSync(
  new URL("../components/live-media.native.tsx", import.meta.url),
  "utf8",
);
const webSource = readFileSync(
  new URL("../components/live-media.web.tsx", import.meta.url),
  "utf8",
);

describe("D26-19 live host setup cancellation authority", () => {
  it("keeps camera preparation non-destructive until an authenticated current-host join returns its generation", () => {
    expect(
      currentLiveHostEndInput({ host: true, streamId: 91, lease: null }),
    ).toBeNull();
    expect(
      liveHostLeaseFromJoin({
        host: true,
        streamId: 91,
        generation: 4,
        joinedHostId: 41,
        currentUserId: null,
      }),
    ).toBeNull();
    expect(
      liveHostLeaseFromJoin({
        host: true,
        streamId: 91,
        generation: 4,
        joinedHostId: 41,
        currentUserId: 42,
      }),
    ).toBeNull();

    const lease = liveHostLeaseFromJoin({
      host: true,
      streamId: 91,
      generation: 4,
      joinedHostId: 41,
      currentUserId: 41,
    });
    expect(lease).toEqual({ streamId: 91, generation: 4 });
    expect(
      currentLiveHostEndInput({ host: true, streamId: 91, lease }),
    ).toEqual({ streamId: 91, generation: 4 });
  });

  it("fails closed for ended or foreign routes and never lets an older callback downgrade the current generation", () => {
    const current = { streamId: 91, generation: 9 };

    expect(
      currentLiveHostEndInput({ host: false, streamId: 91, lease: current }),
    ).toBeNull();
    expect(
      currentLiveHostEndInput({
        host: true,
        streamId: 92,
        lease: current,
      }),
    ).toBeNull();
    expect(
      acceptCurrentLiveHostLease({
        streamId: 91,
        currentLease: current,
        candidate: { streamId: 91, generation: 8 },
      }),
    ).toBe(current);
    expect(
      acceptCurrentLiveHostLease({
        streamId: 91,
        currentLease: current,
        candidate: { streamId: 91, generation: 10 },
      }),
    ).toEqual({ streamId: 91, generation: 10 });
    expect(
      acceptCurrentLiveHostLease({
        streamId: 91,
        currentLease: current,
        candidate: { streamId: 92, generation: 11 },
      }),
    ).toBe(current);
  });

  it("wires the authenticated join lease callback in both transports before readiness and preserves ready callbacks", () => {
    for (const source of [nativeSource, webSource]) {
      const join = source.indexOf("const session = await api.live.join.mutate");
      const lease = source.indexOf("liveHostLeaseFromJoin", join);
      const leaseCallback = source.indexOf("onHostLease?.(hostLease)", lease);
      const readyCallback = source.indexOf("onReady?.(hostCleanupGeneration)");

      expect(join).toBeGreaterThan(-1);
      expect(lease).toBeGreaterThan(join);
      expect(leaseCallback).toBeGreaterThan(lease);
      expect(readyCallback).toBeGreaterThan(leaseCallback);
    }
  });
});

describe("D26-20 live video status presentation", () => {
  it("uses a fully opaque accessible backplate and matching semantic foregrounds for progress and failure", () => {
    const preparing = liveMediaStatusPresentation("Preparing camera…");
    const unavailable = liveMediaStatusPresentation(
      "Live video native support is unavailable.",
    );

    expect(preparing).toEqual({
      message: "Preparing camera…",
      tone: "info",
      backplateColor: LIVE_MEDIA_STATUS_BACKPLATE,
      foregroundColor: UI_ACCESSIBLE_COLORS.secondary,
    });
    expect(unavailable).toEqual({
      message: "Live video native support is unavailable.",
      tone: "error",
      backplateColor: LIVE_MEDIA_STATUS_BACKPLATE,
      foregroundColor: UI_ACCESSIBLE_COLORS.action,
    });
    expect(LIVE_MEDIA_STATUS_BACKPLATE).toMatch(/^#[0-9A-F]{6}$/i);
    expect(
      contrastRatio(preparing.foregroundColor, preparing.backplateColor),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(unavailable.foregroundColor, unavailable.backplateColor),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("removes the status overlay once media is live and keeps a single shared status path in each adapter", () => {
    expect(liveMediaStatusPresentation("Live").message).toBeNull();
    for (const source of [nativeSource, webSource]) {
      expect(source).toContain("<StatusMessage");
      expect(source).toContain(
        "backgroundColor: statusPresentation.backplateColor",
      );
    }
    expect(webSource).not.toContain('role="status"');
  });
});
