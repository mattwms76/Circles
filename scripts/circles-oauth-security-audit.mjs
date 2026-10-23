#!/usr/bin/env node
/**
 * Read-only PostgreSQL security audit for Circles' fixed OAuth pending-state
 * helper. It inspects only circles_auth.oauth_pending_states through catalog
 * metadata and bounded SELECT 1 permission probes. It never reads state rows,
 * OAuth payloads, fingerprints, bearer material, connection configuration, or
 * raw database errors.
 *
 * Run only from an authorized parent/operator environment. This module makes
 * no provider or HTTP requests and is intentionally not invoked by its tests.
 */
import { createRequire } from "node:module";
import { lstat, realpath, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

const execFileAsync = promisify(execFile);

export const DEFAULT_PROJECT_DIR = "/home/ubuntu/circles";
export const AUTH_SCHEMA = "circles_auth";
export const PENDING_TABLE = "oauth_pending_states";
export const RUNTIME_ROLE = "circles_app_runtime";
export const EXTERNAL_ROLES = Object.freeze([
  "anon",
  "authenticated",
  "service_role",
]);
const AUDITED_GRANTEES = Object.freeze([RUNTIME_ROLE, ...EXTERNAL_ROLES]);
const EXPECTED_POLICY =
  "circles_auth_oauth_pending_states_runtime_backend_policy";
const EXPECTED_COLUMNS = Object.freeze([
  ["state_fingerprint", "text", true, null],
  ["flow_kind", "text", true, null],
  ["cookie_binding_fingerprint", "text", false, null],
  ["flow_token_fingerprint", "text", false, null],
  ["redirect_uri", "text", true, null],
  ["nonce", "text", true, null],
  ["frontend_origin", "text", false, null],
  ["expires_at", "timestamp with time zone", true, null],
  ["created_at", "timestamp with time zone", true, "clock_timestamp()"],
]);
// Exact reviewed PostgreSQL17 deparse of migration0002; do not accept keyword substrings.
const EXPECTED_CONSTRAINTS = Object.freeze({
  circles_auth_oauth_pending_states_cookie_fingerprint_check: {
    type: "c",
    definition:
      "CHECK (cookie_binding_fingerprint IS NULL OR cookie_binding_fingerprint ~ '^[0-9a-f]{64}$'::text)",
  },
  circles_auth_oauth_pending_states_expiry_check: {
    type: "c",
    definition: "CHECK (expires_at > created_at)",
  },
  circles_auth_oauth_pending_states_flow_binding_check: {
    type: "c",
    definition:
      "CHECK (flow_kind = 'web'::text AND cookie_binding_fingerprint IS NOT NULL AND flow_token_fingerprint IS NULL AND frontend_origin IS NOT NULL AND length(frontend_origin) > 0 OR flow_kind = 'native'::text AND cookie_binding_fingerprint IS NULL AND flow_token_fingerprint IS NOT NULL AND frontend_origin IS NULL)",
  },
  circles_auth_oauth_pending_states_flow_fingerprint_check: {
    type: "c",
    definition:
      "CHECK (flow_token_fingerprint IS NULL OR flow_token_fingerprint ~ '^[0-9a-f]{64}$'::text)",
  },
  circles_auth_oauth_pending_states_flow_kind_check: {
    type: "c",
    definition: "CHECK (flow_kind = ANY (ARRAY['web'::text, 'native'::text]))",
  },
  circles_auth_oauth_pending_states_nonce_check: {
    type: "c",
    definition: "CHECK (nonce ~ '^[A-Za-z0-9_-]{32,128}$'::text)",
  },
  circles_auth_oauth_pending_states_state_fingerprint_check: {
    type: "c",
    definition: "CHECK (state_fingerprint ~ '^[0-9a-f]{64}$'::text)",
  },
  oauth_pending_states_pkey: {
    type: "p",
    definition: "PRIMARY KEY (state_fingerprint)",
  },
});
const EXPECTED_INDEXES = Object.freeze({
  circles_auth_oauth_pending_states_expires_at_idx: {
    primary: false,
    unique: false,
    definition:
      "CREATE INDEX circles_auth_oauth_pending_states_expires_at_idx ON circles_auth.oauth_pending_states USING btree (expires_at)",
  },
  circles_auth_oauth_pending_states_native_flow_token_idx: {
    primary: false,
    unique: true,
    definition:
      "CREATE UNIQUE INDEX circles_auth_oauth_pending_states_native_flow_token_idx ON circles_auth.oauth_pending_states USING btree (flow_token_fingerprint) WHERE (flow_kind = 'native'::text)",
  },
  oauth_pending_states_pkey: {
    primary: true,
    unique: true,
    definition:
      "CREATE UNIQUE INDEX oauth_pending_states_pkey ON circles_auth.oauth_pending_states USING btree (state_fingerprint)",
  },
});
const SENSITIVE_KEY =
  /(?:password|secret|bearer|token|fingerprint|payload|cookie|nonce|authorization|database[_-]?url|raw[_-]?error|error[_-]?(?:message|detail|stack)|connection[_-]?string|\bstate\b)/i;
const SENSITIVE_TEXT =
  /(?:postgres(?:ql)?:\/\/|bearer\s+|password=|supabase_database_url)/i;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoolean(value) {
  return typeof value === "boolean";
}

function isString(value) {
  return typeof value === "string";
}

function isStringOrNull(value) {
  return value === null || isString(value);
}

function unknown(reason) {
  return { status: "unknown", reason };
}

function pass(details = {}) {
  return { status: "pass", ...details };
}

function fail(details = {}) {
  return { status: "fail", ...details };
}

function rowsArePresent(rows) {
  return Array.isArray(rows);
}

function normalizedRoles(value) {
  if (Array.isArray(value) && value.every(isString)) return [...value].sort();
  if (isString(value) && value.startsWith("{") && value.endsWith("}")) {
    const contents = value.slice(1, -1);
    if (contents === "") return [];
    const roles = contents.split(",").map((role) => role.replaceAll('"', ""));
    return roles.every((role) => /^[A-Za-z_][A-Za-z0-9_$]*$/.test(role))
      ? roles.sort()
      : null;
  }
  return null;
}

export function normalizeExpression(expression) {
  if (expression === null || expression === undefined) return null;
  if (!isString(expression)) return null;
  return expression
    .replaceAll(/\s+/g, "")
    .replaceAll(/^\(+|\)+$/g, "")
    .toLowerCase();
}

function normalizeSql(expression) {
  if (!isString(expression)) return null;
  // Preserve quoted literals, casts and grouping. Only outside-literal whitespace,
  // SQL keyword case and optional pg_catalog qualification are immaterial.
  const parts = expression.match(/'(?:[^']|'')*'|[^']+/g);
  if (!parts || parts.join("") !== expression) return null;
  return parts
    .map((part) =>
      part.startsWith("'")
        ? part
        : part
            .toLowerCase()
            .replaceAll(/\s+/g, "")
            .replaceAll(/pg_catalog\./g, ""),
    )
    .join("");
}

function namesFromRows(rows, key) {
  if (!rowsArePresent(rows) || !rows.every(isRecord)) return null;
  const names = rows.map((row) => row[key]);
  return names.every(isString) ? names : null;
}

function sameStrings(actual, expected) {
  if (actual.length !== expected.length) return false;
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  return sortedActual.every((value, index) => value === sortedExpected[index]);
}

/** Pure evaluator: exact private schema/table inventory and postgres ownership. */
export function evaluateInventoryAndOwnership(schemaRows, tableRows) {
  if (!rowsArePresent(schemaRows) || !rowsArePresent(tableRows)) {
    return unknown("schema_or_table_catalog_unavailable");
  }
  if (!schemaRows.every(isRecord) || !tableRows.every(isRecord)) {
    return unknown("malformed_schema_or_table_catalog");
  }
  if (schemaRows.length !== 1) {
    return fail({ violation: "schema_missing_or_not_unique" });
  }
  const schema = schemaRows[0];
  if (!isString(schema.schema_name) || !isString(schema.owner)) {
    return unknown("malformed_schema_metadata");
  }
  if (schema.schema_name !== AUTH_SCHEMA || schema.owner !== "postgres") {
    return fail({
      violation:
        schema.schema_name !== AUTH_SCHEMA ? "schema_missing" : "schema_owner",
    });
  }
  const tableNames = namesFromRows(tableRows, "table_name");
  if (!tableNames) return unknown("malformed_table_metadata");
  if (!sameStrings(tableNames, [PENDING_TABLE])) {
    return fail({
      missing_table: !tableNames.includes(PENDING_TABLE),
      unexpected_table_count: tableNames.filter(
        (name) => name !== PENDING_TABLE,
      ).length,
    });
  }
  const table = tableRows[0];
  if (!isString(table.owner)) return unknown("malformed_table_owner");
  if (table.owner !== "postgres") return fail({ violation: "table_owner" });
  return pass({ exact_table_inventory: true, postgres_owner: true });
}

/** Pure evaluator: forced RLS and the one exact runtime-only ALL policy. */
export function evaluateRlsAndPolicy(tableRows, policyRows) {
  if (!rowsArePresent(tableRows) || !rowsArePresent(policyRows)) {
    return unknown("rls_or_policy_catalog_unavailable");
  }
  if (!tableRows.every(isRecord) || !policyRows.every(isRecord)) {
    return unknown("malformed_rls_or_policy_catalog");
  }
  const table = tableRows.find((row) => row.table_name === PENDING_TABLE);
  if (!table) return fail({ violation: "pending_table_missing" });
  if (!isBoolean(table.rls_enabled) || !isBoolean(table.rls_forced)) {
    return unknown("malformed_rls_metadata");
  }
  if (!table.rls_enabled || !table.rls_forced) {
    return fail({
      rls_enabled: table.rls_enabled,
      rls_forced: table.rls_forced,
    });
  }
  const policies = policyRows.filter((row) => row.table_name === PENDING_TABLE);
  if (
    policies.length !== 1 ||
    policyRows.some((row) => row.table_name !== PENDING_TABLE)
  ) {
    return fail({ violation: "policy_count_or_table_coverage" });
  }
  const policy = policies[0];
  if (
    !isString(policy.policy_name) ||
    !isString(policy.command) ||
    !isStringOrNull(policy.using_qualification) ||
    !isStringOrNull(policy.with_check_qualification)
  ) {
    return unknown("malformed_policy_metadata");
  }
  const roles = normalizedRoles(policy.roles);
  if (!roles) return unknown("malformed_policy_roles");
  const exact =
    policy.policy_name === EXPECTED_POLICY &&
    policy.command === "ALL" &&
    sameStrings(roles, [RUNTIME_ROLE]) &&
    normalizeExpression(policy.using_qualification) === "true" &&
    normalizeExpression(policy.with_check_qualification) === "true";
  return exact
    ? pass({ forced_rls: true, exact_runtime_only_policy: true })
    : fail({ violation: "runtime_only_policy_shape" });
}

/** Pure evaluator: non-login runtime role with no role-membership elevation path. */
export function evaluateRuntimeRoleAndMembership(roleRows, membershipRows) {
  if (!rowsArePresent(roleRows) || !rowsArePresent(membershipRows)) {
    return unknown("role_or_membership_catalog_unavailable");
  }
  if (!roleRows.every(isRecord) || !membershipRows.every(isRecord)) {
    return unknown("malformed_role_or_membership_catalog");
  }
  if (roleRows.length !== 1)
    return fail({ violation: "runtime_role_missing_or_not_unique" });
  const role = roleRows[0];
  if (
    !isString(role.role_name) ||
    !isBoolean(role.can_login) ||
    !isBoolean(role.inherits) ||
    !isBoolean(role.is_superuser) ||
    !isBoolean(role.bypasses_rls)
  ) {
    return unknown("malformed_runtime_role_metadata");
  }
  if (role.role_name !== RUNTIME_ROLE)
    return fail({ violation: "runtime_role_missing" });
  if (membershipRows.some((row) => !isString(row.parent_role))) {
    return unknown("malformed_membership_metadata");
  }
  const unsafeFlags = [
    role.can_login ? "can_login" : null,
    role.inherits ? "inherits" : null,
    role.is_superuser ? "is_superuser" : null,
    role.bypasses_rls ? "bypasses_rls" : null,
  ].filter(Boolean);
  if (unsafeFlags.length > 0 || membershipRows.length > 0) {
    return fail({
      unsafe_flags: unsafeFlags,
      membership_count: membershipRows.length,
    });
  }
  return pass({
    nologin_noinherit_nosuper_nobypass: true,
    membership_count: 0,
  });
}

function expectedSchemaAcl() {
  return [`${RUNTIME_ROLE}:USAGE:false`];
}

function expectedTableAcl() {
  return ["DELETE", "INSERT", "SELECT"].map(
    (privilege) => `${RUNTIME_ROLE}:${privilege}:false`,
  );
}

function normalizeAclRows(rows) {
  if (!rowsArePresent(rows) || !rows.every(isRecord)) return null;
  const normalized = [];
  for (const row of rows) {
    if (
      !isString(row.grantee) ||
      !isString(row.privilege_type) ||
      !isBoolean(row.is_grantable)
    ) {
      return null;
    }
    normalized.push(
      `${row.grantee}:${row.privilege_type.toUpperCase()}:${row.is_grantable}`,
    );
  }
  return normalized;
}

function expectedEffectivePrivilegeRows(rows, objectKind) {
  if (!rowsArePresent(rows) || !rows.every(isRecord)) return null;
  if (rows.length !== AUDITED_GRANTEES.length) return false;
  const byRole = new Map();
  for (const row of rows) {
    if (!isString(row.role_name) || !isBoolean(row.role_exists)) return null;
    if (
      objectKind === "schema" &&
      (!isBoolean(row.has_usage) || !isBoolean(row.has_create))
    )
      return null;
    const tableKeys = [
      "can_select",
      "can_insert",
      "can_update",
      "can_delete",
      "can_truncate",
      "can_references",
      "can_trigger",
    ];
    if (
      objectKind === "table" &&
      !tableKeys.every((key) => isBoolean(row[key]))
    ) {
      return null;
    }
    if (byRole.has(row.role_name)) return false;
    byRole.set(row.role_name, row);
  }
  if (!sameStrings([...byRole.keys()], AUDITED_GRANTEES)) return false;
  for (const roleName of AUDITED_GRANTEES) {
    const row = byRole.get(roleName);
    if (!row.role_exists) return false;
    if (objectKind === "schema") {
      const mustUse = roleName === RUNTIME_ROLE;
      if (row.has_usage !== mustUse || row.has_create !== false) return false;
    } else {
      const runtime = roleName === RUNTIME_ROLE;
      if (
        row.can_select !== runtime ||
        row.can_insert !== runtime ||
        row.can_delete !== runtime ||
        row.can_update !== false ||
        row.can_truncate !== false ||
        row.can_references !== false ||
        row.can_trigger !== false
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Pure evaluator: exact effective and direct ACLs. PUBLIC is checked through
 * direct ACL rows and through effective privileges on each external role.
 */
export function evaluatePrivileges(
  schemaPrivilegeRows,
  tablePrivilegeRows,
  schemaAclRows,
  tableAclRows,
) {
  const schemaEffective = expectedEffectivePrivilegeRows(
    schemaPrivilegeRows,
    "schema",
  );
  const tableEffective = expectedEffectivePrivilegeRows(
    tablePrivilegeRows,
    "table",
  );
  const schemaAcl = normalizeAclRows(schemaAclRows);
  const tableAcl = normalizeAclRows(tableAclRows);
  if (
    schemaEffective === null ||
    tableEffective === null ||
    schemaAcl === null ||
    tableAcl === null
  ) {
    return unknown("malformed_or_unavailable_privilege_metadata");
  }
  const exactAcl =
    sameStrings(schemaAcl, expectedSchemaAcl()) &&
    sameStrings(tableAcl, expectedTableAcl());
  if (!schemaEffective || !tableEffective || !exactAcl) {
    return fail({
      exact_effective_privileges:
        schemaEffective === true && tableEffective === true,
      exact_direct_acl: exactAcl,
    });
  }
  return pass({
    runtime_select_insert_delete_only: true,
    external_and_public_denied: true,
  });
}

function evaluateColumns(rows) {
  if (!rowsArePresent(rows) || !rows.every(isRecord))
    return unknown("column_catalog_unavailable");
  if (rows.length !== EXPECTED_COLUMNS.length) {
    return fail({ violation: "column_count" });
  }
  const byName = new Map();
  for (const row of rows) {
    if (
      !isString(row.column_name) ||
      !isString(row.data_type) ||
      !isBoolean(row.not_null) ||
      !isStringOrNull(row.column_default)
    ) {
      return unknown("malformed_column_metadata");
    }
    if (byName.has(row.column_name))
      return fail({ violation: "duplicate_column" });
    byName.set(row.column_name, row);
  }
  for (const [name, dataType, notNull, defaultExpression] of EXPECTED_COLUMNS) {
    const row = byName.get(name);
    if (!row) return fail({ violation: "required_column_missing" });
    const defaultMatches =
      defaultExpression === null
        ? row.column_default === null
        : normalizeSql(row.column_default) === normalizeSql(defaultExpression);
    if (
      row.data_type !== dataType ||
      row.not_null !== notNull ||
      !defaultMatches
    ) {
      return fail({ violation: "column_type_nullability_or_default" });
    }
  }
  return pass({ exact_columns: true });
}

function evaluateConstraints(rows) {
  if (!rowsArePresent(rows) || !rows.every(isRecord)) {
    return unknown("constraint_catalog_unavailable");
  }
  const expectedNames = Object.keys(EXPECTED_CONSTRAINTS);
  if (rows.length !== expectedNames.length)
    return fail({ violation: "constraint_count" });
  const byName = new Map();
  for (const row of rows) {
    if (
      !isString(row.constraint_name) ||
      !isString(row.constraint_type) ||
      !isBoolean(row.is_validated) ||
      !isString(row.definition)
    ) {
      return unknown("malformed_constraint_metadata");
    }
    if (byName.has(row.constraint_name))
      return fail({ violation: "duplicate_constraint" });
    byName.set(row.constraint_name, row);
  }
  for (const [name, specification] of Object.entries(EXPECTED_CONSTRAINTS)) {
    const row = byName.get(name);
    const definition = row && normalizeSql(row.definition);
    if (
      !row ||
      row.constraint_type !== specification.type ||
      !definition ||
      row.is_validated !== true ||
      definition !== normalizeSql(specification.definition)
    ) {
      return fail({ violation: "required_constraint_shape" });
    }
  }
  return pass({ required_constraints: true });
}

function evaluateIndexes(rows) {
  if (!rowsArePresent(rows) || !rows.every(isRecord))
    return unknown("index_catalog_unavailable");
  const expectedNames = Object.keys(EXPECTED_INDEXES);
  if (rows.length !== expectedNames.length)
    return fail({ violation: "index_count" });
  const byName = new Map();
  for (const row of rows) {
    if (
      !isString(row.index_name) ||
      !isBoolean(row.is_primary) ||
      !isBoolean(row.is_unique) ||
      !isBoolean(row.is_valid) ||
      !isBoolean(row.is_ready) ||
      !isString(row.definition)
    ) {
      return unknown("malformed_index_metadata");
    }
    if (byName.has(row.index_name))
      return fail({ violation: "duplicate_index" });
    byName.set(row.index_name, row);
  }
  for (const [name, specification] of Object.entries(EXPECTED_INDEXES)) {
    const row = byName.get(name);
    const definition = row && normalizeSql(row.definition);
    if (
      !row ||
      row.is_primary !== specification.primary ||
      row.is_unique !== specification.unique ||
      !definition ||
      row.is_valid !== true ||
      row.is_ready !== true ||
      definition !== normalizeSql(specification.definition)
    ) {
      return fail({ violation: "required_index_shape" });
    }
  }
  return pass({ required_indexes: true });
}

/** Pure evaluator: column types/default, constraint, and index requirements. */
export function evaluateStructuralMetadata(
  columnRows,
  constraintRows,
  indexRows,
) {
  const columns = evaluateColumns(columnRows);
  const constraints = evaluateConstraints(constraintRows);
  const indexes = evaluateIndexes(indexRows);
  if (
    [columns, constraints, indexes].some(
      (result) => result.status === "unknown",
    )
  ) {
    return unknown("structural_catalog_incomplete");
  }
  if (
    [columns, constraints, indexes].some((result) => result.status === "fail")
  ) {
    return fail({
      columns: columns.status,
      constraints: constraints.status,
      indexes: indexes.status,
    });
  }
  return pass({ columns: "pass", constraints: "pass", indexes: "pass" });
}

/** Pure evaluator: no migration-unexpected functions and no unsafe default/function ACL grants. */
export function evaluateFunctionAndDefaultAclHazards(
  functionRows,
  functionAclRows,
  defaultAclRows,
) {
  if (
    !rowsArePresent(functionRows) ||
    !rowsArePresent(functionAclRows) ||
    !rowsArePresent(defaultAclRows)
  ) {
    return unknown("function_or_default_acl_catalog_unavailable");
  }
  if (
    !functionRows.every(isRecord) ||
    !functionAclRows.every(isRecord) ||
    !defaultAclRows.every(isRecord)
  ) {
    return unknown("malformed_function_or_default_acl_metadata");
  }
  for (const row of functionRows) {
    if (!isString(row.function_name) || !isBoolean(row.security_definer)) {
      return unknown("malformed_function_metadata");
    }
  }
  for (const row of [...functionAclRows, ...defaultAclRows]) {
    if (
      !isString(row.grantee) ||
      !isString(row.privilege_type) ||
      !isBoolean(row.is_grantable)
    ) {
      return unknown("malformed_acl_hazard_metadata");
    }
  }
  if (
    functionRows.length > 0 ||
    functionAclRows.length > 0 ||
    defaultAclRows.length > 0
  ) {
    return fail({
      unexpected_function_count: functionRows.length,
      function_acl_hazard_count: functionAclRows.length,
      default_acl_hazard_count: defaultAclRows.length,
    });
  }
  return pass({ no_functions_or_function_default_acl_hazards: true });
}

function validProbeRow(row) {
  return (
    isRecord(row) &&
    isString(row.role_name) &&
    ["allowed", "denied", "indeterminate"].includes(row.outcome) &&
    row.bounded_select_1_limit_1 === true
  );
}

/** Pure evaluator: each external role must receive a real, classified denial. */
export function evaluateExternalProbes(probeRows) {
  if (!rowsArePresent(probeRows)) return unknown("external_probes_unavailable");
  if (!probeRows.every(validProbeRow))
    return unknown("malformed_external_probe_metadata");
  if (probeRows.length !== EXTERNAL_ROLES.length)
    return fail({ violation: "external_probe_count" });
  const names = probeRows.map((row) => row.role_name);
  if (!sameStrings(names, EXTERNAL_ROLES))
    return fail({ violation: "external_probe_role_coverage" });
  if (probeRows.some((row) => row.outcome === "indeterminate")) {
    return unknown("external_probe_indeterminate");
  }
  if (probeRows.some((row) => row.outcome !== "denied")) {
    return fail({ violation: "external_select_allowed" });
  }
  return pass({ all_external_select_1_probes_denied: true });
}

/** Pure evaluator: the runtime role must be allowed only the bounded SELECT 1 probe. */
export function evaluateRuntimeProbe(probe) {
  if (!isRecord(probe)) return unknown("runtime_probe_unavailable");
  if (!validProbeRow(probe) || probe.role_name !== RUNTIME_ROLE) {
    return unknown("malformed_runtime_probe_metadata");
  }
  if (probe.outcome === "indeterminate")
    return unknown("runtime_probe_indeterminate");
  return probe.outcome === "allowed"
    ? pass({ runtime_select_1_probe_allowed: true })
    : fail({ violation: "runtime_select_denied" });
}

/** Combine pre-collected synthetic/catalog evidence without I/O; useful to tests. */
export function evaluateEvidence(evidence) {
  if (!isRecord(evidence)) return { status: "unknown", checks: {} };
  const checks = {
    inventory_and_ownership: evaluateInventoryAndOwnership(
      evidence.schema_rows,
      evidence.table_rows,
    ),
    forced_rls_and_runtime_only_policy: evaluateRlsAndPolicy(
      evidence.table_rows,
      evidence.policy_rows,
    ),
    runtime_role_and_membership: evaluateRuntimeRoleAndMembership(
      evidence.runtime_role_rows,
      evidence.membership_rows,
    ),
    exact_schema_and_table_privileges: evaluatePrivileges(
      evidence.schema_privilege_rows,
      evidence.table_privilege_rows,
      evidence.schema_acl_rows,
      evidence.table_acl_rows,
    ),
    required_columns_constraints_indexes: evaluateStructuralMetadata(
      evidence.column_rows,
      evidence.constraint_rows,
      evidence.index_rows,
    ),
    function_and_default_acl_hazards: evaluateFunctionAndDefaultAclHazards(
      evidence.function_rows,
      evidence.function_acl_rows,
      evidence.default_acl_rows,
    ),
    external_role_select_1_denials: evaluateExternalProbes(
      evidence.external_probes,
    ),
    runtime_select_1: evaluateRuntimeProbe(evidence.runtime_probe),
  };
  const statuses = Object.values(checks).map((check) => check.status);
  return {
    status: statuses.every((status) => status === "pass") ? "pass" : "fail",
    checks,
  };
}

/** Remove defensive secret/error-shaped values before either output format is rendered. */
export function sanitizeForOutput(value) {
  if (Array.isArray(value)) return value.map((item) => sanitizeForOutput(item));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[redacted]" : sanitizeForOutput(entry),
      ]),
    );
  }
  if (isString(value) && SENSITIVE_TEXT.test(value)) return "[redacted]";
  return value;
}

function makeContext(projectDir, sourceTree) {
  return {
    source_tree: sourceTree,
    executed_at_utc: new Date().toISOString(),
    target: `${AUTH_SCHEMA}.${PENDING_TABLE}`,
    project_dir: projectDir,
  };
}

function makeCheck(context, name, evaluation, passSummary, failSummary) {
  const status = evaluation.status;
  return {
    name,
    status,
    summary:
      status === "pass"
        ? passSummary
        : status === "unknown"
          ? "Catalog/probe evidence was unavailable or malformed; result is fail-closed."
          : failSummary,
    source_tree: context.source_tree,
    executed_at_utc: context.executed_at_utc,
    target: context.target,
    evidence: evaluation,
  };
}

function checksFromEvidence(context, evaluated) {
  const checks = evaluated.checks;
  return [
    makeCheck(
      context,
      "exact_schema_table_inventory_and_owner",
      checks.inventory_and_ownership,
      "The fixed circles_auth schema contains only oauth_pending_states and schema/table ownership is postgres.",
      "The fixed schema/table inventory or postgres ownership differs from the migration contract.",
    ),
    makeCheck(
      context,
      "forced_rls_and_exact_runtime_policy",
      checks.forced_rls_and_runtime_only_policy,
      "The pending-state table has forced RLS and exactly one ALL/true policy for the runtime role.",
      "Forced RLS or the exact runtime-only policy differs from the migration contract.",
    ),
    makeCheck(
      context,
      "runtime_role_flags_and_no_membership_elevation",
      checks.runtime_role_and_membership,
      "The runtime role is NOLOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS, and has no role memberships.",
      "The runtime role has an unsafe attribute or a role-membership elevation path.",
    ),
    makeCheck(
      context,
      "exact_schema_and_table_privileges",
      checks.exact_schema_and_table_privileges,
      "Only the runtime role has schema USAGE and table SELECT/INSERT/DELETE; PUBLIC and external roles have no effective or direct grant.",
      "Schema/table privilege or direct ACL metadata differs from the restricted helper contract.",
    ),
    makeCheck(
      context,
      "required_column_type_constraint_and_index_metadata",
      checks.required_columns_constraints_indexes,
      "Required column types/default, constraints, and indexes match the pending-state migration contract.",
      "Required column/type/default, constraint, or index metadata differs from the migration contract.",
    ),
    makeCheck(
      context,
      "function_and_default_acl_hazards",
      checks.function_and_default_acl_hazards,
      "No functions or external/PUBLIC function/default ACL hazards were cataloged in the fixed helper schema.",
      "Unexpected functions or external/PUBLIC function/default ACL hazards were cataloged.",
    ),
    makeCheck(
      context,
      "external_role_bounded_select_1_denial_probes",
      checks.external_role_select_1_denials,
      "Each external role was denied a bounded SELECT 1 probe in its own read-only transaction.",
      "An external role probe was allowed, missing, or not safely classifiable.",
    ),
    makeCheck(
      context,
      "runtime_bounded_select_1_probe",
      checks.runtime_select_1,
      "The runtime role was allowed a bounded SELECT 1 probe in a read-only transaction.",
      "The runtime role SELECT 1 probe was denied or not safely classifiable.",
    ),
  ];
}

function baseReport(context) {
  return {
    report_version: 1,
    audit_name: "circles_oauth_pending_state_security_audit",
    overall_status: "fail",
    executed_at_utc: context.executed_at_utc,
    source_tree: context.source_tree,
    target: context.target,
    runtime_role: RUNTIME_ROLE,
    scope: {
      schema: AUTH_SCHEMA,
      table: PENDING_TABLE,
      helper: "oauth_pending_state",
    },
    method: {
      database_access: "read_only_catalog_metadata_and_bounded_select_1_only",
      application_row_values_exported: false,
      mutation_statement_issued: false,
      raw_database_errors_exported: false,
      sensitive_material_exported: false,
    },
    checks: [],
    limitations: [
      "Catalog metadata and database role probes cannot establish every API gateway, PostgREST, provider, client, or deployment exposure path.",
      "The server-only RLS policy permits the runtime role and is not a per-user or per-circle authorization claim.",
      "The bounded SELECT 1 probes export neither state rows nor row-count/existence information.",
    ],
  };
}

async function getSourceTree(projectDir) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", projectDir, "rev-parse", "HEAD^{tree}"],
      { timeout: 5_000, maxBuffer: 1_024 },
    );
    const sourceTree = stdout.trim();
    return /^[0-9a-f]{40}$/i.test(sourceTree) ? sourceTree : "unknown";
  } catch {
    return "unknown";
  }
}

function requirePgFromProject(projectDir) {
  const projectRequire = createRequire(resolve(projectDir, "package.json"));
  const pg = projectRequire("pg");
  if (!pg?.Client) throw new Error("PostgreSQL driver unavailable");
  return pg;
}

async function loadApprovedConnectionHelper(projectDir) {
  const configuration = await import(
    pathToFileURL(resolve(projectDir, "server/_core/postgres-config.mjs")).href
  );
  if (
    configuration.RUNTIME_ROLE !== RUNTIME_ROLE ||
    typeof configuration.getPostgresConnectionOptions !== "function"
  ) {
    throw new Error("Unexpected PostgreSQL configuration helper");
  }
  return configuration.getPostgresConnectionOptions;
}

async function queryCatalog(client, sql, values = []) {
  try {
    const result = await client.query(sql, values);
    return result.rows;
  } catch {
    // A catalog error can invalidate the enclosing read-only transaction; remaining
    // catalog results then become unknown and the final report remains fail-closed.
    return null;
  }
}

async function collectCatalogEvidence(client) {
  const grantees = [...AUDITED_GRANTEES];
  const [
    schemaRows,
    tableRows,
    policyRows,
    runtimeRoleRows,
    membershipRows,
    schemaPrivilegeRows,
    tablePrivilegeRows,
    schemaAclRows,
    tableAclRows,
    columnRows,
    constraintRows,
    indexRows,
    functionRows,
    functionAclRows,
    defaultAclRows,
  ] = await Promise.all([
    queryCatalog(
      client,
      `SELECT n.nspname AS schema_name, pg_catalog.pg_get_userbyid(n.nspowner) AS owner
         FROM pg_catalog.pg_namespace AS n
        WHERE n.nspname = $1
        ORDER BY n.nspname
        LIMIT 1`,
      [AUTH_SCHEMA],
    ),
    queryCatalog(
      client,
      `SELECT c.relname AS table_name,
              pg_catalog.pg_get_userbyid(c.relowner) AS owner,
              c.relrowsecurity AS rls_enabled,
              c.relforcerowsecurity AS rls_forced
         FROM pg_catalog.pg_class AS c
         JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
        ORDER BY c.relname
        LIMIT 2`,
      [AUTH_SCHEMA],
    ),
    queryCatalog(
      client,
      `SELECT p.tablename AS table_name,
              p.policyname AS policy_name,
              p.roles AS roles,
              p.cmd AS command,
              p.qual AS using_qualification,
              p.with_check AS with_check_qualification
         FROM pg_catalog.pg_policies AS p
        WHERE p.schemaname = $1
        ORDER BY p.tablename, p.policyname
        LIMIT 2`,
      [AUTH_SCHEMA],
    ),
    queryCatalog(
      client,
      `SELECT r.rolname AS role_name,
              r.rolcanlogin AS can_login,
              r.rolinherit AS inherits,
              r.rolsuper AS is_superuser,
              r.rolbypassrls AS bypasses_rls
         FROM pg_catalog.pg_roles AS r
        WHERE r.rolname = $1
        ORDER BY r.rolname
        LIMIT 1`,
      [RUNTIME_ROLE],
    ),
    queryCatalog(
      client,
      `SELECT parent.rolname AS parent_role
         FROM pg_catalog.pg_auth_members AS member_of
         JOIN pg_catalog.pg_roles AS parent ON parent.oid = member_of.roleid
         JOIN pg_catalog.pg_roles AS member ON member.oid = member_of.member
        WHERE member.rolname = $1
        ORDER BY parent.rolname
        LIMIT 2`,
      [RUNTIME_ROLE],
    ),
    queryCatalog(
      client,
      `WITH target_roles(role_name) AS (SELECT unnest($2::text[]))
       SELECT target_roles.role_name,
              role_catalog.oid IS NOT NULL AS role_exists,
              CASE WHEN role_catalog.oid IS NULL THEN false
                   ELSE pg_catalog.has_schema_privilege(role_catalog.oid, n.oid, 'USAGE') END AS has_usage,
              CASE WHEN role_catalog.oid IS NULL THEN false
                   ELSE pg_catalog.has_schema_privilege(role_catalog.oid, n.oid, 'CREATE') END AS has_create
         FROM target_roles
         CROSS JOIN pg_catalog.pg_namespace AS n
         LEFT JOIN pg_catalog.pg_roles AS role_catalog ON role_catalog.rolname = target_roles.role_name
        WHERE n.nspname = $1
        ORDER BY target_roles.role_name
        LIMIT 4`,
      [AUTH_SCHEMA, grantees],
    ),
    queryCatalog(
      client,
      `WITH target_roles(role_name) AS (SELECT unnest($2::text[]))
       SELECT target_roles.role_name,
              role_catalog.oid IS NOT NULL AS role_exists,
              CASE WHEN role_catalog.oid IS NULL THEN false ELSE pg_catalog.has_table_privilege(role_catalog.oid, c.oid, 'SELECT') END AS can_select,
              CASE WHEN role_catalog.oid IS NULL THEN false ELSE pg_catalog.has_table_privilege(role_catalog.oid, c.oid, 'INSERT') END AS can_insert,
              CASE WHEN role_catalog.oid IS NULL THEN false ELSE pg_catalog.has_table_privilege(role_catalog.oid, c.oid, 'UPDATE') END AS can_update,
              CASE WHEN role_catalog.oid IS NULL THEN false ELSE pg_catalog.has_table_privilege(role_catalog.oid, c.oid, 'DELETE') END AS can_delete,
              CASE WHEN role_catalog.oid IS NULL THEN false ELSE pg_catalog.has_table_privilege(role_catalog.oid, c.oid, 'TRUNCATE') END AS can_truncate,
              CASE WHEN role_catalog.oid IS NULL THEN false ELSE pg_catalog.has_table_privilege(role_catalog.oid, c.oid, 'REFERENCES') END AS can_references,
              CASE WHEN role_catalog.oid IS NULL THEN false ELSE pg_catalog.has_table_privilege(role_catalog.oid, c.oid, 'TRIGGER') END AS can_trigger
         FROM target_roles
         CROSS JOIN pg_catalog.pg_class AS c
         JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
         LEFT JOIN pg_catalog.pg_roles AS role_catalog ON role_catalog.rolname = target_roles.role_name
        WHERE n.nspname = $1 AND c.relname = $3 AND c.relkind IN ('r', 'p')
        ORDER BY target_roles.role_name
        LIMIT 4`,
      [AUTH_SCHEMA, grantees, PENDING_TABLE],
    ),
    queryCatalog(
      client,
      `SELECT COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
              privilege.privilege_type AS privilege_type,
              privilege.is_grantable AS is_grantable
         FROM pg_catalog.pg_namespace AS n
         CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) AS privilege
         LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = privilege.grantee
        WHERE n.nspname = $1
          AND privilege.grantee <> n.nspowner
        ORDER BY grantee, privilege.privilege_type
        LIMIT 11`,
      [AUTH_SCHEMA],
    ),
    queryCatalog(
      client,
      `SELECT COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
              privilege.privilege_type AS privilege_type,
              privilege.is_grantable AS is_grantable
         FROM pg_catalog.pg_class AS c
         JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) AS privilege
         LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = privilege.grantee
        WHERE n.nspname = $1 AND c.relname = $3 AND c.relkind IN ('r', 'p')
          AND $2::text[] IS NOT NULL AND privilege.grantee <> c.relowner
        ORDER BY grantee, privilege.privilege_type
        LIMIT 36`,
      [AUTH_SCHEMA, grantees, PENDING_TABLE],
    ),
    queryCatalog(
      client,
      `SELECT a.attname AS column_name,
              pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
              a.attnotnull AS not_null,
              pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS column_default
         FROM pg_catalog.pg_attribute AS a
         JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
         JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
         LEFT JOIN pg_catalog.pg_attrdef AS d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum
        LIMIT 10`,
      [AUTH_SCHEMA, PENDING_TABLE],
    ),
    queryCatalog(
      client,
      `SELECT constraint_catalog.conname AS constraint_name,
              constraint_catalog.contype::text AS constraint_type,
              pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true) AS definition,
              constraint_catalog.convalidated AS is_validated
         FROM pg_catalog.pg_constraint AS constraint_catalog
         JOIN pg_catalog.pg_class AS c ON c.oid = constraint_catalog.conrelid
         JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2
        ORDER BY constraint_catalog.conname
        LIMIT 9`,
      [AUTH_SCHEMA, PENDING_TABLE],
    ),
    queryCatalog(
      client,
      `SELECT index_catalog.relname AS index_name,
              index_data.indisprimary AS is_primary,
              index_data.indisunique AS is_unique,
              index_data.indisvalid AS is_valid,
              index_data.indisready AS is_ready,
              pg_catalog.pg_get_indexdef(index_catalog.oid) AS definition
         FROM pg_catalog.pg_index AS index_data
         JOIN pg_catalog.pg_class AS c ON c.oid = index_data.indrelid
         JOIN pg_catalog.pg_class AS index_catalog ON index_catalog.oid = index_data.indexrelid
         JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2
        ORDER BY index_catalog.relname
        LIMIT 4`,
      [AUTH_SCHEMA, PENDING_TABLE],
    ),
    queryCatalog(
      client,
      `SELECT procedure_catalog.proname AS function_name,
              procedure_catalog.prosecdef AS security_definer
         FROM pg_catalog.pg_proc AS procedure_catalog
         JOIN pg_catalog.pg_namespace AS n ON n.oid = procedure_catalog.pronamespace
        WHERE n.nspname = $1
        ORDER BY procedure_catalog.proname, procedure_catalog.oid
        LIMIT 2`,
      [AUTH_SCHEMA],
    ),
    queryCatalog(
      client,
      `SELECT COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
              privilege.privilege_type AS privilege_type,
              privilege.is_grantable AS is_grantable
         FROM pg_catalog.pg_proc AS procedure_catalog
         JOIN pg_catalog.pg_namespace AS n ON n.oid = procedure_catalog.pronamespace
         CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(procedure_catalog.proacl, pg_catalog.acldefault('f', procedure_catalog.proowner))) AS privilege
         LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = privilege.grantee
        WHERE n.nspname = $1
          AND privilege.grantee <> procedure_catalog.proowner
        ORDER BY grantee, privilege.privilege_type
        LIMIT 20`,
      [AUTH_SCHEMA],
    ),
    queryCatalog(
      client,
      // Global defaults override hard-wired defaults; per-schema entries add to
      // those defaults. Never invent PUBLIC EXECUTE by ignoring a global revoke.
      // https://www.postgresql.org/docs/17/catalog-pg-default-acl.html
      `WITH default_kinds(object_kind) AS (VALUES ('r'::"char"), ('S'::"char"), ('f'::"char")),
       defining_owner AS (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'postgres' LIMIT 1),
       effective_acl AS (
         SELECT privilege.* FROM default_kinds
         CROSS JOIN defining_owner
         LEFT JOIN pg_catalog.pg_default_acl global_acl
           ON global_acl.defaclnamespace = 0 AND global_acl.defaclrole = defining_owner.oid
          AND global_acl.defaclobjtype = default_kinds.object_kind
         CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(global_acl.defaclacl, pg_catalog.acldefault(default_kinds.object_kind, defining_owner.oid))) privilege
         UNION ALL
         SELECT privilege.* FROM pg_catalog.pg_default_acl scoped_acl
         JOIN pg_catalog.pg_namespace n ON n.oid = scoped_acl.defaclnamespace
         CROSS JOIN defining_owner
         CROSS JOIN LATERAL pg_catalog.aclexplode(scoped_acl.defaclacl) privilege
         WHERE n.nspname = $1 AND scoped_acl.defaclrole = defining_owner.oid
           AND scoped_acl.defaclobjtype IN ('r', 'S', 'f')
       )
       SELECT DISTINCT COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
              privilege.privilege_type, privilege.is_grantable
       FROM effective_acl privilege
       LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = privilege.grantee
       CROSS JOIN defining_owner
       WHERE privilege.grantee <> defining_owner.oid
       ORDER BY grantee, privilege.privilege_type
       LIMIT 65`,
      [AUTH_SCHEMA],
    ),
  ]);
  return {
    schema_rows: schemaRows,
    table_rows: tableRows,
    policy_rows: policyRows,
    runtime_role_rows: runtimeRoleRows,
    membership_rows: membershipRows,
    schema_privilege_rows: schemaPrivilegeRows,
    table_privilege_rows: tablePrivilegeRows,
    schema_acl_rows: schemaAclRows,
    table_acl_rows: tableAclRows,
    column_rows: columnRows,
    constraint_rows: constraintRows,
    index_rows: indexRows,
    function_rows: functionRows,
    function_acl_rows: functionAclRows,
    default_acl_rows: defaultAclRows,
  };
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

async function runReadOnlyProbe(client, roleName) {
  let began = false;
  let roleSelected = false;
  try {
    await client.query("BEGIN READ ONLY");
    began = true;
    await client.query(`SET LOCAL ROLE ${quoteIdentifier(roleName)}`);
    roleSelected = true;
    await client.query(
      `SELECT 1 AS permission_probe FROM ${quoteIdentifier(AUTH_SCHEMA)}.${quoteIdentifier(PENDING_TABLE)} LIMIT 1`,
    );
    return {
      role_name: roleName,
      outcome: "allowed",
      bounded_select_1_limit_1: true,
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error ? error.code : null;
    return {
      role_name: roleName,
      outcome: roleSelected && code === "42501" ? "denied" : "indeterminate",
      bounded_select_1_limit_1: true,
    };
  } finally {
    if (began) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Client closure below ends the failed read-only session without outputting errors.
      }
    }
  }
}

async function collectProbes(client) {
  const externalProbes = [];
  for (const roleName of EXTERNAL_ROLES) {
    externalProbes.push(await runReadOnlyProbe(client, roleName));
  }
  const runtimeProbe = await runReadOnlyProbe(client, RUNTIME_ROLE);
  return { externalProbes, runtimeProbe };
}

/** Render only safe, concise markdown; it deliberately contains no evidence tables. */
export function renderMarkdown(report) {
  const safeReport = sanitizeForOutput(report);
  const statusWord = safeReport.overall_status === "pass" ? "PASS" : "FAIL";
  const lines = [
    "# Circles OAuth pending-state security audit",
    "",
    `**Overall status:** ${statusWord}`,
    "",
    "## Scope and method",
    "",
    `- **Target:** \`${AUTH_SCHEMA}.${PENDING_TABLE}\` only (the fixed OAuth pending-state helper).`,
    `- **Executed (UTC):** ${safeReport.executed_at_utc}`,
    `- **Source tree:** ${safeReport.source_tree}`,
    "- **Method:** `BEGIN READ ONLY` catalog metadata queries plus bounded `SELECT 1 ... LIMIT 1` role probes; no DDL, DML, provider request, application-row export, or secret/configuration export.",
    "",
    "## Automated checks",
    "",
    ...safeReport.checks.map(
      (check) =>
        `- **${check.status.toUpperCase()} — ${check.name}:** ${check.summary}`,
    ),
    "",
    "## Important limitations",
    "",
    ...safeReport.limitations.map((limitation) => `- ${limitation}`),
    "",
    "## Follow-up",
    "",
    "- Treat any FAIL or UNKNOWN evidence as fail-closed; correct the database object/role configuration, then have the authorized parent rerun this audit.",
    "- Confirm gateway and deployment exposure separately. This catalog-and-probe audit makes no per-user or per-circle RLS authorization claim.",
    "",
  ];
  return lines.join("\n");
}

export function parseArgs(argv) {
  const options = {
    projectDir: DEFAULT_PROJECT_DIR,
    jsonOutput: null,
    markdownOutput: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (
      argument === "--project-dir" ||
      argument === "--json-output" ||
      argument === "--markdown-output"
    ) {
      const value = argv[index + 1];
      if (!isString(value) || value.length === 0 || value.startsWith("--")) {
        throw new Error("Invalid audit command arguments");
      }
      index += 1;
      if (argument === "--project-dir") options.projectDir = resolve(value);
      if (argument === "--json-output") options.jsonOutput = resolve(value);
      if (argument === "--markdown-output")
        options.markdownOutput = resolve(value);
      continue;
    }
    throw new Error("Invalid audit command arguments");
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

/** Ensure reports are outside the Git tree and cannot overwrite pre-existing private output. */
export async function validateOutputPaths(options) {
  if (!options?.jsonOutput || !options?.markdownOutput)
    throw new Error("Both JSON and Markdown output paths are required");
  const projectDir = await realpath(
    resolve(options.projectDir ?? DEFAULT_PROJECT_DIR),
  );
  const { stdout } = await execFileAsync(
    "git",
    ["-C", projectDir, "rev-parse", "--show-toplevel"],
    { timeout: 5000, maxBuffer: 4096 },
  );
  const gitRoot = await realpath(stdout.trim());
  const canonicalOutputs = [];
  for (const requested of [options.jsonOutput, options.markdownOutput]) {
    const lexical = resolve(requested);
    const parent = await realpath(dirname(lexical));
    const stat = await lstat(parent);
    if (
      !stat.isDirectory() ||
      (stat.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())
    )
      throw new Error(
        "Audit output directory must be private and owner-controlled",
      );
    const output = resolve(parent, basename(lexical));
    if (pathIsWithin(output, gitRoot))
      throw new Error("Audit outputs must be outside the project Git tree");
    try {
      await lstat(output);
      throw new Error("Refusing to overwrite an existing audit output");
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ENOENT")
        throw new Error("Refusing an existing or unavailable audit output");
    }
    canonicalOutputs.push(output);
  }
  if (canonicalOutputs[0] === canonicalOutputs[1])
    throw new Error("Output paths must be distinct");
  return {
    jsonOutput: canonicalOutputs[0],
    markdownOutput: canonicalOutputs[1],
  };
}

async function writePrivateNewFile(outputPath, content) {
  await writeFile(outputPath, content, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}

export async function runAudit(options = {}) {
  const projectDir = resolve(options.projectDir ?? DEFAULT_PROJECT_DIR);
  const context = makeContext(projectDir, await getSourceTree(projectDir));
  const report = baseReport(context);
  let client;
  try {
    const getPostgresConnectionOptions =
      await loadApprovedConnectionHelper(projectDir);
    const { Client } = requirePgFromProject(projectDir);
    // The project-approved helper consumes its secret only in memory. Nothing from
    // the returned configuration is retained in evidence, report, markdown, or errors.
    client = new Client(getPostgresConnectionOptions(process.env, projectDir));
    await client.connect();
    report.checks.push({
      name: "approved_project_connection_helper",
      status: "pass",
      summary:
        "The approved project connection helper and project-resolved pg client connected without exporting connection material.",
      source_tree: context.source_tree,
      executed_at_utc: context.executed_at_utc,
      target: context.target,
      evidence: { project_resolved_pg: true, approved_helper: true },
    });

    let catalogEvidence;
    let catalogTransactionBegan = false;
    try {
      await client.query("BEGIN READ ONLY");
      catalogTransactionBegan = true;
      catalogEvidence = await collectCatalogEvidence(client);
    } finally {
      if (catalogTransactionBegan) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Safe failure is reflected by null catalog result(s), never raw diagnostics.
        }
      }
    }

    const { externalProbes, runtimeProbe } = await collectProbes(client);
    const evaluated = evaluateEvidence({
      ...catalogEvidence,
      external_probes: externalProbes,
      runtime_probe: runtimeProbe,
    });
    report.checks.push(...checksFromEvidence(context, evaluated));
    report.evidence_summary = {
      catalog_evaluation: evaluated.status,
      external_probe_roles: EXTERNAL_ROLES,
      runtime_probe_role: RUNTIME_ROLE,
    };
  } catch {
    report.checks.push({
      name: "approved_project_connection_helper",
      status: "error",
      summary:
        "The approved project helper, project-resolved pg client, or database connection was unavailable; no connection material or raw error was retained.",
      source_tree: context.source_tree,
      executed_at_utc: context.executed_at_utc,
      target: context.target,
      evidence: { safe_error: "unavailable" },
    });
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        // Never expose raw driver diagnostics.
      }
    }
  }
  report.overall_status = report.checks.every(
    (check) => check.status === "pass",
  )
    ? "pass"
    : "fail";
  return sanitizeForOutput(report);
}

function usage() {
  return [
    "Usage: node scripts/circles-oauth-security-audit.mjs [options]",
    "  --project-dir <path>       Circles project root (default: /home/ubuntu/circles)",
    "  --json-output <path>       New private JSON path outside the project tree (required)",
    "  --markdown-output <path>   New private Markdown path outside the project tree (required)",
    "  --help                     Show this help",
  ].join("\n");
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch {
    console.error(
      "OAuth security audit arguments are invalid. Use --help for usage.",
    );
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }
  let paths;
  try {
    paths = await validateOutputPaths(options);
  } catch {
    console.error(
      "OAuth security audit output paths are invalid or already exist.",
    );
    process.exitCode = 2;
    return;
  }
  const report = await runAudit(options);
  try {
    await writePrivateNewFile(
      paths.jsonOutput,
      `${JSON.stringify(report, null, 2)}\n`,
    );
    await writePrivateNewFile(paths.markdownOutput, renderMarkdown(report));
  } catch {
    console.error(
      "OAuth security audit completed but a requested private output could not be written.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `OAuth pending-state security audit ${report.overall_status.toUpperCase()}.`,
  );
  if (report.overall_status !== "pass") process.exitCode = 1;
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
