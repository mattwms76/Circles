export type LiveTurnIceServer = Readonly<{
  urls: readonly string[];
  username: string;
  credential: string;
  credentialType: "password";
}>;

/** The authenticated live.join response exposes this shape, never a shared secret. */
export type LiveTurnCredentials = Readonly<{
  iceServers: readonly LiveTurnIceServer[];
  expiresAt: string;
}>;

export type LiveIceConfiguration = Readonly<{
  iceServers: readonly Readonly<{
    urls: readonly string[];
    username?: string;
    credential?: string;
    credentialType?: "password";
  }>[];
}>;

const DEVELOPMENT_STUN_SERVER = "stun:stun.l.google.com:19302";
const MAX_RELAY_LIFETIME_MS = 61 * 60 * 1000;
export const LIVE_RELAY_REFRESH_SKEW_MS = 60 * 1000;
/** A remote-description wait must never become an unbounded client queue. */
export const MAX_PENDING_LIVE_ICE_CANDIDATES = 64;

export type LiveViewerRecoveryPlan =
  | Readonly<{ terminal: true }>
  | Readonly<{
      terminal: false;
      attempt: number;
      retryDelayMs: number;
    }>;

/**
 * A failed direct viewer peer gets a small, deterministic retry budget. The
 * caller reuses `attempt` for its generation-safe leave/rejoin attempt and
 * schedules exactly the returned delay only after that attempt fails.
 */
export function planLiveViewerRecovery(
  attempts: number,
  maxAttempts: number,
  baseDelayMs: number,
): LiveViewerRecoveryPlan {
  if (attempts >= maxAttempts) return { terminal: true };
  const attempt = attempts + 1;
  return { terminal: false, attempt, retryDelayMs: baseDelayMs * attempt };
}

export type LiveOfferEpoch = Readonly<{ liveOfferEpoch?: number }>;
export type LiveIceCandidateEnvelope = LiveOfferEpoch &
  Readonly<{
    candidate: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
  }>;

export function isLiveOfferEpoch(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value > 0
  );
}

export function withLiveOfferEpoch<T extends object>(
  value: T,
  liveOfferEpoch: number,
): T & { liveOfferEpoch: number } {
  return { ...value, liveOfferEpoch };
}

export function liveIceCandidateKey(candidate: LiveIceCandidateEnvelope): string {
  return [
    candidate.liveOfferEpoch ?? "legacy",
    candidate.candidate,
    candidate.sdpMid ?? "",
    candidate.sdpMLineIndex ?? "",
  ].join("\u0000");
}

/**
 * Keeps only distinct candidates for a bounded wait. The epoch tag means a
 * restart candidate cannot be applied against an older remote description.
 */
export function queuePendingLiveIce<T extends LiveIceCandidateEnvelope>(
  pending: readonly T[],
  candidate: T,
): T[] {
  if (
    pending.length >= MAX_PENDING_LIVE_ICE_CANDIDATES ||
    pending.some(
      (queued) => liveIceCandidateKey(queued) === liveIceCandidateKey(candidate),
    )
  ) {
    return [...pending];
  }
  return [...pending, candidate];
}

export function splitPendingLiveIceForOfferEpoch<
  T extends LiveIceCandidateEnvelope,
>(
  pending: readonly T[],
  remoteOfferEpoch: number | null,
): { apply: T[]; retain: T[] } {
  const apply: T[] = [];
  const retain: T[] = [];
  for (const candidate of pending) {
    // A deliberately legacy remote description can safely consume only its
    // untagged candidates. Never invent an epoch for tagged ICE: retain it in
    // the bounded queue until an exact tagged offer establishes a match.
    if (candidate.liveOfferEpoch === undefined) {
      apply.push(candidate);
    } else if (
      remoteOfferEpoch !== null &&
      candidate.liveOfferEpoch === remoteOfferEpoch
    ) {
      apply.push(candidate);
    } else if (
      remoteOfferEpoch === null ||
      candidate.liveOfferEpoch > remoteOfferEpoch
    ) {
      retain.push(candidate);
    }
  }
  return { apply, retain };
}

function isUsableRelayServer(server: LiveTurnIceServer): boolean {
  return (
    Array.isArray(server.urls) &&
    server.urls.length > 0 &&
    server.urls.every((url) => /^turns?:[^\s]+$/i.test(url)) &&
    server.username.length > 0 &&
    server.credential.length > 0 &&
    server.credentialType === "password"
  );
}

/**
 * Accept only the short-lived ISO timestamp produced by the server. An expiry
 * in the past would leave a delayed peer with unusable credentials, while a
 * far-future value is never a valid coturn REST credential from this API.
 */
function parseLiveRelayExpiryMs(
  relay: LiveTurnCredentials,
  now = Date.now(),
): number {
  const expiresAtMs = Date.parse(relay.expiresAt);
  if (
    !Number.isFinite(expiresAtMs) ||
    new Date(expiresAtMs).toISOString() !== relay.expiresAt ||
    expiresAtMs > now + MAX_RELAY_LIFETIME_MS
  ) {
    throw new Error("Live relay credentials are unavailable. Please retry.");
  }
  return expiresAtMs;
}

export function liveRelayExpiryMs(
  relay: LiveTurnCredentials,
  now = Date.now(),
): number {
  const expiresAtMs = parseLiveRelayExpiryMs(relay, now);
  if (expiresAtMs <= now) {
    throw new Error("Live relay credentials are unavailable. Please retry.");
  }
  return expiresAtMs;
}

export function liveRelayNeedsRefresh(
  relay: LiveTurnCredentials | null,
  now = Date.now(),
): boolean {
  return (
    relay !== null &&
    parseLiveRelayExpiryMs(relay, now) - now <= LIVE_RELAY_REFRESH_SKEW_MS
  );
}

/**
 * Creates a fresh object for each peer connection. A null relay payload is the
 * intentional non-production direct/STUN fallback; a malformed relay payload
 * is terminal rather than silently pretending a production relay is present.
 */
export function createLiveIceConfiguration(
  relay: LiveTurnCredentials | null,
  now = Date.now(),
): LiveIceConfiguration {
  if (relay === null) {
    return { iceServers: [{ urls: [DEVELOPMENT_STUN_SERVER] }] };
  }
  if (
    relay.iceServers.length === 0 ||
    relay.iceServers.some((server) => !isUsableRelayServer(server))
  ) {
    throw new Error("Live relay credentials are unavailable. Please retry.");
  }
  liveRelayExpiryMs(relay, now);

  return {
    iceServers: relay.iceServers.map((server) => ({
      urls: [...server.urls],
      username: server.username,
      credential: server.credential,
      credentialType: "password" as const,
    })),
  };
}
