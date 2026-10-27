import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createSec27CaptureLifecycle,
  type Sec27CaptureTerminalReason,
} from "../components/sec27-capture-lifecycle";

const nativeAdapterSource = readFileSync(
  new URL("../components/live-media.native.tsx", import.meta.url),
  "utf8",
);
const webAdapterSource = readFileSync(
  new URL("../components/live-media.web.tsx", import.meta.url),
  "utf8",
);
const liveRouteSource = readFileSync(
  new URL("../app/live/[id].tsx", import.meta.url),
  "utf8",
);

type MockPlatform = {
  stopCapture: () => void;
  emit: (reason: Sec27CaptureTerminalReason, generation: number | null) => void;
  foreground: () => true;
};

function createMockPlatform(events: string[]): MockPlatform {
  const lifecycle = createSec27CaptureLifecycle({
    stopLocalCapture: () => events.push("local-stop"),
    notifyTerminal: (reason) => events.push(`terminal:${reason}`),
    sendGenerationTerminal: async (generation) => {
      events.push(`network-terminal:${generation}`);
    },
  });

  return {
    stopCapture: () => lifecycle.terminate("native-background", null),
    emit: (reason, generation) => lifecycle.terminate(reason, generation),
    foreground: () => lifecycle.resumeRequiresExplicitRejoin(),
  };
}

describe("SEC014 background capture lifecycle", () => {
  it("stops mock tracks, peers, and renderers before the native generation terminal request", async () => {
    const events: string[] = [];
    const lifecycle = createSec27CaptureLifecycle({
      stopLocalCapture: () => {
        events.push("tracks-stopped");
        events.push("peers-closed");
        events.push("renderers-detached");
      },
      notifyTerminal: () => events.push("terminal-notified"),
      sendGenerationTerminal: async (generation) => {
        events.push(`leave:${generation}`);
      },
    });

    lifecycle.terminate("native-inactive", 44);
    await Promise.resolve();

    expect(events).toEqual([
      "tracks-stopped",
      "peers-closed",
      "renderers-detached",
      "terminal-notified",
      "leave:44",
    ]);
  });

  it("handles hidden/pagehide mock web events once and does not reacquire on a later foreground event", async () => {
    const events: string[] = [];
    const platform = createMockPlatform(events);

    platform.emit("web-hidden", 71);
    platform.emit("web-pagehide", 71);
    const requiresExplicitRejoin = platform.foreground();
    await Promise.resolve();

    expect(events).toEqual([
      "local-stop",
      "terminal:web-hidden",
      "network-terminal:71",
    ]);
    expect(requiresExplicitRejoin).toBe(true);
    expect(events).not.toContain("reacquire-capture");
  });

  it("releases one late generation after backgrounding during a pending join without duplicate terminals", async () => {
    const sendGenerationTerminal = vi.fn<
      (generation: number) => Promise<unknown>
    >(async () => undefined);
    const stopLocalCapture = vi.fn();
    const notifyTerminal = vi.fn();
    const lifecycle = createSec27CaptureLifecycle({
      stopLocalCapture,
      notifyTerminal,
      sendGenerationTerminal,
    });

    expect(lifecycle.terminate("native-background", null)).toBe(false);
    expect(lifecycle.bindGenerationAfterTerminal(93)).toBe(true);
    expect(lifecycle.bindGenerationAfterTerminal(93)).toBe(false);
    expect(lifecycle.terminate("native-background", 93)).toBe(false);
    await Promise.resolve();

    expect(stopLocalCapture).toHaveBeenCalledTimes(1);
    expect(notifyTerminal).toHaveBeenCalledTimes(1);
    expect(sendGenerationTerminal).toHaveBeenCalledTimes(1);
    expect(sendGenerationTerminal).toHaveBeenCalledWith(93);
  });

  it("wires the coordinator to native AppState, web visibility/pagehide, and a user-only keyed rejoin", () => {
    for (const source of [nativeAdapterSource, webAdapterSource]) {
      const lifecycleStart = source.indexOf(
        "const captureLifecycle = createSec27CaptureLifecycle",
      );
      const lifecycleEnd = source.indexOf(
        "const initialise = async",
        lifecycleStart,
      );
      const lifecycle = source.slice(lifecycleStart, lifecycleEnd);

      expect(lifecycle).toContain("stopTransport();");
      expect(lifecycle).toContain("sendGenerationTerminal");
      expect(lifecycle.indexOf("stopTransport();")).toBeLessThan(
        lifecycle.indexOf("sendGenerationTerminal"),
      );
      expect(source).toContain(
        "bindGenerationAfterTerminal(session.generation)",
      );
    }
    expect(nativeAdapterSource).toContain("AppState.addEventListener");
    expect(nativeAdapterSource).toContain("appStateSubscription.remove()");
    expect(nativeAdapterSource).toContain('"native-inactive"');
    expect(nativeAdapterSource).toContain('"native-background"');
    expect(webAdapterSource).toContain('window.addEventListener("pagehide"');
    expect(webAdapterSource).toContain(
      'document.addEventListener("visibilitychange", visibilityChangeHandler)',
    );
    expect(webAdapterSource).toContain('document.visibilityState === "hidden"');
    expect(liveRouteSource).toContain("key={mediaAttempt}");
    expect(liveRouteSource).toContain("const rejoinLiveMedia = useCallback");
    expect(liveRouteSource).toContain('title="Rejoin live video"');
  });
});
