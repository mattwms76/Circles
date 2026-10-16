import { secureStorage as AsyncStorage } from './secureStorage';
import * as FileSystem from 'expo-file-system/legacy';
import { signedMediaUrls, uploadWithProgress } from './media';
import type {
  Circle,
  CircleJoinRequest,
  CirclePost,
  Conversation,
  CreatePostInput,
  DirectMessage,
  Gift,
  LiveGiftEvent,
  LiveSession,
  PostComment,
  Profile,
  UUID,
} from '../types';
import {
  circles as demoCircles,
  conversations as demoConversations,
  currentUser,
  gifts as demoGifts,
  liveSessions as demoLiveSessions,
  people,
  posts as demoPosts,
} from '../data/demo';
import { backendReady, requireSupabase, supabase } from './supabase';
import { messageCursorFilter, type MessageCursor } from './messagePagination';

const postMediaBucket = 'post-media';

export async function loadOwnProfile(): Promise<Profile> {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to load your profile.');
  const { data, error } = await client
    .from('profiles')
    .select('id,handle,display_name,avatar_url,bio,interests,onboarding_completed_at')
    .eq('id', auth.user.id)
    .single();
  if (error) throw error;
  return toProfile(data);
}

export async function updateOwnProfile(
  input: Pick<Profile, 'displayName' | 'bio' | 'interests'> & { avatarUrl?: string },
  expectedUserId?: UUID,
): Promise<Profile> {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to update your profile.');
  if (expectedUserId && auth.user.id !== expectedUserId)
    throw new Error('Your account changed. Please try again.');
  const { data, error } = await client
    .from('profiles')
    .update({
      display_name: input.displayName.trim(),
      bio: (input.bio ?? '').trim(),
      interests: input.interests ?? [],
      ...(input.avatarUrl !== undefined ? { avatar_url: input.avatarUrl } : {}),
    })
    .eq('id', auth.user.id)
    .select('id,handle,display_name,avatar_url,bio,interests,onboarding_completed_at')
    .single();
  if (error) throw error;
  return toProfile(data);
}

export async function loadCircles(offset = 0, pageSize = 30): Promise<Circle[]> {
  if (!supabase) return demoCircles.slice(offset, offset + pageSize);
  const { data, error } = await supabase
    .from('circles')
    .select('id,name,description,interest,members_count,is_private,cover_url,cover_color')
    .order('members_count', { ascending: false })
    .order('id', { ascending: true })
    .range(offset, offset + pageSize - 1);
  if (error) throw error;
  if (!data) return [];
  const { data: auth } = await supabase.auth.getUser();
  let memberships: { circle_id: string; status: string; role: string }[] = [];
  if (auth.user) {
    const { data, error: membershipError } = await supabase
      .from('circle_memberships')
      .select('circle_id,status,role')
      .eq('user_id', auth.user.id);
    if (membershipError) throw membershipError;
    memberships = data ?? [];
  }
  const byId = new Map(
    (memberships ?? [])
      .filter((item) => item.status === 'member')
      .map((item) => [item.circle_id, item.role]),
  );
  const missing = [...byId.keys()].filter((id) => !data.some((c) => c.id === id));
  if (missing.length) {
    const extra = await supabase
      .from('circles')
      .select('id,name,description,interest,members_count,is_private,cover_url,cover_color')
      .in('id', missing);
    if (extra.error) throw extra.error;
    data.push(...(extra.data ?? []));
  }
  return data.map((circle) => ({
    id: circle.id,
    name: circle.name,
    description: circle.description,
    interest: circle.interest,
    members: circle.members_count,
    isPrivate: circle.is_private,
    isMember: byId.has(circle.id),
    isOwner: byId.get(circle.id) === 'owner',
    color: circle.cover_color,
    imageUrl: circle.cover_url ?? '',
  }));
}

export async function joinCircle(circle: Circle): Promise<'member' | 'pending'> {
  if (!supabase) return circle.isPrivate ? 'pending' : 'member';
  const { data, error } = await supabase.rpc('request_circle_membership', {
    target_circle_id: circle.id,
  });
  if (error) throw error;
  return data === 'pending' ? 'pending' : 'member';
}

export async function leaveCircle(
  circleId: UUID,
  cancelPending = false,
): Promise<'left' | 'request_cancelled' | 'not_member'> {
  if (!supabase) return cancelPending ? 'request_cancelled' : 'left';
  const { data, error } = await requireSupabase().rpc('leave_circle', {
    target_circle_id: circleId,
  });
  if (error) throw error;
  if (data === 'left' || data === 'request_cancelled' || data === 'not_member') return data;
  throw new Error('Could not confirm the circle membership change. Refresh and try again.');
}

export async function createCircle(
  input: Pick<Circle, 'name' | 'description' | 'interest' | 'isPrivate'>,
): Promise<Circle> {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to create a circle.');
  const { data, error } = await client
    .from('circles')
    .insert({
      name: input.name,
      description: input.description,
      interest: input.interest,
      is_private: input.isPrivate,
      owner_id: auth.user.id,
    })
    .select('id,name,description,interest,members_count,is_private,cover_url,cover_color')
    .single();
  if (error) throw error;
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    interest: data.interest,
    members: Math.max(data.members_count, 1),
    isPrivate: data.is_private,
    isMember: true,
    isOwner: true,
    color: data.cover_color,
    imageUrl: data.cover_url ?? '',
  };
}

export async function loadCircleRequests(): Promise<CircleJoinRequest[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('circle_memberships')
    .select(
      'circle_id,user_id,circles!circle_memberships_circle_id_fkey(name),profiles!circle_memberships_user_id_fkey(id,handle,display_name,avatar_url)',
    )
    .eq('status', 'pending')
    .order('joined_at');
  if (error) throw error;
  if (!data) return [];
  return data.map((row: any) => ({
    id: `${row.circle_id}:${row.user_id}`,
    circleId: row.circle_id,
    circleName: row.circles.name,
    requester: {
      id: row.profiles.id,
      handle: row.profiles.handle,
      displayName: row.profiles.display_name,
      avatarUrl: row.profiles.avatar_url ?? '',
      interests: [],
    },
  }));
}

export async function loadMyPendingCircleIds(): Promise<UUID[]> {
  if (!supabase) return [];
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await supabase
    .from('circle_memberships')
    .select('circle_id')
    .eq('user_id', auth.user.id)
    .eq('status', 'pending');
  if (error) throw error;
  return (data ?? []).map((row) => row.circle_id);
}

export async function decideCircleJoinRequest(
  circleId: UUID,
  requesterId: UUID,
  accepted: boolean,
): Promise<void> {
  const { error } = await requireSupabase()
    .from('circle_memberships')
    .update({ status: accepted ? 'member' : 'declined' })
    .eq('circle_id', circleId)
    .eq('user_id', requesterId);
  if (error) throw error;
}

export async function loadPosts(offset = 0, pageSize = 20): Promise<CirclePost[]> {
  if (!supabase) return demoPosts.slice(offset, offset + pageSize);
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const raw = await AsyncStorage.getItem(`circles:experience:${auth.user.id}:community:feed-mode`);
  const mode = raw === '"latest"' ? 'latest' : 'recommended';
  const result = await supabase.rpc('personal_feed', {
    sort_mode: mode,
    page_offset: offset,
    page_size: pageSize,
  });
  if (result.error) throw result.error;
  const ranked = (result.data as { id: string; reason: string }[]) ?? [];
  if (!ranked.length) return [];
  const posts = await fetchPosts(
    0,
    pageSize,
    undefined,
    undefined,
    undefined,
    undefined,
    ranked.map((r) => r.id),
  );
  return ranked.flatMap((r) => {
    const post = posts.find((p) => p.id === r.id);
    return post ? [{ ...post, reason: r.reason }] : [];
  });
}

export async function loadCirclePosts(
  circleId: UUID,
  offset = 0,
  pageSize = 20,
): Promise<CirclePost[]> {
  if (!supabase)
    return demoPosts.filter((post) => post.circleId === circleId).slice(offset, offset + pageSize);
  return fetchPosts(offset, pageSize, circleId);
}

export async function loadPostById(id: UUID): Promise<CirclePost | null> {
  if (!supabase) return demoPosts.find((p) => p.id === id) ?? null;
  return (await fetchPosts(0, 1, undefined, undefined, id))[0] ?? null;
}
export async function loadCircleById(id: UUID): Promise<Circle | null> {
  if (!supabase) return demoCircles.find((c) => c.id === id) ?? null;
  const { data, error } = await supabase.from('circles').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { data: auth } = await supabase.auth.getUser();
  const { data: member } = await supabase
    .from('circle_memberships')
    .select('role,status')
    .eq('circle_id', id)
    .eq('user_id', auth.user?.id ?? '')
    .maybeSingle();
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    interest: data.interest,
    members: data.members_count,
    isPrivate: data.is_private,
    isMember: member?.status === 'member',
    isOwner: member?.role === 'owner',
    imageUrl: data.cover_url ?? '',
    color: data.cover_color,
    welcomeText: data.welcome_text,
  };
}

export async function loadProfilePosts(
  authorId: UUID,
  offset = 0,
  pageSize = 20,
): Promise<CirclePost[]> {
  if (!supabase)
    return demoPosts.filter((post) => post.author.id === authorId).slice(offset, offset + pageSize);
  return fetchPosts(offset, pageSize, undefined, authorId);
}

async function fetchPosts(
  offset: number,
  pageSize: number,
  circleId?: UUID,
  authorId?: UUID,
  postId?: UUID,
  search?: { text: string; media: 'all' | 'image' | 'video' },
  postIds?: string[],
  topicId?: string,
): Promise<CirclePost[]> {
  if (!supabase) return demoPosts.slice(offset, offset + pageSize);
  let query = supabase
    .from('posts')
    .select(
      `id,circle_id,body,created_at,post_type,topic_id,profiles!posts_author_id_fkey(id,handle,display_name,avatar_url),circles!posts_circle_id_fkey(name),post_media${search && search.media !== 'all' ? '!inner' : ''}(id,kind,storage_path,position,cover_path,subtitles),post_likes(user_id)`,
    )
    .eq('visibility', 'published');
  if (topicId) query = query.eq('topic_id', topicId);
  if (postIds) query = query.in('id', postIds);
  if (circleId) query = query.eq('circle_id', circleId);
  if (authorId) query = query.eq('author_id', authorId);
  if (postId) query = query.eq('id', postId);
  if (search?.text.trim())
    query = query.ilike('body', `%${search.text.trim().replace(/[\\%_]/g, '\\$&')}%`);
  if (search && search.media !== 'all')
    query =
      search.media === 'image'
        ? query.in('post_media.kind', ['image', 'gif'])
        : query.eq('post_media.kind', 'video');
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + pageSize - 1);
  if (error) throw error;
  if (!data) return [];
  const { data: auth } = await supabase.auth.getUser();
  const signedUrls = await signedMediaUrls(
    data.flatMap(
      (row: any) =>
        row.post_media?.flatMap((m: any) => [
          m.storage_path,
          ...(m.cover_path ? [m.cover_path] : []),
        ]) ?? [],
    ),
    auth.user?.id ?? '',
  );
  return data.map((row: any) => {
    const mediaItems = [...(row.post_media ?? [])]
      .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
      .flatMap((item: any) => {
        const url = signedUrls.get(item.storage_path);
        return url
          ? [
              {
                id: item.id,
                kind: item.kind,
                url,
                storagePath: item.storage_path,
                position: item.position,
                coverUrl: item.cover_path ? signedUrls.get(item.cover_path) : undefined,
                subtitles: item.subtitles ?? [],
              },
            ]
          : [];
      });
    const media = mediaItems[0];
    return {
      id: row.id,
      circleId: row.circle_id,
      circleName: row.circles?.name ?? 'A circle',
      author: {
        id: row.profiles.id,
        handle: row.profiles.handle,
        displayName: row.profiles.display_name,
        avatarUrl: row.profiles.avatar_url ?? '',
        interests: [],
      },
      body: row.body,
      postType: row.post_type,
      topicId: row.topic_id,
      mediaItems,
      likes: row.post_likes?.length ?? 0,
      createdAt: relativeTime(row.created_at),
      liked: Boolean(
        auth.user && row.post_likes?.some((like: any) => like.user_id === auth.user!.id),
      ),
      media,
    };
  });
}

export async function createPost(
  input: CreatePostInput,
  options: { onProgress?: (progress: number) => void; signal?: AbortSignal } = {},
): Promise<void> {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to post.');
  const attachments = input.mediaItems?.length
    ? input.mediaItems
    : input.media
      ? [input.media]
      : [];
  if (
    attachments.length > 10 ||
    (attachments.length > 1 && attachments.some((m) => m.kind !== 'image'))
  )
    throw new Error('Choose up to 10 photos, or one video or GIF.');
  for (const attachment of attachments) {
    const info = await FileSystem.getInfoAsync(attachment.uri);
    if (!info.exists)
      throw new Error('The attachment is no longer on this device. Choose it again.');
    if (info.size > 25 * 1024 * 1024) throw new Error('Media must be 25 MB or smaller.');
    const allowed = {
      image: ['image/jpeg', 'image/png', 'image/webp'],
      gif: ['image/gif'],
      video: ['video/mp4', 'video/quicktime', 'video/webm'],
    };
    if (!allowed[attachment.kind].includes(attachment.mimeType))
      throw new Error('Choose a supported photo, GIF, or video.');
  }
  const requestId = input.requestId ?? createIdempotencyKey();
  let { data: post, error } = await client
    .from('posts')
    .insert({
      circle_id: input.circleId,
      author_id: auth.user.id,
      body: input.body.trim(),
      topic_id: input.topicId ?? null,
      visibility: attachments.length ? 'removed' : 'published',
      upload_pending: attachments.length > 0,
      client_request_id: requestId,
    })
    .select('id,visibility')
    .single();
  if (error?.code === '23505') {
    const previous = await client
      .from('posts')
      .select('id,visibility')
      .eq('author_id', auth.user.id)
      .eq('client_request_id', requestId)
      .single();
    post = previous.data;
    error = previous.error;
    if (post?.visibility === 'published') return;
  }
  if (error || !post) throw error ?? new Error('Could not save your post.');
  if (!attachments.length) return;
  for (const [position, attachment] of attachments.entries()) {
    const path = `${auth.user.id}/${post.id}/${attachments.length > 1 ? position + '-' : ''}${attachment.fileName.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
    // Keep partial uploads for TUS resume. A completed upload may precede a lost metadata response.
    const existing = await client.storage
      .from(postMediaBucket)
      .list(`${auth.user.id}/${post.id}`, { search: path.split('/').pop() });
    if (existing.error) throw existing.error;
    const uploaded = existing.data.some((file) => file.name === path.split('/').pop());
    try {
      if (!uploaded)
        await uploadWithProgress(
          postMediaBucket,
          path,
          attachment.uri,
          attachment.mimeType,
          (value) => options.onProgress?.((position + value) / attachments.length),
          options.signal,
        );
      if (options.signal?.aborted) throw new Error('Upload cancelled. Your draft is saved.');
      let coverPath: string | null = null;
      if (attachment.coverUri) {
        coverPath = `${auth.user.id}/${post.id}/cover-${position}.jpg`;
        const cover = await FileSystem.getInfoAsync(attachment.coverUri);
        if (!cover.exists || cover.size > 5 * 1024 * 1024)
          throw new Error('Choose a video cover smaller than 5 MB.');
        const priorCover = await client.storage
          .from(postMediaBucket)
          .list(`${auth.user.id}/${post.id}`, { search: `cover-${position}.jpg` });
        if (priorCover.error) throw priorCover.error;
        if (!priorCover.data.some((f) => f.name === `cover-${position}.jpg`))
          await uploadWithProgress(
            postMediaBucket,
            coverPath,
            attachment.coverUri,
            'image/jpeg',
            undefined,
            options.signal,
          );
      }
      const metadata = await client.from('post_media').insert({
        post_id: post.id,
        owner_id: auth.user.id,
        kind: attachment.kind,
        storage_path: path,
        mime_type: attachment.mimeType,
        position,
        cover_path: coverPath,
        subtitles: attachment.subtitles ?? [],
      });
      if (metadata.error && metadata.error.code !== '23505') throw metadata.error;
    } catch (uploadError) {
      throw uploadError;
    }
  }
  // A lost publish response is ambiguous: preserve the upload and retry with the same request ID.
  const published = await client
    .from('posts')
    .update({ visibility: 'published' })
    .eq('id', post.id)
    .eq('author_id', auth.user.id)
    .select('id')
    .single();
  if (published.error) throw published.error;
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

export async function loadPostComments(postId: UUID, limit = 51): Promise<PostComment[]> {
  if (!supabase) return [];
  const rows: any[] = [];
  const count = Math.max(1, Math.floor(limit));
  for (let offset = 0; offset < count; offset += 200) {
    const take = Math.min(200, count - offset);
    const { data, error } = await supabase
      .from('post_comments')
      .select(
        'id,post_id,body,created_at,reply_to_id,profiles!post_comments_author_id_fkey(id,handle,display_name,avatar_url,bio,interests)',
      )
      .eq('post_id', postId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + take - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < take) break;
  }
  return rows.reverse().map((row) => ({
    id: row.id,
    postId: row.post_id,
    author: toProfile(row.profiles),
    body: row.body,
    createdAt: relativeTime(row.created_at),
    createdAtIso: row.created_at,
    replyToId: row.reply_to_id,
  }));
}

export async function createPostComment(
  postId: UUID,
  body: string,
  replyToId?: UUID,
  expectedUserId?: UUID,
): Promise<PostComment> {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to reply.');
  if (expectedUserId && auth.user.id !== expectedUserId)
    throw new Error('Your account changed. Reopen the post before replying.');
  if (!body.trim() || [...body.trim()].length > 2000)
    throw new Error('Replies must contain 1–2000 characters.');
  const { data, error } = await client
    .from('post_comments')
    .insert({
      post_id: postId,
      author_id: auth.user.id,
      body: body.trim(),
      reply_to_id: replyToId ?? null,
    })
    .select(
      'id,post_id,body,created_at,reply_to_id,profiles!post_comments_author_id_fkey(id,handle,display_name,avatar_url,bio,interests)',
    )
    .single();
  if (error) throw error;
  return {
    id: data.id,
    postId: data.post_id,
    author: toProfile(data.profiles),
    body: data.body,
    createdAt: relativeTime(data.created_at),
    createdAtIso: data.created_at,
    replyToId: data.reply_to_id,
  };
}

async function deleteOwnContent(
  table: 'direct_messages' | 'post_comments',
  id: UUID,
): Promise<void> {
  const client = requireSupabase();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!auth.user) throw new Error('Sign in to delete your content.');
  const ownerColumn = table === 'direct_messages' ? 'sender_id' : 'author_id';
  const { data, error } = await client
    .from(table)
    .delete()
    .eq('id', id)
    .eq(ownerColumn, auth.user.id)
    .select('id');
  if (error) throw error;
  if (!data?.length)
    throw new Error('This item is unavailable or its 15-minute deletion window has ended.');
}

export async function deleteDirectMessage(id: UUID): Promise<void> {
  await deleteOwnContent('direct_messages', id);
}

export async function deletePostComment(id: UUID): Promise<void> {
  await deleteOwnContent('post_comments', id);
}

export async function loadLiveSessions(): Promise<LiveSession[]> {
  if (!supabase) return demoLiveSessions;
  const freshnessCutoff = new Date(Date.now() - 60_000).toISOString();
  const { data, error } = await supabase
    .from('live_sessions')
    .select(
      'id,title,status,started_at,viewer_count,profiles!live_sessions_host_id_fkey(id,handle,display_name,avatar_url),circles(name),live_seats(user_id,role,profiles(id,handle,display_name,avatar_url))',
    )
    .eq('status', 'live')
    .gte('host_heartbeat_at', freshnessCutoff)
    .order('started_at', { ascending: false });
  if (error) throw error;
  if (!data) return [];
  return data.map((row: any) => {
    const circle = Array.isArray(row.circles) ? row.circles[0] : row.circles;
    return {
      id: row.id,
      title: row.title,
      status: 'live',
      startedAt: row.started_at,
      viewerCount: row.viewer_count,
      circleName: circle?.name,
      host: toProfile(row.profiles),
      seats: (row.live_seats ?? []).map((seat: any) => ({
        user: toProfile(seat.profiles),
        role: seat.role,
      })),
    };
  });
}

export async function createLiveSession(title: string, circleId?: UUID): Promise<LiveSession> {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to start a livestream.');
  const { data, error } = await client.rpc('start_live_session', {
    session_title: title,
    target_circle_id: circleId ?? null,
  });
  if (error) throw error;
  const { data: row, error: readError } = await client
    .from('live_sessions')
    .select(
      'id,title,status,started_at,viewer_count,profiles!live_sessions_host_id_fkey(id,handle,display_name,avatar_url),circles(name)',
    )
    .eq('id', data)
    .single();
  if (readError) throw readError;
  const circle = Array.isArray(row.circles) ? row.circles[0] : row.circles;
  return {
    id: row.id,
    title: row.title,
    status: 'live',
    startedAt: row.started_at,
    viewerCount: 0,
    circleName: circle?.name,
    host: toProfile(row.profiles),
    seats: [{ user: toProfile(row.profiles), role: 'host' }],
  };
}

export async function endLiveSession(sessionId: UUID): Promise<void> {
  const { error } = await requireSupabase().rpc('end_live_session', {
    target_session_id: sessionId,
  });
  if (error) throw error;
}

export async function heartbeatLiveSession(sessionId: UUID): Promise<void> {
  const { error } = await requireSupabase().rpc('heartbeat_live_session', {
    target_session_id: sessionId,
  });
  if (error) throw error;
}

export async function requestCoHost(sessionId: UUID): Promise<UUID> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('request_live_seat', { target_session_id: sessionId });
  if (error) throw error;
  return data;
}

export async function decideCoHostRequest(requestId: UUID, accepted: boolean): Promise<void> {
  const { error } = await requireSupabase().rpc('decide_live_seat_request', {
    target_request_id: requestId,
    accept_request: accepted,
  });
  if (error) throw error;
}

export async function sendGift(
  sessionId: UUID,
  gift: Gift,
  idempotencyKey: string,
): Promise<number | null> {
  if (!supabase) return null;
  const { data, error } = await requireSupabase().rpc('send_live_gift', {
    target_session_id: sessionId,
    target_gift_id: gift.id,
    idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  return Number(data);
}

export async function loadLiveGiftEvents(sessionId: UUID): Promise<LiveGiftEvent[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('live_gifts')
    .select(
      'id,coin_value,created_at,gifts(name,emoji),profiles!live_gifts_sender_id_fkey(id,handle,display_name,avatar_url,bio,interests)',
    )
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(8);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    sender: toProfile(row.profiles),
    giftName: row.gifts.name,
    emoji: row.gifts.emoji,
    coins: row.coin_value,
    createdAt: relativeTime(row.created_at),
  }));
}

export async function loadConversations(): Promise<Conversation[]> {
  if (!supabase) return demoConversations;
  const { data, error } = await supabase.rpc('list_mutual_conversations');
  if (error) throw error;
  if (!data) return [];
  return data.map((row: any) => ({
    id: row.conversation_id,
    peer: toProfile(row.peer),
    isMutual: true,
    unread: row.unread_count,
    messages: row.last_message
      ? [
          {
            id: row.last_message.id,
            senderId: row.last_message.sender_id,
            body: row.last_message.body,
            createdAt: relativeTime(row.last_message.created_at),
            createdAtIso: row.last_message.created_at,
          },
        ]
      : [],
  }));
}

export async function loadConversationMessages(
  peerId: UUID,
  before?: MessageCursor,
  pageSize = 40,
): Promise<DirectMessage[]> {
  if (!supabase)
    return (
      demoConversations.find((conversation) => conversation.peer.id === peerId)?.messages ?? []
    );
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  let query = supabase
    .from('direct_messages')
    .select('id,sender_id,body,created_at,reply_to_id,read_at')
    .or(
      `and(sender_id.eq.${auth.user.id},recipient_id.eq.${peerId}),and(sender_id.eq.${peerId},recipient_id.eq.${auth.user.id})`,
    )
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageSize);
  if (before) query = query.or(messageCursorFilter(before));
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).reverse().map((row) => ({
    id: row.id,
    senderId: row.sender_id,
    body: row.body,
    createdAt: relativeTime(row.created_at),
    createdAtIso: row.created_at,
    replyToId: row.reply_to_id,
    readAt: row.read_at,
  }));
}

export async function markConversationRead(peerId: UUID): Promise<void> {
  if (!supabase) return;
  const { error } = await requireSupabase().rpc('mark_conversation_read', { peer_user_id: peerId });
  if (error) throw error;
}

export async function loadPeopleAndFollows(
  offset = 0,
  pageSize = 20,
): Promise<{ people: Profile[]; followingIds: UUID[]; followerIds: UUID[] }> {
  if (!supabase)
    return {
      people: people
        .filter((person) => person.id !== currentUser.id)
        .slice(offset, offset + pageSize),
      followingIds: demoConversations.map((conversation) => conversation.peer.id),
      followerIds: demoConversations.map((conversation) => conversation.peer.id),
    };
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { people: [], followingIds: [], followerIds: [] };
  const [
    { data: profiles, error: profilesError },
    { data: follows, error: followsError },
    { data: blocks, error: blocksError },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('id,handle,display_name,avatar_url,bio,interests')
      .neq('id', auth.user.id)
      .order('display_name')
      .range(offset, offset + pageSize - 1),
    supabase
      .from('follows')
      .select('follower_id,followee_id')
      .or(`follower_id.eq.${auth.user.id},followee_id.eq.${auth.user.id}`),
    supabase.from('blocks').select('blocked_id').eq('blocker_id', auth.user.id),
  ]);
  if (profilesError) throw profilesError;
  if (followsError) throw followsError;
  if (blocksError) throw blocksError;
  const rows = follows ?? [];
  const blockedIds = new Set((blocks ?? []).map((row) => row.blocked_id));
  return {
    people: (profiles ?? []).filter((row) => !blockedIds.has(row.id)).map((row) => toProfile(row)),
    followingIds: rows
      .filter((row) => row.follower_id === auth.user!.id)
      .map((row) => row.followee_id),
    followerIds: rows
      .filter((row) => row.followee_id === auth.user!.id)
      .map((row) => row.follower_id),
  };
}

export async function loadFollowers(): Promise<Profile[]> {
  if (!supabase)
    return people.filter((person) =>
      demoConversations.some((conversation) => conversation.peer.id === person.id),
    );
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data: follows, error: followsError } = await supabase
    .from('follows')
    .select('follower_id,created_at')
    .eq('followee_id', auth.user.id)
    .order('created_at', { ascending: false });
  if (followsError) throw followsError;
  const followerIds = (follows ?? []).map((row) => row.follower_id);
  if (!followerIds.length) return [];
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id,handle,display_name,avatar_url,bio,interests')
    .in('id', followerIds);
  if (profilesError) throw profilesError;
  const profilesById = new Map((profiles ?? []).map((row) => [row.id, toProfile(row)]));
  return followerIds.flatMap((id) => (profilesById.has(id) ? [profilesById.get(id)!] : []));
}

export async function loadFollowing(): Promise<Profile[]> {
  if (!supabase)
    return people.filter((person) =>
      demoConversations.some((conversation) => conversation.peer.id === person.id),
    );
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data: follows, error: followsError } = await supabase
    .from('follows')
    .select('followee_id,created_at')
    .eq('follower_id', auth.user.id)
    .order('created_at', { ascending: false });
  if (followsError) throw followsError;
  const followingIds = (follows ?? []).map((row) => row.followee_id);
  if (!followingIds.length) return [];
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id,handle,display_name,avatar_url,bio,interests')
    .in('id', followingIds);
  if (profilesError) throw profilesError;
  const profilesById = new Map((profiles ?? []).map((row) => [row.id, toProfile(row)]));
  return followingIds.flatMap((id) => (profilesById.has(id) ? [profilesById.get(id)!] : []));
}

export async function loadPublicProfile(userId: UUID): Promise<Profile | null> {
  if (!supabase) return people.find((person) => person.id === userId) ?? null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id,handle,display_name,avatar_url,bio,interests')
    .eq('id', userId)
    .maybeSingle();
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
  const { data: follows, error: followsError } = await supabase
    .from('follows')
    .select('follower_id,created_at')
    .eq('followee_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (followsError) throw followsError;
  const ids = (follows ?? []).map((row) => row.follower_id);
  if (!ids.length) return [];
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id,handle,display_name,avatar_url,bio,interests')
    .in('id', ids);
  if (profilesError) throw profilesError;
  const byId = new Map((profiles ?? []).map((row) => [row.id, toProfile(row)]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
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
  const { data: follows, error: followsError } = await supabase
    .from('follows')
    .select('followee_id,created_at')
    .eq('follower_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (followsError) throw followsError;
  const ids = (follows ?? []).map((row) => row.followee_id);
  if (!ids.length) return [];
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id,handle,display_name,avatar_url,bio,interests')
    .in('id', ids);
  if (profilesError) throw profilesError;
  const byId = new Map((profiles ?? []).map((row) => [row.id, toProfile(row)]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

export async function sendDirectMessage(
  recipientId: UUID,
  body: string,
  replyToId?: UUID,
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('send_message_reply', {
    recipient_user_id: recipientId,
    message_body: body.trim(),
    parent_id: replyToId ?? null,
  });
  if (error) throw error;
}

export async function followUser(targetUserId: UUID): Promise<void> {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to follow people.');
  const { error } = await client
    .from('follows')
    .insert({ follower_id: auth.user.id, followee_id: targetUserId });
  if (error && error.code !== '23505') throw error;
}

export async function unfollowUser(targetUserId: UUID): Promise<void> {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to manage follows.');
  const { error } = await client
    .from('follows')
    .delete()
    .eq('follower_id', auth.user.id)
    .eq('followee_id', targetUserId);
  if (error) throw error;
}

export async function reportContent(input: {
  targetType: string;
  targetId: UUID;
  reason: string;
}): Promise<void> {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to report content.');
  const { error } = await client.from('reports').insert({
    reporter_id: auth.user.id,
    target_type: input.targetType,
    target_id: input.targetId,
    reason: input.reason,
  });
  if (error) throw error;
}

export async function blockUser(targetUserId: UUID): Promise<void> {
  const { error } = await requireSupabase().rpc('block_user', { target_user_id: targetUserId });
  if (error) throw error;
}

export async function loadGiftCatalog(): Promise<Gift[]> {
  if (!supabase) return demoGifts;
  const { data, error } = await supabase
    .from('gifts')
    .select('id,name,emoji,coin_value,tier')
    .eq('is_active', true)
    .order('coin_value')
    .limit(300);
  if (error) throw error;
  if (!data) return [];
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    coins: row.coin_value,
    tier: row.tier,
  }));
}

export function isLiveBackendConfigured() {
  return backendReady;
}

export function getDemoCurrentUser() {
  return currentUser;
}

export function toProfile(row: any) {
  return {
    onboardingCompletedAt: row.onboarding_completed_at,
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? '',
    bio: row.bio ?? '',
    interests: row.interests ?? [],
  };
}

export function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function createIdempotencyKey() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
  );
}

export async function searchCirclePosts(
  circleId: string,
  text: string,
  media: 'all' | 'image' | 'video',
  offset = 0,
): Promise<CirclePost[]> {
  if (!supabase)
    return demoPosts
      .filter(
        (p) =>
          p.circleId === circleId &&
          p.body.toLowerCase().includes(text.toLowerCase()) &&
          (media === 'all' ||
            (media === 'image'
              ? ['image', 'gif'].includes(p.media?.kind ?? '')
              : p.media?.kind === 'video')),
      )
      .slice(offset, offset + 20);
  return fetchPosts(offset, 20, circleId, undefined, undefined, { text, media });
}

export async function loadTopicPosts(topicId: string, offset = 0) {
  return fetchPosts(offset, 20, undefined, undefined, undefined, undefined, undefined, topicId);
}
