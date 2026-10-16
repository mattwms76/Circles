import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { handleStoryCleanup } from '../_shared/story-cleanup.ts';
import { cleanupCommunityMedia, cleanupPostMedia } from '../_shared/community-cleanup.ts';
Deno.serve(async (request: Request) => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const stories = await handleStoryCleanup(request, admin);
  if (!stories.ok) return stories;
  try {
    const community = await cleanupCommunityMedia(admin);
    const posts = await cleanupPostMedia(admin);
    return Response.json({ ...(await stories.json()), community, posts });
  } catch {
    return Response.json(
      { error: 'Community media cleanup failed; queued uploads will be retried.' },
      { status: 500 },
    );
  }
});
