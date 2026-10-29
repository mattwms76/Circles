/**
 * CBA-04 durable live-chat admission contract. The router evaluates these
 * limits only after it holds the live stream row lock, so concurrent callers
 * cannot independently pass a stale count and over-admit durable rows.
 */
export const MAX_LIVE_CHAT_POLL_BATCH = 100;
export const MAX_LIVE_CHAT_ROWS_PER_STREAM = 1_000;
export const MAX_LIVE_CHAT_ROWS_PER_PARTICIPANT = 200;

/** Human chat permits a small burst while keeping a participant bounded. */
export const LIVE_CHAT_RATE_WINDOW_MS = 10_000;
export const MAX_LIVE_CHAT_PER_PARTICIPANT_PER_WINDOW = 5;

/** Heart taps are durable only at a materially tighter rate than chat text. */
export const LIVE_REACTION_RATE_WINDOW_MS = 5_000;
export const MAX_LIVE_REACTIONS_PER_PARTICIPANT_PER_WINDOW = 1;

export type LiveChatAdmissionKind = "chat" | "reaction";

export type LiveChatAdmissionCounts = Readonly<{
  streamRows: number;
  participantRows: number;
  recentParticipantRows: number;
}>;

export function liveChatRateWindowMs(kind: LiveChatAdmissionKind): number {
  return kind === "reaction"
    ? LIVE_REACTION_RATE_WINDOW_MS
    : LIVE_CHAT_RATE_WINDOW_MS;
}

/**
 * Row caps retain history without destructive live cleanup. Rate limits are
 * deliberately participant-specific; the stream cap remains the hard shared
 * storage boundary for a stream lifetime.
 */
export function wouldExceedLiveChatAdmission(
  kind: LiveChatAdmissionKind,
  counts: LiveChatAdmissionCounts,
): boolean {
  if (
    counts.streamRows >= MAX_LIVE_CHAT_ROWS_PER_STREAM ||
    counts.participantRows >= MAX_LIVE_CHAT_ROWS_PER_PARTICIPANT
  ) {
    return true;
  }

  const perWindowLimit =
    kind === "reaction"
      ? MAX_LIVE_REACTIONS_PER_PARTICIPANT_PER_WINDOW
      : MAX_LIVE_CHAT_PER_PARTICIPANT_PER_WINDOW;
  return counts.recentParticipantRows >= perWindowLimit;
}
