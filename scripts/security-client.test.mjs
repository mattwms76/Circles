import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { loadSource, deferred } from './react-fixture.mjs';
const { createSecureStorage } = loadSource('src/lib/secureStorageCore.ts');
function storageFixture() {
  const legacy = new Map(),
    vault = new Map();
  let generation = 0,
    fail = false;
  const adapter = {
    getItem: async (k) => legacy.get(k) ?? null,
    setItem: async (k, v) => legacy.set(k, v),
    removeItem: async (k) => legacy.delete(k),
    getAllKeys: async () => [...legacy.keys()],
  };
  const storage = createSecureStorage(
    adapter,
    {
      get: async (k) => vault.get(k) ?? null,
      set: async (k, v) => {
        if (fail) throw Error('Native vault unavailable');
        assert.ok(Buffer.byteLength(v, 'utf8') <= 2048);
        vault.set(k, v);
      },
      remove: async (k) => vault.delete(k),
    },
    async (k) => createHash('sha256').update(k).digest('hex'),
    () => `generation-${++generation}`,
  );
  return { legacy, vault, storage, setFail: (value) => (fail = value) };
}
test('Secure persistence migrates plaintext, handles large Unicode sessions, and never writes payloads to AsyncStorage', async () => {
  const { legacy, vault, storage } = storageFixture();
  const value = 'token-' + '秘密🔒'.repeat(2000);
  legacy.set('sb-project-auth-token', value);
  assert.equal(await storage.getItem('sb-project-auth-token'), value);
  assert.equal(legacy.has('sb-project-auth-token'), false);
  assert.ok(![...legacy.values()].some((x) => x.includes('秘密')));
  assert.ok(vault.size > 10);
  await storage.setItem('circles:message-draft:a:b', '');
  assert.equal(await storage.getItem('circles:message-draft:a:b'), '');
  await storage.removeItem('sb-project-auth-token');
  assert.equal(await storage.getItem('sb-project-auth-token'), null);
  assert.ok(![...vault.values()].some((x) => x.includes('秘密')));
});
test('Failed secure writes retain the prior committed value; deletion tombstones prevent plaintext resurrection', async () => {
  const { legacy, storage, setFail } = storageFixture();
  await storage.setItem('session', 'original');
  setFail(true);
  await assert.rejects(storage.setItem('session', 'replacement'));
  setFail(false);
  assert.equal(await storage.getItem('session'), 'original');
  await storage.removeItem('session');
  legacy.set('session', 'stale-token');
  assert.equal(await storage.getItem('session'), null);
  assert.equal(legacy.has('session'), false);
  await Promise.all([storage.setItem('draft', 'first'), storage.setItem('draft', 'second')]);
  assert.equal(await storage.getItem('draft'), 'second');
});
test('Missing secure chunks fail closed instead of returning a partial token or old plaintext', async () => {
  const { legacy, vault, storage } = storageFixture();
  await storage.setItem('session', 'value');
  vault.delete([...vault.keys()].find((k) => k.endsWith('.0')));
  legacy.set('session', 'stale');
  await assert.rejects(storage.getItem('session'), /incomplete/);
});
test('PKCE callbacks reject injected tokens, missing initiation, expired flows and account switching', async () => {
  const values = new Map();
  const secureStorage = {
    getItem: async (k) => values.get(k) ?? null,
    setItem: async (k, v) => values.set(k, v),
    removeItem: async (k) => values.delete(k),
  };
  const flow = loadSource('src/lib/authFlow.ts', {
    './supabase': { allowAuthSession() {} },
    './secureStorage': { secureStorage },
    './contentLinks': loadSource('src/lib/contentLinks.ts'),
  });
  let exchanges = 0,
    signedIn = false;
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: signedIn ? { user: { id: 'existing' } } : null },
        error: null,
      }),
      exchangeCodeForSession: async () => {
        exchanges++;
        return { data: { session: { user: { id: 'verified' } } }, error: null };
      },
    },
  };
  for (const url of [
    'circles://auth/callback#access_token=foreign&refresh_token=foreign',
    'circles://auth/callback?token_hash=foreign&type=signup',
    'https://attacker.invalid/auth/callback?code=bad',
    'circles://auth/callback?code=uninitiated',
  ])
    await assert.rejects(flow.completeAuthFlow(url, client));
  assert.equal(exchanges, 0);
  await flow.beginAuthFlow('signup');
  signedIn = true;
  await assert.rejects(
    flow.completeAuthFlow('circles://auth/callback?code=valid', client),
    /Sign out/,
  );
  assert.equal(exchanges, 0);
  signedIn = false;
  values.set('circles:pending-auth-flow', JSON.stringify({ kind: 'signup', started: 0 }));
  await assert.rejects(
    flow.completeAuthFlow('circles://auth/callback?code=valid', client),
    /expired/,
  );
  await flow.beginAuthFlow('recovery');
  const result = await flow.completeAuthFlow('circles://auth/recovery?code=valid', client);
  assert.equal(result.recovery, true);
  assert.equal(exchanges, 1);
  assert.equal(values.has('circles:pending-auth-flow'), false);
  await assert.rejects(flow.completeAuthFlow('circles://auth/recovery?code=replay', client));
});
test('Logout clears local Auth state even when device deregistration fails', async () => {
  let cleared = false;
  const { signOutDevice } = loadSource('src/lib/community.ts', {
    './pushDevice': {
      deregisterPushDevice: async () => {
        throw Error('Offline');
      },
      registerPushDevice: async () => {},
    },
    './supabase': {
      supabase: {},
      signOutDeviceSession: async () => {
        cleared = true;
      },
    },
    './repositories': {},
    './experience': {},
    './media': {},
    './drafts': {},
    'react-native': {},
    'expo-notifications': {},
    '../data/demo': {},
  });
  await signOutDevice();
  assert.equal(cleared, true);
});
test('Offline local sign-out removes persisted credentials and emits sign-out before waiting for server revocation', async () => {
  const previous = { ...process.env };
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  const events = [],
    remote = deferred();
  let listener,
    persisted,
    underlyingWrites = 0;
  const client = {
    auth: {
      onAuthStateChange: (fn) => {
        listener = fn;
        return {};
      },
      signOut: async () => {
        events.push('local-out');
        return { error: null };
      },
      admin: {
        signOut: async () => {
          events.push('remote-revoke');
          return remote.promise;
        },
      },
    },
  };
  try {
    const { signOutDeviceSession, allowAuthSession } = loadSource('src/lib/supabase.ts', {
      '@supabase/supabase-js': {
        createClient: (_url, _key, config) => {
          persisted = config.auth.storage;
          return client;
        },
      },
      './secureStorage': {
        secureStorage: {
          getItem: async () => null,
          setItem: async () => {
            underlyingWrites++;
          },
          multiRemove: async (keys) => {
            assert.ok(keys.includes('sb-example-auth-token'));
            events.push('credentials-removed');
          },
        },
        migrateLegacyPrivateData: async () => {},
      },
    });
    listener('SIGNED_IN', { access_token: 'synthetic' });
    await signOutDeviceSession();
    assert.deepEqual(events, ['credentials-removed', 'local-out', 'remote-revoke']);
    await persisted.setItem('sb-example-auth-token', 'late-refresh');
    assert.equal(underlyingWrites, 0);
    assert.equal(await persisted.getItem('sb-example-auth-token'), null);
    allowAuthSession();
    await persisted.setItem('sb-example-auth-token', 'deliberate-new-login');
    assert.equal(underlyingWrites, 1);
    remote.resolve({ error: null });
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in previous)) delete process.env[k];
    Object.assign(process.env, previous);
  }
});
test('Device deregistration proof survives network failure and retries after signing into another account', async () => {
  const values = new Map();
  let offline = true;
  const calls = [];
  const device = loadSource('src/lib/pushDevice.ts', {
    'expo-crypto': { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    './secureStorage': {
      secureStorage: {
        getItem: async (k) => values.get(k) ?? null,
        setItem: async (k, v) => values.set(k, v),
        removeItem: async (k) => values.delete(k),
      },
    },
    './supabase': {
      requireSupabase: () => ({
        rpc: async (name, args) => {
          calls.push({ name, args });
          return { error: offline ? Error('Offline') : null };
        },
      }),
    },
  });
  offline = false;
  await device.registerPushDevice('ExpoPushToken[synthetic]');
  offline = true;
  await assert.rejects(device.deregisterPushDevice());
  assert.ok(values.has('circles:pending-push-deregistration'));
  offline = false;
  await device.flushPendingPushDeregistration();
  assert.equal(values.has('circles:pending-push-deregistration'), false);
  assert.equal(calls.at(-1).args.device_key, '11111111-1111-4111-8111-111111111111');
});
