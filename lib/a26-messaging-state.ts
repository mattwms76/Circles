export const MAX_MESSAGE_TEXT_LENGTH = 10_000;
export const MAX_VISIBLE_UNREAD_COUNT = 999;

export type InboxMatchState = "content" | "empty" | "no-match";

type ErrorRecord = Record<string, unknown>;

type ConversationMetadata = {
  id: number;
};

function isRecord(value: unknown): value is ErrorRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * A chat deep link must identify exactly one positive safe integer. Arrays are
 * deliberately rejected rather than silently selecting the first route value.
 */
export function positiveSafeConversationId(
  value: string | string[] | undefined,
): number | null {
  if (Array.isArray(value) || !value || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Mirrors the router's trimmed 10,000-character message limit. */
export function messageTextIsWithinLimit(text: string): boolean {
  return text.trim().length <= MAX_MESSAGE_TEXT_LENGTH;
}

/**
 * A tRPC response containing its structured data code has definitively reached
 * the application. Only failures without that response remain delivery-ambiguous.
 */
export function isDefinitiveMessageApplicationError(error: unknown): boolean {
  if (!isRecord(error)) return false;

  const data = isRecord(error.data) ? error.data : null;
  const shape = isRecord(error.shape) ? error.shape : null;
  const shapeData = shape && isRecord(shape.data) ? shape.data : null;
  return typeof data?.code === "string" || typeof shapeData?.code === "string";
}

/**
 * A name is renderable only when the current account-scoped metadata response
 * contains the requested conversation ID. Route metadata is never authority.
 */
export function authorizedConversationMetadata<T extends ConversationMetadata>(
  conversations: readonly T[] | null | undefined,
  conversationId: number,
): T | null {
  if (!Number.isSafeInteger(conversationId) || conversationId <= 0) return null;
  return (
    conversations?.find(
      (conversation) =>
        Number.isSafeInteger(conversation.id) &&
        conversation.id === conversationId,
    ) ?? null
  );
}

/** Distinguishes an actually empty inbox from active search/filter no-matches. */
export function inboxMatchState({
  conversationCount,
  filteredCount,
  filter,
  search,
}: {
  conversationCount: number;
  filteredCount: number;
  filter: string;
  search: string;
}): InboxMatchState {
  if (conversationCount <= 0) return "empty";
  if (filteredCount <= 0 && (filter !== "All" || search.trim().length > 0)) {
    return "no-match";
  }
  return "content";
}

/**
 * Keep the fixed visual rail bounded while the caller continues to expose the
 * original server count in its accessibility value.
 */
export function visibleUnreadCount(unread: number): string {
  if (!Number.isSafeInteger(unread) || unread <= 0) return "0";
  return unread > MAX_VISIBLE_UNREAD_COUNT
    ? `${MAX_VISIBLE_UNREAD_COUNT}+`
    : String(unread);
}
