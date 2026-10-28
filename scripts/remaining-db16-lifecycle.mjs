#!/usr/bin/env node
/**
 * DB-16 lifecycle operator helper.
 *
 * This is not an installer and cannot create a schedule. It reads no .env file
 * and deliberately ignores inherited database settings: an operator must pass a
 * private, mode-0600 file containing one PostgreSQL connection URL. The default
 * invocation is a manual dry run with a batch of 25. A destructive invocation
 * requires the separately selected database policy plus an explicit private
 * confirmation JSON file; the database helper independently rejects it unless
 * its stored confirmation payload matches exactly.
 */
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const MAX_BATCH_SIZE = 100;
const DEFAULT_BATCH_SIZE = 25;
const PRIVATE_FILE_PERMISSIONS = 0o077;
const FUNCTION_NAME = "circles_ops.run_remaining_db16_security_state_retention";
const INHERITED_DATABASE_VARIABLES = [
  "DATABASE_URL",
  "SUPABASE_DATABASE_URL",
  "PGHOST",
  "PGPORT",
  "PGUSER",
  "PGPASSWORD",
  "PGDATABASE",
  "PGSERVICE",
  "PGPASSFILE",
];

function usage() {
  return [
    "Usage:",
    "  node scripts/remaining-db16-lifecycle.mjs --print-sql [--batch-size 1..100]",
    "  node scripts/remaining-db16-lifecycle.mjs --database-url-file /private/db-url [--batch-size 1..100]",
    "  node scripts/remaining-db16-lifecycle.mjs --database-url-file /private/db-url --delete \\",
    "    --acknowledge-db16-destructive-operation --confirm-private-payload /private/confirmation.json",
    "",
    "The default is p_dry_run => true. --delete does not install or schedule anything;",
    "it is rejected by the database until a separately approved active policy and exact",
    "private confirmation payload have already been installed by the parent-owned workflow.",
  ].join("\n");
}

function fail(message) {
  throw new Error(`DB-16 lifecycle: ${message}`);
}

function parseBatchSize(value) {
  if (!/^[1-9][0-9]*$/.test(value ?? "")) {
    fail("--batch-size must be an integer from 1 through 100");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_BATCH_SIZE) {
    fail("--batch-size must be an integer from 1 through 100");
  }
  return parsed;
}

export function parseRemainingDb16Args(argumentsList) {
  const options = {
    batchSize: DEFAULT_BATCH_SIZE,
    databaseUrlFile: null,
    dryRun: true,
    printSql: false,
    acknowledgement: false,
    confirmationFile: null,
  };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--help" || argument === "-h") {
      return { help: true };
    }
    if (argument === "--batch-size") {
      options.batchSize = parseBatchSize(argumentsList[++index]);
      continue;
    }
    if (argument === "--database-url-file") {
      const value = argumentsList[++index];
      if (!value) fail("--database-url-file requires a private file path");
      options.databaseUrlFile = resolve(value);
      continue;
    }
    if (argument === "--delete") {
      options.dryRun = false;
      continue;
    }
    if (argument === "--acknowledge-db16-destructive-operation") {
      options.acknowledgement = true;
      continue;
    }
    if (argument === "--confirm-private-payload") {
      const value = argumentsList[++index];
      if (!value)
        fail("--confirm-private-payload requires a private JSON file path");
      options.confirmationFile = resolve(value);
      continue;
    }
    if (argument === "--print-sql") {
      options.printSql = true;
      continue;
    }
    fail(`unknown argument ${JSON.stringify(argument)}`);
  }

  if (!options.dryRun) {
    if (!options.acknowledgement || !options.confirmationFile) {
      fail(
        "--delete requires --acknowledge-db16-destructive-operation and --confirm-private-payload",
      );
    }
    if (options.printSql) {
      fail("--delete cannot be combined with --print-sql");
    }
  } else if (options.confirmationFile || options.acknowledgement) {
    fail("a private confirmation is only accepted with explicit --delete");
  }

  if (options.printSql && options.databaseUrlFile) {
    fail("--print-sql does not accept --database-url-file");
  }
  if (!options.printSql && !options.databaseUrlFile) {
    fail("--database-url-file is required unless --print-sql is used");
  }
  return options;
}

async function readPrivateFile(path, label) {
  const details = await stat(path);
  if (!details.isFile()) fail(`${label} must be a regular file`);
  if ((details.mode & PRIVATE_FILE_PERMISSIONS) !== 0) {
    fail(`${label} must not be group/world accessible (chmod 600)`);
  }
  const contents = (await readFile(path, "utf8")).trim();
  if (!contents) fail(`${label} is empty`);
  return contents;
}

async function readDatabaseUrl(path) {
  const value = await readPrivateFile(path, "database URL file");
  if (/\s/.test(value)) fail("database URL file must contain exactly one URL");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("database URL file does not contain a valid URL");
  }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
    fail("database URL must use postgres:// or postgresql://");
  }
  return value;
}

function refuseInheritedDatabaseConfiguration() {
  const inherited = INHERITED_DATABASE_VARIABLES.filter(
    (name) => process.env[name] !== undefined,
  );
  if (inherited.length > 0) {
    fail(
      "refusing inherited PostgreSQL configuration; use only --database-url-file",
    );
  }
}

async function readConfirmationPayload(path) {
  const raw = await readPrivateFile(path, "private confirmation payload");
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    fail("private confirmation payload must be valid JSON");
  }
  if (
    !payload ||
    Array.isArray(payload) ||
    payload.schema !== "circles.db16.retention-confirmation.v1" ||
    typeof payload.policyVersion !== "string" ||
    payload.policyVersion.length < 1 ||
    payload.policyVersion.length > 64 ||
    typeof payload.approvalReference !== "string" ||
    payload.approvalReference.trim().length < 1 ||
    payload.approvalReference.length > 160 ||
    !payload.confirmation ||
    Array.isArray(payload.confirmation) ||
    typeof payload.confirmation !== "object"
  ) {
    fail(
      "private confirmation payload requires schema, policyVersion, approvalReference, and an object confirmation",
    );
  }
  return payload.confirmation;
}

export function invocationSql() {
  return `SELECT state_kind, candidate_count, deleted_count, hold_active\nFROM ${FUNCTION_NAME}(\n  $1::boolean,\n  $2::integer,\n  'manual'::text,\n  $3::jsonb\n);`;
}

export function printableDryRunSql(batchSize) {
  return [
    "-- This is a dry-run-only invocation; it does not install or schedule DB-16.",
    "SELECT state_kind, candidate_count, deleted_count, hold_active",
    `FROM ${FUNCTION_NAME}(`,
    "  p_dry_run => true,",
    `  p_batch_size => ${batchSize},`,
    "  p_execution_source => 'manual',",
    "  p_confirmation => NULL",
    ");",
  ].join("\n");
}

async function run(options) {
  if (options.printSql) {
    process.stdout.write(`${printableDryRunSql(options.batchSize)}\n`);
    return;
  }

  refuseInheritedDatabaseConfiguration();
  const connectionString = await readDatabaseUrl(options.databaseUrlFile);
  const confirmation = options.dryRun
    ? null
    : await readConfirmationPayload(options.confirmationFile);
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5_000,
    application_name: "circles-db16-lifecycle-manual",
  });

  try {
    await client.connect();
    const result = await client.query({
      text: invocationSql(),
      values: [options.dryRun, options.batchSize, confirmation],
      query_timeout: 7_000,
    });
    // The helper returns sanitized aggregate counts only. Do not print URLs,
    // confirmation payloads, state/session keys, or any connection metadata.
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: options.dryRun ? "dry_run" : "delete",
          batchSize: options.batchSize,
          rows: result.rows,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main() {
  const options = parseRemainingDb16Args(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  await run(options);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "DB-16 lifecycle failed"}\n`,
    );
    process.exitCode = 1;
  });
}
