#!/usr/bin/env node
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DATA_MIGRATION_COLUMNS,
  DATA_MIGRATION_KEY,
  DATA_MIGRATION_TABLE,
  LEGACY_TABLES,
  MANIFEST_VERSION,
  PRIVATE_SCHEMA,
  SOURCE_TREE,
} from "./supabase-data-manifest.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(moduleDirectory, "..");
export const WRITE_PAUSE_ACKNOWLEDGEMENT =
  "I_CONFIRM_CIRCLES_API_WRITES_ARE_PAUSED";
export const DEFAULT_BATCH_SIZE = 250;
export const MAX_BATCH_SIZE = 500;
export const LOCK_TIMEOUT_MS = 5_000;
export const STATEMENT_TIMEOUT_MS = 30_000;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TEMPORAL_COLUMNS = new Set([
  "createdAt",
  "updatedAt",
  "lastSignedIn",
  "expiresAt",
  "revokedAt",
  "lastReadAt",
  "readyAt",
  "lastHeartbeatAt",
  "endedAt",
  "joinedAt",
  "lastSeenAt",
  "leftAt",
  "completedAt",
]);

/** No application-row value is included in returned errors or CLI output. */
export class MigrationSafetyError extends Error {
  constructor(code) {
    super(code);
    this.name = "MigrationSafetyError";
    this.code = code;
  }
}

function fail(code) {
  throw new MigrationSafetyError(code);
}

function assertIdentifier(value) {
  if (typeof value !== "string" || !IDENTIFIER.test(value))
    fail("unsafe_identifier");
  return value;
}

export function quoteIdentifier(value) {
  return `"${assertIdentifier(value).replaceAll('"', '""')}"`;
}

export function qualifiedTable(tableName) {
  return `${quoteIdentifier(PRIVATE_SCHEMA)}.${quoteIdentifier(tableName)}`;
}

function mysqlIdentifier(value) {
  return `\`${assertIdentifier(value).replaceAll("`", "``")}\``;
}

function tableByName(name) {
  const table = LEGACY_TABLES.find((entry) => entry.name === name);
  if (!table) fail("table_not_allowlisted");
  return table;
}

function integer(value, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value)) fail("invalid_integer_option");
  return value;
}

export function validateBatchSize(value) {
  const batchSize = integer(value, DEFAULT_BATCH_SIZE);
  if (batchSize < 1 || batchSize > MAX_BATCH_SIZE)
    fail("batch_size_out_of_range");
  return batchSize;
}

/**
 * Parses only explicit modes. Apply additionally requires an acknowledgement that
 * the parent has stopped the active API writer. This utility cannot stop it itself.
 */
export function parseCliArguments(argv = process.argv.slice(2)) {
  const options = {
    mode: null,
    batchSize: DEFAULT_BATCH_SIZE,
    acknowledgement: null,
  };
  const modeFlags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--preflight", "--apply", "--verify"].includes(argument)) {
      modeFlags.add(argument);
      continue;
    }
    if (argument === "--batch-size") {
      options.batchSize = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (argument.startsWith("--batch-size=")) {
      options.batchSize = Number(argument.slice("--batch-size=".length));
      continue;
    }
    if (argument === "--acknowledge-write-pause") {
      options.acknowledgement = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument.startsWith("--acknowledge-write-pause=")) {
      options.acknowledgement = argument.slice(
        "--acknowledge-write-pause=".length,
      );
      continue;
    }
    if (argument === "--help" || argument === "-h") return { help: true };
    fail("unknown_argument");
  }
  if (modeFlags.size !== 1) fail("exactly_one_mode_required");
  options.mode = [...modeFlags][0].slice(2);
  options.batchSize = validateBatchSize(options.batchSize);
  if (
    options.mode === "apply" &&
    options.acknowledgement !== WRITE_PAUSE_ACKNOWLEDGEMENT
  ) {
    fail("write_pause_acknowledgement_required");
  }
  if (options.mode !== "apply" && options.acknowledgement !== null) {
    fail("write_pause_acknowledgement_only_valid_for_apply");
  }
  return options;
}

export function sourceEngineForVersion(version) {
  if (typeof version !== "string" || !version.trim())
    fail("source_version_unavailable");
  return /tidb/i.test(version) ? "tidb" : "mysql";
}

/**
 * Converts only temporal values to canonical UTC instants. mysql2 dateStrings
 * avoids locale conversion; PostgreSQL receives Date instances in UTC.
 */
export function normalizeCell(column, value) {
  if (value === null || value === undefined) return value ?? null;
  if (TEMPORAL_COLUMNS.has(column) && typeof value === "string") {
    const normalized = value.includes("T")
      ? value
      : `${value.replace(" ", "T")}Z`;
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.valueOf())) fail("invalid_source_timestamp");
    return parsed;
  }
  return value;
}

export function normalizedRow(table, row) {
  const output = {};
  for (const column of table.columns) {
    if (!Object.hasOwn(row, column)) fail("source_row_column_missing");
    output[column] = normalizeCell(column, row[column]);
  }
  return output;
}

function canonicalValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) fail("invalid_timestamp");
    return { $date: value.toISOString() };
  }
  if (Buffer.isBuffer(value)) return { $buffer: value.toString("base64") };
  if (typeof value === "bigint") return { $bigint: value.toString(10) };
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort())
      sorted[key] = canonicalValue(value[key]);
    return sorted;
  }
  return value;
}

export function canonicalRow(table, row) {
  return JSON.stringify(
    table.columns.map((column) => canonicalValue(row[column])),
  );
}

export function createDigest() {
  const hash = createHash("sha256");
  let count = 0;
  return {
    add(table, row) {
      hash.update(canonicalRow(table, row));
      hash.update("\n");
      count += 1;
    },
    finish() {
      return { count, sha256: hash.digest("hex") };
    },
  };
}

export function emptyDigest() {
  return createDigest().finish();
}

function markerSummaryIsValid(summary) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary))
    return false;
  if (
    summary.version !== MANIFEST_VERSION ||
    summary.sourceTree !== SOURCE_TREE
  )
    return false;
  if (!Number.isSafeInteger(summary.totalRows) || summary.totalRows < 0)
    return false;
  if (
    !summary.tables ||
    typeof summary.tables !== "object" ||
    Array.isArray(summary.tables)
  )
    return false;
  let totalRows = 0;
  const expectedNames = new Set(LEGACY_TABLES.map((table) => table.name));
  if (Object.keys(summary.tables).length !== expectedNames.size) return false;
  for (const table of LEGACY_TABLES) {
    const result = summary.tables[table.name];
    if (!result || !Number.isSafeInteger(result.count) || result.count < 0)
      return false;
    if (
      typeof result.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(result.sha256)
    )
      return false;
    totalRows += result.count;
  }
  return totalRows === summary.totalRows;
}

export function createMigrationSummary(tableResults) {
  const tables = {};
  let totalRows = 0;
  for (const table of LEGACY_TABLES) {
    const result = tableResults[table.name];
    if (
      !result ||
      !Number.isSafeInteger(result.count) ||
      typeof result.sha256 !== "string"
    ) {
      fail("invalid_table_summary");
    }
    tables[table.name] = { count: result.count, sha256: result.sha256 };
    totalRows += result.count;
  }
  const summary = {
    version: MANIFEST_VERSION,
    sourceTree: SOURCE_TREE,
    totalRows,
    tables,
  };
  if (!markerSummaryIsValid(summary)) fail("invalid_migration_summary");
  return summary;
}

export function compactSummary(summary) {
  if (!markerSummaryIsValid(summary)) fail("invalid_migration_summary");
  return {
    totalRows: summary.totalRows,
    tables: Object.fromEntries(
      LEGACY_TABLES.map((table) => [
        table.name,
        summary.tables[table.name].count,
      ]),
    ),
  };
}

function sameTableSummary(left, right) {
  if (!markerSummaryIsValid(left) || !markerSummaryIsValid(right)) return false;
  return LEGACY_TABLES.every((table) => {
    const a = left.tables[table.name];
    const b = right.tables[table.name];
    return a.count === b.count && a.sha256 === b.sha256;
  });
}

function mysqlResultRows(result) {
  if (!Array.isArray(result) || !Array.isArray(result[0]))
    fail("source_query_result_invalid");
  return result[0];
}

async function sourceRead(source, sql, values = []) {
  return mysqlResultRows(
    await source.query({ sql, values, timeout: STATEMENT_TIMEOUT_MS }),
  );
}

async function sourceCommand(source, sql, values = []) {
  await source.query({ sql, values, timeout: STATEMENT_TIMEOUT_MS });
}

async function targetQuery(target, sql, values = []) {
  return target.query({
    text: sql,
    values,
    query_timeout: STATEMENT_TIMEOUT_MS,
  });
}

function sourceMetadataSql() {
  const placeholders = LEGACY_TABLES.map(() => "?").join(", ");
  return `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name IN (${placeholders}) ORDER BY TABLE_NAME, ORDINAL_POSITION`;
}

/** Fails on unknown/missing legacy columns rather than silently dropping data. */
export async function validateSourceInventory(source) {
  const rows = await sourceRead(
    source,
    sourceMetadataSql(),
    LEGACY_TABLES.map((table) => table.name),
  );
  const actual = new Map();
  for (const row of rows) {
    const tableName = row.TABLE_NAME;
    const columnName = row.COLUMN_NAME;
    if (!LEGACY_TABLES.some((table) => table.name === tableName))
      fail("unexpected_source_table_metadata");
    if (!actual.has(tableName)) actual.set(tableName, new Set());
    actual.get(tableName).add(columnName);
  }
  for (const table of LEGACY_TABLES) {
    const columns = actual.get(table.name);
    if (!columns || columns.size !== table.columns.length)
      fail("source_schema_mismatch");
    for (const column of table.columns)
      if (!columns.has(column)) fail("source_schema_mismatch");
  }
  return { tables: LEGACY_TABLES.length };
}

/**
 * Begin a source snapshot without making source data changes. TiDB v8.5 normal
 * START TRANSACTION is documented as taking a snapshot at statement execution;
 * its serverless parser rejects MySQL's READ ONLY modifier, so it is not sent.
 */
export async function beginSourceSnapshot(source) {
  const versionRows = await sourceRead(source, "SELECT VERSION() AS version");
  const version = versionRows[0]?.version;
  const engine = sourceEngineForVersion(version);
  await sourceCommand(source, "SET time_zone = '+00:00'");
  await sourceCommand(
    source,
    "SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ",
  );
  if (engine === "tidb") {
    await sourceCommand(source, "START TRANSACTION");
    return { engine, snapshotBegin: "START TRANSACTION" };
  }
  await sourceCommand(
    source,
    "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY",
  );
  return {
    engine,
    snapshotBegin: "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY",
  };
}

export async function rollbackSourceSnapshot(source) {
  try {
    await sourceCommand(source, "ROLLBACK");
  } catch {
    // The only safe cleanup response is to close the source connection below.
  }
}

function mysqlKeysetPredicate(table, cursor) {
  if (!cursor) return { sql: "", values: [] };
  if (table.primaryKey.length === 1) {
    return {
      sql: ` WHERE ${mysqlIdentifier(table.primaryKey[0])} > ?`,
      values: [cursor[0]],
    };
  }
  const clauses = [];
  const values = [];
  for (let index = 0; index < table.primaryKey.length; index += 1) {
    const equal = table.primaryKey
      .slice(0, index)
      .map((key) => `${mysqlIdentifier(key)} = ?`);
    const greater = `${mysqlIdentifier(table.primaryKey[index])} > ?`;
    clauses.push(`(${[...equal, greater].join(" AND ")})`);
    values.push(...cursor.slice(0, index), cursor[index]);
  }
  return { sql: ` WHERE ${clauses.join(" OR ")}`, values };
}

function postgresKeysetPredicate(table, cursor) {
  if (!cursor) return { sql: "", values: [] };
  if (table.primaryKey.length === 1) {
    return {
      sql: ` WHERE ${quoteIdentifier(table.primaryKey[0])} > $1`,
      values: [cursor[0]],
    };
  }
  const clauses = [];
  const values = [];
  for (let index = 0; index < table.primaryKey.length; index += 1) {
    const equal = table.primaryKey.slice(0, index).map((key, keyIndex) => {
      values.push(cursor[keyIndex]);
      return `${quoteIdentifier(key)} = $${values.length}`;
    });
    values.push(cursor[index]);
    clauses.push(
      `(${[...equal, `${quoteIdentifier(table.primaryKey[index])} > $${values.length}`].join(" AND ")})`,
    );
  }
  return { sql: ` WHERE ${clauses.join(" OR ")}`, values };
}

function keyForRow(table, row) {
  const key = table.primaryKey.map((column) => row[column]);
  if (key.some((value) => value === null || value === undefined))
    fail("null_primary_key");
  return key;
}

export function buildSourcePageQuery(tableName, cursor, batchSize) {
  const table = tableByName(tableName);
  const pageSize = validateBatchSize(batchSize);
  const keyset = mysqlKeysetPredicate(table, cursor);
  return {
    sql: `SELECT ${table.columns.map(mysqlIdentifier).join(", ")} FROM ${mysqlIdentifier(table.name)}${keyset.sql} ORDER BY ${table.primaryKey.map(mysqlIdentifier).join(", ")} ASC LIMIT ?`,
    values: [...keyset.values, pageSize],
  };
}

export function buildTargetPageQuery(tableName, cursor, batchSize) {
  const table = tableByName(tableName);
  const pageSize = validateBatchSize(batchSize);
  const keyset = postgresKeysetPredicate(table, cursor);
  return {
    sql: `SELECT ${table.columns.map(quoteIdentifier).join(", ")} FROM ${qualifiedTable(table.name)}${keyset.sql} ORDER BY ${table.primaryKey.map(quoteIdentifier).join(", ")} ASC LIMIT $${keyset.values.length + 1}`,
    values: [...keyset.values, pageSize],
  };
}

export async function eachSourceTableRow(source, table, batchSize, visit) {
  let cursor = null;
  for (;;) {
    const page = buildSourcePageQuery(table.name, cursor, batchSize);
    const rows = await sourceRead(source, page.sql, page.values);
    if (!rows.length) return;
    for (const row of rows) {
      const normalized = normalizedRow(table, row);
      await visit(normalized);
      cursor = keyForRow(table, normalized);
    }
    if (rows.length < batchSize) return;
  }
}

export async function eachTargetTableRow(target, table, batchSize, visit) {
  let cursor = null;
  for (;;) {
    const page = buildTargetPageQuery(table.name, cursor, batchSize);
    const result = await targetQuery(target, page.sql, page.values);
    const rows = result.rows;
    if (!Array.isArray(rows)) fail("target_query_result_invalid");
    if (!rows.length) return;
    for (const row of rows) {
      const normalized = normalizedRow(table, row);
      await visit(normalized);
      cursor = keyForRow(table, normalized);
    }
    if (rows.length < batchSize) return;
  }
}

export async function summarizeSource(source, batchSize) {
  const tableResults = {};
  for (const table of LEGACY_TABLES) {
    const digest = createDigest();
    await eachSourceTableRow(source, table, batchSize, (row) =>
      digest.add(table, row),
    );
    tableResults[table.name] = digest.finish();
  }
  return createMigrationSummary(tableResults);
}

export async function summarizeTarget(target, batchSize) {
  const tableResults = {};
  for (const table of LEGACY_TABLES) {
    const digest = createDigest();
    await eachTargetTableRow(target, table, batchSize, (row) =>
      digest.add(table, row),
    );
    tableResults[table.name] = digest.finish();
  }
  return createMigrationSummary(tableResults);
}

async function validateTargetInventory(target) {
  const names = [
    ...LEGACY_TABLES.map((table) => table.name),
    DATA_MIGRATION_TABLE,
  ];
  const tableRows = await targetQuery(
    target,
    "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = ANY($2::text[])",
    [PRIVATE_SCHEMA, names],
  );
  const foundTables = new Set(tableRows.rows.map((row) => row.table_name));
  if (
    foundTables.size !== names.length ||
    names.some((name) => !foundTables.has(name))
  ) {
    fail("target_schema_missing_table");
  }
  const columnRows = await targetQuery(
    target,
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = ANY($2::text[])",
    [PRIVATE_SCHEMA, names],
  );
  const columns = new Map();
  for (const row of columnRows.rows) {
    if (!columns.has(row.table_name)) columns.set(row.table_name, new Set());
    columns.get(row.table_name).add(row.column_name);
  }
  for (const table of LEGACY_TABLES) {
    const targetColumns = columns.get(table.name);
    if (
      !targetColumns ||
      table.columns.some((column) => !targetColumns.has(column))
    ) {
      fail("target_schema_column_mismatch");
    }
  }
  const markerColumns = columns.get(DATA_MIGRATION_TABLE);
  if (
    !markerColumns ||
    DATA_MIGRATION_COLUMNS.some((column) => !markerColumns.has(column))
  ) {
    fail("target_marker_schema_mismatch");
  }
  return { tables: names.length };
}

async function readMarkerRows(target) {
  const result = await targetQuery(
    target,
    `SELECT ${DATA_MIGRATION_COLUMNS.map(quoteIdentifier).join(", ")} FROM ${qualifiedTable(DATA_MIGRATION_TABLE)} ORDER BY ${quoteIdentifier("key")} ASC`,
  );
  return result.rows;
}

async function targetCounts(target) {
  const counts = {};
  for (const table of LEGACY_TABLES) {
    const result = await targetQuery(
      target,
      `SELECT COUNT(*)::bigint AS count FROM ${qualifiedTable(table.name)}`,
    );
    counts[table.name] = Number(result.rows[0]?.count ?? Number.NaN);
    if (!Number.isSafeInteger(counts[table.name]) || counts[table.name] < 0)
      fail("target_count_invalid");
  }
  return counts;
}

/** Empty means every app table is empty and no migration marker exists. */
export async function inspectTargetState(
  target,
  batchSize,
  verifyCompleted = true,
) {
  const counts = await targetCounts(target);
  const markers = await readMarkerRows(target);
  const allEmpty = Object.values(counts).every((count) => count === 0);
  if (allEmpty && markers.length === 0) return { state: "empty", counts };
  if (
    markers.length !== 1 ||
    markers[0].key !== DATA_MIGRATION_KEY ||
    markers[0].sourceTree !== SOURCE_TREE
  ) {
    fail("target_not_empty_or_matching_completed_marker");
  }
  const summary = markers[0].summary;
  if (!markerSummaryIsValid(summary)) fail("target_completed_marker_invalid");
  if (verifyCompleted) {
    const targetSummary = await summarizeTarget(target, batchSize);
    if (!sameTableSummary(summary, targetSummary))
      fail("target_completed_marker_parity_failed");
  }
  return {
    state: "completed",
    counts,
    summary,
    completedAt: markers[0].completedAt,
  };
}

async function lockTargetTables(target) {
  const tables = [
    ...LEGACY_TABLES.map((table) => qualifiedTable(table.name)),
    qualifiedTable(DATA_MIGRATION_TABLE),
  ];
  await targetQuery(
    target,
    `LOCK TABLE ${tables.join(", ")} IN SHARE ROW EXCLUSIVE MODE`,
  );
}

function insertStatement(table, rowCount) {
  if (!Number.isInteger(rowCount) || rowCount < 1)
    fail("invalid_insert_row_count");
  const placeholders = [];
  let index = 1;
  for (let row = 0; row < rowCount; row += 1) {
    const values = [];
    for (let column = 0; column < table.columns.length; column += 1)
      values.push(`$${index++}`);
    placeholders.push(`(${values.join(", ")})`);
  }
  return `INSERT INTO ${qualifiedTable(table.name)} (${table.columns.map(quoteIdentifier).join(", ")}) VALUES ${placeholders.join(", ")}`;
}

async function insertRows(target, table, rows) {
  if (!rows.length) return;
  const values = rows.flatMap((row) =>
    table.columns.map((column) => row[column]),
  );
  await targetQuery(target, insertStatement(table, rows.length), values);
}

async function copyTable(source, target, table, batchSize) {
  const digest = createDigest();
  let cursor = null;
  for (;;) {
    const page = buildSourcePageQuery(table.name, cursor, batchSize);
    const rows = (await sourceRead(source, page.sql, page.values)).map((row) =>
      normalizedRow(table, row),
    );
    if (!rows.length) return digest.finish();
    for (const row of rows) digest.add(table, row);
    await insertRows(target, table, rows);
    cursor = keyForRow(table, rows.at(-1));
    if (rows.length < batchSize) return digest.finish();
  }
}

export async function resetIdentity(target, table) {
  if (!table.identityColumn) return;
  const sequenceResult = await targetQuery(
    target,
    "SELECT pg_get_serial_sequence(format('%I.%I', $1::text, $2::text), $3::text) AS sequence_name",
    [PRIVATE_SCHEMA, table.name, table.identityColumn],
  );
  const sequenceName = sequenceResult.rows[0]?.sequence_name;
  if (typeof sequenceName !== "string" || !sequenceName)
    fail("target_identity_sequence_missing");
  const countResult = await targetQuery(
    target,
    `SELECT COUNT(*)::bigint AS count, COALESCE(MAX(${quoteIdentifier(table.identityColumn)}), 1)::bigint AS maximum FROM ${qualifiedTable(table.name)}`,
  );
  const count = Number(countResult.rows[0]?.count ?? Number.NaN);
  const maximum = Number(countResult.rows[0]?.maximum ?? Number.NaN);
  if (!Number.isSafeInteger(count) || !Number.isSafeInteger(maximum))
    fail("target_identity_value_invalid");
  await targetQuery(
    target,
    "SELECT setval($1::regclass, $2::bigint, $3::boolean)",
    [sequenceName, maximum, count > 0],
  );
}

async function resetIdentities(target) {
  for (const table of LEGACY_TABLES) await resetIdentity(target, table);
}

async function writeCompletionMarker(target, summary) {
  if (!markerSummaryIsValid(summary)) fail("invalid_migration_summary");
  await targetQuery(
    target,
    `INSERT INTO ${qualifiedTable(DATA_MIGRATION_TABLE)} (${DATA_MIGRATION_COLUMNS.map(quoteIdentifier).join(", ")}) VALUES ($1, $2, clock_timestamp(), $3::jsonb)`,
    [DATA_MIGRATION_KEY, SOURCE_TREE, JSON.stringify(summary)],
  );
}

async function checkPostgresIdentity(target) {
  const result = await targetQuery(
    target,
    "SELECT current_database() AS database_name",
  );
  if (result.rows[0]?.database_name !== "postgres")
    fail("unexpected_postgres_database");
}

async function openMySqlSource(env, projectRoot, mysqlModule) {
  const sourceUrl = env.DATABASE_URL;
  if (typeof sourceUrl !== "string" || !sourceUrl.trim())
    fail("legacy_mysql_database_url_required");
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    fail("legacy_mysql_database_url_invalid");
  }
  if (!["mysql:", "mysql2:"].includes(parsed.protocol))
    fail("legacy_mysql_database_url_invalid");
  const mysql = mysqlModule ?? (await import("mysql2/promise"));
  if (typeof mysql.createConnection !== "function")
    fail("mysql_driver_unavailable");
  // Preserve timestamp text until explicit UTC normalization; no URI or error is logged.
  return mysql.createConnection({
    uri: sourceUrl,
    dateStrings: true,
    connectTimeout: STATEMENT_TIMEOUT_MS,
  });
}

async function openPostgresTarget(env, projectRoot, pgModule) {
  const helperPath = pathToFileURL(
    path.join(projectRoot, "server", "_core", "postgres-config.mjs"),
  ).href;
  let helper;
  try {
    helper = await import(helperPath);
  } catch {
    fail("shared_postgres_config_unavailable");
  }
  if (typeof helper.getPostgresConnectionOptions !== "function")
    fail("shared_postgres_config_unavailable");
  const pg = pgModule ?? (await import("pg"));
  if (typeof pg.Client !== "function") fail("postgres_driver_unavailable");
  const client = new pg.Client(
    helper.getPostgresConnectionOptions(env, projectRoot),
  );
  await client.connect();
  return client;
}

async function closeQuietly(connection, method) {
  if (!connection || typeof connection[method] !== "function") return;
  try {
    await connection[method]();
  } catch {
    // Do not replace the safety outcome or emit a driver error that might include a DSN.
  }
}

/**
 * Opens a bounded, explicit source snapshot and certificate-verified private
 * PostgreSQL connection. It intentionally does not load .env files.
 */
export async function preflight({
  env = process.env,
  projectRoot = PROJECT_ROOT,
  batchSize = DEFAULT_BATCH_SIZE,
  mysqlModule,
  pgModule,
} = {}) {
  const size = validateBatchSize(batchSize);
  let source;
  let target;
  let sourceSnapshot = null;
  try {
    source = await openMySqlSource(env, projectRoot, mysqlModule);
    target = await openPostgresTarget(env, projectRoot, pgModule);
    await checkPostgresIdentity(target);
    await validateTargetInventory(target);
    await validateSourceInventory(source);
    sourceSnapshot = await beginSourceSnapshot(source);
    const sourceSummary = await summarizeSource(source, size);
    const state = await inspectTargetState(target, size);
    if (
      state.state === "completed" &&
      !sameTableSummary(sourceSummary, state.summary)
    ) {
      fail("source_target_parity_failed");
    }
    return {
      ok: true,
      mode: "preflight",
      source: sourceSnapshot,
      target: { state: state.state },
      summary: compactSummary(sourceSummary),
      sourceTree: SOURCE_TREE,
    };
  } finally {
    if (sourceSnapshot) await rollbackSourceSnapshot(source);
    await closeQuietly(source, "end");
    await closeQuietly(target, "end");
  }
}

export async function applyMigration({
  env = process.env,
  projectRoot = PROJECT_ROOT,
  batchSize = DEFAULT_BATCH_SIZE,
  acknowledgement,
  mysqlModule,
  pgModule,
} = {}) {
  if (acknowledgement !== WRITE_PAUSE_ACKNOWLEDGEMENT)
    fail("write_pause_acknowledgement_required");
  const size = validateBatchSize(batchSize);
  let source;
  let target;
  let sourceSnapshot = null;
  let targetTransaction = false;
  try {
    source = await openMySqlSource(env, projectRoot, mysqlModule);
    target = await openPostgresTarget(env, projectRoot, pgModule);
    await checkPostgresIdentity(target);
    await validateTargetInventory(target);
    await validateSourceInventory(source);
    sourceSnapshot = await beginSourceSnapshot(source);

    await targetQuery(target, "BEGIN ISOLATION LEVEL SERIALIZABLE");
    targetTransaction = true;
    await targetQuery(
      target,
      `SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`,
    );
    await targetQuery(
      target,
      `SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`,
    );
    await targetQuery(target, "SET LOCAL TIME ZONE 'UTC'");
    await targetQuery(target, "SELECT pg_advisory_xact_lock(hashtext($1))", [
      DATA_MIGRATION_KEY,
    ]);
    await lockTargetTables(target);
    const state = await inspectTargetState(target, size);
    if (state.state === "completed") {
      const sourceSummary = await summarizeSource(source, size);
      if (!sameTableSummary(sourceSummary, state.summary))
        fail("source_target_parity_failed");
      await targetQuery(target, "ROLLBACK");
      targetTransaction = false;
      return {
        ok: true,
        mode: "apply",
        outcome: "already_completed",
        source: sourceSnapshot,
        summary: compactSummary(sourceSummary),
        sourceTree: SOURCE_TREE,
      };
    }

    const tableResults = {};
    for (const table of LEGACY_TABLES)
      tableResults[table.name] = await copyTable(source, target, table, size);
    const sourceSummary = createMigrationSummary(tableResults);
    await resetIdentities(target);
    const targetSummary = await summarizeTarget(target, size);
    if (!sameTableSummary(sourceSummary, targetSummary))
      fail("target_parity_failed_before_marker");
    await writeCompletionMarker(target, sourceSummary);
    await targetQuery(target, "COMMIT");
    targetTransaction = false;
    return {
      ok: true,
      mode: "apply",
      outcome: "copied",
      source: sourceSnapshot,
      summary: compactSummary(sourceSummary),
      sourceTree: SOURCE_TREE,
    };
  } catch (error) {
    if (targetTransaction) {
      try {
        await targetQuery(target, "ROLLBACK");
      } catch {
        // Connection close is the final rollback guard.
      }
    }
    if (error instanceof MigrationSafetyError) throw error;
    fail("migration_failed");
  } finally {
    if (sourceSnapshot) await rollbackSourceSnapshot(source);
    await closeQuietly(source, "end");
    await closeQuietly(target, "end");
  }
}

export async function verifyMigration({
  env = process.env,
  projectRoot = PROJECT_ROOT,
  batchSize = DEFAULT_BATCH_SIZE,
  mysqlModule,
  pgModule,
} = {}) {
  const size = validateBatchSize(batchSize);
  let source;
  let target;
  let sourceSnapshot = null;
  let targetTransaction = false;
  try {
    source = await openMySqlSource(env, projectRoot, mysqlModule);
    target = await openPostgresTarget(env, projectRoot, pgModule);
    await checkPostgresIdentity(target);
    await validateTargetInventory(target);
    await validateSourceInventory(source);
    sourceSnapshot = await beginSourceSnapshot(source);
    await targetQuery(
      target,
      "BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ",
    );
    targetTransaction = true;
    await targetQuery(target, "SET LOCAL TIME ZONE 'UTC'");
    const state = await inspectTargetState(target, size);
    if (state.state !== "completed")
      fail("target_completed_marker_required_for_verify");
    const sourceSummary = await summarizeSource(source, size);
    if (!sameTableSummary(sourceSummary, state.summary))
      fail("source_target_parity_failed");
    await targetQuery(target, "COMMIT");
    targetTransaction = false;
    return {
      ok: true,
      mode: "verify",
      source: sourceSnapshot,
      summary: compactSummary(sourceSummary),
      sourceTree: SOURCE_TREE,
    };
  } catch (error) {
    if (targetTransaction) {
      try {
        await targetQuery(target, "ROLLBACK");
      } catch {
        // Closing a PostgreSQL client with an open transaction rolls it back.
      }
    }
    if (error instanceof MigrationSafetyError) throw error;
    fail("migration_verification_failed");
  } finally {
    if (sourceSnapshot) await rollbackSourceSnapshot(source);
    await closeQuietly(source, "end");
    await closeQuietly(target, "end");
  }
}

export async function runMigration(options, dependencies = {}) {
  if (!options || !["preflight", "apply", "verify"].includes(options.mode))
    fail("invalid_mode");
  const shared = {
    env: dependencies.env ?? process.env,
    projectRoot: dependencies.projectRoot ?? PROJECT_ROOT,
    batchSize: options.batchSize,
    mysqlModule: dependencies.mysqlModule,
    pgModule: dependencies.pgModule,
  };
  if (options.mode === "preflight") return preflight(shared);
  if (options.mode === "apply")
    return applyMigration({
      ...shared,
      acknowledgement: options.acknowledgement,
    });
  return verifyMigration(shared);
}

function usage() {
  return [
    "Usage:",
    "  node scripts/migrate-to-supabase.mjs --preflight [--batch-size 1..500]",
    `  node scripts/migrate-to-supabase.mjs --apply --acknowledge-write-pause=${WRITE_PAUSE_ACKNOWLEDGEMENT} [--batch-size 1..500]`,
    "  node scripts/migrate-to-supabase.mjs --verify [--batch-size 1..500]",
    "",
    "Uses DATABASE_URL only as the legacy MySQL/TiDB read source and SUPABASE_DATABASE_URL only through the shared private PostgreSQL TLS helper. It never creates schemas/tables, truncates, seeds, exports rows, or writes to the source.",
  ].join("\n");
}

async function main() {
  let options;
  try {
    options = parseCliArguments();
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    const result = await runMigration(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const code =
      error instanceof MigrationSafetyError ? error.code : "migration_failed";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    return 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().then((code) => {
    process.exitCode = code;
  });
}
