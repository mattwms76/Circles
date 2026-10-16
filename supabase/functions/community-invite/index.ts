import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
export async function invitationPage(request: Request) {
  if (!['GET', 'HEAD'].includes(request.method))
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
  const query = new URL(request.url).searchParams,
    token = query.get('token');
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    return Response.json({ error: 'This invitation is invalid.' }, { status: 400, headers });
  if (query.get('format') !== 'json') {
    const landing = new URL('https://mattwms76.github.io/Circles/');
    landing.searchParams.set('token', token);
    return new Response(null, {
      status: 302,
      headers: { ...headers, Location: landing.toString() },
    });
  }
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false },
  });
  const { data, error } = await client.rpc('invite_preview', { invite_token: token });
  if (error)
    return Response.json(
      { error: 'Invitations are temporarily unavailable.' },
      { status: 503, headers },
    );
  if (!data)
    return Response.json(
      { error: 'This invitation expired or was revoked.' },
      { status: 410, headers },
    );
  return request.method === 'HEAD'
    ? new Response(null, { headers })
    : Response.json(data, { headers });
}
Deno.serve(invitationPage);
