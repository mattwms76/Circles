import { Directory, File, FileMode, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import {
  inspectRecordedMp4,
  MAX_RECORDED_VIDEO_BYTES,
  type RecordedVideoDraft,
  type RecordingDuration,
} from "../shared/recorded-video";

const ADOPTED_RECORDING_DIRECTORY = "circles-recorded-videos";
const CAMERA_RECORDING_DIRECTORY = "Camera";
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const SAFE_ERROR_PREFIXES = [
  "The video upload limit is unavailable.",
  "This video file could not be read.",
  "This video file changed before it could be inspected.",
  "This video file could not be read completely.",
  "Keep your recorded video under the allowed size.",
  "This MP4 file is incomplete or damaged.",
  "Choose a standard MP4 video.",
  "This video must use H.264 video with AAC audio.",
  "This video is missing the metadata needed to publish it.",
  "This fragmented MP4 recording is not supported.",
  "Choose a 30- or 60-second recording length.",
  "This recording is longer than the selected time limit.",
  "This recording is no longer available.",
  "This recording changed after preview.",
] as const;

function uploadLimit(maxBytes: number): number {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error(
      "The video upload limit is unavailable. Try again shortly.",
    );
  }
  return Math.min(MAX_RECORDED_VIDEO_BYTES, Math.floor(maxBytes));
}

function ownedDirectory(): Directory {
  return new Directory(Paths.cache, ADOPTED_RECORDING_DIRECTORY);
}

function cameraDirectory(): Directory {
  return new Directory(Paths.cache, CAMERA_RECORDING_DIRECTORY);
}

function childUriPrefix(directory: Directory): string {
  return directory.uri.endsWith("/") ? directory.uri : `${directory.uri}/`;
}

function isChildOfDirectory(uri: string, directory: Directory): boolean {
  const prefix = childUriPrefix(directory);
  if (
    typeof uri !== "string" ||
    !prefix.startsWith("file://") ||
    !uri.startsWith(prefix) ||
    uri.includes("?") ||
    uri.includes("#") ||
    uri.includes("%")
  ) {
    return false;
  }
  const filename = uri.slice(prefix.length);
  // CameraView and this adapter both create direct cache children with simple
  // generated names. Reject nested, dot-component, encoded, and non-file URIs
  // before any deletion; this predicate is the cleanup authorization boundary.
  return (
    filename !== "." && filename !== ".." && /^[A-Za-z0-9._-]+$/.test(filename)
  );
}

function isOwnedRecordingUri(uri: string): boolean {
  return isChildOfDirectory(uri, ownedDirectory());
}

function isKnownCameraTempUri(uri: string): boolean {
  return isChildOfDirectory(uri, cameraDirectory());
}

function safeDelete(file: File) {
  try {
    if (file.exists) file.delete();
  } catch {
    // Cleanup is best-effort. Never replace an already safe user-facing error.
  }
}

function safeDeleteKnownCameraTemp(uri: string) {
  if (isKnownCameraTempUri(uri)) safeDelete(new File(uri));
}

function safeDeleteOwnedRecording(uri: string) {
  if (isOwnedRecordingUri(uri)) safeDelete(new File(uri));
}

function safeUserError(error: unknown, fallback: string): Error {
  if (
    error instanceof Error &&
    SAFE_ERROR_PREFIXES.some((prefix) => error.message.startsWith(prefix))
  ) {
    return error;
  }
  return new Error(fallback);
}

function readBoundedBytes(file: File, maxBytes: number): Uint8Array {
  const limit = uploadLimit(maxBytes);
  let info;
  try {
    info = file.info();
  } catch {
    throw new Error(
      "This video file could not be read. Record it again and try again.",
    );
  }

  const infoSize = info.size;
  if (
    !info.exists ||
    !Number.isSafeInteger(infoSize) ||
    infoSize === undefined ||
    infoSize <= 0
  ) {
    throw new Error(
      "This video file could not be read. Record it again and try again.",
    );
  }
  if (infoSize > limit) {
    throw new Error("Keep your recorded video under the allowed size.");
  }

  let handle: ReturnType<File["open"]> | undefined;
  try {
    handle = file.open(FileMode.ReadOnly);
    const handleSize = handle.size;
    if (
      !Number.isSafeInteger(handleSize) ||
      handleSize === null ||
      handleSize <= 0 ||
      handleSize > limit ||
      handleSize !== infoSize
    ) {
      throw new Error("This video file changed before it could be inspected.");
    }

    const bytes = handle.readBytes(handleSize);
    if (bytes.byteLength !== handleSize) {
      throw new Error("This video file could not be read completely.");
    }
    // Detect a file that grew after the stat/open checks without reading it unboundedly.
    if (handle.readBytes(1).byteLength !== 0) {
      throw new Error("This video file changed before it could be inspected.");
    }
    return bytes;
  } catch (error) {
    throw safeUserError(
      error,
      "This video file could not be read. Record it again and try again.",
    );
  } finally {
    try {
      handle?.close();
    } catch {
      // The bytes have already been read or a safe read error is being returned.
    }
  }
}

function nextAdoptedFilename(): string {
  return `recorded-${randomUUID()}.mp4`;
}

function base64FromBytes(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 3 * 8192;

  for (let start = 0; start < bytes.length; start += chunkSize) {
    const end = Math.min(bytes.length, start + chunkSize);
    let chunk = "";
    for (let offset = start; offset < end; offset += 3) {
      const first = bytes[offset];
      const hasSecond = offset + 1 < bytes.length;
      const hasThird = offset + 2 < bytes.length;
      const second = hasSecond ? bytes[offset + 1] : 0;
      const third = hasThird ? bytes[offset + 2] : 0;
      const value = (first << 16) | (second << 8) | third;
      chunk += BASE64_ALPHABET[(value >> 18) & 0x3f];
      chunk += BASE64_ALPHABET[(value >> 12) & 0x3f];
      chunk += hasSecond ? BASE64_ALPHABET[(value >> 6) & 0x3f] : "=";
      chunk += hasThird ? BASE64_ALPHABET[value & 0x3f] : "=";
    }
    chunks.push(chunk);
  }

  return chunks.join("");
}

/**
 * Validates a CameraView cache result, copies it into the app-owned recording
 * cache, validates the adopted copy again, and removes the CameraView temp file.
 */
export async function prepareRecordedVideo(
  uri: string,
  maxDurationSeconds: RecordingDuration,
  maxBytes: number,
): Promise<RecordedVideoDraft> {
  if (!isKnownCameraTempUri(uri)) {
    throw new Error(
      "This recording is no longer available. Record it again and try again.",
    );
  }

  const source = new File(uri);
  let adopted: File | undefined;
  try {
    const sourceBytes = readBoundedBytes(source, maxBytes);
    inspectRecordedMp4(sourceBytes, { maxDurationSeconds, maxBytes });

    const directory = ownedDirectory();
    directory.create({ idempotent: true, intermediates: true });
    adopted = new File(directory, nextAdoptedFilename());
    await source.copy(adopted);

    const bytes = readBoundedBytes(adopted, maxBytes);
    const metadata = inspectRecordedMp4(bytes, {
      maxDurationSeconds,
      maxBytes,
    });
    safeDeleteKnownCameraTemp(uri);
    return {
      ...metadata,
      localUri: adopted.uri,
      maxDurationSeconds,
    };
  } catch (error) {
    if (adopted) safeDeleteOwnedRecording(adopted.uri);
    safeDeleteKnownCameraTemp(uri);
    throw safeUserError(
      error,
      "This recording could not be prepared. Record it again and try again.",
    );
  }
}

/** Deletes only a file previously adopted into this module's private cache. */
export async function deleteRecordedVideo(uri: string): Promise<void> {
  safeDeleteOwnedRecording(uri);
}

/**
 * Re-reads and revalidates the app-owned draft only when the member explicitly
 * publishes it. The draft itself never carries base64 media data.
 */
export async function recordedVideoBase64(
  draft: RecordedVideoDraft,
  maxBytes: number,
): Promise<string> {
  if (!draft || !isOwnedRecordingUri(draft.localUri)) {
    throw new Error(
      "This recording is no longer available. Record it again and try again.",
    );
  }

  const bytes = readBoundedBytes(new File(draft.localUri), maxBytes);
  const metadata = inspectRecordedMp4(bytes, {
    maxDurationSeconds: draft.maxDurationSeconds,
    maxBytes,
  });
  if (
    metadata.fileSize !== draft.fileSize ||
    metadata.durationMs !== draft.durationMs ||
    metadata.width !== draft.width ||
    metadata.height !== draft.height ||
    draft.mimeType !== "video/mp4"
  ) {
    throw new Error(
      "This recording changed after preview. Record it again and try again.",
    );
  }

  return base64FromBytes(bytes);
}
