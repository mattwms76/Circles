export type ContentLink = { kind: 'post' | 'circle'; id: string; circleId?: string };
export function contentLink(kind: 'post' | 'circle', id: string, circleId?: string) {
  return `circles://${kind}/${encodeURIComponent(id)}${circleId ? `?circle=${encodeURIComponent(circleId)}` : ''}`;
}
export function parseContentLink(url: string): ContentLink | null {
  try {
    if (!/^circles:\/\/(post|circle)\/[a-zA-Z0-9-]{1,100}(?:\?[^#]*)?$/.test(url)) return null;
    const parsed = new URL(url);
    if (parsed.protocol !== 'circles:' || !['post', 'circle'].includes(parsed.hostname))
      return null;
    const id = decodeURIComponent(parsed.pathname.slice(1));
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) return null;
    const circleId = parsed.searchParams.get('circle') ?? undefined;
    if (circleId && !/^[a-zA-Z0-9-]{1,100}$/.test(circleId)) return null;
    return { kind: parsed.hostname as 'post' | 'circle', id, circleId };
  } catch {
    return null;
  }
}
