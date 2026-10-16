import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = request.headers.get('x-dispatch-secret');
  if (!secret || secret.length > 200) return json({ error: 'Unauthorized' }, 401);
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const authorized = await admin.rpc('authorize_notification_dispatch', {
    provided_secret: secret,
  });
  if (authorized.error || authorized.data !== true) return json({ error: 'Unauthorized' }, 401);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const update = async (id: string, values: Record<string, unknown>) => {
    const result = await admin.from('notification_deliveries').update(values).eq('id', id);
    if (result.error) throw result.error;
  };
  try {
    const { data: jobs, error } = await admin.rpc('claim_notification_deliveries');
    if (error) throw error;
    // One request per token allows tokens from different EAS projects during migrations.
    // Process in bounded groups to avoid request bursts and Edge Function timeouts.
    for (let i = 0; i < (jobs ?? []).length; i += 5)
      await Promise.all(
        jobs.slice(i, i + 5).map(async (job: any) => {
          try {
            const response = await fetch('https://exp.host/--/api/v2/push/send', {
              method: 'POST',
              headers,
              signal: AbortSignal.timeout(8000),
              body: JSON.stringify({
                to: job.token,
                title: job.title,
                body: job.body,
                sound: 'default',
                channelId: 'circles',
                data: { notificationId: job.notificationId },
              }),
            });
            if (!response.ok) throw new Error(`Expo HTTP ${response.status}`);
            const result = await response.json();
            const ticket = result.data;
            if (ticket?.status === 'ok' && ticket.id)
              await update(job.id, {
                state: 'ticket',
                receipt_id: ticket.id,
                available_at: new Date(Date.now() + 15 * 60_000).toISOString(),
                last_error: null,
              });
            else {
              if (ticket?.details?.error === 'DeviceNotRegistered') {
                await admin.from('device_push_tokens').delete().eq('token', job.token);
                return;
              }
              await update(job.id, {
                state: 'failed',
                last_error: String(ticket?.details?.error ?? 'Invalid push response').slice(0, 100),
              });
            }
          } catch {
            await update(job.id, {
              state: job.attempts >= 5 ? 'failed' : 'pending',
              available_at: new Date(
                Date.now() + Math.min(3600, 30 * 2 ** job.attempts) * 1000,
              ).toISOString(),
              last_error: 'Push request failed',
            });
          }
        }),
      );
    const receipts = await admin
      .from('notification_deliveries')
      .select('id,token,receipt_id,available_at')
      .eq('state', 'ticket')
      .lte('available_at', new Date().toISOString())
      .limit(100);
    if (receipts.error) throw receipts.error;
    if (receipts.data.length) {
      const response = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ ids: receipts.data.map((r) => r.receipt_id) }),
      });
      if (!response.ok) throw new Error('Receipt request failed');
      const result = await response.json();
      for (const item of receipts.data) {
        const receipt = result.data?.[item.receipt_id];
        if (!receipt) {
          if (Date.now() - Date.parse(item.available_at) > 23 * 60 * 60_000)
            await update(item.id, {
              state: 'failed',
              last_error: 'Receipt expired',
            });
          continue;
        }
        if (receipt.details?.error === 'DeviceNotRegistered') {
          await admin.from('device_push_tokens').delete().eq('token', item.token);
          continue;
        }
        await update(item.id, {
          state: receipt.status === 'ok' ? 'delivered' : 'failed',
          receipt_checked_at: new Date().toISOString(),
          last_error:
            receipt.status === 'ok'
              ? null
              : String(receipt.details?.error ?? 'Delivery failed').slice(0, 100),
        });
      }
    }
    return json({ processed: jobs?.length ?? 0 });
  } catch (error) {
    console.error('dispatch-notifications', error instanceof Error ? error.name : 'UnknownError');
    return json({ error: 'Dispatch failed' }, 500);
  }
});
