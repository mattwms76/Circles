import type { A26LiveMediaPhase } from "./a26-live-media-state";

/**
 * Keeps the over-video badge aligned with the adapter lifecycle while leaving
 * its existing placement, viewer count, backplate, and colors to the screen.
 */
export function d28LiveMediaBadgeLabel(
  phase: A26LiveMediaPhase,
): "VIDEO UNAVAILABLE" | "LIVE" | "CONNECTING" {
  if (phase === "error") return "VIDEO UNAVAILABLE";
  if (phase === "ready") return "LIVE";
  return "CONNECTING";
}
