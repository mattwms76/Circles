import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// A separate scheduler secret keeps retention independent of push delivery.
export async function handleStoryCleanup(request: Request, admin: SupabaseClient) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = request.headers.get('x-cleanup-secret');
  if (!secret || secret.length > 200) return json({ error: 'Unauthorized' }, 401);
  try {
    const authorized = await admin.rpc('authorize_story_cleanup', { provided_secret: secret });
    if (authorized.error || authorized.data !== true) return json({ error: 'Unauthorized' }, 401);
    const queued = await admin.rpc('queue_expired_story_media');
    if (queued.error) throw queued.error;
    const pending = await admin
      .from('story_media_cleanup')
      .select('storage_path')
      .order('queued_at')
      .limit(100);
    if (pending.error) throw pending.error;
    const paths = (pending.data ?? []).map((item: { storage_path: string }) => item.storage_path);
    if (paths.length) {
      // Storage owns object deletion. Retain the queue if deletion fails so the next run retries.
      const removed = await admin.storage.from('story-media').remove(paths);
      if (removed.error) throw removed.error;
      const cleared = await admin.from('story_media_cleanup').delete().in('storage_path', paths);
      if (cleared.error) throw cleared.error;
    }
    return json({ removed: paths.length, more: paths.length === 100 });
  } catch {
    return json({ error: 'Story cleanup failed; queued media will be retried.' }, 500);
  }
}
