export type ContentLink = { kind: 'post' | 'circle' | 'invite'; id: string; circleId?: string };
export function isAuthCallback(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'circles:' &&
      parsed.hostname === 'auth' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      ['/callback', '/recovery'].includes(parsed.pathname)
    );
  } catch {
    return false;
  }
}
export function contentLink(kind: 'post' | 'circle', id: string, circleId?: string) {
  return `circles://${kind}/${encodeURIComponent(id)}${circleId ? `?circle=${encodeURIComponent(circleId)}` : ''}`;
}
export function parseContentLink(url: string): ContentLink | null {
  try {
    const invite = new URL(url);
    if (
      invite.protocol === 'circles:' &&
      invite.hostname === 'invite' &&
      /^\/[a-f0-9]{64}$/.test(invite.pathname) &&
      !invite.search &&
      !invite.hash
    )
      return { kind: 'invite', id: invite.pathname.slice(1) };
    const landing = process.env.EXPO_PUBLIC_INVITE_BASE_URL;
    if (landing) {
      const allowed = new URL(landing);
      if (
        invite.protocol === 'https:' &&
        invite.origin === allowed.origin &&
        invite.pathname === allowed.pathname &&
        /^[a-f0-9]{64}$/.test(invite.searchParams.get('token') ?? '') &&
        !invite.hash
      )
        return { kind: 'invite', id: invite.searchParams.get('token')! };
    }
    const backend = process.env.EXPO_PUBLIC_SUPABASE_URL;
    if (
      backend &&
      invite.protocol === 'https:' &&
      invite.origin === new URL(backend).origin &&
      invite.pathname === '/functions/v1/community-invite' &&
      /^[a-f0-9]{64}$/.test(invite.searchParams.get('token') ?? '') &&
      !invite.hash
    )
      return { kind: 'invite', id: invite.searchParams.get('token')! };

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
