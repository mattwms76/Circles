#!/usr/bin/env node
/**
 * Future-only operations SQL transport.
 *
 * This module intentionally accepts no connection string, environment fallback, or
 * remote CLI parameters. A parent-owned caller must provide an already-connected,
 * transaction-capable PostgreSQL client.
 */
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FUTURE_MANIFEST_FORMAT =
  "circles-sec27-future-migration-manifest-v1";
export const FUTURE_SQL_PREFIX = "operations/future-migrations/";

export class FutureMigrationTransportError extends Error {
  constructor(code, options = {}) {
    super(code, { cause: options.cause });
    this.name = "FutureMigrationTransportError";
    this.code = code;
    this.retryForbidden = options.retryForbidden ?? false;
    this.rollbackAttempted = options.rollbackAttempted ?? false;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertRepositoryRelativePath(value, code) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\")) {
    throw new FutureMigrationTransportError(code);
  }
  if (path.posix.isAbsolute(value))
    throw new FutureMigrationTransportError(code);

  const segments = value.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw new FutureMigrationTransportError(code);
  }

  return value;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== "..")
  );
}

async function readRepositoryFile(repositoryRoot, relativePath, code) {
  const checkedPath = assertRepositoryRelativePath(relativePath, code);
  const resolvedRoot = await realpath(repositoryRoot).catch(() => {
    throw new FutureMigrationTransportError("repository_root_unavailable");
  });
  const resolvedCandidate = path.resolve(resolvedRoot, checkedPath);
  if (!isWithin(resolvedRoot, resolvedCandidate)) {
    throw new FutureMigrationTransportError(code);
  }

  const realCandidate = await realpath(resolvedCandidate).catch(() => {
    throw new FutureMigrationTransportError(code);
  });
  if (!isWithin(resolvedRoot, realCandidate)) {
    throw new FutureMigrationTransportError(code);
  }

  return readFile(realCandidate);
}

function validateManifestShape(manifest) {
  if (
    !isPlainObject(manifest) ||
    manifest.format !== FUTURE_MANIFEST_FORMAT ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.length === 0
  ) {
    throw new FutureMigrationTransportError("manifest_invalid");
  }

  return manifest.entries.map((entry) => {
    if (
      !isPlainObject(entry) ||
      !Number.isSafeInteger(entry.ordinal) ||
      entry.ordinal < 1 ||
      typeof entry.path !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    ) {
      throw new FutureMigrationTransportError("manifest_entry_invalid");
    }
    if (
      !entry.path.startsWith(FUTURE_SQL_PREFIX) ||
      !entry.path.endsWith(".sql")
    ) {
      throw new FutureMigrationTransportError("future_sql_path_required");
    }
    assertRepositoryRelativePath(entry.path, "manifest_path_invalid");
    return { ordinal: entry.ordinal, path: entry.path, sha256: entry.sha256 };
  });
}

/**
 * Reads and checks an immutable, repository-relative manifest and every SQL byte
 * before a transaction starts. The returned SQL strings are the exact bytes whose
 * checksums were verified, avoiding a second read between validation and execution.
 */
export async function prepareFutureOnlyMigrationBundle({
  repositoryRoot,
  manifestRelativePath,
}) {
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0) {
    throw new FutureMigrationTransportError("repository_root_required");
  }
  const checkedManifestPath = assertRepositoryRelativePath(
    manifestRelativePath,
    "manifest_path_invalid",
  );
  if (checkedManifestPath.startsWith("operations/migrations/")) {
    throw new FutureMigrationTransportError(
      "manifest_must_be_outside_applied_migrations",
    );
  }

  let manifest;
  try {
    manifest = JSON.parse(
      (
        await readRepositoryFile(
          repositoryRoot,
          checkedManifestPath,
          "manifest_unreadable",
        )
      ).toString("utf8"),
    );
  } catch (error) {
    if (error instanceof FutureMigrationTransportError) throw error;
    throw new FutureMigrationTransportError("manifest_invalid", {
      cause: error,
    });
  }

  const entries = validateManifestShape(manifest);
  const seenOrdinals = new Set();
  const seenPaths = new Set();
  let previousOrdinal = 0;
  const verified = [];

  for (const entry of entries) {
    if (seenOrdinals.has(entry.ordinal)) {
      throw new FutureMigrationTransportError("manifest_ordinal_duplicate");
    }
    if (seenPaths.has(entry.path)) {
      throw new FutureMigrationTransportError("manifest_path_duplicate");
    }
    if (entry.ordinal !== previousOrdinal + 1) {
      throw new FutureMigrationTransportError("manifest_ordinal_gap");
    }
    seenOrdinals.add(entry.ordinal);
    seenPaths.add(entry.path);
    previousOrdinal = entry.ordinal;

    const sqlBytes = await readRepositoryFile(
      repositoryRoot,
      entry.path,
      "manifest_sql_unreadable",
    );
    if (sha256(sqlBytes) !== entry.sha256) {
      throw new FutureMigrationTransportError("manifest_checksum_mismatch");
    }
    verified.push({ ...entry, sql: sqlBytes.toString("utf8") });
  }

  const manifestSha256 = sha256(
    verified
      .map(
        (entry) => `${entry.ordinal}\u0000${entry.path}\u0000${entry.sha256}\n`,
      )
      .join(""),
  );

  return Object.freeze({
    manifestSha256,
    entries: Object.freeze(verified.map((entry) => Object.freeze(entry))),
  });
}

function assertPgClient(pgClient) {
  if (!pgClient || typeof pgClient.query !== "function") {
    throw new FutureMigrationTransportError("pg_client_required");
  }
}

/**
 * Executes an already-prepared future-only bundle in one caller-supplied PG
 * transaction. `recordReceipt`, when used, is invoked only after a confirmed
 * COMMIT; the helper never writes installed-history metadata itself.
 */
/**
 * @param {{pgClient: {query: (sql: string) => Promise<unknown>}, repositoryRoot: string, manifestRelativePath: string, recordReceipt?: (receipt: object) => Promise<unknown> | void}} options
 */
export async function applyFutureOnlyMigrationBundle({
  pgClient,
  repositoryRoot,
  manifestRelativePath,
  recordReceipt,
}) {
  assertPgClient(pgClient);
  if (recordReceipt !== undefined && typeof recordReceipt !== "function") {
    throw new FutureMigrationTransportError("receipt_recorder_invalid");
  }

  // This completes all filesystem and SHA-256 validation before BEGIN.
  const prepared = await prepareFutureOnlyMigrationBundle({
    repositoryRoot,
    manifestRelativePath,
  });

  let transactionStarted = false;
  let committed = false;
  let phase = "begin";

  try {
    await pgClient.query("BEGIN");
    transactionStarted = true;

    for (const entry of prepared.entries) {
      phase = "statement";
      await pgClient.query(entry.sql);
    }

    phase = "commit";
    await pgClient.query("COMMIT");
    committed = true;
  } catch (cause) {
    let rollbackAttempted = false;
    if (transactionStarted && !committed) {
      rollbackAttempted = true;
      try {
        await pgClient.query("ROLLBACK");
      } catch {
        // The original failure remains authoritative. A parent must inspect an
        // ambiguous transaction through bounded metadata instead of retrying it.
      }
    }
    throw new FutureMigrationTransportError(
      phase === "commit"
        ? "transaction_outcome_ambiguous"
        : "transaction_rolled_back",
      {
        cause,
        rollbackAttempted,
        retryForbidden: phase === "commit",
      },
    );
  }

  const receipt = Object.freeze({
    format: "circles-sec27-future-migration-receipt-v1",
    outcome: "committed",
    manifestSha256: prepared.manifestSha256,
    migrationCount: prepared.entries.length,
    entries: Object.freeze(
      prepared.entries.map(
        ({ ordinal, path: entryPath, sha256: entrySha256 }) =>
          Object.freeze({ ordinal, path: entryPath, sha256: entrySha256 }),
      ),
    ),
  });

  // Installed-history recording is deliberately a parent-owned post-commit step.
  if (recordReceipt) await recordReceipt(receipt);
  return receipt;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.stderr.write(
    "sec27-future-migration-transport is an import-only helper; pass an already-connected pg client from reviewed parent code.\n",
  );
  process.exitCode = 64;
}
