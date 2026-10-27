#!/usr/bin/env node
/**
 * DB-10: bounded, read-only index-workload review for the Circles schemas.
 *
 * This reviewer intentionally reads catalog metadata and cumulative statistics
 * only. A zero scan count is an observation within PostgreSQL's statistics
 * window, never a removal decision. It has no data-row, DDL, or DML path.
 */
import { createRequire } from "node:module";
import { constants as fsConstants } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lstat, open, realpath } from "node:fs/promises";

export const ISSUE_ID = "DB-10";
export const DEFAULT_PROJECT_DIR = "/home/ubuntu/circles";
export const REVIEWED_SCHEMAS = Object.freeze([
  "circles_admin",
  "circles_app",
  "circles_auth",
  "circles_ops",
  "circles_publish",
  "private",
  "public",
]);
export const MAX_OBSERVATIONS = 250;
export const REVIEW_STATEMENT_TIMEOUT_MS = 8_000;

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;
const REVIEW_DISPOSITION = "retain_pending_workload_and_plan_review";

const SCOPED_INDEXES_CTE = `
WITH scoped_indexes AS (
  SELECT
    namespace_relation.nspname AS schema_name,
    table_relation.relname AS table_name,
    index_relation.relname AS index_name,
    index_metadata.indisvalid AS valid,
    index_metadata.indisready AS ready,
    index_metadata.indisunique AS unique_index,
    index_metadata.indisprimary AS primary_index,
    COALESCE(index_statistics.idx_scan, 0)::bigint AS idx_scan,
    COALESCE(index_statistics.idx_tup_read, 0)::bigint AS idx_tup_read,
    COALESCE(index_statistics.idx_tup_fetch, 0)::bigint AS idx_tup_fetch,
    pg_catalog.pg_relation_size(index_relation.oid)::bigint AS index_bytes,
    EXISTS (
      SELECT 1
        FROM pg_catalog.pg_constraint AS index_constraint
       WHERE index_constraint.conindid = index_metadata.indexrelid
    ) AS constraint_backing,
    EXISTS (
      SELECT 1
        FROM pg_catalog.pg_constraint AS foreign_key_constraint
       WHERE foreign_key_constraint.contype = 'f'
         AND foreign_key_constraint.conrelid = table_relation.oid
         AND index_metadata.indisvalid
         AND index_metadata.indisready
         AND index_metadata.indpred IS NULL
         AND index_metadata.indnkeyatts >= pg_catalog.cardinality(foreign_key_constraint.conkey)
         AND NOT EXISTS (
           SELECT 1
             FROM pg_catalog.unnest(foreign_key_constraint.conkey)
                  WITH ORDINALITY AS foreign_key_column(attnum, ordinality)
            WHERE index_metadata.indkey[(foreign_key_column.ordinality::integer - 1)]
                  <> foreign_key_column.attnum
         )
    ) AS foreign_key_child_cover
  FROM pg_catalog.pg_index AS index_metadata
  JOIN pg_catalog.pg_class AS index_relation
    ON index_relation.oid = index_metadata.indexrelid
   AND index_relation.relkind IN ('i', 'I')
  JOIN pg_catalog.pg_class AS table_relation
    ON table_relation.oid = index_metadata.indrelid
   AND table_relation.relkind IN ('r', 'm', 'p')
  JOIN pg_catalog.pg_namespace AS namespace_relation
    ON namespace_relation.oid = table_relation.relnamespace
  LEFT JOIN pg_catalog.pg_stat_user_indexes AS index_statistics
    ON index_statistics.indexrelid = index_metadata.indexrelid
 WHERE namespace_relation.nspname = ANY($1::name[])
)
`;

export const INDEX_STATISTICS_SQL = `
/* DB-10 index statistics reset window */
SELECT statistics.stats_reset::text AS stats_reset
  FROM pg_catalog.pg_stat_database AS statistics
 WHERE statistics.datname = pg_catalog.current_database()
 LIMIT 1`;

export const INDEX_SUMMARY_SQL = `${SCOPED_INDEXES_CTE}
/* DB-10 bounded index observation summary */
SELECT
  count(*)::bigint AS scoped_index_count,
  count(*) FILTER (
    WHERE NOT unique_index
      AND NOT primary_index
      AND idx_scan = 0
  )::bigint AS zero_scan_nonunique_count,
  count(*) FILTER (
    WHERE NOT unique_index
      AND NOT primary_index
      AND idx_scan = 0
      AND constraint_backing
  )::bigint AS zero_scan_constraint_backing_count,
  count(*) FILTER (
    WHERE NOT unique_index
      AND NOT primary_index
      AND idx_scan = 0
      AND foreign_key_child_cover
  )::bigint AS zero_scan_foreign_key_cover_count
FROM scoped_indexes`;

export const ZERO_SCAN_INDEXES_SQL = `${SCOPED_INDEXES_CTE}
/* DB-10 bounded zero-scan observations, not an action list */
SELECT
  schema_name,
  table_name,
  index_name,
  valid,
  ready,
  unique_index,
  primary_index,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch,
  index_bytes,
  constraint_backing,
  foreign_key_child_cover
FROM scoped_indexes
WHERE NOT unique_index
  AND NOT primary_index
  AND idx_scan = 0
ORDER BY schema_name, table_name, index_name
LIMIT $2`;

function genericError(message) {
  return new Error(message);
}

function isSafeIdentifier(value) {
  return typeof value === "string" && SAFE_IDENTIFIER.test(value);
}

export function redactIdentifier(value) {
  return isSafeIdentifier(value) ? value : "[redacted]";
}

function nonNegativeDecimal(value) {
  if (typeof value === "bigint") return value >= 0n ? value.toString() : null;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return null;
  return value.replace(/^0+(?=\d)/, "");
}

function normalizeBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function normalizeTimestamp(value) {
  if (!(typeof value === "string" || value instanceof Date)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function elapsedSeconds(fromTimestamp, toTimestamp) {
  if (!fromTimestamp || !toTimestamp) return null;
  const difference =
    new Date(toTimestamp).getTime() - new Date(fromTimestamp).getTime();
  return Number.isSafeInteger(difference) && difference >= 0
    ? Math.floor(difference / 1_000)
    : null;
}

function compareObservations(left, right) {
  return ["schema_name", "table_name", "index_name"].reduce((result, key) => {
    if (result !== 0) return result;
    return left[key].localeCompare(right[key]);
  }, 0);
}

function normalizeObservation(row) {
  if (!row || typeof row !== "object") return null;
  const normalized = {
    schema_name: redactIdentifier(row.schema_name),
    table_name: redactIdentifier(row.table_name),
    index_name: redactIdentifier(row.index_name),
    index_valid: normalizeBoolean(row.valid),
    index_ready: normalizeBoolean(row.ready),
    idx_scan_since_stats_reset: nonNegativeDecimal(row.idx_scan),
    idx_tup_read_since_stats_reset: nonNegativeDecimal(row.idx_tup_read),
    idx_tup_fetch_since_stats_reset: nonNegativeDecimal(row.idx_tup_fetch),
    index_bytes: nonNegativeDecimal(row.index_bytes),
    backs_catalog_constraint: normalizeBoolean(row.constraint_backing),
    covers_foreign_key_child_columns: normalizeBoolean(
      row.foreign_key_child_cover,
    ),
    disposition: REVIEW_DISPOSITION,
  };
  const complete =
    normalized.index_valid !== null &&
    normalized.index_ready !== null &&
    normalized.idx_scan_since_stats_reset !== null &&
    normalized.idx_tup_read_since_stats_reset !== null &&
    normalized.idx_tup_fetch_since_stats_reset !== null &&
    normalized.index_bytes !== null &&
    normalized.backs_catalog_constraint !== null &&
    normalized.covers_foreign_key_child_columns !== null;
  return {
    observation: normalized,
    complete,
    identifier_redacted:
      normalized.schema_name === "[redacted]" ||
      normalized.table_name === "[redacted]" ||
      normalized.index_name === "[redacted]",
  };
}

function normalizeSummary(row) {
  if (!row || typeof row !== "object") return null;
  const summary = {
    scoped_index_count: nonNegativeDecimal(row.scoped_index_count),
    zero_scan_nonunique_count: nonNegativeDecimal(
      row.zero_scan_nonunique_count,
    ),
    zero_scan_constraint_backing_count: nonNegativeDecimal(
      row.zero_scan_constraint_backing_count,
    ),
    zero_scan_foreign_key_cover_count: nonNegativeDecimal(
      row.zero_scan_foreign_key_cover_count,
    ),
  };
  return Object.values(summary).every((value) => value !== null)
    ? summary
    : null;
}

/**
 * Convert bounded catalog-only query results into a redacted review report.
 * A complete report is deliberately still "review_only": no zero-scan count
 * changes that disposition.
 */
export function buildIndexWorkloadReport({
  statsRow,
  summaryRow,
  observationRows,
  executedAt = new Date(),
  observationLimit = MAX_OBSERVATIONS,
} = {}) {
  if (!Number.isSafeInteger(observationLimit) || observationLimit < 1) {
    throw genericError("Invalid index workload observation limit");
  }
  const observedAt =
    normalizeTimestamp(executedAt) ?? new Date(0).toISOString();
  const statsResetAt = normalizeTimestamp(statsRow?.stats_reset);
  const statisticsWindowSeconds = elapsedSeconds(statsResetAt, observedAt);
  const summary = normalizeSummary(summaryRow);
  const normalizedRows = Array.isArray(observationRows)
    ? observationRows.map(normalizeObservation).filter(Boolean)
    : [];
  const observations = normalizedRows
    .map((entry) => entry.observation)
    .sort(compareObservations);
  const incompleteObservationCount = normalizedRows.filter(
    (entry) => !entry.complete,
  ).length;
  const redactedIdentifierCount = normalizedRows.filter(
    (entry) => entry.identifier_redacted,
  ).length;
  const zeroScanCount = summary?.zero_scan_nonunique_count;
  const observationsTruncated =
    zeroScanCount === null ||
    zeroScanCount === undefined ||
    BigInt(zeroScanCount) > BigInt(observations.length);
  const evidenceComplete =
    Boolean(summary && statsResetAt) && incompleteObservationCount === 0;

  return {
    issue_id: ISSUE_ID,
    generated_at_utc: observedAt,
    review_status: evidenceComplete
      ? "review_only"
      : "review_only_incomplete_catalog_evidence",
    disposition: REVIEW_DISPOSITION,
    scope: {
      schema_names: [...REVIEWED_SCHEMAS],
      observation_limit: observationLimit,
      application_rows_read: false,
      index_definitions_emitted: false,
      DDL_or_DML_executed: false,
      connection_source: "existing_pinned_postgres_configuration_helper",
    },
    statistics_window: {
      stats_reset_at_utc: statsResetAt,
      seconds_observed_since_reset: statisticsWindowSeconds,
      status:
        statisticsWindowSeconds === null
          ? "unknown_or_invalid_reset_window"
          : "cumulative_since_reported_reset",
    },
    summary: summary ?? {
      scoped_index_count: null,
      zero_scan_nonunique_count: null,
      zero_scan_constraint_backing_count: null,
      zero_scan_foreign_key_cover_count: null,
    },
    observations_returned: observations.length,
    observations_truncated_or_incomplete: observationsTruncated,
    incomplete_observation_count: incompleteObservationCount,
    redacted_identifier_count: redactedIdentifierCount,
    observations,
    limitations: [
      "idx_scan is cumulative only since the PostgreSQL statistics reset and is not a lifetime-use measurement.",
      "The catalog cannot demonstrate rare, seasonal, administrative, recovery, or future workloads.",
      "Constraint support and foreign-key child-side enforcement can make an index necessary even when scan counters are zero or not representative.",
      "This collection contains no application query capture or plan evidence and cannot establish redundancy.",
    ],
    required_review_before_any_change: [
      "Confirm that the reset window covers representative production and maintenance cycles.",
      "Map each observation to authorized workload telemetry and isolated plan evidence without exporting application rows.",
      "Preserve constraint-backed and foreign-key-supporting indexes unless a separately reviewed compatibility analysis proves a safe alternative.",
      "Route any proposed schema change through an explicit, separately approved migration and rollback review.",
    ],
  };
}

function rowsFrom(result) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

async function query(client, sql, values = []) {
  const result = await client.query(sql, values);
  return rowsFrom(result);
}

/**
 * Run only catalog/statistics SELECTs inside a read-only transaction. The
 * client is injectable solely for credential-free tests; callers cannot supply
 * a connection string or a SQL fragment.
 */
export async function collectIndexWorkloadEvidence(
  client,
  { observationLimit = MAX_OBSERVATIONS } = {},
) {
  if (!client || typeof client.query !== "function") {
    throw genericError("Index workload reviewer requires a PostgreSQL client");
  }
  if (!Number.isSafeInteger(observationLimit) || observationLimit < 1) {
    throw genericError("Invalid index workload observation limit");
  }

  let began = false;
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    began = true;
    await client.query(
      "SELECT pg_catalog.set_config('statement_timeout', $1, true)",
      [String(REVIEW_STATEMENT_TIMEOUT_MS)],
    );
    await client.query(
      "SELECT pg_catalog.set_config('lock_timeout', $1, true)",
      [String(REVIEW_STATEMENT_TIMEOUT_MS)],
    );
    const statsRows = await query(client, INDEX_STATISTICS_SQL);
    const summaryRows = await query(client, INDEX_SUMMARY_SQL, [
      REVIEWED_SCHEMAS,
    ]);
    const observationRows = await query(client, ZERO_SCAN_INDEXES_SQL, [
      REVIEWED_SCHEMAS,
      observationLimit,
    ]);
    await client.query("COMMIT");
    began = false;
    return {
      statsRow: statsRows[0] ?? null,
      summaryRow: summaryRows[0] ?? null,
      observationRows,
    };
  } catch {
    if (began) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The original generic failure remains the only externally visible error.
      }
    }
    throw genericError("Index workload catalog collection failed");
  }
}

export async function runIndexWorkloadReview(client, options = {}) {
  const evidence = await collectIndexWorkloadEvidence(client, options);
  return buildIndexWorkloadReport({ ...evidence, ...options });
}

function requirePgFromProject(projectDir) {
  const projectRequire = createRequire(resolve(projectDir, "package.json"));
  const pg = projectRequire("pg");
  if (!pg?.Pool) throw genericError("PostgreSQL driver unavailable");
  return pg;
}

async function loadPinnedConnectionOptions(projectDir) {
  const configuration = await import(
    pathToFileURL(resolve(projectDir, "server/_core/postgres-config.mjs")).href
  );
  if (typeof configuration.getPostgresConnectionOptions !== "function") {
    throw genericError("Pinned PostgreSQL configuration helper unavailable");
  }
  // The helper is the sole connection authority. It validates the approved
  // target, hostname, CA, and credential shape and receives no CLI DSN input.
  return configuration.getPostgresConnectionOptions(undefined, projectDir);
}

export async function runWithPinnedConnection(options) {
  const projectDir = resolve(options?.projectDir ?? DEFAULT_PROJECT_DIR);
  const connectionOptions = await loadPinnedConnectionOptions(projectDir);
  const { Pool } = requirePgFromProject(projectDir);
  const pool = new Pool(connectionOptions);
  let client;
  try {
    client = await pool.connect();
    return await runIndexWorkloadReview(client);
  } catch {
    throw genericError("Index workload review did not complete");
  } finally {
    try {
      client?.release();
    } finally {
      await pool.end().catch(() => undefined);
    }
  }
}

export function parseArgs(argv) {
  const options = {
    projectDir: DEFAULT_PROJECT_DIR,
    jsonOutput: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--project-dir" || argument === "--json-output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw genericError("Invalid index workload review arguments");
      }
      index += 1;
      if (argument === "--project-dir") options.projectDir = resolve(value);
      if (argument === "--json-output") options.jsonOutput = resolve(value);
      continue;
    }
    throw genericError("Invalid index workload review arguments");
  }
  if (!options.help && !options.jsonOutput) {
    throw genericError("A redacted JSON output path is required");
  }
  return options;
}

function pathIsWithin(childPath, parentPath) {
  const pathRelation = relative(parentPath, childPath);
  return (
    pathRelation === "" ||
    (!pathRelation.startsWith("..") && !isAbsolute(pathRelation))
  );
}

async function prepareOutputPath(outputPath) {
  const requested = resolve(outputPath);
  const outputParent = await realpath(dirname(requested));
  const parentStat = await lstat(outputParent);
  if (!parentStat.isDirectory() || !pathIsWithin(requested, outputParent)) {
    throw genericError("Index workload output path is unavailable");
  }
  const outputPathname = resolve(outputParent, basename(requested));
  try {
    await lstat(outputPathname);
    throw genericError("Index workload output already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return outputPathname;
}

export async function writeRedactedReport(outputPath, report) {
  const destination = await prepareOutputPath(outputPath);
  let handle;
  try {
    handle = await open(
      destination,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  } catch {
    throw genericError("Unable to write redacted index workload report");
  } finally {
    await handle?.close();
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(
      "Usage: node scripts/review-database-index-workload.mjs --project-dir <circles-root> --json-output <new-private-json-path>\n",
    );
    return;
  }
  const report = await runWithPinnedConnection(options);
  await writeRedactedReport(options.jsonOutput, report);
  process.stdout.write("DB-10 redacted index workload review completed.\n");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    process.stderr.write("DB-10 index workload review failed.\n");
    process.exitCode = 1;
  });
}
