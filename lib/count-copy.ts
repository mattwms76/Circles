/** Shared visible and accessible count copy; callers retain their own number formatting. */
export function countNoun(
  count: number,
  singular: string,
  plural = `${singular}s`,
) {
  return count === 1 ? singular : plural;
}

export function countLabel(
  count: number,
  singular: string,
  plural = `${singular}s`,
) {
  return `${count} ${countNoun(count, singular, plural)}`;
}
