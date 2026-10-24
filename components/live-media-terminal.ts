export type LiveTerminalState = {
  kind: "access-revoked" | "ended";
  message: string;
};

type UnknownRecord = Record<string, unknown>;

const ACCESS_REVOKED_MESSAGE =
  "Your access to this live moment has been revoked.";
const ENDED_MESSAGE = "This live moment has ended.";

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function errorCode(error: unknown): string | null {
  if (!isRecord(error)) return null;

  const data = isRecord(error.data) ? error.data : null;
  const shape = isRecord(error.shape) ? error.shape : null;
  const shapeData = shape && isRecord(shape.data) ? shape.data : null;
  const candidates = [data?.code, shapeData?.code, error.code];

  for (const candidate of candidates) {
    if (typeof candidate === "string") return candidate;
  }
  return null;
}

/**
 * tRPC terminal responses mean the participant no longer has a valid media
 * lifecycle. Transport failures without one of these server codes remain
 * retryable and must not tear down an established direct peer.
 */
export function terminalLiveStateForError(
  error: unknown,
): LiveTerminalState | null {
  const code = errorCode(error);
  if (code === "FORBIDDEN" || code === "UNAUTHORIZED") {
    return { kind: "access-revoked", message: ACCESS_REVOKED_MESSAGE };
  }
  if (code === "NOT_FOUND") {
    return { kind: "ended", message: ENDED_MESSAGE };
  }
  return null;
}

/**
 * Invokes transport-specific teardown only for terminal authorization or
 * liveness responses. Keeping the effectful cleanup at the transport layer
 * preserves web/native media and peer ownership while giving both paths the
 * same server-error contract.
 */
export function terminateLiveTransportForError(
  error: unknown,
  onTerminal: (state: LiveTerminalState) => void,
): boolean {
  const state = terminalLiveStateForError(error);
  if (!state) return false;
  onTerminal(state);
  return true;
}
