import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { headers, status });
Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ error: 'Sign in required' }, 401);
  const url = Deno.env.get('SUPABASE_URL')!;
  const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError || !user) return json({ error: 'Invalid session' }, 401);
  try {
    const body = await request.json();
    if (body.confirmation !== 'DELETE')
      return json({ error: 'Deletion confirmation required' }, 400);
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // End sessions first. Existing access tokens expire independently; removing the
    // profile below also revokes app access through its foreign keys and RLS.
    const revoked = await admin.auth.admin.signOut(
      authorization.replace(/^Bearer\s+/i, ''),
      'global',
    );
    if (revoked.error) throw revoked.error;
    const prepared = await admin.rpc('prepare_account_deletion', {
      target_user: user.id,
    });
    if (prepared.error) throw prepared.error;
    for (const bucket of ['post-media', 'avatars', 'story-media']) {
      const folders = [user.id];
      while (folders.length) {
        const folder = folders.pop()!;
        let offset = 0;
        const paths: string[] = [];
        for (;;) {
          const listed = await admin.storage.from(bucket).list(folder, {
            limit: 100,
            offset,
            sortBy: { column: 'name', order: 'asc' },
          });
          if (listed.error) throw listed.error;
          for (const item of listed.data) {
            const path = `${folder}/${item.name}`;
            if (item.id) paths.push(path);
            else folders.push(path);
          }
          if (listed.data.length < 100) break;
          offset += listed.data.length;
        }
        for (let i = 0; i < paths.length; i += 100) {
          const removed = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
          if (removed.error) throw removed.error;
        }
      }
    }
    const deleted = await admin.auth.admin.deleteUser(user.id);
    if (deleted.error) throw deleted.error;
    return json({ deleted: true });
  } catch (error) {
    console.error('delete-account', error instanceof Error ? error.name : 'UnknownError');
    return json({ error: 'Deletion could not finish. Sign in again and retry.' }, 500);
  }
});
