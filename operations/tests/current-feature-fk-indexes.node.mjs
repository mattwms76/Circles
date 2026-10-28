import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const TEST_DIRECTORY = resolve(fileURLToPath(new URL(".", import.meta.url)));
const UNIT_ROOT = resolve(TEST_DIRECTORY, "../..");
const SQL_PATH = resolve(
  UNIT_ROOT,
  "operations/remediation/current_feature_fk_indexes.sql",
);
const CATALOG_PATH = resolve(
  TEST_DIRECTORY,
  "fixtures/current-feature-fk-catalog.json",
);
const LEGACY_DB07_PATH = resolve(
  UNIT_ROOT,
  "operations/remediation/db07_foreign_key_indexes.sql",
);

const SQL = readFileSync(SQL_PATH, "utf8");
const CATALOG_BYTES = readFileSync(CATALOG_PATH);
assert.equal(
  createHash("sha256").update(CATALOG_BYTES).digest("hex"),
  "8e1c6e0e4bb1d1f19ecbed6f857bd1a213f4e7a8ce9ec85593b0b83a75940d4d",
  "Bundled reviewed three-FK metadata fixture changed",
);
const CATALOG = JSON.parse(CATALOG_BYTES.toString("utf8"));
assert.equal(CATALOG.queries.constraints.length, 3);
const LEGACY_DB07 = readFileSync(LEGACY_DB07_PATH, "utf8");

const TARGETS = [
  {
    childSchema: "circles_admin",
    childTable: "review_handoffs",
    constraint: "review_handoffs_assignee_operator_id_fkey",
    childColumn: "assignee_operator_id",
    parentSchema: "circles_admin",
    parentTable: "operators",
    parentColumn: "id",
    type: "uuid",
    deleteAction: "c",
    operatorClass: "uuid_ops",
    index: "review_handoffs_assignee_operator_id_fk_idx",
    definition:
      "FOREIGN KEY (assignee_operator_id) REFERENCES circles_admin.operators(id) ON DELETE CASCADE",
  },
  {
    childSchema: "circles_publish",
    childTable: "circlePrompts",
    constraint: "circlePrompts_updatedBy_fkey",
    childColumn: "updatedBy",
    parentSchema: "circles_app",
    parentTable: "users",
    parentColumn: "id",
    type: "integer",
    deleteAction: "r",
    operatorClass: "int4_ops",
    index: "circle_prompts_updated_by_fk_idx",
    definition:
      'FOREIGN KEY ("updatedBy") REFERENCES circles_app.users(id) ON DELETE RESTRICT',
  },
  {
    childSchema: "circles_publish",
    childTable: "promptPosts",
    constraint: "promptPosts_circleId_fkey",
    childColumn: "circleId",
    parentSchema: "circles_app",
    parentTable: "circles",
    parentColumn: "id",
    type: "integer",
    deleteAction: "c",
    operatorClass: "int4_ops",
    index: "prompt_posts_circle_id_fk_idx",
    definition:
      'FOREIGN KEY ("circleId") REFERENCES circles_app.circles(id) ON DELETE CASCADE',
  },
];

function catalogConstraint(target) {
  return CATALOG.queries.constraints.find(
    (constraint) =>
      constraint.schema_name === target.childSchema &&
      constraint.table_name === target.childTable &&
      constraint.conname === target.constraint,
  );
}

test("current-feature FK-index static contract is closed to exactly three catalog gaps", () => {
  assert.equal(TARGETS.length, 3);
  assert.deepEqual(
    TARGETS.map((target) => target.index),
    [
      "review_handoffs_assignee_operator_id_fk_idx",
      "circle_prompts_updated_by_fk_idx",
      "prompt_posts_circle_id_fk_idx",
    ],
  );

  for (const target of TARGETS) {
    const constraint = catalogConstraint(target);
    assert.ok(constraint, `catalog is missing ${target.constraint}`);
    assert.equal(constraint.contype, "f");
    assert.equal(constraint.convalidated, true);
    assert.equal(constraint.definition, target.definition);
    assert.ok(target.index.length <= 63, `${target.index} exceeds 63 bytes`);

    const call = [
      target.childSchema,
      target.childTable,
      target.constraint,
      target.childColumn,
      target.parentSchema,
      target.parentTable,
      target.parentColumn,
      target.type,
      target.deleteAction,
      target.operatorClass,
      "postgres",
      target.index,
    ]
      .map((value) => `'${value}'`)
      .join("\\s*,\\s*");

    assert.match(
      SQL,
      new RegExp(
        `current_feature_fk_indexes_assert\\(\\s*${call}\\s*,\\s*false\\s*\\)`,
      ),
      `missing exact preflight for ${target.index}`,
    );
    assert.match(
      SQL,
      new RegExp(
        `current_feature_fk_indexes_assert\\(\\s*${call}\\s*,\\s*true\\s*\\)`,
      ),
      `missing exact postflight for ${target.index}`,
    );
    assert.match(
      SQL,
      new RegExp(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${target.index}\\s+ON`,
      ),
      `missing concurrent create for ${target.index}`,
    );
  }
});

test("current-feature FK-index script is transaction-safe and validates exact existing-name index metadata", () => {
  assert.match(SQL, /psql-only, autocommit script/i);
  assert.match(SQL, /current_feature_fk_indexes_confirm_no_transaction/);
  assert.match(SQL, /SET lock_timeout = '5s';/);
  assert.match(SQL, /SET statement_timeout = '30min';/);
  assert.match(SQL, /pg_try_advisory_lock/);
  assert.match(
    SQL,
    /CREATE OR REPLACE FUNCTION pg_temp\.current_feature_fk_indexes_assert/,
  );
  assert.match(SQL, /pg_get_userbyid\(namespace\.nspowner\) = p_owner/);
  assert.match(SQL, /pg_get_userbyid\(relation\.relowner\) = p_owner/);
  assert.match(SQL, /pg_get_userbyid\(index_relation\.relowner\) = p_owner/);
  assert.match(SQL, /fk\.conkey\[1\] = v_child_attnum/);
  assert.match(SQL, /fk\.confkey\[1\] = v_parent_attnum/);
  assert.match(SQL, /fk\.convalidated/);
  assert.match(SQL, /fk\.confdeltype = p_delete_action/);
  assert.match(SQL, /fk\.confupdtype = 'a'/);
  assert.match(SQL, /fk\.confmatchtype = 's'/);
  assert.match(SQL, /NOT fk\.condeferrable/);
  assert.match(SQL, /NOT fk\.condeferred/);
  assert.match(SQL, /key_collation\.collation_oid = v_child_collation/);
  assert.match(SQL, /key_option\.option_bits = 0/);
  assert.match(SQL, /operator_class\.opcname = p_operator_class/);
  assert.match(SQL, /operator_class\.opcdefault/);
  assert.match(SQL, /access_method\.amname = 'btree'/);
  assert.match(SQL, /index_metadata\.indisvalid/);
  assert.match(SQL, /index_metadata\.indisready/);
  assert.match(SQL, /index_metadata\.indislive/);
  assert.match(SQL, /index_metadata\.indpred IS NULL/);
  assert.match(SQL, /index_metadata\.indexprs IS NULL/);
  assert.match(
    SQL,
    /pg_get_indexdef\(index_metadata\.indexrelid\) = v_expected_definition/,
  );
  assert.equal(
    (SQL.match(/CREATE INDEX CONCURRENTLY IF NOT EXISTS/g) ?? []).length,
    3,
  );
  assert.doesNotMatch(SQL, /^\s*(BEGIN|COMMIT)\s*;/im);
  assert.doesNotMatch(
    SQL,
    /DROP\s+INDEX|DELETE\s+FROM|UPDATE\s+|INSERT\s+INTO|ALTER\s+(TABLE|ROLE|SCHEMA)/i,
  );
});

test("current-feature candidate does not amend the original twelve-index DB-07 history", () => {
  assert.match(LEGACY_DB07, /all twelve reviewed child-side B-tree indexes/i);
  assert.equal(
    (LEGACY_DB07.match(/CREATE INDEX CONCURRENTLY IF NOT EXISTS/g) ?? [])
      .length,
    12,
  );
  for (const target of TARGETS) {
    assert.doesNotMatch(
      LEGACY_DB07,
      new RegExp(target.index.replaceAll("_", "\\_")),
      `${target.index} must remain in the separate current-feature candidate`,
    );
  }
});
