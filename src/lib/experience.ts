import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireSupabase, supabase } from './supabase';
import { getDemoCurrentUser, toProfile, relativeTime } from './repositories';
import type { Circle, DirectMessage, Profile } from '../types';
import type { ActivityNotification } from './community';

export type DiscoveryOptions = {
  privacy: 'all' | 'public' | 'private';
  sort: 'recommended' | 'active' | 'popular' | 'newest';
  activeOnly: boolean;
};
export const defaultDiscovery: DiscoveryOptions = {
  privacy: 'all',
  sort: 'recommended',
  activeOnly: false,
};
export const reactionEmoji = ['❤️', '👍', '😂', '🎉', '😮'] as const;
export type Reaction = { user_id: string; emoji: string };
export type ScheduledRoom = {
  id: string;
  host_id: string;
  circle_id: string | null;
  title: string;
  starts_at: string;
  status: 'scheduled' | 'live' | 'cancelled';
  live_session_id: string | null;
  reminded: boolean;
  host?: Profile;
};
export type CircleMember = {
  user_id: string;
  role: 'owner' | 'moderator' | 'member';
  profile: Profile;
};
const checked = <T>(result: { data: T; error: any }): T => {
  if (result.error) throw result.error;
  return result.data;
};
export async function experienceUser() {
  if (!supabase) return getDemoCurrentUser().id;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('Sign in to continue.');
  return data.user.id;
}
async function localRead<T>(key: string, fallback: T): Promise<T> {
  const value = await AsyncStorage.getItem(`circles:experience:${await experienceUser()}:${key}`);
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
async function localWrite(key: string, value: unknown) {
  await AsyncStorage.setItem(
    `circles:experience:${await experienceUser()}:${key}`,
    JSON.stringify(value),
  );
}
export function recommendationReason(circle: Circle, interests: string[]) {
  if (circle.isMember) return 'You’re already part of this circle';
  if (interests.some((i) => i.toLowerCase() === circle.interest.toLowerCase()))
    return `Matches your interest in ${circle.interest.toLowerCase()}`;
  return circle.isPrivate
    ? 'A private community · request access from its host'
    : `Explore ${circle.interest.toLowerCase()} with ${circle.members.toLocaleString()} members`;
}
export function filterDiscovery(
  circles: Circle[],
  options: DiscoveryOptions,
  interests: string[],
  now = Date.now(),
) {
  return circles
    .filter(
      (c) =>
        (options.privacy === 'all' || c.isPrivate === (options.privacy === 'private')) &&
        (!options.activeOnly ||
          (c.lastActivityAt && Date.parse(c.lastActivityAt) > now - 7 * 86400000)),
    )
    .sort((a, b) => {
      if (options.sort === 'popular') return b.members - a.members;
      if (options.sort === 'newest')
        return (
          Date.parse(b.createdAtIso ?? '1970-01-01') - Date.parse(a.createdAtIso ?? '1970-01-01')
        );
      if (options.sort === 'recommended') {
        const delta =
          Number(interests.includes(b.interest)) - Number(interests.includes(a.interest));
        if (delta) return delta;
      }
      return (
        Date.parse(b.lastActivityAt ?? '1970-01-01') - Date.parse(a.lastActivityAt ?? '1970-01-01')
      );
    });
}
export async function loadReactions(
  kind: 'message' | 'comment',
  ids: string[],
): Promise<Record<string, Reaction[]>> {
  if (!ids.length) return {};
  if (!supabase) return localRead(`${kind}-reactions`, {});
  const column = `${kind}_id`,
    grouped: Record<string, Reaction[]> = {};
  const unique = [...new Set(ids)];
  for (let start = 0; start < unique.length; start += 100) {
    const batch = unique.slice(start, start + 100);
    for (let offset = 0; ; offset += 500) {
      const rows = checked(
        await supabase
          .from(`${kind}_reactions`)
          .select(`${column},user_id,emoji`)
          .in(column, batch)
          .order(column)
          .order('user_id')
          .order('emoji')
          .range(offset, offset + 499),
      ) as any[] | null;
      for (const row of rows ?? [])
        (grouped[row[column]] ??= []).push({ user_id: row.user_id, emoji: row.emoji });
      if ((rows?.length ?? 0) < 500) break;
    }
  }
  return grouped;
}
export async function reactToContent(
  kind: 'message' | 'comment',
  id: string,
  emoji: string,
  remove: boolean,
) {
  if (!reactionEmoji.includes(emoji as any)) throw new Error('Choose a supported reaction.');
  const user = await experienceUser();
  if (!supabase) {
    const groups = await loadReactions(kind, [id]);
    groups[id] = (groups[id] ?? []).filter((r) => !(r.user_id === user && r.emoji === emoji));
    if (!remove) groups[id].push({ user_id: user, emoji });
    await localWrite(`${kind}-reactions`, groups);
    return;
  }
  const column = `${kind}_id`,
    table = supabase.from(`${kind}_reactions`);
  const result = remove
    ? await table.delete().eq(column, id).eq('user_id', user).eq('emoji', emoji)
    : await table.insert({ [column]: id, user_id: user, emoji });
  if (result.error && result.error.code !== '23505') throw result.error;
}
export async function searchMessages(
  peer: string,
  text: string,
  offset = 0,
): Promise<DirectMessage[]> {
  if (!supabase) return [];
  const own = await experienceUser();
  const rows = checked(
    await supabase
      .from('direct_messages')
      .select('id,sender_id,body,created_at,reply_to_id,read_at')
      .or(
        `and(sender_id.eq.${own},recipient_id.eq.${peer}),and(sender_id.eq.${peer},recipient_id.eq.${own})`,
      )
      .ilike('body', `%${text.replace(/[\\%_]/g, '\\$&')}%`)
      .order('created_at', { ascending: false })
      .order('id')
      .range(offset, offset + 39),
  );
  return (rows ?? []).map((r) => ({
    id: r.id,
    senderId: r.sender_id,
    body: r.body,
    createdAt: relativeTime(r.created_at),
    createdAtIso: r.created_at,
    replyToId: r.reply_to_id,
    readAt: r.read_at,
  }));
}
export async function conversationMuted(peer: string) {
  if (!supabase) return localRead(`muted:${peer}`, false);
  return (
    checked(
      await supabase
        .from('conversation_preferences')
        .select('muted')
        .eq('user_id', await experienceUser())
        .eq('peer_id', peer)
        .maybeSingle(),
    )?.muted ?? false
  );
}
export async function muteConversation(peer: string, muted: boolean) {
  if (!supabase) return localWrite(`muted:${peer}`, muted);
  checked(
    await supabase
      .from('conversation_preferences')
      .upsert({ user_id: await experienceUser(), peer_id: peer, muted }),
  );
}
export async function loadGiftFavourites(): Promise<string[]> {
  return localRead('gift-favourites', []);
}
export async function saveGiftFavourites(ids: string[]) {
  return localWrite('gift-favourites', [...new Set(ids)]);
}
export async function loadCircleOverview(
  circle: Circle,
  limit = 100,
): Promise<{ rules: string; members: CircleMember[]; ownRole?: string }> {
  if (!supabase)
    return localRead(`overview:${circle.id}`, { rules: circle.rules ?? '', members: [] });
  const [c, m] = await Promise.all([
    supabase.from('circles').select('rules').eq('id', circle.id).single(),
    supabase
      .from('circle_memberships')
      .select('user_id,role,profiles!circle_memberships_user_id_fkey(*)')
      .eq('circle_id', circle.id)
      .eq('status', 'member')
      .order('joined_at')
      .order('user_id')
      .limit(limit),
  ]);
  const own = checked(
    await supabase
      .from('circle_memberships')
      .select('role')
      .eq('circle_id', circle.id)
      .eq('user_id', await experienceUser())
      .eq('status', 'member')
      .maybeSingle(),
  );
  return {
    ownRole: own?.role ?? 'member',
    rules: checked(c)?.rules ?? '',
    members: (checked(m) ?? []).map((row: any) => ({
      user_id: row.user_id,
      role: row.role,
      profile: toProfile(row.profiles),
    })),
  };
}
export async function saveCircleRules(circle: Circle, rules: string) {
  if (!supabase) {
    const previous = await loadCircleOverview(circle);
    return localWrite(`overview:${circle.id}`, { ...previous, rules });
  }
  checked(await supabase.from('circles').update({ rules: rules.trim() }).eq('id', circle.id));
}
export async function setCircleRole(circleId: string, user: string, role: 'member' | 'moderator') {
  checked(
    await requireSupabase().rpc('set_circle_role', {
      target_circle: circleId,
      target_member: user,
      new_role: role,
    }),
  );
}
export async function loadScheduledRooms(): Promise<ScheduledRoom[]> {
  if (!supabase) return localRead('scheduled-rooms', []);
  const own = await experienceUser();
  const [rooms, reminders] = await Promise.all([
    supabase
      .from('scheduled_live_rooms')
      .select('*,profiles!scheduled_live_rooms_host_id_fkey(*)')
      .neq('status', 'cancelled')
      .gte('starts_at', new Date(Date.now() - 86400000).toISOString())
      .order('starts_at')
      .limit(100),
    supabase.from('live_reminders').select('room_id').eq('user_id', own),
  ]);
  const set = new Set(checked(reminders)?.map((r) => r.room_id));
  return (checked(rooms) ?? []).map((r) => ({
    ...r,
    host: toProfile(r.profiles),
    reminded: set.has(r.id),
  }));
}
export async function saveScheduledRoom(
  title: string,
  date: string,
  circleId: string | null,
  id?: string,
) {
  const parsed = Date.parse(date);
  if (title.trim().length < 2 || title.trim().length > 120)
    throw new Error('Use a title between 2 and 120 characters.');
  if (!Number.isFinite(parsed) || parsed <= Date.now())
    throw new Error('Choose a future date and time.');
  const input = { title: title.trim(), starts_at: new Date(parsed).toISOString() };
  if (!supabase) {
    const rooms = await loadScheduledRooms();
    const existing = rooms.find((r) => r.id === id);
    await localWrite('scheduled-rooms', [
      ...rooms.filter((r) => r.id !== id),
      {
        ...existing,
        ...input,
        id: id ?? `room-${Date.now()}`,
        host_id: await experienceUser(),
        circle_id: circleId,
        status: 'scheduled',
        live_session_id: null,
        reminded: existing?.reminded ?? false,
      },
    ]);
    return;
  }
  checked(
    id
      ? await supabase.from('scheduled_live_rooms').update(input).eq('id', id)
      : await supabase
          .from('scheduled_live_rooms')
          .insert({ ...input, circle_id: circleId, host_id: await experienceUser() }),
  );
}
export async function setLiveReminder(room: ScheduledRoom) {
  if (!supabase)
    return localWrite(
      'scheduled-rooms',
      (await loadScheduledRooms()).map((r) =>
        r.id === room.id ? { ...r, reminded: !r.reminded } : r,
      ),
    );
  const user = await experienceUser();
  checked(
    room.reminded
      ? await supabase.from('live_reminders').delete().eq('room_id', room.id).eq('user_id', user)
      : await supabase.from('live_reminders').insert({ room_id: room.id, user_id: user }),
  );
}
export async function manageScheduledRoom(
  id: string,
  action: 'start' | 'cancel',
): Promise<string | null> {
  if (!supabase) {
    if (action === 'start')
      throw new Error('Starting scheduled video requires a connected account.');
    await localWrite(
      'scheduled-rooms',
      (await loadScheduledRooms()).filter((r) => r.id !== id),
    );
    return null;
  }
  return checked(await supabase.rpc('manage_scheduled_room', { room_id: id, action }));
}
export function groupActivity(items: ActivityNotification[]) {
  const groups = new Map<
    string,
    { key: string; items: ActivityNotification[]; latest: ActivityNotification; unread: number }
  >();
  for (const item of [...items].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  )) {
    const key = [item.kind, item.target_id, item.created_at.slice(0, 10)].join(':');
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
      if (!item.read_at) group.unread++;
    } else groups.set(key, { key, items: [item], latest: item, unread: item.read_at ? 0 : 1 });
  }
  return [...groups.values()];
}
export async function loadNotificationById(id: string): Promise<ActivityNotification | null> {
  if (!supabase) return null;
  return checked(
    await supabase
      .from('notifications')
      .select('id,kind,title,body,target_id,circle_id,read_at,created_at')
      .eq('id', id)
      .maybeSingle(),
  );
}
export async function markActivitiesRead(ids: string[]) {
  if (!supabase) return;
  checked(
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .in('id', ids),
  );
}
