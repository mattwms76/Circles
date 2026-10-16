import { secureStorage as AsyncStorage } from './secureStorage';
import { supabase } from './supabase';
import { loadPostById } from './repositories';
import { createTextDraftStore } from './textDraftStore';

export type FeedMode = 'recommended' | 'latest';
export interface FeedChoice {
  circle_id: string;
  favourite: boolean;
  see_less: boolean;
  snoozed_until: string | null;
}
export interface Topic {
  id: string;
  circle_id: string;
  name: string;
}
export interface Collection extends Topic {
  creator_id: string;
}
export interface GroupMessage {
  id: string;
  circle_id: string;
  author_id: string;
  body: string;
  created_at: string;
  media_kind?: 'photo' | 'voice';
  media_path?: string;
  duration_ms?: number;
  profiles?: { display_name: string };
}
export interface Recognition {
  circle_id: string;
  user_id: string;
  label: string;
  profiles?: { display_name: string };
}
export interface Catchup {
  since: string;
  posts: { id: string; circle_id: string; body: string }[];
  unanswered: { id: string; body: string }[];
  events: { id: string; circle_id: string; title: string; starts_at: string }[];
  replies: { id: string; target_id: string; title: string }[];
}
export interface CircleDepth {
  topics: Topic[];
  collections: Collection[];
  recognition: Recognition[];
  members: { user_id: string; role: string; profiles: { display_name: string } }[];
  chat: { enabled: boolean; slow_seconds: number };
  prompt: { question: string; weekday: number; enabled: boolean } | null;
  host: boolean;
}
function checked<T>(r: { data: T; error: any }): T {
  if (r.error) throw r.error;
  return r.data;
}
const key = (user: string, part: string) => `circles:experience:${user}:community:${part}`;
const communityStorage = createTextDraftStore(AsyncStorage);
function matchesCacheShape(value: unknown, fallback: unknown): boolean {
  if (fallback === null) return true;
  if (Array.isArray(fallback)) return Array.isArray(value) && value.every((item) => item != null);
  if (typeof fallback === 'object') {
    return (
      !!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.entries(fallback as Record<string, unknown>).every(([field, sample]) =>
        matchesCacheShape((value as Record<string, unknown>)[field], sample),
      )
    );
  }
  return typeof value === typeof fallback;
}
export async function localValue<T>(user: string, part: string, fallback: T): Promise<T> {
  try {
    const raw = await communityStorage.read(key(user, part));
    const value = raw ? JSON.parse(raw) : fallback;
    return matchesCacheShape(value, fallback) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}
export async function storeValue(user: string, part: string, value: unknown) {
  await communityStorage.save(key(user, part), JSON.stringify(value));
}
export async function assertAccount(user: string) {
  if (supabase) {
    const r = await supabase.auth.getUser();
    if (r.error || r.data.user?.id !== user)
      throw new Error('Your account changed. Please sign in again.');
  }
}
export async function feedMode(user: string): Promise<FeedMode> {
  return (await localValue(user, 'feed-mode', 'recommended')) === 'latest'
    ? 'latest'
    : 'recommended';
}
export async function setFeedMode(user: string, mode: FeedMode) {
  await storeValue(user, 'feed-mode', mode);
}
export async function feedChoices(user: string): Promise<FeedChoice[]> {
  if (!supabase)
    return (await localValue<FeedChoice[]>(user, 'feed', [])).filter(
      (row) =>
        typeof row.circle_id === 'string' &&
        typeof row.favourite === 'boolean' &&
        typeof row.see_less === 'boolean' &&
        (row.snoozed_until === null || typeof row.snoozed_until === 'string'),
    );
  return checked(await supabase.from('feed_preferences').select('*').eq('user_id', user)) ?? [];
}
export async function updateFeedChoice(
  user: string,
  circle: string,
  changes: Partial<Omit<FeedChoice, 'circle_id'>>,
) {
  await assertAccount(user);
  const rows = await feedChoices(user),
    old = rows.find((r) => r.circle_id === circle) ?? {
      circle_id: circle,
      favourite: false,
      see_less: false,
      snoozed_until: null,
    };
  const next = { ...old, ...changes };
  if (supabase) checked(await supabase.from('feed_preferences').upsert({ ...next, user_id: user }));
  else await storeValue(user, 'feed', [...rows.filter((r) => r.circle_id !== circle), next]);
}
export async function hidePost(user: string, post: string, hide = true) {
  await assertAccount(user);
  if (supabase) {
    const result = hide
      ? await supabase.from('hidden_posts').insert({ user_id: user, post_id: post })
      : await supabase.from('hidden_posts').delete().eq('user_id', user).eq('post_id', post);
    if (result.error?.code !== '23505') checked(result);
    return;
  }
  const ids = await localValue<string[]>(user, 'hidden', []);
  await storeValue(
    user,
    'hidden',
    hide ? [...new Set([...ids, post])] : ids.filter((id) => id !== post),
  );
}
export async function circleDepth(
  user: string,
  circle: string,
  demoOwner = false,
): Promise<CircleDepth> {
  const empty: CircleDepth = {
    topics: [],
    collections: [],
    recognition: [],
    members: [],
    chat: { enabled: false, slow_seconds: 0 },
    prompt: null,
    host: demoOwner,
  };
  if (!supabase) {
    const cached = await localValue(user, `circle:${circle}`, empty);
    const valid =
      cached.topics.every((t) => typeof t.id === 'string' && typeof t.name === 'string') &&
      cached.collections.every((c) => typeof c.id === 'string' && typeof c.name === 'string') &&
      cached.recognition.every(
        (r) => typeof r.user_id === 'string' && typeof r.label === 'string',
      ) &&
      cached.members.every((m) => typeof m.user_id === 'string' && typeof m.role === 'string');
    return valid ? { ...cached, host: demoOwner || cached.host } : empty;
  }
  const [topics, collections, recognition, members, chat, prompt] = await Promise.all([
    supabase.from('circle_topics').select('*').eq('circle_id', circle).order('name'),
    supabase.from('circle_collections').select('*').eq('circle_id', circle).order('created_at'),
    supabase
      .from('circle_recognition')
      .select('*,profiles!circle_recognition_user_id_fkey(display_name)')
      .eq('circle_id', circle),
    supabase
      .from('circle_memberships')
      .select('user_id,role,profiles!circle_memberships_user_id_fkey(display_name)')
      .eq('circle_id', circle)
      .eq('status', 'member'),
    supabase.from('circle_chat_settings').select('*').eq('circle_id', circle).maybeSingle(),
    supabase.from('circle_prompts').select('*').eq('circle_id', circle).maybeSingle(),
  ]);
  const memberRows = checked(members) as unknown as CircleDepth['members'];
  return {
    topics: checked(topics) ?? [],
    collections: checked(collections) ?? [],
    recognition: checked(recognition) as unknown as Recognition[],
    members: memberRows ?? [],
    chat: checked(chat) ?? empty.chat,
    prompt: checked(prompt),
    host:
      memberRows?.some((m) => m.user_id === user && ['owner', 'moderator'].includes(m.role)) ??
      false,
  };
}
export async function changeCircleDepth(
  user: string,
  circle: string,
  table:
    | 'circle_topics'
    | 'circle_collections'
    | 'circle_prompts'
    | 'circle_chat_settings'
    | 'circle_recognition',
  values: Record<string, unknown>,
  remove = false,
) {
  await assertAccount(user);
  if (supabase) {
    if (remove) {
      let q = supabase.from(table).delete().eq('circle_id', circle);
      if (values.id) q = q.eq('id', values.id);
      if (values.user_id) q = q.eq('user_id', values.user_id);
      checked(await q);
    } else {
      const row = { circle_id: circle, ...values };
      checked(
        ['circle_topics', 'circle_collections'].includes(table)
          ? await supabase.from(table).insert(row)
          : await supabase.from(table).upsert(row),
      );
    }
    return;
  }
  const state = await circleDepth(user, circle),
    id = String(values.id ?? Date.now());
  if (table === 'circle_topics')
    state.topics = remove
      ? state.topics.filter((t) => t.id !== values.id)
      : [...state.topics, { id, circle_id: circle, name: String(values.name) }];
  if (table === 'circle_collections')
    state.collections = remove
      ? state.collections.filter((t) => t.id !== values.id)
      : [
          ...state.collections,
          { id, circle_id: circle, name: String(values.name), creator_id: user },
        ];
  if (table === 'circle_prompts') state.prompt = values as unknown as CircleDepth['prompt'];
  if (table === 'circle_chat_settings') state.chat = values as unknown as CircleDepth['chat'];
  if (table === 'circle_recognition')
    state.recognition = remove
      ? state.recognition.filter((r) => r.user_id !== values.user_id)
      : [
          ...state.recognition.filter((r) => r.user_id !== values.user_id),
          { circle_id: circle, user_id: String(values.user_id), label: String(values.label) },
        ];
  await storeValue(user, `circle:${circle}`, state);
}
export async function participation(
  user: string,
  circle: string,
  body: string,
  type: 'question' | 'poll',
  options: string[],
  topic: string | null,
  requestId: string,
): Promise<string> {
  await assertAccount(user);
  if (!body.trim() || body.length > 5000)
    throw new Error('Write a question of up to 5,000 characters.');
  if (
    type === 'poll' &&
    (options.length < 2 ||
      options.length > 6 ||
      options.some((o) => !o.trim() || o.trim().length > 120) ||
      new Set(options.map((o) => o.trim().toLowerCase())).size !== options.length)
  )
    throw new Error('Add 2–6 different options, each up to 120 characters.');
  if (!supabase) {
    const id = `participation-${requestId}`;
    await storeValue(user, `poll:${id}`, { options, votes: [] });
    return id;
  }
  return checked(
    await supabase.rpc('create_participation_post', {
      target_circle: circle,
      post_body: body.trim(),
      kind: type,
      poll_options: type === 'poll' ? options.map((o) => o.trim()) : null,
      selected_topic: topic,
      request_id: requestId,
    }),
  );
}
export async function loadPoll(
  user: string,
  post: string,
): Promise<{
  options: string[];
  votes: { user_id: string; option_index: number }[];
  closes_at?: string;
}> {
  if (!supabase) return localValue(user, `poll:${post}`, { options: [], votes: [] });
  const [poll, votes] = await Promise.all([
    supabase.from('post_polls').select('*').eq('post_id', post).single(),
    supabase.from('poll_votes').select('user_id,option_index').eq('post_id', post),
  ]);
  return { ...checked(poll), votes: checked(votes) ?? [] };
}
export async function castVote(user: string, post: string, index: number | null) {
  await assertAccount(user);
  if (supabase) {
    checked(
      index === null
        ? await supabase.from('poll_votes').delete().eq('post_id', post).eq('user_id', user)
        : await supabase
            .from('poll_votes')
            .upsert({ post_id: post, user_id: user, option_index: index }),
    );
  } else {
    const p = await loadPoll(user, post);
    p.votes = [
      ...p.votes.filter((v) => v.user_id !== user),
      ...(index === null ? [] : [{ user_id: user, option_index: index }]),
    ];
    await storeValue(user, `poll:${post}`, p);
  }
}
export async function collectionPage(user: string, collection: string, offset = 0) {
  const entries: { post_id: string; added_by: string }[] = supabase
    ? (checked(
        await supabase
          .from('collection_posts')
          .select('post_id,added_by')
          .eq('collection_id', collection)
          .order('post_id')
          .range(offset, offset + 19),
      ) ?? [])
    : (await localValue<string[]>(user, `collection:${collection}`, []))
        .slice(offset, offset + 20)
        .map((id) => ({ post_id: id, added_by: user }));
  const posts = (
    await Promise.all(
      entries.map(async (entry) => {
        const post = await loadPostById(entry.post_id);
        return post ? { ...post, collectedBy: entry.added_by } : null;
      }),
    )
  ).filter((p): p is NonNullable<typeof p> => p !== null);
  return { posts, nextOffset: offset + entries.length, hasMore: entries.length === 20 };
}
export async function collectPost(user: string, collection: string, post: string, remove = false) {
  await assertAccount(user);
  if (supabase) {
    const result = remove
      ? await supabase
          .from('collection_posts')
          .delete()
          .eq('collection_id', collection)
          .eq('post_id', post)
      : await supabase
          .from('collection_posts')
          .insert({ collection_id: collection, post_id: post, added_by: user });
    if (result.error?.code !== '23505') checked(result);
  } else {
    const ids = await localValue<string[]>(user, `collection:${collection}`, []);
    await storeValue(
      user,
      `collection:${collection}`,
      remove ? ids.filter((id) => id !== post) : [...new Set([...ids, post])],
    );
  }
}
export async function helpfulAnswer(user: string, post: string, comment?: string) {
  await assertAccount(user);
  if (!supabase) return storeValue(user, `helpful:${post}`, comment ?? null);
  checked(
    comment
      ? await supabase
          .from('helpful_answers')
          .upsert({ post_id: post, comment_id: comment, marked_by: user })
      : await supabase.from('helpful_answers').delete().eq('post_id', post),
  );
}
export async function loadHelpful(user: string, post: string): Promise<string | null> {
  if (!supabase) return localValue(user, `helpful:${post}`, null);
  return (
    checked(
      await supabase.from('helpful_answers').select('comment_id').eq('post_id', post).maybeSingle(),
    )?.comment_id ?? null
  );
}
export async function catchup(user: string): Promise<Catchup> {
  if (supabase) return checked(await supabase.rpc('get_catchup'));
  return {
    since: await localValue(user, 'caught-up', new Date(Date.now() - 7 * 86400000).toISOString()),
    posts: [],
    unanswered: [],
    replies: [],
    events: [],
  };
}
export async function markCaughtUp(user: string) {
  await assertAccount(user);
  if (supabase) checked(await supabase.rpc('mark_caught_up'));
  else await storeValue(user, 'caught-up', new Date().toISOString());
}
export async function createInvite(user: string, circle: string, previewName: boolean) {
  await assertAccount(user);
  if (!supabase) throw new Error('Connect Supabase to share invitations.');
  return checked(
    await supabase
      .from('circle_invites')
      .insert({ circle_id: circle, created_by: user, preview_name: previewName })
      .select('token,expires_at')
      .single(),
  );
}
export async function redeemInvite(token: string) {
  if (!supabase) throw new Error('Connect Supabase to use invitations.');
  return checked(await supabase.rpc('redeem_circle_invite', { invite_token: token })) as {
    circleId: string;
    status: string;
  };
}
export function invitationUrl(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid invitation');
  const base = process.env.EXPO_PUBLIC_INVITE_BASE_URL;
  if (base) {
    const link = new URL(base);
    if (link.protocol !== 'https:') throw new Error('Invitation links must use HTTPS.');
    link.searchParams.set('token', token);
    return link.toString();
  }
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('Connect Supabase to share invitations.');
  return `${url}/functions/v1/community-invite?token=${token}`;
}
