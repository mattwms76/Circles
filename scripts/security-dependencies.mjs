import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const from = (parent, child) => createRequire(parent).resolve(child);
export function dependencySecurityStatus() {
  const cli = from(require.resolve('expo/package.json'), '@expo/cli/package.json');
  const forge = from(cli, 'node-forge/lib/rsa.js');
  const plugin = from(
    require.resolve('react-native/package.json'),
    '@react-native/community-cli-plugin/package.json',
  );
  const metro = from(plugin, 'metro/package.json');
  const fileMap = from(metro, 'metro-file-map/package.json');
  const micromatch = from(fileMap, 'micromatch/package.json');
  const braces = from(micromatch, 'braces/lib/parse.js');
  const plugins = from(require.resolve('expo/package.json'), '@expo/config-plugins/package.json');
  const xcode = from(plugins, 'xcode/package.json');
  const uuid = from(xcode, 'uuid');
  const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const fixed = {
    'GHSA-86w9-cpqp-85rv':
      hash(forge) === '2a01db97b6e05de4a18fa9741a01e9072c9f6dda80579103759653867f1ba94f',
    'GHSA-vfj7-8cjw-p6xm':
      hash(braces) === 'e7e080272fc2853936d109f037ec93f23ff4d8f69cc781df9477995fb156c862',
  };
  return { fixed, forge, braces, uuid };
}
export function evaluateAdvisories(audit, fixed) {
  if (!audit.advisories || !audit.metadata?.vulnerabilities)
    throw Error('The advisory service did not return a complete audit.');
  const unresolved = Object.values(audit.advisories).filter((advisory) => {
    const versions = advisory.findings.flatMap((finding) => finding.version);
    const expected = {
      'GHSA-86w9-cpqp-85rv': ['node-forge', '1.4.0'],
      'GHSA-vfj7-8cjw-p6xm': ['braces', '3.0.3'],
    }[advisory.github_advisory_id];
    return !(
      expected &&
      fixed[advisory.github_advisory_id] &&
      advisory.module_name === expected[0] &&
      versions.length &&
      versions.every((v) => v === expected[1])
    );
  });
  return unresolved;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const status = dependencySecurityStatus();
  if (Object.values(status.fixed).some((fixed) => !fixed))
    throw Error('A reviewed security patch is absent or changed.');
  const options = { encoding: 'utf8', windowsHide: true, timeout: 120000 };
  const run =
    process.platform === 'win32'
      ? spawnSync('pnpm audit --json', { ...options, shell: true })
      : spawnSync('pnpm', ['audit', '--json'], options);
  if (run.error || !run.stdout) throw run.error ?? Error('Dependency audit did not complete.');
  const audit = JSON.parse(run.stdout);
  const unresolved = evaluateAdvisories(audit, status.fixed);
  for (const item of unresolved)
    console.error(`${item.severity}: ${item.module_name}: ${item.github_advisory_id}`);
  console.log(
    JSON.stringify({
      registryAdvisories: Object.keys(audit.advisories).length,
      verifiedLocalPatches: Object.keys(status.fixed).filter((id) => status.fixed[id]),
      unresolved: unresolved.length,
    }),
  );
  if (unresolved.length) process.exitCode = 1;
}
