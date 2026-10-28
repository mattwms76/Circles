import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  D28_LIVE_STATUS_BADGE_MEDIA_INSET,
  d28LiveStatusOverlayStyles,
} from "../lib/d28-018-live-status-overlay";

const liveScreenSource = readFileSync(
  new URL("../app/live/[id].tsx", import.meta.url),
  "utf8",
);

describe("D28-018 live viewer-status overlay width", () => {
  it("constrains the badge to both media insets and lets its backplate wrap", () => {
    expect(d28LiveStatusOverlayStyles.container).toMatchObject({
      position: "absolute",
      top: D28_LIVE_STATUS_BADGE_MEDIA_INSET,
      left: D28_LIVE_STATUS_BADGE_MEDIA_INSET,
      right: D28_LIVE_STATUS_BADGE_MEDIA_INSET,
      alignItems: "flex-start",
    });
    expect(d28LiveStatusOverlayStyles.badge).toEqual({ maxWidth: "100%" });
    expect(d28LiveStatusOverlayStyles.text).toMatchObject({
      flexShrink: 1,
      flexWrap: "wrap",
    });
  });

  it("uses the bounded layout seam without changing complete status/count copy", () => {
    expect(liveScreenSource).toContain("d28LiveStatusOverlayStyles.container");
    expect(liveScreenSource).toContain("d28LiveStatusOverlayStyles.badge");
    expect(liveScreenSource).toContain("d28LiveStatusOverlayStyles.text");
    expect(liveScreenSource).toContain(
      "{mediaBadgeLabel} · {live.viewers} watching",
    );
  });
});
