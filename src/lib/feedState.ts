export function applyPostReaction<T extends { id: string; liked: boolean; likes: number }>(
  items: T[],
  postId: string,
  liked: boolean,
  likes: number,
): T[] {
  return items.map((item) =>
    item.id === postId ? { ...item, liked, likes: Math.max(0, likes) } : item,
  );
}
export function mergeUniquePage<T extends { id: string }>(current: T[], page: T[]): T[] {
  const existing = new Set(current.map((item) => item.id));
  return [
    ...current,
    ...page.filter((item) => !existing.has(item.id) && Boolean(existing.add(item.id))),
  ];
}
