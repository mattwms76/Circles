import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateExternalPrivileges,
  evaluateInventory,
  evaluatePolicies,
  evaluateRls,
  evaluateRuntimePrivileges,
  evaluateRuntimeRole,
  normalizeExpression,
  parseArgs,
} from "../../scripts/circles-supabase-security-audit.mjs";

const RUNTIME = "circles_app_runtime";
const APP_TABLES = ["users", "posts"];
const ALL_TABLES = [...APP_TABLES, "_dataMigrations"];

function appPolicy(table_name) {
  return {
    table_name,
    policy_name: `runtime_${table_name}_policy`,
    roles: [RUNTIME],
    command: "ALL",
    using_qualification: "(true)",
    with_check_qualification: "true",
  };
}

test("expression normalization accepts harmless parentheses and whitespace", () => {
  assert.equal(normalizeExpression(" (( true )) "), "true");
  assert.equal(normalizeExpression(null), null);
});

test("inventory detects missing and unexpected tables", () => {
  const pass = evaluateInventory(
    ALL_TABLES,
    ALL_TABLES.map((table_name) => ({ table_name })),
  );
  assert.equal(pass.status, "pass");

  const fail = evaluateInventory(ALL_TABLES, [
    { table_name: "users" },
    { table_name: "surprise" },
  ]);
  assert.equal(fail.status, "fail");
  assert.deepEqual(fail.missing.sort(), ["_dataMigrations", "posts"]);
  assert.deepEqual(fail.unexpected, ["surprise"]);
});

test("RLS requires every expected table to be enabled", () => {
  const result = evaluateRls(ALL_TABLES, [
    { table_name: "users", rls_enabled: true },
    { table_name: "posts", rls_enabled: false },
    { table_name: "_dataMigrations", rls_enabled: true },
  ]);
  assert.equal(result.status, "fail");
  assert.deepEqual(result.missing_or_disabled, ["posts"]);
});

test("policy evaluator requires exact runtime role, command, and marker read-only shape", () => {
  const passing = [
    ...APP_TABLES.map(appPolicy),
    {
      table_name: "_dataMigrations",
      policy_name: "runtime_data_migrations_read_policy",
      roles: [RUNTIME],
      command: "SELECT",
      using_qualification: "true",
      with_check_qualification: null,
    },
  ];
  assert.equal(
    evaluatePolicies(APP_TABLES, "_dataMigrations", passing, RUNTIME).status,
    "pass",
  );

  const failing = passing.map((policy) => ({ ...policy }));
  failing[0].roles = ["authenticated"];
  failing[2].command = "ALL";
  assert.equal(
    evaluatePolicies(APP_TABLES, "_dataMigrations", failing, RUNTIME).status,
    "fail",
  );
});

test("runtime role must be non-login, non-inheriting, non-superuser, and no-bypass-RLS", () => {
  assert.equal(
    evaluateRuntimeRole({
      can_login: false,
      inherits: false,
      is_superuser: false,
      bypasses_rls: false,
    }).status,
    "pass",
  );
  const fail = evaluateRuntimeRole({
    can_login: true,
    inherits: false,
    is_superuser: false,
    bypasses_rls: true,
  });
  assert.equal(fail.status, "fail");
  assert.deepEqual(fail.violations, ["can_login", "bypasses_rls"]);
});

test("external privilege evaluator rejects any schema, table, or sequence grant", () => {
  const pass = evaluateExternalPrivileges(
    [{ role_name: "anon", has_usage: false }],
    [
      {
        role_name: "anon",
        table_name: "users",
        can_select: false,
        can_insert: false,
        can_update: false,
        can_delete: false,
      },
    ],
    [
      {
        role_name: "anon",
        sequence_name: "users_id_seq",
        can_usage: false,
        can_select: false,
        can_update: false,
      },
    ],
  );
  assert.equal(pass.status, "pass");

  const fail = evaluateExternalPrivileges(
    [{ role_name: "service_role", has_usage: true }],
    [
      {
        role_name: "anon",
        table_name: "users",
        can_select: true,
        can_insert: false,
        can_update: false,
        can_delete: false,
      },
    ],
    [],
  );
  assert.equal(fail.status, "fail");
  assert.deepEqual(fail.schema_usage_roles, ["service_role"]);
  assert.equal(fail.table_grants[0].table_name, "users");
});

test("runtime privilege evaluator permits app DML but demands marker read-only", () => {
  const passing = [
    ...APP_TABLES.map((table_name) => ({
      table_name,
      can_select: true,
      can_insert: true,
      can_update: true,
      can_delete: true,
    })),
    {
      table_name: "_dataMigrations",
      can_select: true,
      can_insert: false,
      can_update: false,
      can_delete: false,
    },
  ];
  assert.equal(
    evaluateRuntimePrivileges(APP_TABLES, "_dataMigrations", passing).status,
    "pass",
  );

  const failureRows = passing.map((row) => ({ ...row }));
  failureRows[2].can_delete = true;
  const failure = evaluateRuntimePrivileges(
    APP_TABLES,
    "_dataMigrations",
    failureRows,
  );
  assert.equal(failure.status, "fail");
  assert.equal(failure.marker_read_only, false);
});

test("argument parsing requires output values and supports project override", () => {
  const parsed = parseArgs([
    "--project-dir",
    "/tmp/circles",
    "--json-output",
    "/tmp/audit.json",
  ]);
  assert.equal(parsed.projectDir, "/tmp/circles");
  assert.equal(parsed.jsonOutput, "/tmp/audit.json");
  assert.throws(
    () => parseArgs(["--markdown-output"]),
    /Invalid audit command arguments/,
  );
});
