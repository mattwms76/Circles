import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
// Called only after the independent retention endpoint has authenticated its scheduler.
export async function cleanupCommunityMedia(admin: SupabaseClient) {
  const queued = await admin.rpc('queue_abandoned_community_media');
  if (queued.error) throw queued.error;
  const pending = await admin
    .from('community_media_cleanup')
    .select('storage_path')
    .order('queued_at')
    .limit(100);
  if (pending.error) throw pending.error;
  const paths = (pending.data ?? []).map((r: { storage_path: string }) => r.storage_path);
  if (paths.length) {
    const removed = await admin.storage.from('community-media').remove(paths);
    if (removed.error) throw removed.error;
    const cleared = await admin.from('community_media_cleanup').delete().in('storage_path', paths);
    if (cleared.error) throw cleared.error;
  }
  return { removed: paths.length, more: paths.length === 100 };
}
export async function cleanupPostMedia(admin: SupabaseClient) {
  const queued = await admin.rpc('queue_abandoned_post_media');
  if (queued.error) throw queued.error;
  const pending = await admin
    .from('post_media_cleanup')
    .select('storage_path')
    .order('queued_at')
    .limit(100);
  if (pending.error) throw pending.error;
  const paths = (pending.data ?? []).map((row: { storage_path: string }) => row.storage_path);
  if (paths.length) {
    const removed = await admin.storage.from('post-media').remove(paths);
    if (removed.error) throw removed.error;
    const cleared = await admin.from('post_media_cleanup').delete().in('storage_path', paths);
    if (cleared.error) throw cleared.error;
  }
  return { removed: paths.length, more: paths.length === 100 };
}
