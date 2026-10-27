import { describe, expect, it, vi } from "vitest";
import type { RecordedVideoDraft } from "../shared/recorded-video";
import {
  canChangeRecorderDuration,
  canSwitchRecorderCamera,
  conservativeRecordingVideoBitrate,
  createInitialRecordingLifecycle,
  createRecordingOperationFence,
  effectiveRecordingByteLimit,
  nativeRecordingOptions,
  prepareCaptureForCurrentOperation,
  reduceRecordingLifecycle,
  shouldAutoStopRecording,
  shouldMountRecorderCamera,
} from "../lib/recording-lifecycle";

function readyLifecycle() {
  let state = createInitialRecordingLifecycle();
  state = reduceRecordingLifecycle(state, {
    type: "begin-permission-request",
  });
  state = reduceRecordingLifecycle(state, { type: "permissions-granted" });
  state = reduceRecordingLifecycle(state, {
    type: "camera-ready",
    cameraInstance: state.cameraInstance,
  });
  return state;
}

describe("recording lifecycle state machine", () => {
  it("defaults to 30 seconds and does not mount camera before the member starts permission flow", () => {
    const state = createInitialRecordingLifecycle();

    expect(state.maxDurationSeconds).toBe(30);
    expect(shouldMountRecorderCamera(state)).toBe(false);
    expect(canChangeRecorderDuration(state)).toBe(true);
  });

  it("requires permission and camera readiness before recording, with a camera-only capture mount", () => {
    let state = createInitialRecordingLifecycle();
    state = reduceRecordingLifecycle(state, {
      type: "begin-permission-request",
    });
    expect(state.phase).toBe("requesting-permission");
    expect(shouldMountRecorderCamera(state)).toBe(false);

    state = reduceRecordingLifecycle(state, { type: "permissions-granted" });
    expect(state.phase).toBe("camera-loading");
    expect(shouldMountRecorderCamera(state)).toBe(true);

    const earlyStart = reduceRecordingLifecycle(state, {
      type: "start-recording",
    });
    expect(earlyStart).toEqual(state);

    state = reduceRecordingLifecycle(state, {
      type: "camera-ready",
      cameraInstance: state.cameraInstance,
    });
    state = reduceRecordingLifecycle(state, { type: "start-recording" });
    expect(state.phase).toBe("recording");
    expect(shouldMountRecorderCamera(state)).toBe(true);

    state = reduceRecordingLifecycle(state, { type: "request-stop" });
    expect(state.phase).toBe("finalizing");
    // The native view remains mounted only until recordAsync settles. This
    // prevents unmounting it from racing the platform's stop/finalize path.
    expect(shouldMountRecorderCamera(state)).toBe(true);
    state = reduceRecordingLifecycle(state, { type: "capture-received" });
    expect(state.phase).toBe("preparing");
    expect(shouldMountRecorderCamera(state)).toBe(false);
  });

  it("allows only 30 or 60 seconds before recording and locks duration/front-back changes in flight", () => {
    let state = readyLifecycle();
    state = reduceRecordingLifecycle(state, {
      type: "select-duration",
      duration: 60,
    });
    expect(state.maxDurationSeconds).toBe(60);
    expect(canSwitchRecorderCamera(state)).toBe(true);

    state = reduceRecordingLifecycle(state, { type: "switch-camera" });
    expect(state.facing).toBe("front");
    expect(state.phase).toBe("camera-loading");
    expect(canSwitchRecorderCamera(state)).toBe(false);

    state = reduceRecordingLifecycle(state, {
      type: "camera-ready",
      cameraInstance: state.cameraInstance,
    });
    state = reduceRecordingLifecycle(state, { type: "start-recording" });
    const lockedDuration = reduceRecordingLifecycle(state, {
      type: "select-duration",
      duration: 30,
    });
    const lockedFacing = reduceRecordingLifecycle(state, {
      type: "switch-camera",
    });

    expect(lockedDuration).toEqual(state);
    expect(lockedFacing).toEqual(state);
    expect(canChangeRecorderDuration(state)).toBe(false);
  });

  it("ignores duplicate or late phase events and does not restore camera for preview", () => {
    let state = readyLifecycle();
    const duplicateReady = reduceRecordingLifecycle(state, {
      type: "camera-ready",
      cameraInstance: state.cameraInstance,
    });
    expect(duplicateReady).toEqual(state);

    state = reduceRecordingLifecycle(state, { type: "start-recording" });
    state = reduceRecordingLifecycle(state, { type: "request-stop" });
    state = reduceRecordingLifecycle(state, { type: "capture-received" });
    state = reduceRecordingLifecycle(state, { type: "capture-prepared" });
    expect(state.phase).toBe("preview");
    expect(shouldMountRecorderCamera(state)).toBe(false);

    const duplicateCapture = reduceRecordingLifecycle(state, {
      type: "capture-prepared",
    });
    expect(duplicateCapture).toEqual(state);
  });

  it("moves a valid preview into a new camera session for retake and transfers only from preview", () => {
    let state = readyLifecycle();
    state = reduceRecordingLifecycle(state, { type: "start-recording" });
    state = reduceRecordingLifecycle(state, { type: "capture-received" });
    state = reduceRecordingLifecycle(state, { type: "capture-prepared" });
    const previewCameraInstance = state.cameraInstance;

    const transferred = reduceRecordingLifecycle(state, { type: "use" });
    expect(transferred.phase).toBe("transferred");

    state = reduceRecordingLifecycle(state, { type: "retake" });
    expect(state.phase).toBe("camera-loading");
    expect(state.cameraInstance).toBe(previewCameraInstance + 1);
    expect(shouldMountRecorderCamera(state)).toBe(true);
  });
});

describe("recording limits and mocked native seams", () => {
  it("reserves a small finalization margin without relaxing the selected native duration cap", () => {
    expect(shouldAutoStopRecording(29_749, 30)).toBe(false);
    expect(shouldAutoStopRecording(29_750, 30)).toBe(true);
    expect(shouldAutoStopRecording(59_750, 60)).toBe(true);
    expect(shouldAutoStopRecording(Number.NaN, 30)).toBe(false);
    expect(nativeRecordingOptions(30, 1000).maxDuration).toBe(30);
  });
  it("caps every native capture at the effective application limit and uses H.264 options", () => {
    const twentyMiB = 20 * 1024 * 1024;
    expect(effectiveRecordingByteLimit(twentyMiB + 1, twentyMiB)).toBe(
      twentyMiB,
    );
    expect(effectiveRecordingByteLimit(-1, twentyMiB)).toBe(0);
    expect(nativeRecordingOptions(60, twentyMiB)).toEqual({
      maxDuration: 60,
      maxFileSize: twentyMiB,
      codec: "avc1",
    });

    // The 60-second bitrate leaves audio/container headroom and stays under the
    // intentional 720p H.264 ceiling; this is source policy, not a device claim.
    expect(
      conservativeRecordingVideoBitrate(twentyMiB, 60),
    ).toBeLessThanOrEqual(2_400_000);
    expect(conservativeRecordingVideoBitrate(twentyMiB, 60)).toBeGreaterThan(0);
  });

  it("makes earlier permission/capture completions stale after invalidation", () => {
    const fence = createRecordingOperationFence();
    const first = fence.begin();
    const second = fence.begin();

    expect(fence.isCurrent(first)).toBe(false);
    expect(fence.isCurrent(second)).toBe(true);
    fence.invalidate();
    expect(fence.isCurrent(second)).toBe(false);
  });

  it("adopts then deletes a late camera result through mocked app-owned file seams", async () => {
    const fence = createRecordingOperationFence();
    const token = fence.begin();
    const draft: RecordedVideoDraft = {
      localUri: "file:///app-owned-recordings/late.mp4",
      mimeType: "video/mp4",
      fileSize: 1_024,
      durationMs: 1_000,
      width: 1280,
      height: 720,
      maxDurationSeconds: 30,
    };
    let resolvePrepare!: (value: RecordedVideoDraft) => void;
    const prepare = vi.fn(
      () =>
        new Promise<RecordedVideoDraft>((resolve) => {
          resolvePrepare = resolve;
        }),
    );
    const deleteOwned = vi.fn(async () => undefined);

    const pending = prepareCaptureForCurrentOperation({
      fence,
      token,
      uri: "file:///camera-cache/late.mp4",
      maxDurationSeconds: 30,
      maxBytes: 2_000,
      prepare,
      deleteOwned,
    });
    fence.invalidate();
    resolvePrepare(draft);

    await expect(pending).resolves.toBeNull();
    expect(prepare).toHaveBeenCalledWith(
      "file:///camera-cache/late.mp4",
      30,
      2_000,
    );
    expect(deleteOwned).toHaveBeenCalledWith(draft.localUri);
  });

  it("retains a current prepared draft instead of deleting it before explicit Retake, close, or Use", async () => {
    const fence = createRecordingOperationFence();
    const token = fence.begin();
    const draft: RecordedVideoDraft = {
      localUri: "file:///app-owned-recordings/current.mp4",
      mimeType: "video/mp4",
      fileSize: 1_024,
      durationMs: 1_000,
      width: 1280,
      height: 720,
      maxDurationSeconds: 30,
    };
    const prepare = vi.fn(async () => draft);
    const deleteOwned = vi.fn(async () => undefined);

    await expect(
      prepareCaptureForCurrentOperation({
        fence,
        token,
        uri: "file:///camera-cache/current.mp4",
        maxDurationSeconds: 30,
        maxBytes: 2_000,
        prepare,
        deleteOwned,
      }),
    ).resolves.toEqual(draft);
    expect(deleteOwned).not.toHaveBeenCalled();
  });
});
