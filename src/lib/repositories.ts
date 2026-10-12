import type { Circle, CircleJoinRequest, CirclePost, Conversation, CreatePostInput, DirectMessage, Gift, LiveGiftEvent, LiveSession, PostComment, Profile, UUID } from '../types';
import { circles as demoCircles, conversations as demoConversations, currentUser, gifts as demoGifts, liveSessions as demoLiveSessions, people, posts as demoPosts } from '../data/demo';
import { backendReady, requireSupabase, supabase } from './supabase';

const postMediaBucket = 'post-media';

export async function loadOwnProfile(): Promise<Profile> {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to load your profile.');
  const { data, error } = await client.from('profiles').select('id,handle,display_name,avatar_url,bio,interests').eq('id', auth.user.id).single();
  if (error) throw error;
  return toProfile(data);
}

export async function updateOwnProfile(input: Pick<Profile, 'displayName' | 'bio' | 'interests'>): Promise<Profile> {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to update your profile.');
  const { data, error } = await client.from('profiles').update({ display_name: input.displayName.trim(), bio: (input.bio ?? '').trim(), interests: input.interests ?? [] })
    .eq('id', auth.user.id).select('id,handle,display_name,avatar_url,bio,interests').single();
  if (error) throw error;
  return toProfile(data);
}

export async function loadCircles(offset = 0, pageSize = 30): Promise<Circle[]> {
  if (!supabase) return demoCircles.slice(offset, offset + pageSize);
  const { data, error } = await supabase.from('circles').select('id,name,description,interest,members_count,is_private,cover_url,cover_color')
    .order('members_count', { ascending: false }).order('id', { ascending: true }).range(offset, offset + pageSize - 1);
  if (error) throw error;
  if (!data) return [];
  const { data: auth } = await supabase.auth.getUser();
  let memberships: { circle_id: string; status: string; role: string }[] = [];
  if (auth.user) {
    const { data, error: membershipError } = await supabase.from('circle_memberships').select('circle_id,status,role').eq('user_id', auth.user.id);
    if (membershipError) throw membershipError;
    memberships = data ?? [];
  }
  const byId = new Map((memberships ?? []).filter((item) => item.status === 'member').map((item) => [item.circle_id, item.role]));
  return data.map((circle) => ({ id: circle.id, name: circle.name, description: circle.description, interest: circle.interest, members: circle.members_count, isPrivate: circle.is_private, isMember: byId.has(circle.id), isOwner: byId.get(circle.id) === 'owner', color: circle.cover_color, imageUrl: circle.cover_url ?? '' }));
}

export async function joinCircle(circle: Circle): Promise<'member' | 'pending'> {
  if (!supabase) return circle.isPrivate ? 'pending' : 'member';
  const { data, error } = await supabase.rpc('request_circle_membership', { target_circle_id: circle.id });
  if (error) throw error;
  return data === 'pending' ? 'pending' : 'member';
}

export async function leaveCircle(circleId: UUID, cancelPending = false): Promise<'left' | 'request_cancelled' | 'not_member'> {
  if (!supabase) return cancelPending ? 'request_cancelled' : 'left';
  const { data, error } = await requireSupabase().rpc('leave_circle', { target_circle_id: circleId });
  if (error) throw error;
  if (data === 'left' || data === 'request_cancelled' || data === 'not_member') return data;
  throw new Error('Could not confirm the circle membership change. Refresh and try again.');
}

export async function createCircle(input: Pick<Circle, 'name' | 'description' | 'interest' | 'isPrivate'>): Promise<Circle> {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to create a circle.');
  const { data, error } = await client.from('circles').insert({ name: input.name, description: input.description, interest: input.interest, is_private: input.isPrivate, owner_id: auth.user.id }).select('id,name,description,interest,members_count,is_private,cover_url,cover_color').single();
  if (error) throw error;
  return { id: data.id, name: data.name, description: data.description, interest: data.interest, members: Math.max(data.members_count, 1), isPrivate: data.is_private, isMember: true, isOwner: true, color: data.cover_color, imageUrl: data.cover_url ?? '' };
}

export async function loadCircleRequests(): Promise<CircleJoinRequest[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('circle_memberships').select('circle_id,user_id,circles!circle_memberships_circle_id_fkey(name),profiles!circle_memberships_user_id_fkey(id,handle,display_name,avatar_url)').eq('status', 'pending').order('joined_at');
  if (error) throw error;
  if (!data) return [];
  return data.map((row: any) => ({ id: `${row.circle_id}:${row.user_id}`, circleId: row.circle_id, circleName: row.circles.name, requester: { id: row.profiles.id, handle: row.profiles.handle, displayName: row.profiles.display_name, avatarUrl: row.profiles.avatar_url ?? '', interests: [] } }));
}

export async function loadMyPendingCircleIds(): Promise<UUID[]> {
  if (!supabase) return [];
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await supabase.from('circle_memberships').select('circle_id').eq('user_id', auth.user.id).eq('status', 'pending');
  if (error) throw error;
  return (data ?? []).map((row) => row.circle_id);
}

export async function decideCircleJoinRequest(circleId: UUID, requesterId: UUID, accepted: boolean): Promise<void> {
  const { error } = await requireSupabase().from('circle_memberships').update({ status: accepted ? 'member' : 'declined' }).eq('circle_id', circleId).eq('user_id', requesterId);
  if (error) throw error;
}

export async function loadPosts(offset = 0, pageSize = 20): Promise<CirclePost[]> {
  return fetchPosts(offset, pageSize);
}

export async function loadCirclePosts(circleId: UUID, offset = 0, pageSize = 20): Promise<CirclePost[]> {
  if (!supabase) return demoPosts.filter((post) => post.circleId === circleId).slice(offset, offset + pageSize);
  return fetchPosts(offset, pageSize, circleId);
}

async function fetchPosts(offset: number, pageSize: number, circleId?: UUID): Promise<CirclePost[]> {
  if (!supabase) return demoPosts.slice(offset, offset + pageSize);
  let query = supabase.from('posts').select('id,circle_id,body,created_at,profiles!posts_author_id_fkey(id,handle,display_name,avatar_url),circles!posts_circle_id_fkey(name),post_media(id,kind,storage_path),post_likes(user_id)')
    .eq('visibility', 'published');
  if (circleId) query = query.eq('circle_id', circleId);
  const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + pageSize - 1);
  if (error) throw error;
  if (!data) return [];
  const { data: auth } = await supabase.auth.getUser();
  return Promise.all(data.map(async (row: any) => {
    let media: CirclePost['media'];
    if (row.post_media?.[0]) {
      const { data: signed, error: signedError } = await supabase!.storage.from(postMediaBucket).createSignedUrl(row.post_media[0].storage_path, 60 * 60);
      if (signedError) throw signedError;
      media = { id: row.post_media[0].id, kind: row.post_media[0].kind, url: signed.signedUrl };
    }
    return {
      id: row.id, circleId: row.circle_id, circleName: row.circles?.name ?? 'A circle',
      author: { id: row.profiles.id, handle: row.profiles.handle, displayName: row.profiles.display_name, avatarUrl: row.profiles.avatar_url ?? '', interests: [] },
      body: row.body, likes: row.post_likes?.length ?? 0, createdAt: relativeTime(row.created_at), liked: Boolean(auth.user && row.post_likes?.some((like: any) => like.user_id === auth.user!.id)), media,
    };
  }));
}

export async function createPost(input: CreatePostInput): Promise<void> {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to post.');
  const { data: post, error } = await client.from('posts').insert({ circle_id: input.circleId, author_id: auth.user.id, body: input.body.trim(), visibility: input.media ? 'removed' : 'published' }).select('id').single();
  if (error) throw error;
  if (input.media) {
    const path = `${auth.user.id}/${post.id}/${Date.now()}-${input.media.fileName.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
    try {
      const response = await fetch(input.media.uri);
      if (!response.ok) throw new Error('Could not read the selected media file.');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 25 * 1024 * 1024) throw new Error('Media must be 25 MB or smaller.');
      if (input.media.kind === 'video' && !['video/mp4', 'video/quicktime', 'video/webm'].includes(input.media.mimeType)) throw new Error('Choose an MP4, QuickTime, or WebM video.');
      if (input.media.kind === 'gif' && input.media.mimeType !== 'image/gif') throw new Error('Choose an animated GIF file.');
      if (input.media.kind === 'image' && !['image/jpeg', 'image/png', 'image/webp'].includes(input.media.mimeType)) throw new Error('Choose a JPEG, PNG, or WebP image.');
      const { error: uploadError } = await client.storage.from(postMediaBucket).upload(path, bytes, { contentType: input.media.mimeType, upsert: false });
      if (uploadError) throw uploadError;
      const { error: metadataError } = await client.from('post_media').insert({ post_id: post.id, owner_id: auth.user.id, kind: input.media.kind, storage_path: path, mime_type: input.media.mimeType });
      if (metadataError) throw metadataError;
      const { error: publishError } = await client.from('posts').update({ visibility: 'published' }).eq('id', post.id).eq('author_id', auth.user.id);
      if (publishError) throw publishError;
    } catch (error) {
      await client.storage.from(postMediaBucket).remove([path]);
      await client.from('posts').update({ visibility: 'removed' }).eq('id', post.id);
      throw error;
    }
  }
}

export async function togglePostLike(postId: UUID, liked: boolean): Promise<void> {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to like posts.');
  const result = liked
    ? await client.from('post_likes').insert({ post_id: postId, user_id: auth.user.id })
    : await client.from('post_likes').delete().eq('post_id', postId).eq('user_id', auth.user.id);
  if (result.error && !(liked && result.error.code === '23505')) throw result.error;
}

export async function loadPostComments(postId: UUID): Promise<PostComment[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('post_comments')
    .select('id,post_id,body,created_at,profiles!post_comments_author_id_fkey(id,handle,display_name,avatar_url,bio,interests)')
    .eq('post_id', postId).order('created_at', { ascending: true }).limit(200);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ id: row.id, postId: row.post_id, author: toProfile(row.profiles), body: row.body, createdAt: relativeTime(row.created_at) }));
}

export async function createPostComment(postId: UUID, body: string): Promise<PostComment> {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to reply.');
  const { data, error } = await client.from('post_comments').insert({ post_id: postId, author_id: auth.user.id, body: body.trim() })
    .select('id,post_id,body,created_at,profiles!post_comments_author_id_fkey(id,handle,display_name,avatar_url,bio,interests)').single();
  if (error) throw error;
  return { id: data.id, postId: data.post_id, author: toProfile(data.profiles), body: data.body, createdAt: relativeTime(data.created_at) };
}

export async function loadLiveSessions(): Promise<LiveSession[]> {
  if (!supabase) return demoLiveSessions;
  const freshnessCutoff = new Date(Date.now() - 60_000).toISOString();
  const { data, error } = await supabase.from('live_sessions').select('id,title,status,started_at,viewer_count,profiles!live_sessions_host_id_fkey(id,handle,display_name,avatar_url),circles(name),live_seats(user_id,role,profiles(id,handle,display_name,avatar_url))')
    .eq('status', 'live').gte('host_heartbeat_at', freshnessCutoff).order('started_at', { ascending: false });
  if (error) throw error;
  if (!data) return [];
  return data.map((row: any) => {
    const circle = Array.isArray(row.circles) ? row.circles[0] : row.circles;
    return { id: row.id, title: row.title, status: 'live', startedAt: row.started_at, viewerCount: row.viewer_count, circleName: circle?.name, host: toProfile(row.profiles), seats: (row.live_seats ?? []).map((seat: any) => ({ user: toProfile(seat.profiles), role: seat.role })) };
  });
}

export async function createLiveSession(title: string, circleId?: UUID): Promise<LiveSession> {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to start a livestream.');
  const { data, error } = await client.rpc('start_live_session', { session_title: title, target_circle_id: circleId ?? null });
  if (error) throw error;
  const { data: row, error: readError } = await client.from('live_sessions').select('id,title,status,started_at,viewer_count,profiles!live_sessions_host_id_fkey(id,handle,display_name,avatar_url),circles(name)').eq('id', data).single();
  if (readError) throw readError;
  const circle = Array.isArray(row.circles) ? row.circles[0] : row.circles;
  return { id: row.id, title: row.title, status: 'live', startedAt: row.started_at, viewerCount: 0, circleName: circle?.name, host: toProfile(row.profiles), seats: [{ user: toProfile(row.profiles), role: 'host' }] };
}

export async function endLiveSession(sessionId: UUID): Promise<void> {
  const { error } = await requireSupabase().rpc('end_live_session', { target_session_id: sessionId });
  if (error) throw error;
}

export async function heartbeatLiveSession(sessionId: UUID): Promise<void> {
  const { error } = await requireSupabase().rpc('heartbeat_live_session', { target_session_id: sessionId });
  if (error) throw error;
}

export async function requestCoHost(sessionId: UUID): Promise<UUID> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('request_live_seat', { target_session_id: sessionId });
  if (error) throw error;
  return data;
}

export async function decideCoHostRequest(requestId: UUID, accepted: boolean): Promise<void> {
  const { error } = await requireSupabase().rpc('decide_live_seat_request', { target_request_id: requestId, accept_request: accepted });
  if (error) throw error;
}

export async function sendGift(sessionId: UUID, gift: Gift, idempotencyKey: string): Promise<number | null> {
  if (!supabase) return null;
  const { data, error } = await requireSupabase().rpc('send_live_gift', { target_session_id: sessionId, target_gift_id: gift.id, idempotency_key: idempotencyKey });
  if (error) throw error;
  return Number(data);
}

export async function loadLiveGiftEvents(sessionId: UUID): Promise<LiveGiftEvent[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('live_gifts').select('id,coin_value,created_at,gifts(name,emoji),profiles!live_gifts_sender_id_fkey(id,handle,display_name,avatar_url,bio,interests)')
    .eq('session_id', sessionId).order('created_at', { ascending: false }).limit(8);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ id: row.id, sender: toProfile(row.profiles), giftName: row.gifts.name, emoji: row.gifts.emoji, coins: row.coin_value, createdAt: relativeTime(row.created_at) }));
}

export async function loadConversations(): Promise<Conversation[]> {
  if (!supabase) return demoConversations;
  const { data, error } = await supabase.rpc('list_mutual_conversations');
  if (error) throw error;
  if (!data) return [];
  return data.map((row: any) => ({ id: row.conversation_id, peer: toProfile(row.peer), isMutual: true, unread: row.unread_count, messages: row.last_message ? [{ id: row.last_message.id, senderId: row.last_message.sender_id, body: row.last_message.body, createdAt: relativeTime(row.last_message.created_at) }] : [] }));
}

export async function loadConversationMessages(peerId: UUID, before?: string, pageSize = 40): Promise<DirectMessage[]> {
  if (!supabase) return demoConversations.find((conversation) => conversation.peer.id === peerId)?.messages ?? [];
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  let query = supabase.from('direct_messages').select('id,sender_id,body,created_at')
    .or(`and(sender_id.eq.${auth.user.id},recipient_id.eq.${peerId}),and(sender_id.eq.${peerId},recipient_id.eq.${auth.user.id})`)
    .order('created_at', { ascending: false }).limit(pageSize);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).reverse().map((row) => ({ id: row.id, senderId: row.sender_id, body: row.body, createdAt: relativeTime(row.created_at), createdAtIso: row.created_at }));
}

export async function markConversationRead(peerId: UUID): Promise<void> {
  if (!supabase) return;
  const { error } = await requireSupabase().rpc('mark_conversation_read', { peer_user_id: peerId });
  if (error) throw error;
}

export async function loadPeopleAndFollows(offset = 0, pageSize = 20): Promise<{ people: Profile[]; followingIds: UUID[]; followerIds: UUID[] }> {
  if (!supabase) return { people: people.filter((person) => person.id !== currentUser.id).slice(offset, offset + pageSize), followingIds: demoConversations.map((conversation) => conversation.peer.id), followerIds: demoConversations.map((conversation) => conversation.peer.id) };
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { people: [], followingIds: [], followerIds: [] };
  const [{ data: profiles, error: profilesError }, { data: follows, error: followsError }, { data: blocks, error: blocksError }] = await Promise.all([
    supabase.from('profiles').select('id,handle,display_name,avatar_url,bio,interests').neq('id', auth.user.id).order('display_name').range(offset, offset + pageSize - 1),
    supabase.from('follows').select('follower_id,followee_id').or(`follower_id.eq.${auth.user.id},followee_id.eq.${auth.user.id}`),
    supabase.from('blocks').select('blocked_id').eq('blocker_id', auth.user.id),
  ]);
  if (profilesError) throw profilesError;
  if (followsError) throw followsError;
  if (blocksError) throw blocksError;
  const rows = follows ?? [];
  const blockedIds = new Set((blocks ?? []).map((row) => row.blocked_id));
  return {
    people: (profiles ?? []).filter((row) => !blockedIds.has(row.id)).map((row) => toProfile(row)),
    followingIds: rows.filter((row) => row.follower_id === auth.user!.id).map((row) => row.followee_id),
    followerIds: rows.filter((row) => row.followee_id === auth.user!.id).map((row) => row.follower_id),
  };
}

export async function loadFollowers(): Promise<Profile[]> {
  if (!supabase) return people.filter((person) => demoConversations.some((conversation) => conversation.peer.id === person.id));
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data: follows, error: followsError } = await supabase.from('follows').select('follower_id,created_at').eq('followee_id', auth.user.id).order('created_at', { ascending: false });
  if (followsError) throw followsError;
  const followerIds = (follows ?? []).map((row) => row.follower_id);
  if (!followerIds.length) return [];
  const { data: profiles, error: profilesError } = await supabase.from('profiles').select('id,handle,display_name,avatar_url,bio,interests').in('id', followerIds);
  if (profilesError) throw profilesError;
  const profilesById = new Map((profiles ?? []).map((row) => [row.id, toProfile(row)]));
  return followerIds.flatMap((id) => profilesById.has(id) ? [profilesById.get(id)!] : []);
}

export async function loadFollowing(): Promise<Profile[]> {
  if (!supabase) return people.filter((person) => demoConversations.some((conversation) => conversation.peer.id === person.id));
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data: follows, error: followsError } = await supabase.from('follows').select('followee_id,created_at').eq('follower_id', auth.user.id).order('created_at', { ascending: false });
  if (followsError) throw followsError;
  const followingIds = (follows ?? []).map((row) => row.followee_id);
  if (!followingIds.length) return [];
  const { data: profiles, error: profilesError } = await supabase.from('profiles').select('id,handle,display_name,avatar_url,bio,interests').in('id', followingIds);
  if (profilesError) throw profilesError;
  const profilesById = new Map((profiles ?? []).map((row) => [row.id, toProfile(row)]));
  return followingIds.flatMap((id) => profilesById.has(id) ? [profilesById.get(id)!] : []);
}

export async function loadPublicProfile(userId: UUID): Promise<Profile | null> {
  if (!supabase) return people.find((person) => person.id === userId) ?? null;
  const { data, error } = await supabase.from('profiles')
    .select('id,handle,display_name,avatar_url,bio,interests')
    .eq('id', userId).maybeSingle();
  if (error) throw error;
  return data ? toProfile(data) : null;
}

export async function loadUserFollowers(userId: UUID): Promise<Profile[]> {
  if (!supabase) {
    const followsByUser: Record<string, string[]> = {
      'user-you': ['user-cleo', 'user-mara'],
      'user-mara': ['user-you', 'user-noah'],
      'user-noah': ['user-mara'],
      'user-cleo': ['user-you'],
      'user-ari': ['user-noah'],
    };
    return (followsByUser[userId] ?? []).flatMap((id) => {
      const person = people.find((item) => item.id === id);
      return person ? [person] : [];
    });
  }
  const { data: follows, error: followsError } = await supabase.from('follows')
    .select('follower_id,created_at').eq('followee_id', userId)
    .order('created_at', { ascending: false }).limit(100);
  if (followsError) throw followsError;
  const ids = (follows ?? []).map((row) => row.follower_id);
  if (!ids.length) return [];
  const { data: profiles, error: profilesError } = await supabase.from('profiles')
    .select('id,handle,display_name,avatar_url,bio,interests').in('id', ids);
  if (profilesError) throw profilesError;
  const byId = new Map((profiles ?? []).map((row) => [row.id, toProfile(row)]));
  return ids.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []);
}

export async function loadUserFollowing(userId: UUID): Promise<Profile[]> {
  if (!supabase) {
    const followsByUser: Record<string, string[]> = {
      'user-you': ['user-mara', 'user-noah'],
      'user-mara': ['user-you', 'user-cleo'],
      'user-noah': ['user-you', 'user-mara'],
      'user-cleo': ['user-you'],
      'user-ari': ['user-mara', 'user-noah'],
    };
    return (followsByUser[userId] ?? []).flatMap((id) => {
      const person = people.find((item) => item.id === id);
      return person ? [person] : [];
    });
  }
  const { data: follows, error: followsError } = await supabase.from('follows')
    .select('followee_id,created_at').eq('follower_id', userId)
    .order('created_at', { ascending: false }).limit(100);
  if (followsError) throw followsError;
  const ids = (follows ?? []).map((row) => row.followee_id);
  if (!ids.length) return [];
  const { data: profiles, error: profilesError } = await supabase.from('profiles')
    .select('id,handle,display_name,avatar_url,bio,interests').in('id', ids);
  if (profilesError) throw profilesError;
  const byId = new Map((profiles ?? []).map((row) => [row.id, toProfile(row)]));
  return ids.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []);
}

export async function sendDirectMessage(recipientId: UUID, body: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('send_direct_message', { recipient_user_id: recipientId, message_body: body.trim() });
  if (error) throw error;
}

export async function followUser(targetUserId: UUID): Promise<void> {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to follow people.');
  const { error } = await client.from('follows').insert({ follower_id: auth.user.id, followee_id: targetUserId });
  if (error && error.code !== '23505') throw error;
}

export async function unfollowUser(targetUserId: UUID): Promise<void> {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to manage follows.');
  const { error } = await client.from('follows').delete().eq('follower_id', auth.user.id).eq('followee_id', targetUserId);
  if (error) throw error;
}

export async function reportContent(input: { targetType: string; targetId: UUID; reason: string }): Promise<void> {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to report content.');
  const { error } = await client.from('reports').insert({ reporter_id: auth.user.id, target_type: input.targetType, target_id: input.targetId, reason: input.reason });
  if (error) throw error;
}

export async function blockUser(targetUserId: UUID): Promise<void> {
  const { error } = await requireSupabase().rpc('block_user', { target_user_id: targetUserId });
  if (error) throw error;
}

export async function loadGiftCatalog(): Promise<Gift[]> {
  if (!supabase) return demoGifts;
  const { data, error } = await supabase.from('gifts').select('id,name,emoji,coin_value,tier').eq('is_active', true).order('coin_value').limit(300);
  if (error) throw error;
  if (!data) return [];
  return data.map((row) => ({ id: row.id, name: row.name, emoji: row.emoji, coins: row.coin_value, tier: row.tier }));
}

export function isLiveBackendConfigured() {
  return backendReady;
}

export function getDemoCurrentUser() { return currentUser; }

function toProfile(row: any) {
  return { id: row.id, handle: row.handle, displayName: row.display_name, avatarUrl: row.avatar_url ?? '', bio: row.bio ?? '', interests: row.interests ?? [] };
}

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function createIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
