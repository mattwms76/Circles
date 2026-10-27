import type {
  RecordedVideoDraft,
  RecordingDuration,
} from "@/shared/recorded-video";

export type RecorderPhase =
  | "idle"
  | "requesting-permission"
  | "camera-loading"
  | "camera-ready"
  | "recording"
  | "finalizing"
  | "preparing"
  | "preview"
  | "permission-denied"
  | "error"
  | "transferred";

export type RecorderFacing = "front" | "back";

export type RecordingLifecycleState = {
  phase: RecorderPhase;
  maxDurationSeconds: RecordingDuration;
  facing: RecorderFacing;
  cameraInstance: number;
  message: string | null;
  permissionCanAskAgain: boolean;
};

export type RecordingLifecycleEvent =
  | { type: "begin-permission-request" }
  | { type: "permissions-granted" }
  | { type: "permissions-denied"; canAskAgain: boolean }
  | { type: "camera-ready"; cameraInstance: number }
  | { type: "select-duration"; duration: RecordingDuration }
  | { type: "switch-camera" }
  | { type: "start-recording" }
  | { type: "request-stop" }
  | { type: "capture-received" }
  | { type: "capture-prepared" }
  | { type: "retake" }
  | { type: "use" }
  | { type: "failure"; message: string }
  | { type: "backgrounded"; message: string }
  | { type: "reset" };

const INITIAL_STATE: RecordingLifecycleState = {
  phase: "idle",
  maxDurationSeconds: 30,
  facing: "back",
  cameraInstance: 0,
  message: null,
  permissionCanAskAgain: true,
};

export function createInitialRecordingLifecycle(): RecordingLifecycleState {
  return { ...INITIAL_STATE };
}

/** Camera hardware exists only during these states; never during local playback. */
export function shouldMountRecorderCamera(
  state: RecordingLifecycleState,
): boolean {
  return (
    state.phase === "camera-loading" ||
    state.phase === "camera-ready" ||
    state.phase === "recording" ||
    // Keep the native view alive while stopRecording() resolves recordAsync().
    // capture-received moves to preparing, where it unmounts before inspection
    // and, later, before the local playback component mounts.
    state.phase === "finalizing"
  );
}

export function canChangeRecorderDuration(
  state: RecordingLifecycleState,
): boolean {
  return (
    state.phase === "idle" ||
    state.phase === "permission-denied" ||
    state.phase === "error" ||
    state.phase === "camera-ready"
  );
}

export function canSwitchRecorderCamera(
  state: RecordingLifecycleState,
): boolean {
  return state.phase === "camera-ready";
}

/** Leave mux/AAC finalization headroom; native hard limits and byte validation remain authoritative. */
export function shouldAutoStopRecording(
  elapsedMs: number,
  maximum: RecordingDuration,
): boolean {
  return Number.isFinite(elapsedMs) && elapsedMs >= maximum * 1000 - 250;
}

/**
 * The state machine deliberately ignores impossible/late UI transitions. Async
 * work is additionally guarded with RecordingOperationFence below.
 */
export function reduceRecordingLifecycle(
  state: RecordingLifecycleState,
  event: RecordingLifecycleEvent,
): RecordingLifecycleState {
  switch (event.type) {
    case "begin-permission-request":
      if (
        state.phase !== "idle" &&
        state.phase !== "permission-denied" &&
        state.phase !== "error"
      ) {
        return state;
      }
      return {
        ...state,
        phase: "requesting-permission",
        message: null,
      };

    case "permissions-granted":
      if (state.phase !== "requesting-permission") return state;
      return {
        ...state,
        phase: "camera-loading",
        cameraInstance: state.cameraInstance + 1,
        message: null,
      };

    case "permissions-denied":
      if (state.phase !== "requesting-permission") return state;
      return {
        ...state,
        phase: "permission-denied",
        message:
          "Camera and microphone access are needed to record a video with sound.",
        permissionCanAskAgain: event.canAskAgain,
      };

    case "camera-ready":
      if (
        state.phase !== "camera-loading" ||
        state.cameraInstance !== event.cameraInstance
      ) {
        return state;
      }
      return { ...state, phase: "camera-ready", message: null };

    case "select-duration":
      if (!canChangeRecorderDuration(state)) return state;
      return { ...state, maxDurationSeconds: event.duration };

    case "switch-camera":
      if (!canSwitchRecorderCamera(state)) return state;
      return {
        ...state,
        facing: state.facing === "back" ? "front" : "back",
        phase: "camera-loading",
        cameraInstance: state.cameraInstance + 1,
        message: null,
      };

    case "start-recording":
      if (state.phase !== "camera-ready") return state;
      return { ...state, phase: "recording", message: null };

    case "request-stop":
      if (state.phase !== "recording") return state;
      return { ...state, phase: "finalizing", message: null };

    case "capture-received":
      if (state.phase !== "recording" && state.phase !== "finalizing") {
        return state;
      }
      return { ...state, phase: "preparing", message: null };

    case "capture-prepared":
      if (state.phase !== "preparing") return state;
      return { ...state, phase: "preview", message: null };

    case "retake":
      if (state.phase !== "preview") return state;
      return {
        ...state,
        phase: "camera-loading",
        cameraInstance: state.cameraInstance + 1,
        message: null,
      };

    case "use":
      if (state.phase !== "preview") return state;
      return { ...state, phase: "transferred", message: null };

    case "failure":
      return {
        ...state,
        phase: "error",
        message: event.message,
      };

    case "backgrounded":
      return {
        ...state,
        phase: "error",
        message: event.message,
      };

    case "reset":
      return {
        ...INITIAL_STATE,
        maxDurationSeconds: state.maxDurationSeconds,
      };
  }
}

/**
 * Sequence numbers make stale permission, camera, recording, and file-adoption
 * completions inert after close, background, unmount, or a scope-key remount.
 */
export type RecordingOperationFence = {
  begin: () => number;
  invalidate: () => void;
  isCurrent: (token: number) => boolean;
};

export function createRecordingOperationFence(): RecordingOperationFence {
  let generation = 0;
  return {
    begin: () => {
      generation += 1;
      return generation;
    },
    invalidate: () => {
      generation += 1;
    },
    isCurrent: (token) => token === generation,
  };
}

/**
 * Native maxFileSize is a guard, not a codec guarantee. Reserve 22% for audio,
 * mux/container variation, and device behavior, then cap 720p H.264 video at a
 * conservative 2.4 Mbps. iOS receives avc1 in recording options so Expo honors
 * the requested bitrate.
 */
export function conservativeRecordingVideoBitrate(
  maxBytes: number,
  durationSeconds: RecordingDuration,
): number {
  const safeBytes = Number.isFinite(maxBytes)
    ? Math.max(0, Math.floor(maxBytes))
    : 0;
  const totalBitsPerSecond = Math.floor(
    (safeBytes * 8 * 0.78) / durationSeconds,
  );
  const audioBitsPerSecond = 96_000;
  return Math.max(
    64_000,
    Math.min(2_400_000, totalBitsPerSecond - audioBitsPerSecond),
  );
}

export function effectiveRecordingByteLimit(
  requestedMaxBytes: number,
  hardMaxBytes: number,
): number {
  const requested = Number.isFinite(requestedMaxBytes)
    ? Math.max(0, Math.floor(requestedMaxBytes))
    : 0;
  const hard = Number.isFinite(hardMaxBytes)
    ? Math.max(0, Math.floor(hardMaxBytes))
    : 0;
  return Math.min(requested, hard);
}

export function nativeRecordingOptions(
  maxDurationSeconds: RecordingDuration,
  maxFileSize: number,
): {
  maxDuration: RecordingDuration;
  maxFileSize: number;
  codec: "avc1";
} {
  return {
    maxDuration: maxDurationSeconds,
    maxFileSize,
    codec: "avc1",
  };
}

/**
 * A late camera result is still passed through the app-owned file adopter so it
 * can remove camera-cache output. If ownership became stale while it was being
 * inspected/adopted, delete only the adopted app-owned URI and never a library
 * URI.
 */
export async function prepareCaptureForCurrentOperation({
  fence,
  token,
  uri,
  maxDurationSeconds,
  maxBytes,
  prepare,
  deleteOwned,
}: {
  fence: RecordingOperationFence;
  token: number;
  uri: string;
  maxDurationSeconds: RecordingDuration;
  maxBytes: number;
  prepare: (
    uri: string,
    maxDurationSeconds: RecordingDuration,
    maxBytes: number,
  ) => Promise<RecordedVideoDraft>;
  deleteOwned: (uri: string) => Promise<void>;
}): Promise<RecordedVideoDraft | null> {
  const draft = await prepare(uri, maxDurationSeconds, maxBytes);
  if (fence.isCurrent(token)) return draft;
  await deleteOwned(draft.localUri).catch(() => undefined);
  return null;
}

export async function deleteOwnedRecordingDraft(
  draft: RecordedVideoDraft | null,
  deleteOwned: (uri: string) => Promise<void>,
): Promise<void> {
  if (!draft) return;
  await deleteOwned(draft.localUri).catch(() => undefined);
}
