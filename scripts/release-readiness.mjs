import { existsSync, readFileSync } from 'node:fs';
const env = { ...process.env };
for (const path of ['.env', '.env.local'])
  if (existsSync(path))
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !env[match[1]]) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
const checks = {
  'Supabase URL': /^https:\/\//.test(env.EXPO_PUBLIC_SUPABASE_URL ?? ''),
  'Supabase publishable key': !!env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  'Agora App ID': /^[a-f0-9]{32}$/i.test(env.EXPO_PUBLIC_AGORA_APP_ID ?? ''),
  'EAS project ID': /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
    env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '',
  ),
  'Support email': /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.EXPO_PUBLIC_SUPPORT_EMAIL ?? ''),
};
for (const [label, ready] of Object.entries(checks))
  console.log(`${ready ? 'OK' : 'MISSING'}: ${label}`);
console.log(
  'Device acceptance remains required: iOS + Android camera/upload interruption, private links, two-account messaging, APNs/FCM delivery, Agora live sessions and sandbox purchases.',
);
console.log(
  'Verify server notification dispatcher scheduling and production migrations separately.',
);
if (Object.values(checks).some((value) => !value)) process.exitCode = 1;
