import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configurationChecks, loadReleaseEnvironment } from './release-readiness.mjs';
test('Release configuration rejects missing, malformed and secret Supabase keys', () => {
  assert.ok(Object.values(configurationChecks({})).every((value) => value === false));
  const valid = {
    EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
    EXPO_PUBLIC_AGORA_APP_ID: 'a'.repeat(32),
    EXPO_PUBLIC_EAS_PROJECT_ID: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    EXPO_PUBLIC_SUPPORT_EMAIL: 'help@example.test',
  };
  assert.ok(Object.values(configurationChecks(valid)).every(Boolean));
  assert.equal(
    configurationChecks({ ...valid, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_do_not_use' })[
      'Supabase publishable key'
    ],
    false,
  );
  assert.equal(
    configurationChecks({ ...valid, EXPO_PUBLIC_SUPABASE_URL: 'https://' })['Supabase URL'],
    false,
  );
});
test('Release check honours local overrides and build environment precedence', () => {
  const read = (path) =>
    path === '.env' ? 'EXPO_PUBLIC_AGORA_APP_ID=base\n' : 'EXPO_PUBLIC_AGORA_APP_ID="local"\n';
  assert.equal(loadReleaseEnvironment({}, read).EXPO_PUBLIC_AGORA_APP_ID, 'local');
  assert.equal(
    loadReleaseEnvironment({ EXPO_PUBLIC_AGORA_APP_ID: 'build' }, read).EXPO_PUBLIC_AGORA_APP_ID,
    'build',
  );
});
