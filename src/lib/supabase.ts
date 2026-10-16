import { secureStorage, migrateLegacyPrivateData } from './secureStorage';
import { createClient, type Session } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const backendReady = Boolean(url && publishableKey);
const sessionKey = url
  ? `sb-${new URL(url).hostname.split('.')[0]}-auth-token`
  : 'circles:auth-session';
let sessionWritesAllowed = true;
export function allowAuthSession() {
  sessionWritesAllowed = true;
}
const authStorage = {
  getItem: (key: string) =>
    !sessionWritesAllowed && key.startsWith(sessionKey)
      ? Promise.resolve(null)
      : secureStorage.getItem(key),
  setItem: (key: string, value: string) =>
    !sessionWritesAllowed && key.startsWith(sessionKey)
      ? Promise.resolve()
      : secureStorage.setItem(key, value),
  removeItem: (key: string) => secureStorage.removeItem(key),
};
// Session reads also migrate themselves; migrate unopened private drafts on launch.
void migrateLegacyPrivateData().catch(() => {
  /* Secure storage failures are surfaced by reads. */
});

export const supabase = backendReady
  ? createClient(url!, publishableKey!, {
      auth: {
        storage: authStorage,
        storageKey: sessionKey,
        flowType: 'pkce',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

let sessionForRevocation: Session | null = null;
supabase?.auth.onAuthStateChange((_event, session) => {
  sessionForRevocation = session;
});
export async function signOutDeviceSession() {
  if (!supabase) return;
  const token = sessionForRevocation?.access_token;
  // An in-flight refresh must not restore credentials after local deletion.
  sessionWritesAllowed = false;
  // Remove persistent credentials before calling the SDK. Its local sign-out now
  // emits SIGNED_OUT without waiting on a network revocation request.
  await secureStorage.multiRemove([
    sessionKey,
    `${sessionKey}-user`,
    `${sessionKey}-code-verifier`,
    'circles:pending-auth-flow',
  ]);
  const local = await supabase.auth.signOut({ scope: 'local' });
  if (local.error) throw local.error;
  if (token)
    void supabase.auth.admin.signOut(token, 'local').catch(() => {
      /* Offline tokens retain their normal server expiry; local credentials are gone. */
    });
}

export function requireSupabase() {
  if (!supabase) throw new Error('Add Supabase credentials to .env to enable live data.');
  return supabase;
}
