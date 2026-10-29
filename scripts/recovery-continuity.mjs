#!/usr/bin/env node
/**
 * Circles media continuity inventory and owner-held recovery package utility.
 *
 * This is intentionally separate from the database-backup workflow. It never
 * loads dotenv files, reads a private age identity, calls provider storage APIs,
 * restores data, mutates PostgreSQL, or uploads an artifact. The optional
 * signing-material input is deliberately file-based and opt-in: the running
 * process never reads MANUS_JWT_SECRET.
 */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(moduleDirectory, "..");
export const PRIVATE_SCHEMA = "circles_app";
export const INVENTORY_FORMAT = "circles-media-inventory-v1";
export const PACKAGE_FORMAT = "circles-media-continuity-v1";
export const EXPECTED_BACKUP_RECIPIENT =
  "age179xvs5mqqklvse2w4xhu75s7958krgxepl9ysg55dwwrqteahgmsjcem3f";
export const MAX_SINGLE_MEDIA_BYTES = 20 * 1024 * 1024;
export const DEFAULT_MAX_OBJECTS = 250;
export const MAX_MAX_OBJECTS = 1_000;
export const DEFAULT_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
export const MAX_MAX_TOTAL_BYTES = 500 * 1024 * 1024;
export const MEDIA_FETCH_TIMEOUT_MS = 15_000;
export const ARCHIVE_TIMEOUT_MS = 60_000;
export const AGE_TIMEOUT_MS = 120_000;

const TOOL_TERM_GRACE_MS = 5_000;
const MAX_TOOL_TERM_GRACE_MS = 30_000;

const AGE_RECIPIENT = /^age1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}$/;
const MANAGED_STORAGE_KEY =
  /^social-encrypted\/[1-9]\d*\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp|mp4)\.enc$/;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
]);
const REFERENCE_FIELDS = Object.freeze([
  "profile_refs",
  "circle_refs",
  "post_refs",
  "message_refs",
  "stream_refs",
]);

export class ContinuitySafetyError extends Error {
  constructor(code) {
    super(code);
    this.name = "ContinuitySafetyError";
    this.code = code;
  }
}

function fail(code) {
  throw new ContinuitySafetyError(code);
}

function safeInteger(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    fail(code);
  return value;
}

function privatePath(value, code) {
  if (
    typeof value !== "string" ||
    !path.isAbsolute(value) ||
    value.includes("\0")
  )
    fail(code);
  return path.resolve(value);
}

function lstatTrustedFile(
  filename,
  { privateFile = true, maxBytes = 1024 * 1024 } = {},
) {
  const absolute = privatePath(filename, "file_path_invalid");
  let stat;
  try {
    stat = fs.lstatSync(absolute);
  } catch {
    fail("required_file_unavailable");
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (uid !== null && stat.uid !== uid) ||
    (privateFile ? (stat.mode & 0o077) !== 0 : (stat.mode & 0o022) !== 0) ||
    stat.size < 1 ||
    stat.size > maxBytes
  ) {
    fail("required_file_not_trusted");
  }
  return absolute;
}

function readTrustedText(filename, options) {
  const absolute = lstatTrustedFile(filename, options);
  try {
    return fs.readFileSync(absolute, "utf8");
  } catch {
    fail("required_file_unavailable");
  }
}

function assertPrivateDirectory(directory) {
  const absolute = privatePath(directory, "output_path_invalid");
  let stat;
  try {
    stat = fs.lstatSync(absolute);
  } catch {
    fail("output_directory_unavailable");
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (uid !== null && stat.uid !== uid) ||
    (stat.mode & 0o077) !== 0
  ) {
    fail("output_directory_not_private");
  }
  return absolute;
}

function parsePositiveOption(value, fallback, maximum, code) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) fail(code);
  return safeInteger(Number(value), 1, maximum, code);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function numberFromDatabase(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return Number.NaN;
}

function canonicalMediaUrl(key) {
  return `/manus-storage/${key}`;
}

function strictOrigin(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2_048 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }
  try {
    const origin = new URL(value);
    if (
      origin.origin !== value ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash
    ) {
      return null;
    }
    return origin;
  } catch {
    return null;
  }
}

function isLoopbackOrigin(origin) {
  const hostname = origin.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return ["127.0.0.1", "::1", "localhost"].includes(hostname);
}

/**
 * Public media downloads may carry an app bearer, so an arbitrary Preview host
 * is not a sufficient trust boundary. A public target must exactly equal the
 * already-injected app API origin. Synthetic loopback fixtures remain allowed.
 */
export function isAllowedMediaOrigin(value) {
  const origin = strictOrigin(value);
  if (!origin) return null;
  if (isLoopbackOrigin(origin)) {
    return ["http:", "https:"].includes(origin.protocol) &&
      origin.port === "3000"
      ? origin
      : null;
  }
  const trusted = strictOrigin(process.env.EXPO_PUBLIC_API_BASE_URL);
  if (
    !trusted ||
    isLoopbackOrigin(trusted) ||
    origin.protocol !== "https:" ||
    origin.port ||
    trusted.protocol !== "https:" ||
    trusted.port ||
    origin.origin !== trusted.origin
  ) {
    return null;
  }
  return origin;
}

/** Validates only Circles-generated encrypted upload metadata; no media values are logged. */
export function validateInventoryDocument(
  document,
  {
    maxObjects = DEFAULT_MAX_OBJECTS,
    maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
  } = {},
) {
  safeInteger(maxObjects, 1, MAX_MAX_OBJECTS, "max_objects_out_of_range");
  safeInteger(
    maxTotalBytes,
    1,
    MAX_MAX_TOTAL_BYTES,
    "max_total_bytes_out_of_range",
  );
  if (
    !document ||
    typeof document !== "object" ||
    Array.isArray(document) ||
    document.format !== INVENTORY_FORMAT ||
    !Array.isArray(document.media)
  ) {
    fail("inventory_invalid");
  }
  if (document.media.length > maxObjects)
    fail("inventory_object_limit_exceeded");
  const seen = new Set();
  let totalBytes = 0;
  let referencedObjects = 0;
  const media = document.media.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      fail("inventory_invalid");
    const key = entry.storage_key;
    const url = entry.url;
    const mimeType = entry.mime_type;
    const bytes = numberFromDatabase(entry.bytes);
    if (
      typeof key !== "string" ||
      !MANAGED_STORAGE_KEY.test(key) ||
      typeof url !== "string" ||
      url !== canonicalMediaUrl(key) ||
      typeof mimeType !== "string" ||
      !ALLOWED_MIME_TYPES.has(mimeType) ||
      !Number.isSafeInteger(bytes) ||
      bytes < 1 ||
      bytes > MAX_SINGLE_MEDIA_BYTES ||
      seen.has(key)
    ) {
      fail("inventory_invalid");
    }
    seen.add(key);
    const references = {};
    let totalReferences = 0;
    const supplied = entry.references;
    if (!supplied || typeof supplied !== "object" || Array.isArray(supplied))
      fail("inventory_invalid");
    if (
      Object.keys(supplied).some(
        (keyName) => !REFERENCE_FIELDS.includes(keyName),
      )
    )
      fail("inventory_invalid");
    for (const field of REFERENCE_FIELDS) {
      const count = numberFromDatabase(supplied[field]);
      if (!Number.isSafeInteger(count) || count < 0 || count > 1_000_000)
        fail("inventory_invalid");
      references[field] = count;
      totalReferences += count;
    }
    if (totalReferences > 0) referencedObjects += 1;
    totalBytes += bytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maxTotalBytes)
      fail("inventory_byte_limit_exceeded");
    return { storage_key: key, url, mime_type: mimeType, bytes, references };
  });
  return {
    format: INVENTORY_FORMAT,
    media,
    summary: {
      objects: media.length,
      bytes: totalBytes,
      referenced_objects: referencedObjects,
      unreferenced_objects: media.length - referencedObjects,
    },
  };
}

export function summarizeInventory(inventory) {
  const validated = validateInventoryDocument(inventory, {
    maxObjects: MAX_MAX_OBJECTS,
    maxTotalBytes: MAX_MAX_TOTAL_BYTES,
  });
  return { ...validated.summary, format: INVENTORY_FORMAT };
}

function normalizeInventoryRows(uploadRows, referenceRows, limits) {
  if (!Array.isArray(uploadRows) || !Array.isArray(referenceRows))
    fail("database_inventory_unavailable");
  const referencesByKey = new Map();
  for (const row of referenceRows) {
    if (
      !row ||
      typeof row.storage_key !== "string" ||
      referencesByKey.has(row.storage_key)
    )
      fail("database_inventory_unavailable");
    referencesByKey.set(row.storage_key, {
      profile_refs: numberFromDatabase(row.profile_refs),
      circle_refs: numberFromDatabase(row.circle_refs),
      post_refs: numberFromDatabase(row.post_refs),
      message_refs: numberFromDatabase(row.message_refs),
      stream_refs: numberFromDatabase(row.stream_refs),
    });
  }
  if (referenceRows.length !== uploadRows.length)
    fail("database_inventory_unavailable");
  const inventory = {
    format: INVENTORY_FORMAT,
    media: uploadRows.map((row) => ({
      storage_key: row?.storage_key,
      url: row?.url,
      mime_type: row?.mime_type,
      bytes: numberFromDatabase(row?.bytes),
      references: referencesByKey.get(row?.storage_key),
    })),
  };
  return validateInventoryDocument(inventory, limits);
}

const UPLOAD_INVENTORY_SQL = `
SELECT
  "storageKey" AS storage_key,
  "url" AS url,
  "mimeType" AS mime_type,
  "bytes" AS bytes
FROM "circles_app"."socialUploads"
ORDER BY "id" ASC
LIMIT $1`;

const REFERENCE_INVENTORY_SQL = `
WITH selected AS (
  SELECT * FROM unnest($1::text[], $2::text[]) AS item(storage_key, url)
)
SELECT
  selected.storage_key AS storage_key,
  (SELECT count(*) FROM "circles_app"."profiles" AS p WHERE p."avatar" = selected.url OR p."cover" = selected.url) AS profile_refs,
  (SELECT count(*) FROM "circles_app"."circles" AS c WHERE c."image" = selected.url) AS circle_refs,
  (SELECT count(*) FROM "circles_app"."posts" AS p WHERE p."media" = selected.url) AS post_refs,
  (SELECT count(*) FROM "circles_app"."messages" AS m WHERE m."media" = selected.url) AS message_refs,
  (SELECT count(*) FROM "circles_app"."streams" AS s WHERE s."thumbnail" = selected.url) AS stream_refs
FROM selected
ORDER BY selected.storage_key ASC`;

async function loadReadOnlyClient({ projectDir, environment }) {
  const root = privatePath(projectDir, "project_directory_invalid");
  let configuration;
  let pg;
  try {
    configuration = await import(
      pathToFileURL(path.join(root, "server/_core/postgres-config.mjs")).href
    );
    const projectRequire = createRequire(path.join(root, "package.json"));
    pg = projectRequire("pg");
  } catch {
    fail("database_driver_unavailable");
  }
  if (
    configuration.PRIVATE_SCHEMA !== PRIVATE_SCHEMA ||
    typeof configuration.getPostgresConnectionOptions !== "function" ||
    !pg?.Client
  ) {
    fail("database_driver_unavailable");
  }
  let options;
  try {
    options = configuration.getPostgresConnectionOptions(environment, root);
  } catch {
    fail("database_configuration_unavailable");
  }
  return new pg.Client(options);
}

/**
 * Reads only bounded app-owned upload metadata and reference counts in a declared
 * read-only transaction. It never selects message, user, or encryption-key values.
 */
export async function collectMediaInventory({
  projectDir = PROJECT_ROOT,
  environment = process.env,
  maxObjects = DEFAULT_MAX_OBJECTS,
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
  client: suppliedClient,
} = {}) {
  const limits = {
    maxObjects: safeInteger(
      maxObjects,
      1,
      MAX_MAX_OBJECTS,
      "max_objects_out_of_range",
    ),
    maxTotalBytes: safeInteger(
      maxTotalBytes,
      1,
      MAX_MAX_TOTAL_BYTES,
      "max_total_bytes_out_of_range",
    ),
  };
  const client =
    suppliedClient ?? (await loadReadOnlyClient({ projectDir, environment }));
  let connected = false;
  try {
    await client.connect();
    connected = true;
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const uploadResult = await client.query({
      text: UPLOAD_INVENTORY_SQL,
      values: [limits.maxObjects + 1],
    });
    if (!Array.isArray(uploadResult?.rows))
      fail("database_inventory_unavailable");
    if (uploadResult.rows.length > limits.maxObjects)
      fail("inventory_object_limit_exceeded");
    const orderedUploads = [...uploadResult.rows].sort((left, right) =>
      String(left.storage_key).localeCompare(String(right.storage_key)),
    );
    const keys = orderedUploads.map((row) => row.storage_key);
    const urls = orderedUploads.map((row) => row.url);
    const referenceResult = keys.length
      ? await client.query({
          text: REFERENCE_INVENTORY_SQL,
          values: [keys, urls],
        })
      : { rows: [] };
    const inventory = normalizeInventoryRows(
      orderedUploads,
      referenceResult?.rows,
      limits,
    );
    await client.query("COMMIT");
    return inventory;
  } catch (error) {
    if (error instanceof ContinuitySafetyError) throw error;
    fail("database_inventory_unavailable");
  } finally {
    if (connected) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // A committed/closed transaction has no sensitive error path to report.
      }
    }
    try {
      await client.end();
    } catch {
      // Close failure cannot cause a private driver error to escape.
    }
  }
}

export async function writePrivateInventory(filename, inventory) {
  const absolute = privatePath(filename, "inventory_output_path_invalid");
  const parent = assertPrivateDirectory(path.dirname(absolute));
  if (
    path.dirname(absolute) !== parent ||
    path.basename(absolute) !== path.basename(filename) ||
    fs.existsSync(absolute)
  ) {
    fail("inventory_output_unavailable");
  }
  const content =
    JSON.stringify(
      validateInventoryDocument(inventory, {
        maxObjects: MAX_MAX_OBJECTS,
        maxTotalBytes: MAX_MAX_TOTAL_BYTES,
      }),
    ) + "\n";
  try {
    await fsp.writeFile(absolute, content, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await fsp.chmod(absolute, 0o600);
  } catch {
    try {
      await fsp.rm(absolute, { force: true });
    } catch {
      // Preserve a fixed failure code.
    }
    fail("inventory_output_unavailable");
  }
  return absolute;
}

export function loadPrivateInventory(filename, limits = {}) {
  const text = readTrustedText(filename, {
    privateFile: true,
    maxBytes: 8 * 1024 * 1024,
  });
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("inventory_invalid");
  }
  return validateInventoryDocument(parsed, limits);
}

export function readApprovedRecipient(filename) {
  const text = readTrustedText(filename, { privateFile: false, maxBytes: 256 });
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (
    lines.length !== 1 ||
    !AGE_RECIPIENT.test(lines[0]) ||
    lines[0] !== EXPECTED_BACKUP_RECIPIENT
  ) {
    fail("backup_recipient_not_approved");
  }
  return lines[0];
}

function loadMediaBearer(filename) {
  const text = readTrustedText(filename, {
    privateFile: true,
    maxBytes: 32 * 1024,
  });
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("media_auth_invalid");
  }
  const bearer = parsed?.bearerToken;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).some((key) => key !== "bearerToken") ||
    typeof bearer !== "string" ||
    !bearer.trim() ||
    bearer.length > 16_384 ||
    /[\r\n\0]/.test(bearer)
  ) {
    fail("media_auth_invalid");
  }
  return bearer;
}

function loadSigningMaterial(filename) {
  const text = readTrustedText(filename, {
    privateFile: true,
    maxBytes: 128 * 1024,
  });
  const value = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (
    !value ||
    value.length < 32 ||
    value.length > 100_000 ||
    /[\r\n\0]/.test(value)
  )
    fail("signing_material_invalid");
  return Buffer.from(value, "utf8");
}

async function readBoundedResponse(response, expectedBytes) {
  if (!response.body) fail("media_fetch_failed");
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) !== expectedBytes)
    fail("media_fetch_failed");
  const reader = response.body.getReader();
  const output = Buffer.allocUnsafe(expectedBytes);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength || value.byteLength > expectedBytes - offset)
        fail("media_fetch_failed");
      output.set(value, offset);
      offset += value.byteLength;
    }
    if (offset !== expectedBytes) fail("media_fetch_failed");
    return output;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof ContinuitySafetyError) throw error;
    fail("media_fetch_failed");
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // No diagnostic from a malformed response is allowed to escape.
    }
  }
}

/** Fetches only the exact canonical app media route; redirects and arbitrary URLs are rejected. */
export async function fetchAppMedia({
  origin,
  storageKey,
  bytes,
  bearerToken,
  fetchImpl = fetch,
}) {
  const safeOrigin = isAllowedMediaOrigin(origin);
  if (
    !safeOrigin ||
    typeof storageKey !== "string" ||
    !MANAGED_STORAGE_KEY.test(storageKey)
  )
    fail("media_source_not_allowlisted");
  safeInteger(bytes, 1, MAX_SINGLE_MEDIA_BYTES, "media_fetch_failed");
  const requestUrl = new URL(`/api/media/${storageKey}`, safeOrigin);
  let response;
  try {
    response = await fetchImpl(requestUrl, {
      method: "GET",
      headers: {
        Accept: "application/octet-stream",
        Authorization: `Bearer ${bearerToken}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS),
    });
  } catch {
    fail("media_fetch_failed");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    fail("media_fetch_failed");
  }
  return readBoundedResponse(response, bytes);
}

function safeProcessEnvironment() {
  const allowed = [
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TZ",
    "TMPDIR",
    "SYSTEMROOT",
  ];
  return Object.fromEntries(
    allowed.flatMap((key) =>
      process.env[key] ? [[key, process.env[key]]] : [],
    ),
  );
}

function signalOwnedTool(child, signal) {
  const pid = child.pid;
  if (process.platform !== "win32" && Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // The group may already be gone; fall back to the direct child below.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // A completed helper must not turn timeout cleanup into an unsafe error.
  }
}

export async function runTool(
  command,
  argumentsList,
  timeout,
  operation,
  { terminationGraceMs = TOOL_TERM_GRACE_MS } = {},
) {
  const grace = safeInteger(
    terminationGraceMs,
    1,
    MAX_TOOL_TERM_GRACE_MS,
    operation,
  );
  await new Promise((resolve, reject) => {
    let child;
    let timedOut = false;
    let settled = false;
    let timeoutTimer;
    let graceTimer;

    const clearTimers = () => {
      clearTimeout(timeoutTimer);
      clearTimeout(graceTimer);
    };
    const settle = (error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (error) reject(new ContinuitySafetyError(operation));
      else resolve(undefined);
    };

    try {
      child = spawn(command, argumentsList, {
        detached: process.platform !== "win32",
        shell: false,
        stdio: ["ignore", "ignore", "ignore"],
        env: safeProcessEnvironment(),
      });
    } catch {
      settle(true);
      return;
    }

    timeoutTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      signalOwnedTool(child, "SIGTERM");
      graceTimer = setTimeout(() => {
        signalOwnedTool(child, "SIGKILL");
        // Do not depend on close: cleanup must run even for a stuck helper.
        settle(true);
      }, grace);
    }, timeout);

    child.once("error", () => {
      if (!timedOut) settle(true);
    });
    child.once("close", (code) => {
      // After a timeout, retain the grace timer so any surviving group members
      // are killed before downstream cleanup is allowed to run.
      if (timedOut) return;
      if (code === 0) settle(false);
      else settle(true);
    });
  });
}

async function sourceTree(projectDir) {
  try {
    const root = privatePath(projectDir, "project_directory_invalid");
    const output = await new Promise((resolve) => {
      const child = spawn("git", ["-C", root, "rev-parse", "HEAD^{tree}"], {
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
        env: safeProcessEnvironment(),
      });
      let stdout = "";
      child.stdout?.on("data", (data) => {
        if (stdout.length < 128)
          stdout += String(data).slice(0, 128 - stdout.length);
      });
      child.once("error", () => resolve("unknown"));
      child.once("close", (code) =>
        resolve(
          code === 0 && /^[a-f0-9]{40}\s*$/i.test(stdout)
            ? stdout.trim()
            : "unknown",
        ),
      );
    });
    return output;
  } catch {
    return "unknown";
  }
}

function prepareOutputFile(filename) {
  const output = privatePath(filename, "output_path_invalid");
  assertPrivateDirectory(path.dirname(output));
  if (!output.endsWith(".age") || fs.existsSync(output))
    fail("output_file_unavailable");
  return output;
}

async function writePrivateFile(filename, content) {
  await fsp.writeFile(filename, content, { mode: 0o600, flag: "wx" });
  await fsp.chmod(filename, 0o600);
}

async function archivePackage(tempdir, archivePath, names) {
  const args = [
    "--format=ustar",
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    "--mtime=@0",
    "-C",
    tempdir,
    "-cf",
    archivePath,
    ...names,
  ];
  await runTool("tar", args, ARCHIVE_TIMEOUT_MS, "continuity_archive_failed");
  try {
    await fsp.chmod(archivePath, 0o600);
  } catch {
    fail("continuity_archive_failed");
  }
}

function packageManifest(inventory, objectRecords, tree, signingIncluded) {
  return {
    format: PACKAGE_FORMAT,
    source_tree: tree,
    object_encoding: "app-media-proxy-plaintext-v1",
    recovery_requirement:
      "Re-encrypt each object using the preserved MANUS_JWT_SECRET and circles-media-v1 derivation before restoring its canonical storage key.",
    signing_material_included: signingIncluded,
    media: inventory.media.map((entry, index) => ({
      storage_key: entry.storage_key,
      url: entry.url,
      mime_type: entry.mime_type,
      bytes: entry.bytes,
      references: entry.references,
      archive_path: objectRecords[index].archive_path,
      sha256: objectRecords[index].sha256,
    })),
    summary: inventory.summary,
  };
}

/**
 * Builds exactly one separate, age-encrypted continuity package. The package is
 * not a daily backup asset and is never placed in the existing backup artifact
 * directory, so its three-file release allowlist remains untouched.
 */
export async function exportContinuityPackage({
  projectDir = PROJECT_ROOT,
  inventoryFile,
  mediaOrigin,
  mediaAuthFile,
  recipientFile,
  outputFile,
  includeSigningMaterial = false,
  signingMaterialFile,
  maxObjects = DEFAULT_MAX_OBJECTS,
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
  fetchImpl = fetch,
} = {}) {
  const limits = {
    maxObjects: safeInteger(
      maxObjects,
      1,
      MAX_MAX_OBJECTS,
      "max_objects_out_of_range",
    ),
    maxTotalBytes: safeInteger(
      maxTotalBytes,
      1,
      MAX_MAX_TOTAL_BYTES,
      "max_total_bytes_out_of_range",
    ),
  };
  const inventory = loadPrivateInventory(inventoryFile, limits);
  const origin = isAllowedMediaOrigin(mediaOrigin);
  if (!origin) fail("media_source_not_allowlisted");
  const bearerToken = loadMediaBearer(mediaAuthFile);
  const recipient = readApprovedRecipient(recipientFile);
  const output = prepareOutputFile(outputFile);
  if (includeSigningMaterial !== true && signingMaterialFile !== undefined)
    fail("signing_material_not_opted_in");
  if (includeSigningMaterial === true && !signingMaterialFile)
    fail("signing_material_file_required");
  let signingMaterial = null;
  if (includeSigningMaterial)
    signingMaterial = loadSigningMaterial(signingMaterialFile);

  const temporary = await fsp.mkdtemp(
    path.join(path.dirname(output), ".circles-continuity-"),
  );
  let success = false;
  try {
    await fsp.chmod(temporary, 0o700);
    const objectsDirectory = path.join(temporary, "objects");
    await fsp.mkdir(objectsDirectory, { mode: 0o700 });
    const objectRecords = [];
    for (let index = 0; index < inventory.media.length; index += 1) {
      const entry = inventory.media[index];
      const bytes = await fetchAppMedia({
        origin: origin.origin,
        storageKey: entry.storage_key,
        bytes: entry.bytes,
        bearerToken,
        fetchImpl,
      });
      const archivePath = `objects/${String(index + 1).padStart(6, "0")}.bin`;
      const diskPath = path.join(temporary, archivePath);
      await writePrivateFile(diskPath, bytes);
      objectRecords.push({ archive_path: archivePath, sha256: sha256(bytes) });
      bytes.fill(0);
    }
    const manifest = packageManifest(
      inventory,
      objectRecords,
      await sourceTree(projectDir),
      includeSigningMaterial,
    );
    await writePrivateFile(
      path.join(temporary, "manifest.json"),
      JSON.stringify(manifest) + "\n",
    );
    const archiveNames = [
      "manifest.json",
      ...objectRecords.map((record) => record.archive_path),
    ];
    if (signingMaterial) {
      const material = Buffer.from(
        JSON.stringify({
          format: "circles-signing-material-v1",
          environment_key: "MANUS_JWT_SECRET",
          media_derivation: "sha256(secret || circles-media-v1)",
          value: signingMaterial.toString("utf8"),
        }) + "\n",
        "utf8",
      );
      await writePrivateFile(
        path.join(temporary, "signing-material.json"),
        material,
      );
      material.fill(0);
      signingMaterial.fill(0);
      signingMaterial = null;
      archiveNames.push("signing-material.json");
    }
    const archivePath = path.join(temporary, "continuity.tar");
    await archivePackage(temporary, archivePath, archiveNames);
    const stagedCiphertext = path.join(temporary, "continuity.age");
    await runTool(
      "age",
      ["-r", recipient, "-o", stagedCiphertext, archivePath],
      AGE_TIMEOUT_MS,
      "continuity_encryption_failed",
    );
    await fsp.chmod(stagedCiphertext, 0o600);
    await fsp.rename(stagedCiphertext, output);
    await fsp.chmod(output, 0o600);
    success = true;
    return {
      output_file: output,
      sha256: await hashFile(output),
      bytes: (await fsp.stat(output)).size,
      ...inventory.summary,
      signing_material_included: includeSigningMaterial,
    };
  } catch (error) {
    if (error instanceof ContinuitySafetyError) throw error;
    fail("continuity_export_failed");
  } finally {
    if (signingMaterial) signingMaterial.fill(0);
    try {
      await fsp.rm(temporary, { recursive: true, force: true });
    } catch {
      // Do not turn a cleanup issue into a diagnostic containing paths or data.
    }
    if (!success) {
      try {
        await fsp.rm(output, { force: true });
      } catch {
        // Preserve fixed error handling.
      }
    }
  }
}

async function hashFile(filename) {
  const hash = createHash("sha256");
  const handle = await fsp.open(filename, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
    buffer.fill(0);
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

export function parseCliArguments(argv = process.argv.slice(2)) {
  const options = {
    mode: null,
    projectDir: PROJECT_ROOT,
    maxObjects: undefined,
    maxTotalBytes: undefined,
    includeSigningMaterial: false,
  };
  const flags = new Set();
  const values = new Map([
    ["--project-dir", "projectDir"],
    ["--inventory-output", "inventoryOutput"],
    ["--inventory-file", "inventoryFile"],
    ["--media-origin", "mediaOrigin"],
    ["--media-auth-file", "mediaAuthFile"],
    ["--recipient-file", "recipientFile"],
    ["--output-file", "outputFile"],
    ["--signing-material-file", "signingMaterialFile"],
    ["--max-objects", "maxObjects"],
    ["--max-total-bytes", "maxTotalBytes"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (["--inventory", "--verify-inventory", "--export"].includes(argument)) {
      flags.add(argument);
      continue;
    }
    if (argument === "--include-signing-material") {
      if (options.includeSigningMaterial) fail("duplicate_argument");
      options.includeSigningMaterial = true;
      continue;
    }
    const match = [...values.entries()].find(
      ([flag]) => argument === flag || argument.startsWith(`${flag}=`),
    );
    if (!match) fail("unknown_argument");
    const [flag, property] = match;
    if (
      Object.hasOwn(options, property) &&
      options[property] !== undefined &&
      property !== "projectDir"
    )
      fail("duplicate_argument");
    const value =
      argument === flag ? argv[++index] : argument.slice(flag.length + 1);
    if (!value || value.startsWith("--") || value.includes("\0"))
      fail("argument_value_invalid");
    if (property === "projectDir" && options.projectDir !== PROJECT_ROOT)
      fail("duplicate_argument");
    options[property] = value;
  }
  if (flags.size !== 1) fail("exactly_one_mode_required");
  options.mode = flags.has("--inventory")
    ? "inventory"
    : flags.has("--verify-inventory")
      ? "verify"
      : "export";
  options.maxObjects = parsePositiveOption(
    options.maxObjects,
    DEFAULT_MAX_OBJECTS,
    MAX_MAX_OBJECTS,
    "max_objects_out_of_range",
  );
  options.maxTotalBytes = parsePositiveOption(
    options.maxTotalBytes,
    DEFAULT_MAX_TOTAL_BYTES,
    MAX_MAX_TOTAL_BYTES,
    "max_total_bytes_out_of_range",
  );
  if (options.mode === "inventory") {
    if (
      !options.inventoryOutput ||
      options.inventoryFile ||
      options.mediaOrigin ||
      options.mediaAuthFile ||
      options.recipientFile ||
      options.outputFile ||
      options.includeSigningMaterial ||
      options.signingMaterialFile
    )
      fail("inventory_arguments_invalid");
  } else if (options.mode === "verify") {
    if (
      !options.inventoryFile ||
      options.inventoryOutput ||
      options.mediaOrigin ||
      options.mediaAuthFile ||
      options.recipientFile ||
      options.outputFile ||
      options.includeSigningMaterial ||
      options.signingMaterialFile
    )
      fail("verify_arguments_invalid");
  } else if (
    !options.inventoryFile ||
    !options.mediaOrigin ||
    !options.mediaAuthFile ||
    !options.recipientFile ||
    !options.outputFile ||
    options.inventoryOutput
  ) {
    fail("export_arguments_invalid");
  } else if (options.includeSigningMaterial && !options.signingMaterialFile) {
    fail("signing_material_file_required");
  } else if (!options.includeSigningMaterial && options.signingMaterialFile) {
    fail("signing_material_not_opted_in");
  }
  return options;
}

function helpText() {
  return (
    `Circles read-only media continuity utility\n\n` +
    `Inventory (uses only the pre-injected approved PostgreSQL configuration):\n` +
    `  node scripts/recovery-continuity.mjs --inventory --inventory-output /private/media-inventory.json\n\n` +
    `Verify a private inventory without a database connection:\n` +
    `  node scripts/recovery-continuity.mjs --verify-inventory --inventory-file /private/media-inventory.json\n\n` +
    `Export every inventory object through the exact app /api/media/{canonical-key} endpoint:\n` +
    `  node scripts/recovery-continuity.mjs --export --inventory-file /private/media-inventory.json --media-origin https://current-host.manus.computer --media-auth-file /private/media-auth.json --recipient-file /secure/backup/recipient.txt --output-file /private/circles-media-continuity.age\n\n` +
    `Add --include-signing-material --signing-material-file /private/existing-signing-material only after an owner deliberately stages the existing unrotated MANUS_JWT_SECRET.\n`
  );
}

export async function runCli(argv = process.argv.slice(2), dependencies = {}) {
  let options;
  try {
    options = parseCliArguments(argv);
    if (options.help) {
      process.stdout.write(helpText());
      return 0;
    }
    if (options.mode === "inventory") {
      const inventory = await (
        dependencies.collectMediaInventory ?? collectMediaInventory
      )({
        projectDir: options.projectDir,
        maxObjects: options.maxObjects,
        maxTotalBytes: options.maxTotalBytes,
      });
      await (dependencies.writePrivateInventory ?? writePrivateInventory)(
        options.inventoryOutput,
        inventory,
      );
      process.stdout.write(
        JSON.stringify({
          mode: "inventory",
          ...summarizeInventory(inventory),
        }) + "\n",
      );
      return 0;
    }
    if (options.mode === "verify") {
      const inventory = (
        dependencies.loadPrivateInventory ?? loadPrivateInventory
      )(options.inventoryFile, options);
      process.stdout.write(
        JSON.stringify({ mode: "verify", ...summarizeInventory(inventory) }) +
          "\n",
      );
      return 0;
    }
    const result = await (
      dependencies.exportContinuityPackage ?? exportContinuityPackage
    )(options);
    process.stdout.write(JSON.stringify({ mode: "export", ...result }) + "\n");
    return 0;
  } catch (error) {
    const code =
      error instanceof ContinuitySafetyError
        ? error.code
        : "unexpected_non_sensitive_operational_error";
    process.stderr.write(`recovery continuity failed: ${code}\n`);
    return 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runCli().then((status) => {
    process.exitCode = status;
  });
}
