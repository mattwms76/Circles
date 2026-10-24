import type { PlatformStatus } from "@/shared/platform-settings";
import type { CreateMode } from "@/lib/feed-ui-helpers";

/** Advisory UX only. Every restricted write is independently checked by the API. */
export function platformCreationIssue(
  status: PlatformStatus | undefined,
  mode: CreateMode,
  hasMedia = false,
): string | null {
  if (!status) {
    return mode !== "post" || hasMedia
      ? "Checking creation availability. Please try again shortly."
      : null;
  }
  if (status.integration === "inactive") return null;
  if (!status.feature_readiness || !status.settings) {
    return mode !== "post" || hasMedia
      ? "Creation settings are temporarily unavailable. Please try again."
      : null;
  }
  if (mode === "circle" && !status.settings.circleCreationEnabled) {
    return "Creating new circles is temporarily paused.";
  }
  if (mode === "live" && !status.settings.liveStreamingEnabled) {
    return "Starting new live conversations is temporarily paused.";
  }
  return null;
}

export function platformUploadLimitMb(
  status: PlatformStatus | undefined,
): number {
  return status?.integration === "active" &&
    status.feature_readiness &&
    status.settings
    ? status.settings.maxUploadMb
    : 20;
}
