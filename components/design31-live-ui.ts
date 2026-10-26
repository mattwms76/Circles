import { UI_ACCESSIBLE_COLORS } from "../lib/ui-accessibility";
import type { StatusTone } from "../lib/status-announcement";

export type LiveHostLease = Readonly<{
  streamId: number;
  generation: number;
}>;

type LiveHostJoinLeaseInput = Readonly<{
  host: boolean;
  streamId: number;
  generation: number;
  joinedHostId: number;
  currentUserId: number | null;
}>;

type LiveHostLeaseAcceptanceInput = Readonly<{
  streamId: number;
  currentLease: LiveHostLease | null;
  candidate: LiveHostLease;
}>;

type CurrentLiveHostEndInput = Readonly<{
  host: boolean;
  streamId: number;
  lease: LiveHostLease | null;
}>;

export type LiveMediaStatusPresentation = Readonly<{
  message: string | null;
  tone: StatusTone;
  backplateColor: string;
  foregroundColor: string;
}>;

/**
 * A fully opaque surface keeps foreground status copy readable over arbitrary
 * camera or remote-video pixels. StatusMessage owns the matching foreground.
 */
export const LIVE_MEDIA_STATUS_BACKPLATE = "#FFFFFF";

const LIVE_MEDIA_PROGRESS_STATUSES = new Set([
  "Preparing camera…",
  "Joining live stream…",
  "Waiting for host video…",
  "Rejoining live stream…",
  "Reconnecting live video…",
]);

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isLiveHostLease(value: LiveHostLease | null): value is LiveHostLease {
  return (
    value !== null &&
    isPositiveInteger(value.streamId) &&
    isPositiveInteger(value.generation)
  );
}

/**
 * Converts only an authenticated join result for the current host into an end
 * authority. A listing-derived host label, omitted generation, or mismatched
 * join host fails closed.
 */
export function liveHostLeaseFromJoin(
  input: LiveHostJoinLeaseInput,
): LiveHostLease | null {
  if (
    !input.host ||
    !isPositiveInteger(input.streamId) ||
    !isPositiveInteger(input.generation) ||
    !isPositiveInteger(input.joinedHostId) ||
    input.currentUserId !== input.joinedHostId
  ) {
    return null;
  }

  return { streamId: input.streamId, generation: input.generation };
}

/**
 * Reject a stale callback from a superseded media lifecycle without downgrading
 * the route's newer, current-generation end authority.
 */
export function acceptCurrentLiveHostLease({
  streamId,
  currentLease,
  candidate,
}: LiveHostLeaseAcceptanceInput): LiveHostLease | null {
  if (
    !isPositiveInteger(streamId) ||
    !isLiveHostLease(candidate) ||
    candidate.streamId !== streamId
  ) {
    return currentLease;
  }

  if (
    currentLease?.streamId === streamId &&
    currentLease.generation > candidate.generation
  ) {
    return currentLease;
  }

  return candidate;
}

/**
 * Produce an end payload only for the route's current host and its exact,
 * authenticated join generation. The server keeps its own authoritative CAS.
 */
export function currentLiveHostEndInput({
  host,
  streamId,
  lease,
}: CurrentLiveHostEndInput): { streamId: number; generation: number } | null {
  if (
    !host ||
    !isPositiveInteger(streamId) ||
    !isLiveHostLease(lease) ||
    lease.streamId !== streamId
  ) {
    return null;
  }

  return { streamId, generation: lease.generation };
}

export function liveMediaStatusPresentation(
  status: string,
): LiveMediaStatusPresentation {
  const message = status === "Live" ? null : status;
  const tone: StatusTone =
    message === null || LIVE_MEDIA_PROGRESS_STATUSES.has(status)
      ? "info"
      : "error";

  return {
    message,
    tone,
    backplateColor: LIVE_MEDIA_STATUS_BACKPLATE,
    foregroundColor:
      tone === "error"
        ? UI_ACCESSIBLE_COLORS.action
        : UI_ACCESSIBLE_COLORS.secondary,
  };
}
