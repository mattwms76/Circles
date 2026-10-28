import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { d28LiveMediaBadgeLabel } from "../lib/d28-017-live-media-badge";

const liveScreenSource = readFileSync(
  new URL("../app/live/[id].tsx", import.meta.url),
  "utf8",
);

describe("D28-017 Live media badge", () => {
  it("uses truthful phase-specific copy while retaining the ready and connecting labels", () => {
    expect(d28LiveMediaBadgeLabel("error")).toBe("VIDEO UNAVAILABLE");
    expect(d28LiveMediaBadgeLabel("ready")).toBe("LIVE");
    expect(d28LiveMediaBadgeLabel("joining")).toBe("CONNECTING");
    expect(d28LiveMediaBadgeLabel("admitted")).toBe("CONNECTING");
  });

  it("uses the phase mapping in the existing over-video badge without changing its viewer count", () => {
    expect(liveScreenSource).toContain(
      "d28LiveMediaBadgeLabel(mediaState.phase)",
    );
    expect(liveScreenSource).toContain("· {live.viewers} watching");
  });
});
