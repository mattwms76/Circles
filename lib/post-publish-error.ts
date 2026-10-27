const SAFE_LOCAL_RECORDING_ERRORS = new Set([
  "This MP4 file is incomplete or damaged. Record it again and try again.",
  "Choose a standard MP4 video. QuickTime, WebM, and other video formats are not supported.",
  "This video must use H.264 video with AAC audio.",
  "This video is missing the metadata needed to publish it.",
  "The video upload limit is unavailable. Try again shortly.",
  "Keep your recorded video under the allowed size.",
  "This recording is longer than the selected time limit.",
  "This fragmented MP4 recording is not supported.",
  "This recording is no longer available. Record it again and try again.",
  "This video file could not be read. Record it again and try again.",
  "This video file changed before it could be inspected.",
  "This video file could not be read completely.",
  "This recording changed after preview. Record it again and try again.",
  "Retry-safe publishing is temporarily unavailable. Your local draft has been kept.",
]);

/** Only fixed product copy may reach notices; arbitrary transport/native errors stay private. */
export function postPublishErrorMessage(failure: unknown): string {
  if (
    failure instanceof Error &&
    SAFE_LOCAL_RECORDING_ERRORS.has(failure.message)
  )
    return failure.message;
  const code =
    failure &&
    typeof failure === "object" &&
    "data" in failure &&
    failure.data &&
    typeof failure.data === "object" &&
    "code" in failure.data
      ? failure.data.code
      : undefined;
  if (code === "UNAUTHORIZED")
    return "Sign in again before publishing. Your draft is still here.";
  if (code === "FORBIDDEN")
    return "You no longer have permission to share with this audience. Choose another audience and try again.";
  if (code === "CONFLICT")
    return "The original publication cannot be reused. Retry keeps its original identifier; changing your draft starts a new publication.";
  if (code === "PRECONDITION_FAILED")
    return "Retry-safe publishing is temporarily unavailable. Your local draft has been kept.";
  if (code === "PAYLOAD_TOO_LARGE")
    return "Your video is too large to upload. Choose a smaller clip.";
  if (code === "BAD_REQUEST")
    return "This draft could not be published. Check its media and caption, then try again.";
  return "Could not share. Your draft is still here. Please try again.";
}
