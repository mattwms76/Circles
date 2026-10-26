import type { ImagePickerAsset } from "expo-image-picker";
import { isCircleCoverMime, type CreateMode } from "./feed-ui-helpers";
import { supportedMime, type SupportedMime } from "./media";
import type { Batch3AccountResourceOperation } from "./batch3-account-resource-scope";

export type A26CircleChatOperation = {
  operation: Batch3AccountResourceOperation;
  circleId: number;
  circleName: string;
};

function validPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * Captures the exact mounted actor/circle operation that initiated Circle Chat.
 * Completion must be checked against this value before it changes local UI or
 * navigation state.
 */
export function captureA26CircleChatOperation({
  mountedOperation,
  currentScope,
  circleId,
  circleName,
}: {
  mountedOperation: Batch3AccountResourceOperation | null;
  currentScope: string | null;
  circleId: number;
  circleName: string | null | undefined;
}): A26CircleChatOperation | null {
  if (
    !mountedOperation ||
    mountedOperation.scope !== currentScope ||
    !validPositiveSafeInteger(circleId)
  ) {
    return null;
  }

  return {
    operation: mountedOperation,
    circleId,
    circleName: circleName || "Circle chat",
  };
}

/**
 * A successful chat-open response may navigate only while the initiating
 * account/circle operation is still the mounted current operation.
 */
export function isCurrentA26CircleChatOperation({
  capturedOperation,
  mountedOperation,
  currentScope,
}: {
  capturedOperation: A26CircleChatOperation;
  mountedOperation: Batch3AccountResourceOperation | null;
  currentScope: string | null;
}): boolean {
  return (
    currentScope === capturedOperation.operation.scope &&
    mountedOperation !== null &&
    mountedOperation.scope === capturedOperation.operation.scope &&
    mountedOperation.generation === capturedOperation.operation.generation
  );
}

/** Prevents rapid duplicate Circle Chat activations before a disabled render. */
export function createA26CircleChatSingleFlight() {
  let activeOperationKey: string | null = null;

  function operationKey(operation: A26CircleChatOperation): string {
    return `${operation.operation.scope}:${operation.operation.generation}:chat`;
  }

  return {
    start(operation: A26CircleChatOperation): boolean {
      if (activeOperationKey !== null) return false;
      activeOperationKey = operationKey(operation);
      return true;
    },
    finish(operation: A26CircleChatOperation): void {
      if (activeOperationKey === operationKey(operation)) {
        activeOperationKey = null;
      }
    },
  };
}

export type A26MembershipIntent = "join" | "cancel-request" | "leave";

export function a26MembershipIntent(
  joined: boolean,
  priorRole: string | null | undefined,
): A26MembershipIntent {
  if (joined) return "join";
  return priorRole === "pending" ? "cancel-request" : "leave";
}

/** Uses the requested exit action when a successful server result has no role. */
export function a26MembershipNotice({
  intent,
  joined,
  role,
}: {
  intent: A26MembershipIntent;
  joined: boolean;
  role: string | null | undefined;
}): string {
  if (role === "pending") return "Your request has been sent to the owner.";
  if (joined) return "You’re in. Make yourself at home.";
  return intent === "cancel-request"
    ? "Your membership request was cancelled."
    : "You’ve left this circle.";
}

/** Radio changes must be blocked by both rendered busy state and the sync lock. */
export function canChangeA26IntroductionCircle({
  controlsBusy,
  operationLocked,
}: {
  controlsBusy: boolean;
  operationLocked: boolean;
}): boolean {
  return !controlsBusy && !operationLocked;
}

/** Captures a valid selected target before asynchronous onboarding completion. */
export function captureA26IntroductionCircleId(
  circleId: number | null | undefined,
): number | null {
  return typeof circleId === "number" && validPositiveSafeInteger(circleId)
    ? circleId
    : null;
}

export type A26PickedComposerMedia =
  | { kind: "valid"; mimeType: SupportedMime }
  | { kind: "invalid"; message: string };

const unsupportedMediaMessage =
  "Choose a JPEG, PNG, WebP photo or MP4 video. Other formats aren’t supported yet.";

/**
 * Validates a successful picker selection. Picker-launch permission failures
 * are deliberately handled by the caller, not converted into this result.
 */
export function validateA26PickedComposerMedia({
  asset,
  mode,
  maxUploadMb,
}: {
  asset: ImagePickerAsset | undefined;
  mode: CreateMode;
  maxUploadMb: number;
}): A26PickedComposerMedia {
  if (!asset) {
    return {
      kind: "invalid",
      message:
        "We couldn’t use that media selection. Choose a supported file and try again.",
    };
  }

  const maxUploadBytes = maxUploadMb * 1024 * 1024;
  if (
    Number.isFinite(maxUploadBytes) &&
    maxUploadBytes > 0 &&
    typeof asset.fileSize === "number" &&
    asset.fileSize > maxUploadBytes
  ) {
    return {
      kind: "invalid",
      message: `Choose media no larger than ${maxUploadMb} MiB.`,
    };
  }

  let mimeType: SupportedMime;
  try {
    mimeType = supportedMime(asset);
  } catch (error) {
    return {
      kind: "invalid",
      message:
        error instanceof Error && error.message
          ? error.message
          : unsupportedMediaMessage,
    };
  }

  if (mode === "circle" && !isCircleCoverMime(mimeType)) {
    return {
      kind: "invalid",
      message: "Circle covers need a JPEG, PNG, or WebP photo.",
    };
  }

  return { kind: "valid", mimeType };
}
