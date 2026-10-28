const COMPACT_POST_ACTION_COUNT_LIMIT = 99;

/**
 * Keeps the compact action rail's visible numeric affordance bounded while the
 * caller continues to expose the precise count through accessibility metadata.
 */
export function compactPostActionCount(count: number): string {
  return count > COMPACT_POST_ACTION_COUNT_LIMIT
    ? `${COMPACT_POST_ACTION_COUNT_LIMIT}+`
    : String(Math.max(0, count));
}
