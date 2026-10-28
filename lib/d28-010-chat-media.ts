export type D28_010ChatAttachmentWidthInput = {
  windowWidth: number;
  leftInset: number;
  rightInset: number;
};

const TRANSCRIPT_GUTTER = 22;
const BUBBLE_WIDTH_FRACTION = 0.8;
const BUBBLE_HORIZONTAL_PADDING = 13;
const BUBBLE_BORDER_ALLOWANCE = 2;
const MAX_TRANSCRIPT_WIDTH = 760;
const PREFERRED_MIN_MEDIA_WIDTH = 120;
const PREFERRED_MAX_MEDIA_WIDTH = 220;

function nonnegativeFinite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Matches Chat's post-safe-area transcript geometry. AppShell owns the actual
 * safe-area padding, while window dimensions remain physical, so lateral
 * insets are removed exactly once before applying the transcript constraints.
 */
export function d28_010ChatAttachmentWidth({
  windowWidth,
  leftInset,
  rightInset,
}: D28_010ChatAttachmentWidthInput): number {
  const postInsetWidth = Math.max(
    0,
    nonnegativeFinite(windowWidth) -
      nonnegativeFinite(leftInset) -
      nonnegativeFinite(rightInset),
  );
  const transcriptWidth = Math.min(postInsetWidth, MAX_TRANSCRIPT_WIDTH);
  const transcriptContentWidth = Math.max(
    0,
    transcriptWidth - TRANSCRIPT_GUTTER * 2,
  );
  const bubbleInnerWidth = Math.max(
    0,
    Math.floor(transcriptContentWidth * BUBBLE_WIDTH_FRACTION) -
      BUBBLE_HORIZONTAL_PADDING * 2 -
      BUBBLE_BORDER_ALLOWANCE,
  );
  const preferredWidth = Math.min(
    PREFERRED_MAX_MEDIA_WIDTH,
    Math.max(PREFERRED_MIN_MEDIA_WIDTH, bubbleInnerWidth),
  );

  // On extreme pressure, the 120-point preference must not exceed the inner
  // bubble width that is physically available to the attachment.
  return Math.min(preferredWidth, bubbleInnerWidth);
}
