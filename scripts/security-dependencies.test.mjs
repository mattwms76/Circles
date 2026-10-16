import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { generateKeyPairSync, privateEncrypt, constants } from 'node:crypto';
import { dependencySecurityStatus, evaluateAdvisories } from './security-dependencies.mjs';
const require = createRequire(import.meta.url);
const status = dependencySecurityStatus();

test('The actual Expo/Metro dependency paths use reviewed patches and the fixed UUID version', () => {
  assert.ok(Object.values(status.fixed).every(Boolean));
  const uuid = require(status.uuid);
  assert.throws(() => uuid.v5('test', uuid.v5.DNS, Buffer.alloc(8), 0), RangeError);
  assert.match(uuid.v4(), /^[a-f0-9-]{36}$/);
  const braces = require(createRequire(status.braces).resolve('../index.js'));
  for (const input of [
    '{'.repeat(3000) + 'x' + '}'.repeat(3000),
    '('.repeat(3000) + 'x' + ')'.repeat(3000),
  ])
    assert.throws(() => braces(input), /safe depth/);
  assert.deepEqual(braces.expand('src/{screens,lib}/*.{ts,tsx}'), [
    'src/screens/*.ts',
    'src/screens/*.tsx',
    'src/lib/*.ts',
    'src/lib/*.tsx',
  ]);
});
test('The patched signature verifier rejects extra nested DigestAlgorithm fields and accepts legitimate signatures', () => {
  const forge = require(createRequire(status.forge).resolve('../lib/index.js'));
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
  const key = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }));
  const digest = forge.md.sha256.create().update('Circles security regression').digest().getBytes();
  const asn1 = forge.asn1;
  const algorithm = () =>
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(
        asn1.Class.UNIVERSAL,
        asn1.Type.OID,
        false,
        asn1.oidToDer(forge.oids.sha256).getBytes(),
      ),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
    ]);
  const sign = (extras, invalidNull = false) => {
    const alg = algorithm();
    alg.value.push(...extras);
    if (invalidNull) alg.value[1].value = 'garbage';
    const info = asn1
      .toDer(
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
          alg,
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, digest),
        ]),
      )
      .getBytes();
    const data = Buffer.from(info, 'binary');
    const encoded = Buffer.concat([
      Buffer.from([0, 1]),
      Buffer.alloc(128 - data.length - 3, 255),
      Buffer.from([0]),
      data,
    ]);
    return privateEncrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, encoded).toString(
      'binary',
    );
  };
  assert.equal(key.verify(digest, sign([])), true);
  assert.throws(() => key.verify(digest, sign([], true)), /DigestInfo/);
  for (const extras of [
    [asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, 'garbage')],
    [asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, '')],
  ])
    assert.throws(() => key.verify(digest, sign(extras)), /DigestInfo/);
});
test('Dependency policy fails closed for missing patches, new advisories, versions and incomplete audit responses', () => {
  const advisory = (id, module_name, version) => ({
    github_advisory_id: id,
    module_name,
    findings: [{ version }],
  });
  const audit = (items) => ({
    advisories: Object.fromEntries(items.map((x, i) => [i, x])),
    metadata: { vulnerabilities: {} },
  });
  assert.equal(
    evaluateAdvisories(audit([advisory('GHSA-vfj7-8cjw-p6xm', 'braces', '3.0.3')]), status.fixed)
      .length,
    0,
  );
  assert.equal(
    evaluateAdvisories(audit([advisory('GHSA-vfj7-8cjw-p6xm', 'braces', '3.0.3')]), {}).length,
    1,
  );
  assert.equal(
    evaluateAdvisories(audit([advisory('new', 'braces', '3.0.3')]), status.fixed).length,
    1,
  );
  assert.equal(
    evaluateAdvisories(audit([advisory('GHSA-vfj7-8cjw-p6xm', 'braces', '3.0.4')]), status.fixed)
      .length,
    1,
  );
  assert.throws(() => evaluateAdvisories({ error: 'offline' }, status.fixed));
});
