export type Parity27LiveMediaReadiness = Readonly<{
  host: boolean;
  hostMediaReady: boolean;
  viewerMediaReady: boolean;
}>;

/**
 * Server-coded terminal responses tear the transport down before this policy
 * runs. A locally established participant keeps route readiness for an
 * otherwise recoverable signaling or polling failure, because its current
 * media generation remains active and can heal without another ontrack event.
 */
export function shouldPreserveLiveParticipantReadiness(
  readiness: Parity27LiveMediaReadiness,
): boolean {
  return readiness.host ? readiness.hostMediaReady : readiness.viewerMediaReady;
}
