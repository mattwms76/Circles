/**
 * D28-022 keeps unread badge text exact only when the current response contains
 * a safely representable, nonnegative integer count.
 */
export function d28022ValidatedUnreadCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}
