import type { Message } from "./social";

/** The live conversation page size, small enough for periodic polling. */
export const MESSAGE_PAGE_DEFAULT_LIMIT = 100;
/** The server rejects request sizes above this bound. */
export const MESSAGE_PAGE_MAX_LIMIT = 200;

type MessageOrderFields = Pick<Message, "id" | "createdAt">;

/**
 * Orders a page chronologically and uses the immutable message ID as the tie-breaker. The
 * tie-breaker is required because database timestamps can legitimately be shared by many rows.
 */
export function compareMessagesChronologically(
  left: MessageOrderFields,
  right: MessageOrderFields,
): number {
  const createdAtOrder =
    Date.parse(left.createdAt) - Date.parse(right.createdAt);
  return createdAtOrder || left.id - right.id;
}

/**
 * Combines newest-first query pages into one ascending transcript without duplicate rows when a
 * polling refetch overlaps older history. The first occurrence wins because React Query keeps the
 * live (newest) page first.
 */
export function mergeMessageHistoryPages(
  pages: readonly (readonly Message[])[],
): Message[] {
  const messagesById = new Map<number, Message>();
  for (const page of pages) {
    for (const message of page) {
      if (!messagesById.has(message.id)) messagesById.set(message.id, message);
    }
  }
  return [...messagesById.values()].sort(compareMessagesChronologically);
}

/**
 * Returns the exclusive older-than cursor for a full ascending page. A short page is exhaustive;
 * the caller must not issue an acknowledgement or another history request for an empty page.
 */
export function olderMessagePageCursor(
  page: readonly Pick<Message, "id">[],
  pageLimit = MESSAGE_PAGE_DEFAULT_LIMIT,
): number | undefined {
  if (page.length < pageLimit) return undefined;
  return page.reduce(
    (oldestId, message) => Math.min(oldestId, message.id),
    page[0]?.id,
  );
}
