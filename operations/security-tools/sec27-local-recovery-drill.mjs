#!/usr/bin/env node
/**
 * Synthetic-only local recovery rehearsal.
 *
 * It creates its own private temporary directory, generates test-only key material,
 * and removes every temporary plaintext, ciphertext, metadata, and key before it
 * returns. It never reads environment credentials or contacts a database/provider.
 */
import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

class SyntheticRecoveryError extends Error {
  constructor(code, options = {}) {
    super(code, { cause: options.cause });
    this.name = "SyntheticRecoveryError";
    this.code = code;
  }
}

const SYNTHETIC_OBJECTS = Object.freeze([
  Object.freeze({
    mediaKey: "synthetic-media/alpha.bin",
    bytes: Buffer.from(
      "SEC27 synthetic media alpha; no user or provider bytes.",
    ),
  }),
  Object.freeze({
    mediaKey: "synthetic-media/bravo.bin",
    bytes: Buffer.from(
      "SEC27 synthetic media bravo; no user or provider bytes.",
    ),
  }),
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function objectFileName(mediaKey) {
  return `${sha256(mediaKey)}.gcm`;
}

function encryptAes256Gcm(plaintext, key, mediaKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(mediaKey, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

function decryptAes256Gcm(envelope, key, mediaKey) {
  if (!Buffer.isBuffer(envelope) || envelope.length < 29) {
    throw new SyntheticRecoveryError("synthetic_envelope_invalid");
  }
  try {
    const iv = envelope.subarray(0, 12);
    const tag = envelope.subarray(12, 28);
    const ciphertext = envelope.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(mediaKey, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    throw new SyntheticRecoveryError("synthetic_authentication_rejected", {
      cause: error,
    });
  }
}

function assertSyntheticMediaKey(mediaKey) {
  if (
    typeof mediaKey !== "string" ||
    !mediaKey.startsWith("synthetic-media/") ||
    mediaKey.includes("..") ||
    mediaKey.includes("\\") ||
    mediaKey.split("/").some((part) => part.length === 0 || part === ".")
  ) {
    throw new SyntheticRecoveryError("synthetic_metadata_invalid");
  }
}

async function writePrivateFile(filePath, data) {
  await writeFile(filePath, data, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function createSyntheticPackage(root, key) {
  const sourceDir = path.join(root, "source");
  const packageDir = path.join(root, "package");
  await mkdir(sourceDir, { mode: 0o700 });
  await mkdir(packageDir, { mode: 0o700 });

  const metadata = {
    schemaVersion: 1,
    records: SYNTHETIC_OBJECTS.map(({ mediaKey }) => ({ mediaKey })),
  };
  const manifest = { schemaVersion: 1, records: [] };

  for (const object of SYNTHETIC_OBJECTS) {
    assertSyntheticMediaKey(object.mediaKey);
    const sourcePath = path.join(sourceDir, path.basename(object.mediaKey));
    await writePrivateFile(sourcePath, object.bytes);
    const plaintext = await readFile(sourcePath);
    const encrypted = encryptAes256Gcm(plaintext, key, object.mediaKey);
    const objectFile = objectFileName(object.mediaKey);
    await writePrivateFile(path.join(packageDir, objectFile), encrypted);
    manifest.records.push({
      mediaKey: object.mediaKey,
      objectFile,
      byteLength: plaintext.length,
      sha256: sha256(plaintext),
    });
  }

  await writePrivateFile(
    path.join(packageDir, "metadata.json"),
    `${JSON.stringify(metadata)}\n`,
  );
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8");
  await writePrivateFile(path.join(packageDir, "manifest.json"), manifestBytes);
  await rm(sourceDir, { recursive: true, force: true });

  return { packageDir, manifestSha256: sha256(manifestBytes) };
}

async function restoreSyntheticPackage({ packageDir, restoreDir, key }) {
  let manifest;
  let metadata;
  try {
    manifest = JSON.parse(
      await readFile(path.join(packageDir, "manifest.json"), "utf8"),
    );
    metadata = JSON.parse(
      await readFile(path.join(packageDir, "metadata.json"), "utf8"),
    );
  } catch (error) {
    throw new SyntheticRecoveryError("synthetic_metadata_unreadable", {
      cause: error,
    });
  }

  if (
    !manifest ||
    !Array.isArray(manifest.records) ||
    !metadata ||
    !Array.isArray(metadata.records) ||
    manifest.records.length !== metadata.records.length
  ) {
    throw new SyntheticRecoveryError("synthetic_metadata_invalid");
  }

  const referencedKeys = new Set(
    metadata.records.map((record) => record?.mediaKey),
  );
  let restoredObjects = 0;
  let checksumVerifiedObjects = 0;
  await mkdir(restoreDir, { mode: 0o700 });

  for (const record of manifest.records) {
    if (
      !record ||
      typeof record.mediaKey !== "string" ||
      typeof record.objectFile !== "string" ||
      !/^[a-f0-9]{64}\.gcm$/.test(record.objectFile) ||
      !Number.isSafeInteger(record.byteLength) ||
      record.byteLength < 0 ||
      !/^[a-f0-9]{64}$/.test(record.sha256)
    ) {
      throw new SyntheticRecoveryError("synthetic_manifest_invalid");
    }
    assertSyntheticMediaKey(record.mediaKey);
    if (
      !referencedKeys.has(record.mediaKey) ||
      record.objectFile !== objectFileName(record.mediaKey)
    ) {
      throw new SyntheticRecoveryError("synthetic_reference_invalid");
    }

    let envelope;
    try {
      envelope = await readFile(path.join(packageDir, record.objectFile));
    } catch (error) {
      throw new SyntheticRecoveryError("synthetic_media_missing", {
        cause: error,
      });
    }
    const plaintext = decryptAes256Gcm(envelope, key, record.mediaKey);
    if (
      plaintext.length !== record.byteLength ||
      sha256(plaintext) !== record.sha256
    ) {
      throw new SyntheticRecoveryError("synthetic_checksum_rejected");
    }
    await writePrivateFile(
      path.join(restoreDir, path.basename(record.mediaKey)),
      plaintext,
    );
    restoredObjects += 1;
    checksumVerifiedObjects += 1;
  }

  return { restoredObjects, checksumVerifiedObjects };
}

async function expectSyntheticRejection(operation, expectedCode) {
  try {
    await operation();
  } catch (error) {
    if (error instanceof SyntheticRecoveryError && error.code === expectedCode)
      return true;
    throw error;
  }
  throw new SyntheticRecoveryError("synthetic_rejection_not_observed");
}

/**
 * Runs actual encrypt/package/decrypt/restore/checksum work with only generated
 * test material. The result is deliberately value-free and safe to serialize.
 */
export async function runSyntheticLocalRecoveryRehearsal() {
  const root = await (async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sec27-local-recovery-"),
    );
    await chmod(directory, 0o700);
    return directory;
  })();

  let proof;
  let cleanupComplete = false;
  try {
    const generatedTestOnlyKey = randomBytes(32);
    const keyMaterialPath = path.join(root, "generated-test-only-material.bin");
    await writePrivateFile(keyMaterialPath, generatedTestOnlyKey);
    const testOnlyKey = await readFile(keyMaterialPath);
    const { packageDir, manifestSha256 } = await createSyntheticPackage(
      root,
      testOnlyKey,
    );
    const goodRestore = await restoreSyntheticPackage({
      packageDir,
      restoreDir: path.join(root, "restored-good"),
      key: testOnlyKey,
    });

    const firstObjectPath = path.join(
      packageDir,
      objectFileName(SYNTHETIC_OBJECTS[0].mediaKey),
    );
    const originalEnvelope = await readFile(firstObjectPath);
    const corruptedEnvelope = Buffer.from(originalEnvelope);
    corruptedEnvelope[corruptedEnvelope.length - 1] ^= 0x01;
    await writePrivateFile(firstObjectPath, corruptedEnvelope);
    const corruptionRejected = await expectSyntheticRejection(
      () =>
        restoreSyntheticPackage({
          packageDir,
          restoreDir: path.join(root, "restored-corrupt"),
          key: testOnlyKey,
        }),
      "synthetic_authentication_rejected",
    );
    await writePrivateFile(firstObjectPath, originalEnvelope);

    const wrongKeyRejected = await expectSyntheticRejection(
      () =>
        restoreSyntheticPackage({
          packageDir,
          restoreDir: path.join(root, "restored-wrong-material"),
          key: randomBytes(32),
        }),
      "synthetic_authentication_rejected",
    );

    const temporarilyMissingPath = `${firstObjectPath}.missing`;
    await rename(firstObjectPath, temporarilyMissingPath);
    const missingMediaRejected = await expectSyntheticRejection(
      () =>
        restoreSyntheticPackage({
          packageDir,
          restoreDir: path.join(root, "restored-missing"),
          key: testOnlyKey,
        }),
      "synthetic_media_missing",
    );
    await rename(temporarilyMissingPath, firstObjectPath);

    proof = {
      synthetic_only: true,
      source_metadata_records: SYNTHETIC_OBJECTS.length,
      source_media_objects: SYNTHETIC_OBJECTS.length,
      restored_media_objects: goodRestore.restoredObjects,
      checksum_verified_objects: goodRestore.checksumVerifiedObjects,
      corruption_rejected: corruptionRejected,
      wrong_material_rejected: wrongKeyRejected,
      missing_media_rejected: missingMediaRejected,
      synthetic_manifest_sha256: manifestSha256,
      external_provider_calls: 0,
      database_calls: 0,
      production_key_reads: 0,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
    cleanupComplete = true;
  }

  return Object.freeze({
    ...proof,
    private_temporary_cleanup_confirmed: cleanupComplete,
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runSyntheticLocalRecoveryRehearsal()
    .then((proof) => process.stdout.write(`${JSON.stringify(proof)}\n`))
    .catch(() => {
      process.stderr.write("synthetic local recovery rehearsal failed\n");
      process.exitCode = 1;
    });
}
