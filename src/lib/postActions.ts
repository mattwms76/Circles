import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { CirclePost } from '../types';
import { readStringList } from './localData';
export async function updateOwnPost(post: CirclePost, userId: string, body: string | null) {
  if (post.author.id !== userId) throw new Error('You can only change your own posts.');
  if (body !== null && ((!body.trim() && !post.media) || body.length > 5000))
    throw new Error('Write a post of up to 5,000 characters or include media.');
  if (!supabase) return;
  const { error } = await supabase
    .from('posts')
    .update(body === null ? { visibility: 'removed' } : { body: body.trim() })
    .eq('id', post.id)
    .eq('author_id', userId)
    .select('id')
    .single();
  if (error) throw error;
}
export async function loadSavedPostIds(userId: string): Promise<string[]> {
  if (!supabase) return readStringList(await AsyncStorage.getItem(`saved-posts:${userId}`));
  const ids: string[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase
      .from('post_bookmarks')
      .select('post_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .order('post_id')
      .range(offset, offset + 499);
    if (error) throw error;
    ids.push(...data.map((row) => row.post_id));
    if (data.length < 500) return ids;
  }
}
export async function savePost(userId: string, postId: string, saved: boolean) {
  if (!supabase) {
    const ids = await loadSavedPostIds(userId);
    await AsyncStorage.setItem(
      `saved-posts:${userId}`,
      JSON.stringify(saved ? [...new Set([...ids, postId])] : ids.filter((id) => id !== postId)),
    );
    return;
  }
  const { error } = saved
    ? await supabase.from('post_bookmarks').insert({ user_id: userId, post_id: postId })
    : await supabase.from('post_bookmarks').delete().eq('user_id', userId).eq('post_id', postId);
  if (error && error.code !== '23505') throw error;
}
