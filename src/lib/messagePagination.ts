export type MessageCursor = { createdAt: string; id: string };

export function messageCursorFilter(cursor: MessageCursor): string {
  // These values enter PostgREST's raw filter grammar. Preserve database timestamp
  // precision, but reject punctuation that could change the filter expression.
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      cursor.createdAt,
    ) ||
    !Number.isFinite(Date.parse(cursor.createdAt)) ||
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(cursor.id)
  )
    throw new Error('Invalid message page cursor. Reopen the conversation and try again.');
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
}
