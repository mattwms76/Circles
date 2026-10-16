import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function configurationChecks(env) {
  return {
    'Supabase URL': /^https:\/\/[a-z0-9][a-z0-9.-]+\.[a-z]{2,}\/?$/i.test(
      env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    ),
    'Supabase publishable key': /^sb_publishable_[\w-]+$/.test(
      env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
    ),
    'Agora App ID': /^[a-f0-9]{32}$/i.test(env.EXPO_PUBLIC_AGORA_APP_ID ?? ''),
    'EAS project ID': /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
      env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '',
    ),
    'Support email': /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.EXPO_PUBLIC_SUPPORT_EMAIL ?? ''),
  };
}

export function loadReleaseEnvironment(
  inherited = process.env,
  read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : ''),
) {
  const local = {};
  for (const path of ['.env', '.env.local']) {
    for (const line of read(path).split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) local[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return { ...local, ...inherited };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const productionOnly = process.argv.includes('--production-only');
  if (!productionOnly || process.env.EAS_BUILD_PROFILE === 'production') {
    const checks = configurationChecks(loadReleaseEnvironment());
    for (const [label, ready] of Object.entries(checks))
      console.log(`${ready ? 'OK' : 'MISSING OR INVALID'}: ${label}`);
    console.log(
      'Device acceptance remains required: iOS + Android camera/audio, upload interruption, private links, two-account messaging, APNs/FCM delivery, Agora sessions and sandbox purchases.',
    );
    console.log(
      'Verify production migrations, independent story cleanup and notification dispatch scheduling separately.',
    );
    if (Object.values(checks).some((value) => !value)) process.exitCode = 1;
  } else console.log('Production configuration gate skipped for this development/preview build.');
}
