import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Camera, CameraView } from "expo-camera";
import { C, Button, Icon, IconButton, T } from "@/components/circles-ui";
import { RecordedVideoPreview } from "@/components/recorded-video-preview";
import {
  MAX_RECORDED_VIDEO_BYTES,
  RECORDING_DURATIONS,
  type RecordedVideoDraft,
  type RecordingDuration,
} from "@/shared/recorded-video";
import {
  deleteRecordedVideo,
  prepareRecordedVideo,
} from "@/lib/recorded-video-files";
import {
  canChangeRecorderDuration,
  canSwitchRecorderCamera,
  conservativeRecordingVideoBitrate,
  createInitialRecordingLifecycle,
  createRecordingOperationFence,
  deleteOwnedRecordingDraft,
  effectiveRecordingByteLimit,
  nativeRecordingOptions,
  prepareCaptureForCurrentOperation,
  reduceRecordingLifecycle,
  shouldAutoStopRecording,
  shouldMountRecorderCamera,
  type RecordingLifecycleEvent,
  type RecordingLifecycleState,
} from "@/lib/recording-lifecycle";

export type VideoRecorderProps = {
  maxBytes: number;
  onUse: (draft: RecordedVideoDraft) => void;
  onClose: () => void;
};

type RecorderFlight =
  | "idle"
  | "permission"
  | "recording"
  | "stopping"
  | "preparing";

const BACKGROUND_DISCARD_MESSAGE =
  "Recording was discarded when Circles went to the background. You can start again.";

function friendlyRecorderError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("storage") || message.includes("space")) {
    return "Your device does not have enough free space to record this video.";
  }
  if (message.includes("permission") || message.includes("denied")) {
    return "Camera or microphone access changed. Check your device settings and try again.";
  }
  return "We couldn’t finish that recording. Please try again.";
}

/** File adoption and MP4 inspection deliberately expose only these safe messages. */
function safePreparedVideoError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  const safePrefixes = [
    "The video upload limit is unavailable.",
    "This video file could not be read",
    "This video file changed",
    "Keep your recorded video under the allowed size.",
    "This recording is no longer available.",
    "This recording could not be prepared.",
    "This recording changed after preview.",
    "This recording is longer than the selected time limit.",
    "This MP4 file is incomplete or damaged.",
    "This fragmented MP4 recording is not supported.",
    "Choose a standard MP4 video.",
    "This video must use H.264 video with AAC audio.",
    "This video is missing the metadata needed to publish it.",
  ];
  return safePrefixes.some((prefix) => message.startsWith(prefix))
    ? message
    : "We couldn’t prepare that video. Record it again and try again.";
}

function secondsLabel(value: number): string {
  return `${String(Math.max(0, Math.min(99, value))).padStart(2, "0")}s`;
}

function DurationChoice({
  duration,
  selected,
  disabled,
  onPress,
}: {
  duration: RecordingDuration;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${duration} second maximum recording length`}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.durationChoice,
        selected && styles.durationChoiceSelected,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <T
        style={[
          styles.durationChoiceText,
          selected && styles.durationChoiceTextSelected,
        ]}
      >
        {duration}s
      </T>
    </Pressable>
  );
}

/**
 * Native-only capture UI. The caller keys this component by authenticated
 * composer/account scope; its generation fence makes every late native result
 * inert even before the parent unmount completes.
 */
export function VideoRecorder({
  maxBytes,
  onUse,
  onClose,
}: VideoRecorderProps) {
  const cameraRef = useRef<CameraView | null>(null);
  const [lifecycle, setLifecycle] = useState<RecordingLifecycleState>(
    createInitialRecordingLifecycle,
  );
  const lifecycleRef = useRef<RecordingLifecycleState>(lifecycle);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [previewDraft, setPreviewDraft] = useState<RecordedVideoDraft | null>(
    null,
  );
  const mountedRef = useRef(false);
  const fenceRef = useRef(createRecordingOperationFence());
  const flightRef = useRef<RecorderFlight>("idle");
  const ownedDraftRef = useRef<RecordedVideoDraft | null>(null);
  const foregroundRef = useRef(AppState.currentState === "active");

  const effectiveMaxBytes = useMemo(
    () => effectiveRecordingByteLimit(maxBytes, MAX_RECORDED_VIDEO_BYTES),
    [maxBytes],
  );
  const videoBitrate = useMemo(
    () =>
      conservativeRecordingVideoBitrate(
        effectiveMaxBytes,
        lifecycle.maxDurationSeconds,
      ),
    [effectiveMaxBytes, lifecycle.maxDurationSeconds],
  );

  const transition = useCallback((event: RecordingLifecycleEvent) => {
    const next = reduceRecordingLifecycle(lifecycleRef.current, event);
    lifecycleRef.current = next;
    setLifecycle(next);
    if (next.phase !== "recording") setElapsedSeconds(0);
    return next;
  }, []);

  const stopNativeCamera = useCallback(() => {
    try {
      const stopped = cameraRef.current?.stopRecording();
      void Promise.resolve(stopped).catch(() => undefined);
    } catch {
      // The recordAsync promise handles a genuine capture error. This best-effort
      // stop is also used after the camera has already been unmounted.
    }
  }, []);

  const releaseOwnedDraft = useCallback((draft: RecordedVideoDraft | null) => {
    void deleteOwnedRecordingDraft(draft, deleteRecordedVideo);
  }, []);

  const discard = useCallback(
    (message: string, closeAfterDiscard = false) => {
      fenceRef.current.invalidate();
      flightRef.current = "idle";
      stopNativeCamera();
      const draft = ownedDraftRef.current;
      ownedDraftRef.current = null;
      releaseOwnedDraft(draft);
      if (mountedRef.current) {
        setPreviewDraft(null);
        transition({ type: "backgrounded", message });
      }
      if (closeAfterDiscard) onClose();
    },
    [onClose, releaseOwnedDraft, stopNativeCamera, transition],
  );

  const handleCameraFailure = useCallback(
    (message: string) => {
      fenceRef.current.invalidate();
      flightRef.current = "idle";
      stopNativeCamera();
      if (mountedRef.current) transition({ type: "failure", message });
    },
    [stopNativeCamera, transition],
  );

  useEffect(() => {
    // This setup intentionally resets after development Strict Mode cleanup.
    mountedRef.current = true;
    const fence = fenceRef.current;
    return () => {
      mountedRef.current = false;
      fence.invalidate();
      flightRef.current = "idle";
      stopNativeCamera();
      const draft = ownedDraftRef.current;
      ownedDraftRef.current = null;
      releaseOwnedDraft(draft);
    };
  }, [releaseOwnedDraft, stopNativeCamera]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      foregroundRef.current = nextState === "active";
      if (nextState === "active") return;
      const current = lifecycleRef.current;
      if (current.phase === "idle" || current.phase === "transferred") return;
      discard(BACKGROUND_DISCARD_MESSAGE);
    });
    return () => subscription.remove();
  }, [discard]);

  const requestPermissions = useCallback(async () => {
    const current = lifecycleRef.current;
    if (
      !foregroundRef.current ||
      (current.phase !== "idle" &&
        current.phase !== "permission-denied" &&
        current.phase !== "error") ||
      flightRef.current !== "idle"
    ) {
      return;
    }
    if (effectiveMaxBytes <= 0) {
      transition({
        type: "failure",
        message:
          "Video recording is unavailable because this post has no usable upload limit.",
      });
      return;
    }

    flightRef.current = "permission";
    const token = fenceRef.current.begin();
    transition({ type: "begin-permission-request" });
    try {
      // No permission request occurs on mount: both prompts begin only after the
      // member deliberately starts native recording.
      const cameraPermission = await Camera.requestCameraPermissionsAsync();
      if (
        !mountedRef.current ||
        !foregroundRef.current ||
        !fenceRef.current.isCurrent(token)
      )
        return;
      if (!cameraPermission.granted) {
        transition({
          type: "permissions-denied",
          canAskAgain: cameraPermission.canAskAgain,
        });
        return;
      }

      const microphonePermission =
        await Camera.requestMicrophonePermissionsAsync();
      if (
        !mountedRef.current ||
        !foregroundRef.current ||
        !fenceRef.current.isCurrent(token)
      )
        return;
      if (!microphonePermission.granted) {
        transition({
          type: "permissions-denied",
          canAskAgain:
            cameraPermission.canAskAgain && microphonePermission.canAskAgain,
        });
        return;
      }
      transition({ type: "permissions-granted" });
    } catch {
      if (
        !mountedRef.current ||
        !foregroundRef.current ||
        !fenceRef.current.isCurrent(token)
      )
        return;
      transition({
        type: "failure",
        message:
          "We couldn’t request camera and microphone access. Please try again.",
      });
    } finally {
      if (fenceRef.current.isCurrent(token)) flightRef.current = "idle";
    }
  }, [effectiveMaxBytes, transition]);

  const startRecording = useCallback(async () => {
    const current = lifecycleRef.current;
    if (
      !foregroundRef.current ||
      current.phase !== "camera-ready" ||
      flightRef.current !== "idle" ||
      !cameraRef.current
    ) {
      return;
    }
    if (effectiveMaxBytes <= 0) {
      handleCameraFailure(
        "Video recording is unavailable because this post has no usable upload limit.",
      );
      return;
    }

    flightRef.current = "recording";
    const token = fenceRef.current.begin();
    const camera = cameraRef.current;
    const duration = current.maxDurationSeconds;
    let preparing = false;
    transition({ type: "start-recording" });

    try {
      const result = await camera.recordAsync(
        nativeRecordingOptions(duration, effectiveMaxBytes),
      );
      if (!result?.uri)
        throw new Error("The camera did not return a video file.");

      if (
        mountedRef.current &&
        foregroundRef.current &&
        fenceRef.current.isCurrent(token)
      ) {
        flightRef.current = "preparing";
        preparing = true;
        transition({ type: "capture-received" });
      }

      const draft = await prepareCaptureForCurrentOperation({
        fence: fenceRef.current,
        token,
        uri: result.uri,
        maxDurationSeconds: duration,
        maxBytes: effectiveMaxBytes,
        prepare: prepareRecordedVideo,
        deleteOwned: deleteRecordedVideo,
      });
      if (
        !draft ||
        !mountedRef.current ||
        !foregroundRef.current ||
        !fenceRef.current.isCurrent(token)
      ) {
        return;
      }
      ownedDraftRef.current = draft;
      setPreviewDraft(draft);
      transition({ type: "capture-prepared" });
    } catch (error) {
      if (
        !mountedRef.current ||
        !foregroundRef.current ||
        !fenceRef.current.isCurrent(token)
      )
        return;
      handleCameraFailure(
        preparing
          ? safePreparedVideoError(error)
          : friendlyRecorderError(error),
      );
    } finally {
      if (fenceRef.current.isCurrent(token)) flightRef.current = "idle";
    }
  }, [effectiveMaxBytes, handleCameraFailure, transition]);

  const stopRecording = useCallback(() => {
    if (
      lifecycleRef.current.phase !== "recording" ||
      flightRef.current !== "recording"
    ) {
      return;
    }
    // Set both guards before calling the native imperative API; two quick taps
    // cannot issue duplicate stops even before React has rendered finalizing.
    flightRef.current = "stopping";
    transition({ type: "request-stop" });
    stopNativeCamera();
  }, [stopNativeCamera, transition]);

  useEffect(() => {
    if (lifecycle.phase !== "recording") return;
    const startedAt = performance.now();
    const updateTimer = () => {
      const elapsedMs = performance.now() - startedAt;
      setElapsedSeconds(
        Math.min(
          lifecycle.maxDurationSeconds,
          Math.max(0, Math.floor(elapsedMs / 1000)),
        ),
      );
      if (shouldAutoStopRecording(elapsedMs, lifecycle.maxDurationSeconds))
        stopRecording();
    };
    updateTimer();
    const timer = setInterval(updateTimer, 100);
    return () => clearInterval(timer);
  }, [lifecycle.maxDurationSeconds, lifecycle.phase, stopRecording]);

  const retake = useCallback(() => {
    if (
      !foregroundRef.current ||
      lifecycleRef.current.phase !== "preview" ||
      flightRef.current !== "idle"
    ) {
      return;
    }
    const draft = ownedDraftRef.current;
    ownedDraftRef.current = null;
    setPreviewDraft(null);
    transition({ type: "retake" });
    releaseOwnedDraft(draft);
  }, [releaseOwnedDraft, transition]);

  const useDraft = useCallback(() => {
    const draft = ownedDraftRef.current;
    if (
      !foregroundRef.current ||
      lifecycleRef.current.phase !== "preview" ||
      flightRef.current !== "idle" ||
      !draft
    ) {
      return;
    }
    // Ownership changes before notifying the parent because onUse can close and
    // synchronously unmount this component.
    ownedDraftRef.current = null;
    setPreviewDraft(null);
    transition({ type: "use" });
    onUse(draft);
  }, [onUse, transition]);

  const openSettings = useCallback(() => {
    if (!foregroundRef.current) return;
    void Linking.openSettings().catch(() => {
      if (!mountedRef.current || !foregroundRef.current) return;
      transition({
        type: "failure",
        message:
          "We couldn’t open device settings. You can change camera and microphone access there, then try again.",
      });
    });
  }, [transition]);

  const selectDuration = useCallback(
    (duration: RecordingDuration) => {
      if (!foregroundRef.current) return;
      transition({ type: "select-duration", duration });
    },
    [transition],
  );

  const switchCamera = useCallback(() => {
    if (!foregroundRef.current) return;
    transition({ type: "switch-camera" });
  }, [transition]);

  const cameraInstance = lifecycle.cameraInstance;
  const cameraMounted = shouldMountRecorderCamera(lifecycle);
  const cameraControlsReady = lifecycle.phase === "camera-ready";
  const cameraLoading = lifecycle.phase === "camera-loading";
  const durationChangeAllowed = canChangeRecorderDuration(lifecycle);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <T style={{ fontWeight: "800", fontSize: 18 }}>Record a video</T>
          <T style={styles.subtle}>
            A local draft only — nothing is posted yet.
          </T>
        </View>
        <IconButton
          icon="close"
          label="Close video recorder"
          onPress={() => discard("Video recording was discarded.", true)}
        />
      </View>

      {(lifecycle.phase === "idle" ||
        lifecycle.phase === "permission-denied" ||
        lifecycle.phase === "error") && (
        <View style={styles.infoPanel}>
          <View style={styles.infoIcon} accessible={false}>
            <Icon name="videocam-outline" size={28} color={C.coral} />
          </View>
          <T style={styles.infoTitle}>
            {lifecycle.phase === "permission-denied"
              ? "Camera access is needed"
              : lifecycle.phase === "error"
                ? "Ready when you are"
                : "Share a small moment"}
          </T>
          <T style={styles.infoCopy}>
            Record a 720p video with sound. The recording stays on this device
            until you choose Use video, then Publish.
          </T>
          {lifecycle.message && (
            <T accessibilityRole="alert" style={styles.errorText}>
              {lifecycle.message}
            </T>
          )}
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Maximum video duration"
            style={styles.durationRow}
          >
            {RECORDING_DURATIONS.map((duration) => (
              <DurationChoice
                key={duration}
                duration={duration}
                selected={lifecycle.maxDurationSeconds === duration}
                disabled={!durationChangeAllowed}
                onPress={() => selectDuration(duration)}
              />
            ))}
          </View>
          {lifecycle.phase === "permission-denied" && (
            <Button
              title="Open device settings"
              secondary
              icon="settings-outline"
              onPress={openSettings}
            />
          )}
          <Button
            title={
              lifecycle.phase === "permission-denied"
                ? lifecycle.permissionCanAskAgain
                  ? "Try permissions again"
                  : "Check permissions again"
                : "Start camera"
            }
            icon="videocam-outline"
            onPress={() => void requestPermissions()}
          />
        </View>
      )}

      {cameraMounted && (
        <View style={styles.cameraShell}>
          <CameraView
            key={cameraInstance}
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={lifecycle.facing}
            mode="video"
            videoQuality="720p"
            videoBitrate={videoBitrate}
            onCameraReady={() => {
              if (!foregroundRef.current) return;
              transition({ type: "camera-ready", cameraInstance });
            }}
            onMountError={({ message }) => {
              if (
                !foregroundRef.current ||
                lifecycleRef.current.cameraInstance !== cameraInstance
              )
                return;
              // Native messages can include device/provider details; show only
              // the recoverable product message.
              void message;
              handleCameraFailure(
                "We couldn’t start the camera. Please try again.",
              );
            }}
          />
          <View style={styles.cameraTopBar} pointerEvents="box-none">
            <View style={styles.durationBadge}>
              <T style={styles.durationBadgeText}>
                Up to {lifecycle.maxDurationSeconds}s
              </T>
            </View>
            <IconButton
              icon={
                lifecycle.facing === "back"
                  ? "camera-reverse-outline"
                  : "camera-outline"
              }
              color="#fff"
              label="Switch camera"
              disabled={!canSwitchRecorderCamera(lifecycle)}
              onPress={switchCamera}
              style={styles.cameraIconButton}
            />
          </View>

          {cameraLoading && (
            <View style={styles.cameraOverlay} accessibilityRole="progressbar">
              <ActivityIndicator color="#fff" />
              <T style={styles.cameraOverlayText}>Starting camera…</T>
            </View>
          )}
          {lifecycle.phase === "finalizing" && (
            <View style={styles.cameraOverlay} accessibilityRole="progressbar">
              <ActivityIndicator color="#fff" />
              <T style={styles.cameraOverlayText}>Finishing your video…</T>
            </View>
          )}

          {cameraControlsReady && (
            <View style={styles.cameraControls}>
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel="Maximum video duration"
                style={styles.durationRow}
              >
                {RECORDING_DURATIONS.map((duration) => (
                  <DurationChoice
                    key={duration}
                    duration={duration}
                    selected={lifecycle.maxDurationSeconds === duration}
                    disabled={false}
                    onPress={() => selectDuration(duration)}
                  />
                ))}
              </View>
              <Button
                title="Start recording"
                icon="radio-outline"
                onPress={() => void startRecording()}
                style={styles.recordButton}
              />
            </View>
          )}

          {lifecycle.phase === "recording" && (
            <View style={styles.recordingControls}>
              <View accessibilityLiveRegion="polite" style={styles.timerBadge}>
                <View style={styles.recordingDot} accessible={false} />
                <T style={styles.timerText}>
                  {secondsLabel(elapsedSeconds)} /{" "}
                  {lifecycle.maxDurationSeconds}s
                </T>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Stop recording"
                accessibilityHint="Finishes the local video and opens a preview."
                onPress={stopRecording}
                style={({ pressed }) => [
                  styles.stopButton,
                  pressed && styles.stopButtonPressed,
                ]}
              >
                <View style={styles.stopSquare} accessible={false} />
                <T style={styles.stopButtonText}>Stop</T>
              </Pressable>
            </View>
          )}
        </View>
      )}

      {(lifecycle.phase === "finalizing" ||
        lifecycle.phase === "preparing") && (
        <View style={styles.finalizing} accessibilityRole="progressbar">
          <ActivityIndicator color={C.coral} />
          <T style={{ fontWeight: "700" }}>Finishing your video…</T>
          <T style={styles.subtle}>
            Checking the local MP4 before the preview opens.
          </T>
        </View>
      )}

      {lifecycle.phase === "preview" && previewDraft && (
        <RecordedVideoPreview
          uri={previewDraft.localUri}
          onRetake={retake}
          onUse={useDraft}
        />
      )}

      {lifecycle.phase === "transferred" && (
        <View style={styles.finalizing} accessibilityRole="progressbar">
          <ActivityIndicator color={C.coral} />
          <T style={styles.subtle}>Adding your video to the post…</T>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: C.paper,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 18,
    overflow: "hidden",
  },
  header: {
    minHeight: 60,
    paddingLeft: 16,
    paddingRight: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  subtle: { color: C.secondary, fontSize: 12, lineHeight: 18 },
  infoPanel: { alignItems: "center", gap: 12, padding: 22 },
  infoIcon: {
    alignItems: "center",
    backgroundColor: C.soft,
    borderRadius: 28,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  infoTitle: { fontSize: 19, fontWeight: "800", textAlign: "center" },
  infoCopy: {
    color: C.secondary,
    lineHeight: 20,
    maxWidth: 390,
    textAlign: "center",
  },
  errorText: {
    backgroundColor: C.soft,
    borderColor: C.coral,
    borderRadius: 10,
    borderWidth: 1,
    color: C.ink,
    paddingHorizontal: 12,
    paddingVertical: 9,
    textAlign: "center",
    width: "100%",
  },
  durationRow: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    width: "100%",
  },
  durationChoice: {
    alignItems: "center",
    backgroundColor: C.paper,
    borderColor: C.border,
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 74,
    paddingHorizontal: 14,
  },
  durationChoiceSelected: { backgroundColor: C.ink, borderColor: C.ink },
  durationChoiceText: { color: C.secondary, fontSize: 13, fontWeight: "700" },
  durationChoiceTextSelected: { color: "#fff" },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.74 },
  cameraShell: {
    aspectRatio: 9 / 16,
    backgroundColor: C.ink,
    maxHeight: 500,
    minHeight: 300,
    overflow: "hidden",
    position: "relative",
    width: "100%",
  },
  cameraTopBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    left: 10,
    position: "absolute",
    right: 10,
    top: 10,
  },
  durationBadge: {
    backgroundColor: "rgba(0,0,0,0.56)",
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  durationBadgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  cameraIconButton: { backgroundColor: "rgba(0,0,0,0.44)" },
  cameraOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.52)",
    bottom: 0,
    gap: 10,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  cameraOverlayText: { color: "#fff", fontWeight: "700" },
  cameraControls: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.54)",
    bottom: 0,
    gap: 12,
    left: 0,
    padding: 14,
    position: "absolute",
    right: 0,
  },
  recordButton: { minWidth: 210 },
  recordingControls: {
    alignItems: "center",
    bottom: 20,
    gap: 14,
    left: 0,
    position: "absolute",
    right: 0,
  },
  timerBadge: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.62)",
    borderRadius: 16,
    flexDirection: "row",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  recordingDot: {
    backgroundColor: C.coral,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  timerText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  stopButton: {
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 28,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    minHeight: 56,
    minWidth: 150,
    paddingHorizontal: 22,
  },
  stopButtonPressed: { opacity: 0.75 },
  stopSquare: {
    backgroundColor: C.coral,
    borderRadius: 3,
    height: 16,
    width: 16,
  },
  stopButtonText: { color: C.ink, fontWeight: "800" },
  finalizing: { alignItems: "center", gap: 9, padding: 28 },
});
