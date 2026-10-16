import { isAuthCallback } from './contentLinks';
import { secureStorage } from './secureStorage';
import { allowAuthSession } from './supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
const key = 'circles:pending-auth-flow';
export async function beginAuthFlow(kind: 'signup' | 'recovery') {
  await secureStorage.setItem(key, JSON.stringify({ kind, started: Date.now() }));
}
export async function completeAuthFlow(url: string, client: SupabaseClient) {
  if (!isAuthCallback(url)) throw Error('Invalid sign-in link.');
  const parsed = new URL(url);
  if (
    parsed.hash ||
    !parsed.searchParams.get('code') ||
    parsed.searchParams.has('access_token') ||
    parsed.searchParams.has('refresh_token') ||
    parsed.searchParams.has('token_hash')
  )
    throw Error(
      'Request a new confirmation or reset link from this device, or sign in with your password.',
    );
  const { data: current, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (current.session)
    throw Error('Sign out before opening an account confirmation or recovery link.');
  const raw = await secureStorage.getItem(key);
  const flow = raw ? JSON.parse(raw) : null;
  if (
    !flow ||
    !['signup', 'recovery'].includes(flow.kind) ||
    !Number.isFinite(flow.started) ||
    flow.started > Date.now() ||
    Date.now() - flow.started > 60 * 60_000
  )
    throw Error(
      'This link was not requested on this device, or it has expired. Request a new link here.',
    );
  allowAuthSession();
  const result = await client.auth.exchangeCodeForSession(parsed.searchParams.get('code')!);
  if (result.error) throw result.error;
  await secureStorage.removeItem(key);
  return { session: result.data.session, recovery: flow.kind === 'recovery' };
}
