import { requireSupabase } from './supabase';
import { uploadWithProgress } from './media';
import { validateStoryMedia, type StoryMedia } from './storyRules';
export interface Story {
  id: string;
  circleId: string;
  circleName: string;
  authorId: string;
  authorName: string;
  avatarUrl: string;
  caption: string;
  kind: 'image' | 'video';
  storagePath: string;
  createdAt: string;
  expiresAt: string;
  duration?: number;
}
export async function loadStories(offset = 0, circleId?: string): Promise<Story[]> {
  let query = requireSupabase()
    .from('circle_stories')
    .select('*,circles(name),profiles!circle_stories_author_id_fkey(display_name,avatar_url)')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .order('id')
    .range(offset, offset + 39);
  if (circleId) query = query.eq('circle_id', circleId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((s) => ({
    id: s.id,
    circleId: s.circle_id,
    circleName: s.circles?.name ?? 'Circle',
    authorId: s.author_id,
    authorName: s.profiles?.display_name ?? 'Circle member',
    avatarUrl: s.profiles?.avatar_url ?? '',
    caption: s.caption,
    kind: s.kind,
    storagePath: s.storage_path,
    createdAt: s.created_at,
    expiresAt: s.expires_at,
    duration: s.duration_seconds,
  }));
}
export async function storyUrl(story: Story) {
  const seconds = Math.min(60, Math.floor((Date.parse(story.expiresAt) - Date.now()) / 1000));
  if (seconds < 1) throw new Error('This story has expired.');
  const { data, error } = await requireSupabase()
    .storage.from('story-media')
    .createSignedUrl(story.storagePath, seconds);
  if (error) throw error;
  return data.signedUrl;
}
export async function publishStory(
  userId: string,
  circleId: string,
  id: string,
  caption: string,
  media: StoryMedia,
  onProgress: (value: number) => void,
  signal: AbortSignal,
) {
  validateStoryMedia(media);
  const client = requireSupabase();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || auth.user?.id !== userId) throw new Error('Sign in again to share your story.');
  const ext: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
  };
  const path = `${userId}/${circleId}/${id}.${ext[media.mimeType]}`;
  const previous = await client.from('circle_stories').select('id').eq('id', id).maybeSingle();
  if (previous.error) throw previous.error;
  if (previous.data) return;
  const listed = await client.storage
    .from('story-media')
    .list(`${userId}/${circleId}`, { search: `${id}.` });
  if (listed.error) throw listed.error;
  if (!listed.data.some((f) => f.name === `${id}.${ext[media.mimeType]}`))
    await uploadWithProgress('story-media', path, media.uri, media.mimeType, onProgress, signal);
  if (signal.aborted) throw new Error('Upload paused. Retry to finish sharing.');
  const result = await client.from('circle_stories').insert({
    id,
    circle_id: circleId,
    author_id: userId,
    caption: caption.trim(),
    kind: media.kind,
    storage_path: path,
    duration_seconds: media.kind === 'video' ? media.duration : null,
  });
  if (result.error) {
    if (result.error.code !== '23505') throw result.error;
    const retry = await client
      .from('circle_stories')
      .select('id')
      .eq('id', id)
      .eq('author_id', userId)
      .eq('storage_path', path)
      .maybeSingle();
    if (retry.error || !retry.data) throw result.error;
  }
}
export async function removeStory(story: Story) {
  const client = requireSupabase();
  const { error } = await client.from('circle_stories').delete().eq('id', story.id);
  if (error) throw error;
  // Visibility is revoked first. A failed object removal is reclaimed by scheduled cleanup.
  await client.storage.from('story-media').remove([story.storagePath]);
}
