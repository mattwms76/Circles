import test from "node:test";
import assert from "node:assert/strict";
import {
  INDEX_STATISTICS_SQL,
  INDEX_SUMMARY_SQL,
  MAX_OBSERVATIONS,
  REVIEWED_SCHEMAS,
  ZERO_SCAN_INDEXES_SQL,
  buildIndexWorkloadReport,
  parseArgs,
  runIndexWorkloadReview,
} from "../../scripts/review-database-index-workload.mjs";

const STATS_RESET = "2026-10-02T17:54:14.043Z";
const EXECUTED_AT = new Date("2026-10-27T11:37:31.460Z");

function zeroScanRow(overrides = {}) {
  return {
    schema_name: "circles_app",
    table_name: "posts",
    index_name: "posts_feed",
    valid: true,
    ready: true,
    unique_index: false,
    primary_index: false,
    idx_scan: "0",
    idx_tup_read: "0",
    idx_tup_fetch: "0",
    index_bytes: "8192",
    constraint_backing: false,
    foreign_key_child_cover: false,
    ...overrides,
  };
}

function fakeCatalogClient({ failObservationQuery = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("DB-10 index statistics reset window")) {
        return { rows: [{ stats_reset: STATS_RESET }] };
      }
      if (sql.includes("DB-10 bounded index observation summary")) {
        return {
          rows: [
            {
              scoped_index_count: "240",
              zero_scan_nonunique_count: "98",
              zero_scan_constraint_backing_count: "1",
              zero_scan_foreign_key_cover_count: "3",
            },
          ],
        };
      }
      if (sql.includes("DB-10 bounded zero-scan observations")) {
        if (failObservationQuery) throw new Error("untrusted database detail");
        return {
          rows: [
            zeroScanRow(),
            zeroScanRow({
              table_name: "messages",
              index_name: "messages_author_idx",
              foreign_key_child_cover: true,
            }),
          ],
        };
      }
      return { rows: [] };
    },
  };
}

test("DB-10 reports zero-scan indexes as bounded review-only observations", async () => {
  const client = fakeCatalogClient();
  const report = await runIndexWorkloadReview(client, {
    executedAt: EXECUTED_AT,
  });

  assert.equal(report.issue_id, "DB-10");
  assert.equal(report.review_status, "review_only");
  assert.equal(report.disposition, "retain_pending_workload_and_plan_review");
  assert.equal(report.summary.zero_scan_nonunique_count, "98");
  assert.equal(report.observations_returned, 2);
  assert.equal(report.observations_truncated_or_incomplete, true);
  assert.equal(report.statistics_window.stats_reset_at_utc, STATS_RESET);
  assert.equal(report.statistics_window.seconds_observed_since_reset, 2137397);
  assert.equal(report.scope.DDL_or_DML_executed, false);
  assert.deepEqual(report.scope.schema_names, REVIEWED_SCHEMAS);
  assert.equal(report.scope.observation_limit, MAX_OBSERVATIONS);
  assert.equal(
    report.observations.every(
      (observation) =>
        observation.disposition === "retain_pending_workload_and_plan_review",
    ),
    true,
  );
  assert.equal(
    report.observations.some(
      (observation) => observation.covers_foreign_key_child_columns,
    ),
    true,
  );
  assert.match(
    report.limitations.join(" "),
    /rare, seasonal, administrative, recovery, or future workloads/,
  );

  assert.equal(client.calls[0].sql, "BEGIN TRANSACTION READ ONLY");
  assert.equal(client.calls.at(-1).sql, "COMMIT");
  assert.equal(
    client.calls.every(
      ({ sql }) => !/\bDROP\b|\bDELETE\b|\bUPDATE\b|\bINSERT\b/i.test(sql),
    ),
    true,
  );
  const summaryCall = client.calls.find(({ sql }) =>
    sql.includes("DB-10 bounded index observation summary"),
  );
  const observationCall = client.calls.find(({ sql }) =>
    sql.includes("DB-10 bounded zero-scan observations"),
  );
  assert.deepEqual(summaryCall.values, [REVIEWED_SCHEMAS]);
  assert.deepEqual(observationCall.values, [
    REVIEWED_SCHEMAS,
    MAX_OBSERVATIONS,
  ]);
});

test("DB-10 SQL includes constraint and foreign-key context without index definitions", () => {
  assert.match(
    INDEX_SUMMARY_SQL,
    /pg_catalog\.pg_constraint AS index_constraint/,
  );
  assert.match(ZERO_SCAN_INDEXES_SQL, /foreign_key_constraint\.contype = 'f'/);
  assert.match(ZERO_SCAN_INDEXES_SQL, /LIMIT \$2/);
  assert.doesNotMatch(ZERO_SCAN_INDEXES_SQL, /pg_get_indexdef/i);
  assert.match(INDEX_STATISTICS_SQL, /pg_stat_database/);
  assert.doesNotMatch(
    `${INDEX_SUMMARY_SQL}\n${ZERO_SCAN_INDEXES_SQL}`,
    /\bDROP\b|\bDELETE\b|\bUPDATE\b|\bINSERT\b/i,
  );
});

test("DB-10 redacts malformed identifiers and retains incomplete evidence as review-only", () => {
  const confidentialIdentifier = "not a safe identifier: private detail";
  const report = buildIndexWorkloadReport({
    statsRow: { stats_reset: STATS_RESET },
    summaryRow: {
      scoped_index_count: "1",
      zero_scan_nonunique_count: "1",
      zero_scan_constraint_backing_count: "0",
      zero_scan_foreign_key_cover_count: "0",
    },
    observationRows: [
      zeroScanRow({
        index_name: confidentialIdentifier,
        idx_tup_fetch: "not-a-counter",
      }),
    ],
    executedAt: EXECUTED_AT,
  });

  assert.equal(report.review_status, "review_only_incomplete_catalog_evidence");
  assert.equal(report.redacted_identifier_count, 1);
  assert.equal(report.incomplete_observation_count, 1);
  assert.equal(report.observations[0].index_name, "[redacted]");
  assert.equal(JSON.stringify(report).includes(confidentialIdentifier), false);
  assert.equal(
    report.observations[0].disposition,
    "retain_pending_workload_and_plan_review",
  );
});

test("DB-10 rejects arbitrary connection arguments and rolls back collection failures", async () => {
  assert.throws(
    () => parseArgs(["--database-url", "postgres://unexpected"]),
    /Invalid index workload review arguments/,
  );
  assert.throws(
    () => parseArgs(["--project-dir", "/tmp/circles"]),
    /redacted JSON output path is required/,
  );
  assert.deepEqual(
    parseArgs([
      "--project-dir",
      "/tmp/circles",
      "--json-output",
      "/tmp/private/report.json",
    ]),
    {
      projectDir: "/tmp/circles",
      jsonOutput: "/tmp/private/report.json",
      help: false,
    },
  );

  const client = fakeCatalogClient({ failObservationQuery: true });
  await assert.rejects(
    () => runIndexWorkloadReview(client, { executedAt: EXECUTED_AT }),
    /Index workload catalog collection failed/,
  );
  assert.equal(client.calls.at(-1).sql, "ROLLBACK");
});
