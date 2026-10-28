export const D28_024_COMPACT_TAB_MAX_WIDTH = 360;
export const D28_024_LARGE_TEXT_SCALE = 1.5;

/**
 * Keeps compact tabs icon-first when platform text enlargement would otherwise
 * force four labels around the central Create target.
 */
export function d28024TabCaptionMode(
  availableWidth: number,
  fontScale: number | undefined,
): "all" | "selected" {
  const hasCompactWidth =
    Number.isFinite(availableWidth) &&
    availableWidth <= D28_024_COMPACT_TAB_MAX_WIDTH;
  const hasLargeText =
    typeof fontScale === "number" &&
    Number.isFinite(fontScale) &&
    fontScale >= D28_024_LARGE_TEXT_SCALE;

  return hasCompactWidth && hasLargeText ? "selected" : "all";
}
