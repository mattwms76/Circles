import type {
  RecordedVideoDraft,
  RecordingDuration,
} from "../shared/recorded-video";

function unsupported(): Error {
  return new Error(
    "Recording is available in the native app. On web, upload an existing MP4 video.",
  );
}

/** Web has no native CameraView cache output to inspect or adopt. */
export async function prepareRecordedVideo(
  _uri: string,
  _maxDurationSeconds: RecordingDuration,
  _maxBytes: number,
): Promise<RecordedVideoDraft> {
  throw unsupported();
}

/** There is no app-owned native recording cache on web. */
export async function deleteRecordedVideo(_uri: string): Promise<void> {
  // Intentional no-op: never attempt filesystem deletion from the web shim.
}

/** Web recording is unsupported for this MP4-only capture flow. */
export async function recordedVideoBase64(
  _draft: RecordedVideoDraft,
  _maxBytes: number,
): Promise<string> {
  throw unsupported();
}
