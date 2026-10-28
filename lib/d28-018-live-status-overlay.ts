export const D28_LIVE_STATUS_BADGE_MEDIA_INSET = 14;

/**
 * Keeps the live status backplate inside both clipped-media edges while its
 * status and viewer count use the existing screen copy and accessibility text.
 */
export const d28LiveStatusOverlayStyles = {
  container: {
    position: "absolute",
    top: D28_LIVE_STATUS_BADGE_MEDIA_INSET,
    left: D28_LIVE_STATUS_BADGE_MEDIA_INSET,
    right: D28_LIVE_STATUS_BADGE_MEDIA_INSET,
    alignItems: "flex-start",
  },
  badge: {
    maxWidth: "100%",
  },
  text: {
    flexShrink: 1,
    flexWrap: "wrap",
  },
} as const;
