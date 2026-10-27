#!/usr/bin/env node
/**
 * Read-only metadata audit for the private Circles Supabase PostgreSQL schema.
 *
 * This tool intentionally never reads application rows or emits connection,
 * credential, token, fingerprint, or raw database-error material.  It uses
 * catalog metadata plus bounded `SELECT 1 ... LIMIT 1` permission probes only.
 *
 * Example (run with the real secret injected only in the Circles runtime cwd):
 *   node /home/ubuntu/circles-production-operations-20261022/security/circles-supabase-security-audit.mjs \
 *     --project-dir /home/ubuntu/circles \
 *     --json-output /home/ubuntu/circles-production-operations-20261022/security/circles-supabase-security-audit.json \
 *     --markdown-output /home/ubuntu/circles-production-operations-20261022/security/circles-supabase-security-audit.md
 */
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath, unlink } from "node:fs/promises";
import {
  ADMIN_FUNCTION_CONTRACT_VARIANTS,
  ADMIN_SCHEMA,
  ADMIN_TABLE_EXPECTATIONS,
  APP_LOGIN_CONTRACT_VARIANTS,
  APP_LOGIN_ROLE,
  APPLICATION_ADMIN_ACL,
  POLICY_CONTRACT_VARIANTS,
  REVIEWED_ADMIN_ROLE_NAMES,
  REVIEWED_ROLE_EXPECTATIONS,
  REVIEWED_ROLE_MEMBERSHIPS,
} from "./circles-database-security-contract.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_PROJECT_DIR = "/home/ubuntu/circles";
const PROJECT_REF = "vvclcsqletcxzoaayqzq";
const SCHEMA = "circles_app";
const MARKER_TABLE = "_dataMigrations";
const EXTERNAL_ROLES = Object.freeze(["anon", "authenticated", "service_role"]);
const TABLE_PRIVILEGES = Object.freeze([
  "can_select",
  "can_insert",
  "can_update",
  "can_delete",
  "can_truncate",
  "can_references",
  "can_trigger",
  "can_maintain",
]);
const COLUMN_PRIVILEGES = Object.freeze([
  "can_select",
  "can_insert",
  "can_update",
  "can_references",
]);
const SEQUENCE_PRIVILEGES = Object.freeze([
  "can_usage",
  "can_select",
  "can_update",
]);
const ROUTINE_PRIVILEGES = Object.freeze(["can_execute"]);
const DEFAULT_OBJECT_TYPES = Object.freeze([
  "tables",
  "sequences",
  "functions",
  "types",
]);
// These are the reviewed database owner/admin actors that intentionally need
// SET ROLE access to the restricted backend role. Do not infer trust from role
// attributes, ownership, or a role-name pattern.
const TRUSTED_RUNTIME_SET_ROLE_ACTORS = Object.freeze([
  "postgres",
  "supabase_admin",
  APP_LOGIN_ROLE,
]);
// These exact names are a narrowly reviewed provider/admin exception for
// effective-capability reporting only. They are not API roles and do not make
// an inherited has_*_privilege result proof of a row-returning RLS/API path.
// Do not broaden this list from role attributes or a naming convention.
const REVIEWED_BUILTIN_CAPABILITY_ROLES = Object.freeze([
  "pg_read_all_data",
  "pg_write_all_data",
  "pg_maintain",
]);
const REVIEWED_PROVIDER_SUPERUSER_ROLES = Object.freeze(["supabase_admin"]);
const REVIEWED_MANAGED_ADMIN_ROLES = Object.freeze([
  "supabase_etl_admin",
  "supabase_read_only_user",
]);
const TRUSTED_PRIVILEGED_ROLE_NAMES = Object.freeze([
  "postgres",
  ...REVIEWED_BUILTIN_CAPABILITY_ROLES,
  ...REVIEWED_PROVIDER_SUPERUSER_ROLES,
  ...REVIEWED_MANAGED_ADMIN_ROLES,
]);
const REQUIRED_RUNTIME_FLAGS = Object.freeze({
  can_login: false,
  inherits: false,
  is_superuser: false,
  bypasses_rls: false,
});

function absoluteOutputPath(value) {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function pathIsWithin(childPath, parentPath) {
  const pathRelation = relative(parentPath, childPath);
  return (
    pathRelation === "" ||
    (!pathRelation.startsWith("..") && !isAbsolute(pathRelation))
  );
}

async function rejectSymlinkPathComponents(pathname) {
  const absolute = resolve(pathname);
  const parsed = parse(absolute);
  const components = relative(parsed.root, absolute).split(sep).filter(Boolean);
  let current = parsed.root;
  for (const component of components) {
    current = join(current, component);
    const entry = await lstat(current);
    if (entry.isSymbolicLink())
      throw new Error("Audit output paths must not traverse symbolic links");
  }
}

async function gitRootForPath(pathname) {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", pathname, "rev-parse", "--show-toplevel"],
    { timeout: 5_000, maxBuffer: 4_096 },
  );
  return realpath(stdout.trim());
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
      ["--project-dir", "--json-output", "--markdown-output"].includes(argument)
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error("Invalid audit command arguments");
      index += 1;
      if (argument === "--project-dir") options.projectDir = resolve(value);
      if (argument === "--json-output")
        options.jsonOutput = absoluteOutputPath(value);
      if (argument === "--markdown-output")
        options.markdownOutput = absoluteOutputPath(value);
      continue;
    }
    throw new Error("Invalid audit command arguments");
  }
  return options;
}

/**
 * Validate new report destinations using metadata only. Output files themselves
 * are never opened/read during validation, and must be distinct, private,
 * non-Git-tree paths whose existing parent has no symlink component.
 */
export async function validateOutputPaths(options) {
  if (!options?.jsonOutput || !options?.markdownOutput)
    throw new Error("Both JSON and Markdown output paths are required");
  const projectDir = await realpath(
    resolve(options.projectDir ?? DEFAULT_PROJECT_DIR),
  );
  const gitRoot = await gitRootForPath(projectDir);
  const canonicalOutputs = [];
  for (const requested of [options.jsonOutput, options.markdownOutput]) {
    const lexical = resolve(requested);
    const lexicalParent = dirname(lexical);
    await rejectSymlinkPathComponents(lexicalParent);
    const parent = await realpath(lexicalParent);
    const parentStat = await lstat(parent);
    if (
      !parentStat.isDirectory() ||
      (parentStat.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" &&
        parentStat.uid !== process.getuid())
    ) {
      throw new Error(
        "Audit output directory must be private and owner-controlled",
      );
    }
    const output = resolve(parent, basename(lexical));
    if (pathIsWithin(output, gitRoot))
      throw new Error("Audit outputs must be outside the project Git tree");
    const outputGitRoot = await gitRootForPath(parent).catch(() => null);
    if (outputGitRoot && pathIsWithin(output, outputGitRoot))
      throw new Error("Audit outputs must be outside every Git tree");
    try {
      await lstat(output);
      throw new Error("Refusing to overwrite an existing audit output");
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ENOENT") {
        throw new Error("Refusing an existing or unavailable audit output");
      }
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

export async function writePrivateNewFile(outputPath, content) {
  let handle;
  let completed = false;
  try {
    handle = await open(
      outputPath,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_NOFOLLOW,
      0o600,
    );
    await handle.chmod(0o600);
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      (stat.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())
    ) {
      throw new Error("Audit output is not a private owner-controlled file");
    }
    await handle.writeFile(content, { encoding: "utf8" });
    completed = true;
  } finally {
    if (handle) await handle.close();
    if (handle && !completed) {
      try {
        await unlink(outputPath);
      } catch {
        // The caller receives a safe generic write failure; no private content is read.
      }
    }
  }
}

async function writePrivateReportPair(paths, json, markdown) {
  let jsonWritten = false;
  try {
    await writePrivateNewFile(paths.jsonOutput, json);
    jsonWritten = true;
    await writePrivateNewFile(paths.markdownOutput, markdown);
  } catch {
    if (jsonWritten) {
      try {
        await unlink(paths.jsonOutput);
      } catch {
        // Best-effort cleanup is safer than reading or overwriting the report.
      }
    }
    throw new Error("Private report output failed");
  }
}

export function normalizeExpression(expression) {
  if (expression === null || expression === undefined) return null;
  return String(expression)
    .replaceAll(/\s+/g, "")
    .replaceAll(/^\(+|\)+$/g, "")
    .toLowerCase();
}

function normalizedRoles(roles) {
  if (Array.isArray(roles)) return [...roles].sort();
  // node-postgres may return PostgreSQL's name[] catalog type as a literal
  // rather than a JavaScript array. Policy role names in this audit are simple
  // role identifiers, so this bounded parser preserves the exact identifiers.
  if (
    typeof roles === "string" &&
    roles.startsWith("{") &&
    roles.endsWith("}")
  ) {
    const contents = roles.slice(1, -1);
    return contents === ""
      ? []
      : contents
          .split(",")
          .map((role) => role.replaceAll('"', ""))
          .sort();
  }
  if (typeof roles === "string" && roles.length > 0) return [roles];
  return [];
}

function isTrueExpression(expression) {
  return normalizeExpression(expression) === "true";
}

function hasExactRuntimeRole(roles, runtimeRole) {
  const normalized = normalizedRoles(roles);
  return normalized.length === 1 && normalized[0] === runtimeRole;
}

function checkContext(context) {
  return {
    source_tree: context.sourceTree,
    date_utc: context.executedAt,
    target: context.target,
  };
}

function makeCheck(context, name, status, summary, evidence = {}) {
  return { name, status, summary, ...checkContext(context), evidence };
}

export function evaluateInventory(expectedNames, tableRows) {
  const actualNames = tableRows.map((row) => row.table_name).sort();
  const expected = [...expectedNames].sort();
  const missing = expected.filter((name) => !actualNames.includes(name));
  const unexpected = actualNames.filter((name) => !expected.includes(name));
  const duplicates = actualNames.filter(
    (name, index) => actualNames.indexOf(name) !== index,
  );
  return {
    status:
      missing.length === 0 && unexpected.length === 0 && duplicates.length === 0
        ? "pass"
        : "fail",
    missing,
    unexpected,
    duplicates: [...new Set(duplicates)],
    expected_count: expected.length,
    actual_count: actualNames.length,
  };
}

export function evaluateRls(expectedNames, tableRows) {
  const byName = new Map(tableRows.map((row) => [row.table_name, row]));
  const missing_or_disabled = expectedNames.filter(
    (name) => byName.get(name)?.rls_enabled !== true,
  );
  return {
    status: missing_or_disabled.length === 0 ? "pass" : "fail",
    missing_or_disabled,
  };
}

export function evaluatePolicies(
  expectedAppNames,
  markerTable,
  policies,
  runtimeRole,
) {
  const byTable = new Map();
  for (const policy of policies) {
    const existing = byTable.get(policy.table_name) ?? [];
    existing.push(policy);
    byTable.set(policy.table_name, existing);
  }
  const violations = [];
  for (const tableName of expectedAppNames) {
    const tablePolicies = byTable.get(tableName) ?? [];
    const valid =
      tablePolicies.length === 1 &&
      tablePolicies.every(
        (policy) =>
          policy.command === "ALL" &&
          hasExactRuntimeRole(policy.roles, runtimeRole) &&
          isTrueExpression(policy.using_qualification) &&
          isTrueExpression(policy.with_check_qualification),
      );
    if (!valid) violations.push(tableName);
  }
  const markerPolicies = byTable.get(markerTable) ?? [];
  const markerValid =
    markerPolicies.length === 1 &&
    markerPolicies.every(
      (policy) =>
        policy.command === "SELECT" &&
        hasExactRuntimeRole(policy.roles, runtimeRole) &&
        isTrueExpression(policy.using_qualification) &&
        policy.with_check_qualification === null,
    );
  if (!markerValid) violations.push(markerTable);
  const expectedNames = new Set([...expectedAppNames, markerTable]);
  for (const tableName of byTable.keys()) {
    if (!expectedNames.has(tableName)) violations.push(tableName);
  }
  return {
    status: violations.length === 0 ? "pass" : "fail",
    policy_violations: [...new Set(violations)].sort(),
  };
}

function stableFingerprint(value) {
  if (Array.isArray(value))
    return `[${value.map((entry) => stableFingerprint(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableFingerprint(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function exactRows(actualRows, expectedRows, project = (row) => row) {
  if (!Array.isArray(actualRows) || !Array.isArray(expectedRows))
    return { status: "fail", reason: "evidence_unavailable" };
  const actual = actualRows.map(project);
  if (actual.some((row) => row === null))
    return { status: "fail", reason: "evidence_malformed" };
  const expected = expectedRows.map(project);
  const actualKeys = actual.map(stableFingerprint).sort();
  const expectedKeys = expected.map(stableFingerprint).sort();
  const duplicateActual = actualKeys.some(
    (key, index) => index > 0 && key === actualKeys[index - 1],
  );
  const missing = expectedKeys.filter((key) => !actualKeys.includes(key));
  const unexpected = actualKeys.filter((key) => !expectedKeys.includes(key));
  return {
    status:
      !duplicateActual && missing.length === 0 && unexpected.length === 0
        ? "pass"
        : "fail",
    expected_count: expectedKeys.length,
    actual_count: actualKeys.length,
    duplicate_actual_rows: duplicateActual,
    missing_count: missing.length,
    unexpected_count: unexpected.length,
  };
}

function normalizePolicyForContract(policy) {
  if (
    !policy ||
    typeof policy.schema_name !== "string" ||
    typeof policy.table_name !== "string" ||
    typeof policy.policy_name !== "string" ||
    !["PERMISSIVE", "RESTRICTIVE"].includes(policy.permissive) ||
    typeof policy.command !== "string"
  ) {
    return null;
  }
  const roles = normalizedRoles(policy.roles);
  if (roles.length === 0) return null;
  const usingQualification = normalizeExpression(policy.using_qualification);
  const withCheckQualification = normalizeExpression(
    policy.with_check_qualification,
  );
  if (
    (policy.using_qualification !== null && usingQualification === null) ||
    (policy.with_check_qualification !== null &&
      withCheckQualification === null)
  ) {
    return null;
  }
  return {
    schema_name: policy.schema_name,
    table_name: policy.table_name,
    policy_name: policy.policy_name,
    permissive: policy.permissive,
    roles,
    command: policy.command,
    using_qualification: usingQualification,
    with_check_qualification: withCheckQualification,
  };
}

function evaluateNamedVariants(actualRows, variants, project = (row) => row) {
  if (!actualRows || typeof actualRows[Symbol.iterator] !== "function")
    return { status: "fail", reason: "evidence_unavailable" };
  const normalized = [...actualRows].map(project);
  if (normalized.some((row) => row === null))
    return { status: "fail", reason: "evidence_malformed" };
  const actualKeys = normalized.map(stableFingerprint).sort();
  if (
    actualKeys.some((key, index) => index > 0 && key === actualKeys[index - 1])
  ) {
    return { status: "fail", reason: "duplicate_actual_evidence" };
  }
  const validVariants = [];
  for (const [variant, expectedRows] of Object.entries(variants ?? {})) {
    if (!Array.isArray(expectedRows)) continue;
    const expected = expectedRows.map(project);
    if (expected.some((row) => row === null)) continue;
    const expectedKeys = expected.map(stableFingerprint).sort();
    if (
      expectedKeys.length === actualKeys.length &&
      expectedKeys.every((key, index) => key === actualKeys[index])
    ) {
      validVariants.push(variant);
    }
  }
  return {
    status: validVariants.length === 1 ? "pass" : "fail",
    matched_variant: validVariants.length === 1 ? validVariants[0] : null,
    actual_count: actualKeys.length,
    accepted_variants: Object.keys(variants ?? {}).sort(),
  };
}

/**
 * Accept only a complete named policy state. This intentionally does not allow
 * a caller to remove an arbitrary subset of the DB-09 duplicate policy pairs.
 */
export function evaluateAppAdminPolicies(policies) {
  return evaluateNamedVariants(
    policies,
    POLICY_CONTRACT_VARIANTS,
    normalizePolicyForContract,
  );
}

function projectedAdminFunction(row) {
  if (
    !row ||
    typeof row.function_name !== "string" ||
    typeof row.owner !== "string" ||
    typeof row.security_definer !== "boolean" ||
    typeof row.has_explicit_search_path !== "boolean" ||
    typeof row.search_path_pg_catalog_first !== "boolean" ||
    typeof row.anon_execute !== "boolean" ||
    typeof row.authenticated_execute !== "boolean" ||
    typeof row.runtime_execute !== "boolean"
  ) {
    return null;
  }
  return {
    function_name: row.function_name,
    owner: row.owner,
    security_definer: row.security_definer,
    has_explicit_search_path: row.has_explicit_search_path,
    search_path_pg_catalog_first: row.search_path_pg_catalog_first,
    anon_execute: row.anon_execute,
    authenticated_execute: row.authenticated_execute,
    runtime_execute: row.runtime_execute,
  };
}

function reviewedRoleRows(rows) {
  if (!Array.isArray(rows)) return null;
  return rows.filter((row) =>
    REVIEWED_ROLE_EXPECTATIONS.some(
      (expected) => expected.role_name === row?.role_name,
    ),
  );
}

function projectedReviewedRole(row) {
  if (
    !row ||
    typeof row.role_name !== "string" ||
    typeof row.can_login !== "boolean" ||
    typeof row.inherits !== "boolean" ||
    typeof row.is_superuser !== "boolean" ||
    typeof row.bypasses_rls !== "boolean"
  ) {
    return null;
  }
  return {
    role_name: row.role_name,
    can_login: row.can_login,
    inherits: row.inherits,
    is_superuser: row.is_superuser,
    bypasses_rls: row.bypasses_rls,
  };
}

function reviewedMembershipRows(rows) {
  if (!Array.isArray(rows)) return null;
  const roleNames = new Set(
    REVIEWED_ROLE_EXPECTATIONS.map((row) => row.role_name),
  );
  return rows.filter(
    (row) =>
      (roleNames.has(row?.parent_role) || roleNames.has(row?.member_role)) &&
      row?.parent_role !== APP_LOGIN_ROLE &&
      row?.member_role !== APP_LOGIN_ROLE,
  );
}

function reviewedAdminAclRows(rows) {
  if (!Array.isArray(rows)) return null;
  return rows.filter((row) => REVIEWED_ADMIN_ROLE_NAMES.includes(row?.grantee));
}

function appLoginRoleRows(rows) {
  if (!Array.isArray(rows)) return null;
  return rows.filter((row) => row?.role_name === APP_LOGIN_ROLE);
}

function projectedAppLoginRole(row) {
  if (
    !row ||
    row.role_name !== APP_LOGIN_ROLE ||
    typeof row.can_login !== "boolean" ||
    typeof row.inherits !== "boolean" ||
    typeof row.is_superuser !== "boolean" ||
    typeof row.can_create_db !== "boolean" ||
    typeof row.can_create_role !== "boolean" ||
    typeof row.bypasses_rls !== "boolean" ||
    typeof row.can_replicate !== "boolean"
  ) {
    return null;
  }
  return {
    role_name: row.role_name,
    can_login: row.can_login,
    inherits: row.inherits,
    is_superuser: row.is_superuser,
    can_create_db: row.can_create_db,
    can_create_role: row.can_create_role,
    bypasses_rls: row.bypasses_rls,
    can_replicate: row.can_replicate,
  };
}

function appLoginMembershipRows(rows) {
  if (!Array.isArray(rows)) return null;
  return rows.filter(
    (row) =>
      row?.parent_role === APP_LOGIN_ROLE ||
      row?.member_role === APP_LOGIN_ROLE,
  );
}

function projectedAppLoginMembership(row) {
  if (
    !row ||
    typeof row.parent_role !== "string" ||
    typeof row.member_role !== "string" ||
    typeof row.grantor_role !== "string" ||
    typeof row.inherit_option !== "boolean" ||
    typeof row.set_option !== "boolean" ||
    typeof row.admin_option !== "boolean"
  ) {
    return null;
  }
  return {
    parent_role: row.parent_role,
    member_role: row.member_role,
    grantor_role: row.grantor_role,
    inherit_option: row.inherit_option,
    set_option: row.set_option,
    admin_option: row.admin_option,
  };
}

function appLoginDirectObjectAclRows(evidence) {
  const objectSources = [
    ["schema", evidence?.schema_acl_privileges, "schema_name"],
    ["table", evidence?.table_acl_privileges, "table_name"],
    ["column", evidence?.column_acl_privileges, "column_key"],
    ["sequence", evidence?.sequence_acl_privileges, "sequence_name"],
    ["routine", evidence?.routine_acl_privileges, "routine_name"],
  ];
  if (!objectSources.every(([, rows]) => Array.isArray(rows))) return null;
  return objectSources.flatMap(([object_type, rows, object_key]) =>
    rows
      .filter((row) => row?.grantee === APP_LOGIN_ROLE)
      .map((row) => ({ object_type, object_key, ...row })),
  );
}

function projectedAppLoginDirectObjectAcl(row) {
  if (
    !row ||
    !["schema", "table", "column", "sequence", "routine"].includes(
      row.object_type,
    ) ||
    typeof row.object_key !== "string" ||
    typeof row[row.object_key] !== "string" ||
    typeof row.owner !== "string" ||
    row.grantee !== APP_LOGIN_ROLE ||
    typeof row.privilege_type !== "string" ||
    typeof row.is_grantable !== "boolean"
  ) {
    return null;
  }
  return {
    object_type: row.object_type,
    object_name: row[row.object_key],
    owner: row.owner,
    grantee: row.grantee,
    privilege_type: row.privilege_type,
    is_grantable: row.is_grantable,
  };
}

function appLoginAuthorizationState(evidence) {
  const roles = appLoginRoleRows(evidence?.roles);
  const memberships = appLoginMembershipRows(evidence?.role_memberships);
  const directObjectAcl = appLoginDirectObjectAclRows(evidence);
  if (!roles || !memberships || !directObjectAcl) return null;
  const projectedRoles = roles.map(projectedAppLoginRole);
  const projectedMemberships = memberships.map(projectedAppLoginMembership);
  const projectedDirectObjectAcl = directObjectAcl.map(
    projectedAppLoginDirectObjectAcl,
  );
  if (
    projectedRoles.some((row) => row === null) ||
    projectedMemberships.some((row) => row === null) ||
    projectedDirectObjectAcl.some((row) => row === null)
  ) {
    return null;
  }
  return {
    roles: projectedRoles,
    memberships: projectedMemberships,
    direct_object_acl: projectedDirectObjectAcl,
  };
}

/**
 * DB-02 accepts only the historical baseline or one whole named provisioning
 * state. PUBLIC is cataloged independently; it is never attributed as a direct
 * grant to circles_app_login.
 */
export function evaluateAppLoginAuthorizationContract(appEvidence) {
  const state = appLoginAuthorizationState(appEvidence);
  return evaluateNamedVariants(
    state === null ? null : [state],
    Object.fromEntries(
      Object.entries(APP_LOGIN_CONTRACT_VARIANTS).map(([name, variant]) => [
        name,
        [variant],
      ]),
    ),
  );
}

function projectedAdminTable(row) {
  if (
    !row ||
    typeof row.table_name !== "string" ||
    typeof row.owner !== "string" ||
    typeof row.rls_enabled !== "boolean" ||
    typeof row.rls_forced !== "boolean"
  ) {
    return null;
  }
  return {
    table_name: row.table_name,
    owner: row.owner,
    rls_enabled: row.rls_enabled,
    rls_forced: row.rls_forced,
  };
}

/**
 * Verify the separately reviewed admin surface exactly. All other roles remain
 * subject to the existing generic non-owner privilege failure path.
 */
export function evaluateAdminAuthorizationContract(appEvidence, adminEvidence) {
  if (!appEvidence || !adminEvidence)
    return { status: "fail", reason: "admin_contract_evidence_unavailable" };
  const checks = {
    role_flags: exactRows(
      reviewedRoleRows(appEvidence.roles),
      REVIEWED_ROLE_EXPECTATIONS,
      projectedReviewedRole,
    ),
    role_memberships: exactRows(
      reviewedMembershipRows(appEvidence.role_memberships),
      REVIEWED_ROLE_MEMBERSHIPS,
    ),
    application_schema_acl: exactRows(
      reviewedAdminAclRows(appEvidence.schema_acl_privileges),
      APPLICATION_ADMIN_ACL.schema,
    ),
    application_table_acl: exactRows(
      reviewedAdminAclRows(appEvidence.table_acl_privileges),
      APPLICATION_ADMIN_ACL.tables,
    ),
    application_column_acl: exactRows(
      reviewedAdminAclRows(appEvidence.column_acl_privileges),
      APPLICATION_ADMIN_ACL.columns,
    ),
    application_sequence_acl: exactRows(
      reviewedAdminAclRows(appEvidence.sequence_acl_privileges),
      APPLICATION_ADMIN_ACL.sequences,
    ),
    application_routine_acl: exactRows(
      reviewedAdminAclRows(appEvidence.routine_acl_privileges),
      APPLICATION_ADMIN_ACL.routines,
    ),
    admin_table_inventory: exactRows(
      adminEvidence.raw_tables,
      ADMIN_TABLE_EXPECTATIONS,
      projectedAdminTable,
    ),
    admin_functions: evaluateNamedVariants(
      adminEvidence.functions,
      ADMIN_FUNCTION_CONTRACT_VARIANTS,
      projectedAdminFunction,
    ),
  };
  const failed_checks = Object.entries(checks)
    .filter(([, result]) => result.status !== "pass")
    .map(([name]) => name);
  return {
    status: failed_checks.length === 0 ? "pass" : "fail",
    failed_checks,
    checks,
  };
}

function withoutReviewedContractRoleEvidence(evidence) {
  const isReviewedContractRole = (roleName) =>
    REVIEWED_ADMIN_ROLE_NAMES.includes(roleName) || roleName === APP_LOGIN_ROLE;
  return {
    ...evidence,
    roles: evidence.roles?.filter(
      (row) => !isReviewedContractRole(row.role_name),
    ),
    role_memberships: evidence.role_memberships?.filter(
      (row) =>
        !isReviewedContractRole(row.parent_role) &&
        !isReviewedContractRole(row.member_role),
    ),
    schema_privileges: evidence.schema_privileges?.filter(
      (row) => !isReviewedContractRole(row.role_name),
    ),
    table_privileges: evidence.table_privileges?.filter(
      (row) => !isReviewedContractRole(row.role_name),
    ),
    column_privileges: evidence.column_privileges?.filter(
      (row) => !isReviewedContractRole(row.role_name),
    ),
    sequence_privileges: evidence.sequence_privileges?.filter(
      (row) => !isReviewedContractRole(row.role_name),
    ),
    routine_privileges: evidence.routine_privileges?.filter(
      (row) => !isReviewedContractRole(row.role_name),
    ),
    schema_acl_privileges: evidence.schema_acl_privileges?.filter(
      (row) => !isReviewedContractRole(row.grantee),
    ),
    table_acl_privileges: evidence.table_acl_privileges?.filter(
      (row) => !isReviewedContractRole(row.grantee),
    ),
    column_acl_privileges: evidence.column_acl_privileges?.filter(
      (row) => !isReviewedContractRole(row.grantee),
    ),
    sequence_acl_privileges: evidence.sequence_acl_privileges?.filter(
      (row) => !isReviewedContractRole(row.grantee),
    ),
    routine_acl_privileges: evidence.routine_acl_privileges?.filter(
      (row) => !isReviewedContractRole(row.grantee),
    ),
  };
}

export function evaluateRuntimeRole(roleRow, memberships = []) {
  const violations = [];
  if (!roleRow) return { status: "fail", violations: ["runtime_role_missing"] };
  if (roleRow.role_name !== "circles_app_runtime")
    violations.push("runtime_role_identity");
  for (const [key, expected] of Object.entries(REQUIRED_RUNTIME_FLAGS)) {
    if (roleRow[key] !== expected) violations.push(key);
  }
  if (!Array.isArray(memberships)) {
    violations.push("membership_evidence_unavailable");
  } else if (
    memberships.some(
      (membership) =>
        !membership ||
        typeof membership.parent_role !== "string" ||
        membership.parent_role.length === 0 ||
        typeof membership.member_role !== "string" ||
        membership.member_role.length === 0 ||
        typeof membership.grantor_role !== "string" ||
        membership.grantor_role.length === 0 ||
        typeof membership.inherit_option !== "boolean" ||
        typeof membership.set_option !== "boolean" ||
        typeof membership.admin_option !== "boolean",
    )
  ) {
    violations.push("membership_evidence_malformed");
  } else {
    const inboundRuntimeMemberships = new Map();
    for (const membership of memberships) {
      // The restricted runtime role must never be a member of another role.
      if (membership.member_role === "circles_app_runtime")
        violations.push("runtime_role_membership_elevation");
      // A grant of the runtime role to a reviewed actor is the intentional
      // server-side SET ROLE path. PostgreSQL 17 can retain independent grants
      // for the same logical pair, so evaluate their effective SET option.
      if (membership.parent_role === "circles_app_runtime") {
        const entries =
          inboundRuntimeMemberships.get(membership.member_role) ?? [];
        entries.push(membership);
        inboundRuntimeMemberships.set(membership.member_role, entries);
      }
    }
    for (const [memberRole, entries] of inboundRuntimeMemberships) {
      if (!TRUSTED_RUNTIME_SET_ROLE_ACTORS.includes(memberRole)) {
        violations.push("runtime_role_membership_untrusted_set_role_actor");
      } else if (!entries.some((membership) => membership.set_option)) {
        violations.push("runtime_role_membership_set_role_not_permitted");
      }
    }
  }
  const distinctViolations = [...new Set(violations)];
  return {
    status: distinctViolations.length === 0 ? "pass" : "fail",
    violations: distinctViolations,
  };
}

function uniqueRoleNames(roles) {
  if (!Array.isArray(roles) || roles.length === 0) return null;
  const names = roles.map((role) => role?.role_name);
  if (!names.every((name) => typeof name === "string" && name.length > 0))
    return null;
  return new Set(names).size === names.length ? names : null;
}

function objectRowsAreValid(rows, nameKey) {
  return (
    Array.isArray(rows) &&
    rows.every(
      (row) =>
        row &&
        typeof row[nameKey] === "string" &&
        row[nameKey].length > 0 &&
        typeof row.owner === "string" &&
        row.owner.length > 0,
    )
  );
}

function membershipCoverage(rows, roleNames) {
  if (!Array.isArray(rows))
    return { complete: false, reason: "missing_membership_evidence" };
  const knownRoles = new Set(roleNames);
  const edges = new Set();
  for (const row of rows) {
    if (
      !row ||
      typeof row.parent_role !== "string" ||
      typeof row.member_role !== "string" ||
      typeof row.grantor_role !== "string" ||
      !knownRoles.has(row.parent_role) ||
      !knownRoles.has(row.member_role) ||
      !knownRoles.has(row.grantor_role) ||
      typeof row.inherit_option !== "boolean" ||
      typeof row.set_option !== "boolean" ||
      typeof row.admin_option !== "boolean"
    ) {
      return { complete: false, reason: "malformed_membership_evidence" };
    }
    // PostgreSQL 17 permits more than one grantor for one role/member pair.
    // Preserve those independent option records; only an exact duplicate is
    // evidence corruption or a collector defect.
    const evidenceKey = `${row.parent_role}\u0000${row.member_role}\u0000${row.grantor_role}\u0000${row.inherit_option}\u0000${row.set_option}\u0000${row.admin_option}`;
    if (edges.has(evidenceKey))
      return { complete: false, reason: "duplicate_membership_evidence" };
    edges.add(evidenceKey);
  }
  return { complete: true };
}

function reviewedRoleClassification(roleName, rolesByName) {
  const role = rolesByName.get(roleName);
  if (REVIEWED_BUILTIN_CAPABILITY_ROLES.includes(roleName)) {
    // The collector records the catalog-object identity where PostgreSQL makes
    // it available. A non-login role is required even if older fixture data
    // lacks that optional catalog marker.
    const catalogIdentityAvailable =
      typeof role?.is_catalog_builtin === "boolean";
    const valid =
      role?.can_login === false &&
      (!catalogIdentityAvailable || role.is_catalog_builtin === true);
    return {
      group: "builtin_non_login_capabilities",
      classification: "reviewed_builtin_non_login_capability",
      valid,
      identity_check: valid
        ? catalogIdentityAvailable
          ? "catalog_builtin_and_nologin_confirmed"
          : "catalog_builtin_identity_unavailable_nologin_confirmed"
        : "builtin_identity_or_nologin_requirement_failed",
    };
  }
  if (REVIEWED_PROVIDER_SUPERUSER_ROLES.includes(roleName)) {
    const valid = role?.is_superuser === true;
    return {
      group: "provider_superuser",
      classification: "reviewed_provider_superuser",
      valid,
      identity_check: valid
        ? "provider_superuser_confirmed"
        : "provider_superuser_requirement_failed",
    };
  }
  if (REVIEWED_MANAGED_ADMIN_ROLES.includes(roleName)) {
    return {
      group: "managed_admin_roles",
      classification: "reviewed_managed_admin_role",
      valid: Boolean(role),
      identity_check: role
        ? "exact_reviewed_managed_admin_name"
        : "reviewed_managed_admin_role_missing",
    };
  }
  return null;
}

function unsafePrivilegedMembershipPaths(memberships) {
  const trusted = new Set(TRUSTED_PRIVILEGED_ROLE_NAMES);
  const childrenByParent = new Map();
  for (const membership of memberships) {
    const children = childrenByParent.get(membership.parent_role) ?? [];
    children.push(membership);
    childrenByParent.set(membership.parent_role, children);
  }
  const paths = [];
  for (const privilegedRole of TRUSTED_PRIVILEGED_ROLE_NAMES) {
    const queue = [
      { role: privilegedRole, rolePath: [privilegedRole], edgePath: [] },
    ];
    const seen = new Set([`${privilegedRole}\u0000${privilegedRole}`]);
    while (queue.length > 0) {
      const current = queue.shift();
      for (const membership of childrenByParent.get(current.role) ?? []) {
        const rolePath = [...current.rolePath, membership.member_role];
        const edgePath = [
          ...current.edgePath,
          {
            parent_role: membership.parent_role,
            member_role: membership.member_role,
            inherit_option: membership.inherit_option,
            set_option: membership.set_option,
            admin_option: membership.admin_option,
          },
        ];
        if (!trusted.has(membership.member_role)) {
          // Do not treat NOINHERIT or a false SET option as a safe exception:
          // the graph is checked for every inherit/SET combination and for
          // transitive paths, so a later option change cannot hide a grant.
          paths.push({
            privileged_role: privilegedRole,
            recipient_role: membership.member_role,
            role_path: rolePath,
            membership_path: edgePath,
          });
          continue;
        }
        const seenKey = `${privilegedRole}\u0000${membership.member_role}`;
        if (!seen.has(seenKey)) {
          seen.add(seenKey);
          queue.push({ role: membership.member_role, rolePath, edgePath });
        }
      }
    }
  }
  return paths;
}

function runtimeObjectCoverage(rows, objects, objectKey, privilegeKeys) {
  if (!Array.isArray(rows) || !objectRowsAreValid(objects, objectKey))
    return { complete: false, reason: "missing_or_malformed_runtime_matrix" };
  const expected = new Set();
  for (const object of objects) {
    if (expected.has(object[objectKey]))
      return { complete: false, reason: "duplicate_runtime_object_metadata" };
    expected.add(object[objectKey]);
  }
  const seen = new Set();
  for (const row of rows) {
    if (
      !row ||
      typeof row[objectKey] !== "string" ||
      !expected.has(row[objectKey]) ||
      !privilegeKeys.every((key) => typeof row[key] === "boolean")
    ) {
      return { complete: false, reason: "malformed_runtime_privilege_row" };
    }
    if (seen.has(row[objectKey]))
      return { complete: false, reason: "duplicate_runtime_privilege_row" };
    seen.add(row[objectKey]);
  }
  if (seen.size !== expected.size)
    return { complete: false, reason: "incomplete_runtime_privilege_matrix" };
  return { complete: true };
}

function matrixCoverage(rows, objects, roleNames, objectKey, privilegeKeys) {
  if (!Array.isArray(rows) || !objectRowsAreValid(objects, objectKey))
    return { complete: false, reason: "missing_or_malformed_matrix" };
  const objectByName = new Map();
  for (const object of objects) {
    if (objectByName.has(object[objectKey]))
      return { complete: false, reason: "duplicate_object_metadata" };
    objectByName.set(object[objectKey], object);
  }
  const expected = new Set();
  for (const object of objects) {
    for (const roleName of roleNames) {
      if (roleName !== object.owner)
        expected.add(`${object[objectKey]}\u0000${roleName}`);
    }
  }
  const seen = new Set();
  for (const row of rows) {
    if (
      !row ||
      typeof row[objectKey] !== "string" ||
      typeof row.role_name !== "string" ||
      !privilegeKeys.every((key) => typeof row[key] === "boolean")
    ) {
      return { complete: false, reason: "malformed_privilege_row" };
    }
    const key = `${row[objectKey]}\u0000${row.role_name}`;
    if (!expected.has(key) || seen.has(key))
      return {
        complete: false,
        reason: "unexpected_or_duplicate_privilege_row",
      };
    seen.add(key);
  }
  if (seen.size !== expected.size)
    return { complete: false, reason: "incomplete_privilege_matrix" };
  return { complete: true };
}

function aclCoverage(rows, objects, objectKey) {
  if (!Array.isArray(rows) || !objectRowsAreValid(objects, objectKey))
    return { complete: false, reason: "missing_or_malformed_acl_metadata" };
  const objectNames = new Set(objects.map((object) => object[objectKey]));
  const violations = [];
  for (const row of rows) {
    if (
      !row ||
      typeof row[objectKey] !== "string" ||
      !objectNames.has(row[objectKey]) ||
      typeof row.grantee !== "string" ||
      typeof row.privilege_type !== "string" ||
      typeof row.is_grantable !== "boolean"
    ) {
      return { complete: false, reason: "malformed_acl_row" };
    }
    const owner = objects.find(
      (object) => object[objectKey] === row[objectKey],
    )?.owner;
    if (row.grantee !== owner && row.grantee !== "circles_app_runtime") {
      violations.push({
        object_name: row[objectKey],
        grantee: row.grantee,
        privilege_type: row.privilege_type,
        grantable: row.is_grantable,
      });
    } else if (row.grantee === "circles_app_runtime" && row.is_grantable) {
      violations.push({
        object_name: row[objectKey],
        grantee: row.grantee,
        privilege_type: row.privilege_type,
        grantable: true,
      });
    }
  }
  return { complete: true, violations };
}

/**
 * Fail closed unless every non-owner role has been evaluated for every current
 * object. PostgreSQL has_*_privilege resolves PUBLIC and inherited membership,
 * while direct ACL rows retain grant-option and PUBLIC attribution evidence.
 */
export function evaluateExternalPrivileges(evidence) {
  if (!evidence || typeof evidence !== "object")
    return { status: "fail", reason: "privilege_evidence_unavailable" };
  const roleNames = uniqueRoleNames(evidence.roles);
  const schemaObject = evidence.schema?.schema_name
    ? [
        {
          schema_name: evidence.schema.schema_name,
          owner: evidence.schema.owner,
        },
      ]
    : null;
  const tableObjects = evidence.tables;
  const columnObjects = evidence.columns;
  const sequenceObjects = evidence.sequences;
  const routineObjects = evidence.routines;
  if (
    !roleNames ||
    !schemaObject ||
    !objectRowsAreValid(schemaObject, "schema_name")
  ) {
    return { status: "fail", reason: "role_or_schema_metadata_incomplete" };
  }
  const matrices = [
    matrixCoverage(
      evidence.schema_privileges,
      schemaObject,
      roleNames,
      "schema_name",
      ["has_usage", "has_create"],
    ),
    matrixCoverage(
      evidence.table_privileges,
      tableObjects,
      roleNames,
      "table_name",
      TABLE_PRIVILEGES,
    ),
    matrixCoverage(
      evidence.column_privileges,
      columnObjects,
      roleNames,
      "column_key",
      COLUMN_PRIVILEGES,
    ),
    matrixCoverage(
      evidence.sequence_privileges,
      sequenceObjects,
      roleNames,
      "sequence_name",
      SEQUENCE_PRIVILEGES,
    ),
    matrixCoverage(
      evidence.routine_privileges,
      routineObjects,
      roleNames,
      "routine_name",
      ROUTINE_PRIVILEGES,
    ),
  ];
  const aclChecks = [
    aclCoverage(evidence.schema_acl_privileges, schemaObject, "schema_name"),
    aclCoverage(evidence.table_acl_privileges, tableObjects, "table_name"),
    aclCoverage(evidence.column_acl_privileges, columnObjects, "column_key"),
    aclCoverage(
      evidence.sequence_acl_privileges,
      sequenceObjects,
      "sequence_name",
    ),
    aclCoverage(
      evidence.routine_acl_privileges,
      routineObjects,
      "routine_name",
    ),
  ];
  const membershipCheck = membershipCoverage(
    evidence.role_memberships,
    roleNames,
  );
  const incomplete = [...matrices, ...aclChecks, membershipCheck].filter(
    (check) => !check.complete,
  );
  if (incomplete.length > 0) {
    return {
      status: "fail",
      reason: "privilege_evidence_incomplete",
      incomplete_evidence: incomplete.map((check) => check.reason),
    };
  }
  const rolesByName = new Map(
    evidence.roles.map((role) => [role.role_name, role]),
  );
  const effectivePrivilegeRows = {
    schema: evidence.schema_privileges.filter(
      (row) =>
        (row.role_name !== "circles_app_runtime" &&
          (row.has_usage || row.has_create)) ||
        (row.role_name === "circles_app_runtime" && row.has_create),
    ),
    tables: evidence.table_privileges.filter(
      (row) =>
        row.role_name !== "circles_app_runtime" &&
        TABLE_PRIVILEGES.some((key) => row[key]),
    ),
    columns: evidence.column_privileges.filter(
      (row) =>
        row.role_name !== "circles_app_runtime" &&
        COLUMN_PRIVILEGES.some((key) => row[key]),
    ),
    sequences: evidence.sequence_privileges.filter(
      (row) =>
        row.role_name !== "circles_app_runtime" &&
        SEQUENCE_PRIVILEGES.some((key) => row[key]),
    ),
    routines: evidence.routine_privileges.filter(
      (row) => row.role_name !== "circles_app_runtime" && row.can_execute,
    ),
  };
  const unauthorized = {
    schema: [],
    tables: [],
    columns: [],
    sequences: [],
    routines: [],
    direct_acl: aclChecks.flatMap((check) => check.violations),
  };
  const reviewed_managed_capabilities = {
    builtin_non_login_capabilities: [],
    provider_superuser: [],
    managed_admin_roles: [],
  };
  const reviewed_role_identity_violations = [];
  for (const [category, rows] of Object.entries(effectivePrivilegeRows)) {
    for (const row of rows) {
      const classification = reviewedRoleClassification(
        row.role_name,
        rolesByName,
      );
      if (classification?.valid) {
        reviewed_managed_capabilities[classification.group].push({
          ...row,
          privilege_category: category,
          reviewed_role_classification: classification.classification,
          role_identity_check: classification.identity_check,
        });
      } else {
        unauthorized[category].push(row);
        if (classification) {
          reviewed_role_identity_violations.push({
            role_name: row.role_name,
            category,
            identity_check: classification.identity_check,
          });
        }
      }
    }
  }
  const unsafe_privileged_membership_paths = unsafePrivilegedMembershipPaths(
    evidence.role_memberships,
  );
  const unauthorizedCounts = Object.values(unauthorized).map(
    (rows) => rows.length,
  );
  const reviewed_effective_privilege_counts = Object.fromEntries(
    Object.keys(effectivePrivilegeRows).map((category) => [
      category,
      Object.values(reviewed_managed_capabilities).reduce(
        (total, rows) =>
          total +
          rows.filter((row) => row.privilege_category === category).length,
        0,
      ),
    ]),
  );
  const reviewed_effective_privilege_total = Object.values(
    reviewed_effective_privilege_counts,
  ).reduce((total, count) => total + count, 0);
  return {
    status:
      unauthorizedCounts.every((count) => count === 0) &&
      reviewed_role_identity_violations.length === 0 &&
      unsafe_privileged_membership_paths.length === 0
        ? "pass"
        : "fail",
    unauthorized,
    reviewed_managed_capabilities,
    reviewed_effective_privilege_counts,
    reviewed_effective_privilege_total,
    reviewed_role_identity_violations,
    unsafe_privileged_membership_paths,
    checked_role_count: roleNames.length,
    checked_non_owner_effective_privilege_rows: matrices.reduce(
      (total, check, index) =>
        total +
        [
          evidence.schema_privileges,
          evidence.table_privileges,
          evidence.column_privileges,
          evidence.sequence_privileges,
          evidence.routine_privileges,
        ][index].length,
      0,
    ),
  };
}

export function evaluateRuntimePrivileges(appNames, markerTable, runtimeRows) {
  if (
    !Array.isArray(appNames) ||
    !appNames.every((name) => typeof name === "string" && name.length > 0) ||
    typeof markerTable !== "string" ||
    markerTable.length === 0 ||
    !Array.isArray(runtimeRows)
  ) {
    return {
      status: "fail",
      reason: "runtime_table_privilege_evidence_unavailable",
    };
  }
  const expectedNames = new Set([...appNames, markerTable]);
  if (expectedNames.size !== appNames.length + 1)
    return { status: "fail", reason: "runtime_table_expectations_malformed" };
  const rows = new Map();
  for (const row of runtimeRows) {
    if (
      !row ||
      typeof row.table_name !== "string" ||
      !expectedNames.has(row.table_name) ||
      !TABLE_PRIVILEGES.every((key) => typeof row[key] === "boolean") ||
      rows.has(row.table_name)
    ) {
      return {
        status: "fail",
        reason: "runtime_table_privilege_matrix_incomplete",
      };
    }
    rows.set(row.table_name, row);
  }
  if (rows.size !== expectedNames.size)
    return {
      status: "fail",
      reason: "runtime_table_privilege_matrix_incomplete",
    };
  const missingAppPrivileges = appNames.filter((name) => {
    const row = rows.get(name);
    return (
      !row ||
      !row.can_select ||
      !row.can_insert ||
      (name === "moderationActions" ? row.can_update : !row.can_update) ||
      (name === "moderationActions" ? row.can_delete : !row.can_delete) ||
      row.can_truncate ||
      row.can_references ||
      row.can_trigger ||
      row.can_maintain
    );
  });
  const marker = rows.get(markerTable);
  const markerCorrect =
    Boolean(marker?.can_select) &&
    !marker?.can_insert &&
    !marker?.can_update &&
    !marker?.can_delete &&
    !marker?.can_truncate &&
    !marker?.can_references &&
    !marker?.can_trigger &&
    !marker?.can_maintain;
  return {
    status:
      missingAppPrivileges.length === 0 && markerCorrect ? "pass" : "fail",
    missing_app_privileges: missingAppPrivileges,
    marker_read_only: markerCorrect,
  };
}

export function evaluateRuntimeSequencePrivileges(sequences, runtimeRows) {
  const coverage = runtimeObjectCoverage(
    runtimeRows,
    sequences,
    "sequence_name",
    SEQUENCE_PRIVILEGES,
  );
  if (!coverage.complete) return { status: "fail", reason: coverage.reason };
  const rows = new Map(runtimeRows.map((row) => [row.sequence_name, row]));
  const incorrect = sequences
    .map((sequence) => sequence.sequence_name)
    .filter((sequenceName) => {
      const row = rows.get(sequenceName);
      return !row || !row.can_usage || !row.can_select || row.can_update;
    });
  return {
    status: incorrect.length === 0 ? "pass" : "fail",
    incorrect_sequences: incorrect,
  };
}

export function evaluateRuntimeRoutinePrivileges(routines, runtimeRows) {
  const coverage = runtimeObjectCoverage(
    runtimeRows,
    routines,
    "routine_name",
    ROUTINE_PRIVILEGES,
  );
  if (!coverage.complete) return { status: "fail", reason: coverage.reason };
  const executable = runtimeRows
    .filter((row) => row.can_execute)
    .map((row) => row.routine_name);
  return {
    status: executable.length === 0 ? "pass" : "fail",
    executable_routines: executable,
  };
}

export function evaluateRuntimeSchemaPrivileges(schemaPrivilege) {
  if (
    !schemaPrivilege ||
    typeof schemaPrivilege.has_usage !== "boolean" ||
    typeof schemaPrivilege.has_create !== "boolean"
  ) {
    return {
      status: "fail",
      reason: "runtime_schema_privilege_evidence_unavailable",
    };
  }
  return {
    status:
      schemaPrivilege.has_usage && !schemaPrivilege.has_create
        ? "pass"
        : "fail",
    has_usage: schemaPrivilege.has_usage,
    has_create: schemaPrivilege.has_create,
  };
}

export function evaluateDefaultPrivileges(
  defaultContexts,
  defaultPrivileges,
  schemaUsageForCurrentNonowners = "unknown",
) {
  if (!Array.isArray(defaultContexts) || !Array.isArray(defaultPrivileges))
    return { status: "fail", reason: "default_acl_evidence_unavailable" };
  if (
    !["denied", "granted", "unknown"].includes(schemaUsageForCurrentNonowners)
  ) {
    return {
      status: "fail",
      reason: "default_acl_schema_usage_state_malformed",
    };
  }
  const expectedContexts = new Set();
  for (const context of defaultContexts) {
    if (
      !context ||
      typeof context.defining_owner !== "string" ||
      !DEFAULT_OBJECT_TYPES.includes(context.object_type) ||
      typeof context.global_override_configured !== "boolean" ||
      typeof context.schema_additive_acl_configured !== "boolean"
    ) {
      return { status: "fail", reason: "default_acl_context_malformed" };
    }
    const key = `${context.defining_owner}\u0000${context.object_type}`;
    if (expectedContexts.has(key))
      return { status: "fail", reason: "default_acl_context_duplicate" };
    expectedContexts.add(key);
  }
  if (
    expectedContexts.size === 0 ||
    expectedContexts.size % DEFAULT_OBJECT_TYPES.length !== 0
  )
    return { status: "fail", reason: "default_acl_context_incomplete" };
  for (const definingOwner of new Set(
    defaultContexts.map((row) => row.defining_owner),
  )) {
    for (const objectType of DEFAULT_OBJECT_TYPES) {
      if (!expectedContexts.has(`${definingOwner}\u0000${objectType}`))
        return { status: "fail", reason: "default_acl_context_incomplete" };
    }
  }
  const hazards = [];
  const conditionalTypeUsage = [];
  for (const row of defaultPrivileges) {
    if (
      !row ||
      typeof row.defining_owner !== "string" ||
      !DEFAULT_OBJECT_TYPES.includes(row.object_type) ||
      !["global", "schema_additive"].includes(row.acl_source) ||
      typeof row.grantee !== "string" ||
      typeof row.privilege_type !== "string" ||
      typeof row.is_grantable !== "boolean" ||
      !expectedContexts.has(`${row.defining_owner}\u0000${row.object_type}`)
    ) {
      return { status: "fail", reason: "default_acl_row_malformed" };
    }
    const grant = {
      defining_owner: row.defining_owner,
      object_type: row.object_type,
      acl_source: row.acl_source,
      grantee: row.grantee,
      privilege_type: row.privilege_type,
      grantable: row.is_grantable,
    };
    // PostgreSQL's built-in PUBLIC USAGE default for types applies only to
    // future types. It is not part of the 27-table contract and, while current
    // ordinary/API-role schema USAGE is denied, cannot by itself expose a
    // current table or establish current Data API disclosure. Preserve it as a
    // conditional future-access condition rather than hiding it or calling it a
    // table grant.
    if (row.object_type === "types" && row.privilege_type === "USAGE") {
      conditionalTypeUsage.push({
        ...grant,
        classification: "conditional_future_type_usage",
        schema_usage_for_current_nonowners: schemaUsageForCurrentNonowners,
        current_data_api_disclosure: "not_assessed_from_default_acl_metadata",
      });
    } else {
      // Non-type default ACLs, including function EXECUTE, are genuine future
      // object risks and require explicit review/revocation before creation.
      hazards.push(grant);
    }
  }
  return {
    status: hazards.length === 0 ? "pass" : "fail",
    hazardous_default_grants: hazards,
    conditional_type_usage: conditionalTypeUsage,
    schema_usage_for_current_nonowners: schemaUsageForCurrentNonowners,
    creator_count: expectedContexts.size / DEFAULT_OBJECT_TYPES.length,
  };
}

function schemaUsageForCurrentNonowners(rows, runtimeRole) {
  if (
    !Array.isArray(rows) ||
    rows.length === 0 ||
    !rows.every(
      (row) =>
        row &&
        typeof row.role_name === "string" &&
        typeof row.has_usage === "boolean" &&
        typeof row.has_create === "boolean",
    )
  ) {
    return "unknown";
  }
  return rows.some(
    (row) =>
      row.role_name !== runtimeRole &&
      !REVIEWED_BUILTIN_CAPABILITY_ROLES.includes(row.role_name) &&
      !REVIEWED_PROVIDER_SUPERUSER_ROLES.includes(row.role_name) &&
      !REVIEWED_MANAGED_ADMIN_ROLES.includes(row.role_name) &&
      row.has_usage,
  )
    ? "granted"
    : "denied";
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function safeFailureCheck(context, name, summary) {
  return makeCheck(context, name, "error", summary, {
    safe_error: "unavailable",
  });
}

async function queryCatalog(client, sql, values = []) {
  try {
    return await client.query(sql, values);
  } catch {
    // Do not retain or print raw errors; URLs can appear in driver diagnostics.
    return null;
  }
}

async function getSourceTree(projectDir) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", projectDir, "rev-parse", "HEAD^{tree}"],
      {
        timeout: 5_000,
        maxBuffer: 1_024,
      },
    );
    const revision = stdout.trim();
    return /^[0-9a-f]{40}$/i.test(revision) ? revision : "unknown";
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

async function loadProjectConfiguration(projectDir) {
  const configuration = await import(
    pathToFileURL(resolve(projectDir, "server/_core/postgres-config.mjs")).href
  );
  const manifest = await import(
    pathToFileURL(resolve(projectDir, "scripts/supabase-data-manifest.mjs"))
      .href
  );
  const currentContract = await import(
    pathToFileURL(resolve(projectDir, "scripts/recover-api.mjs")).href
  );
  if (
    configuration.PRIVATE_SCHEMA !== SCHEMA ||
    manifest.PRIVATE_SCHEMA !== SCHEMA
  ) {
    throw new Error("Unexpected audit schema configuration");
  }
  if (
    !Array.isArray(manifest.LEGACY_TABLE_NAMES) ||
    manifest.DATA_MIGRATION_TABLE !== MARKER_TABLE
  ) {
    throw new Error("Unexpected audit manifest configuration");
  }
  const currentAppNames = currentAuditInventory(
    currentContract.REQUIRED_APPLICATION_COLUMNS,
    manifest.LEGACY_TABLE_NAMES,
  );
  return { configuration, manifest, currentAppNames };
}

export function currentAuditInventory(requiredColumns, legacyNames) {
  if (!requiredColumns || !Array.isArray(legacyNames))
    throw new Error("Unexpected current audit contract");
  const names = Object.keys(requiredColumns);
  if (
    !names.includes(MARKER_TABLE) ||
    !legacyNames.every((name) => names.includes(name)) ||
    !names.every(
      (name) =>
        Array.isArray(requiredColumns[name]) &&
        requiredColumns[name].length > 0,
    )
  )
    throw new Error("Unexpected current audit contract");
  return names.filter((name) => name !== MARKER_TABLE);
}

function rowsOrNull(result) {
  return result ? result.rows : null;
}

function columnKey(tableName, columnName) {
  return JSON.stringify([tableName, columnName]);
}

function withColumnKeys(rows) {
  return rows?.map((row) => ({
    ...row,
    column_key: columnKey(row.table_name, row.column_name),
  }));
}

async function runRoleProbe(client, roleName, schemaName, tableName) {
  let began = false;
  try {
    await client.query("BEGIN READ ONLY");
    began = true;
    await client.query(`SET LOCAL ROLE ${quoteIdentifier(roleName)}`);
    const result = await client.query(
      `SELECT 1 AS permission_probe FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} LIMIT 1`,
    );
    return {
      role_name: roleName,
      table_name: tableName,
      outcome: "allowed",
      returned_at_most_one_row: result.rowCount <= 1,
    };
  } catch (error) {
    // A PostgreSQL 42501 is the expected insufficient-privilege result.  No raw
    // code/message is emitted; any other failure remains indeterminate.
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    return {
      role_name: roleName,
      table_name: tableName,
      outcome: code === "42501" ? "denied" : "indeterminate",
      returned_at_most_one_row: true,
    };
  } finally {
    if (began) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The connection will be closed by the caller; never expose driver details.
      }
    }
  }
}

async function runBackendProbe(
  client,
  runtimeRole,
  schemaName,
  appTable,
  markerTable,
) {
  let began = false;
  try {
    await client.query("BEGIN READ ONLY");
    began = true;
    await client.query(`SET LOCAL ROLE ${quoteIdentifier(runtimeRole)}`);
    const appResult = await client.query(
      `SELECT 1 AS permission_probe FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(appTable)} LIMIT 1`,
    );
    const markerResult = await client.query(
      `SELECT 1 AS permission_probe FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(markerTable)} LIMIT 1`,
    );
    return {
      role_name: runtimeRole,
      app_table: appTable,
      app_select: "allowed",
      marker_table: markerTable,
      marker_select: "allowed",
      returned_at_most_one_row:
        appResult.rowCount <= 1 && markerResult.rowCount <= 1,
    };
  } catch {
    return {
      role_name: runtimeRole,
      app_table: appTable,
      app_select: "indeterminate",
      marker_table: markerTable,
      marker_select: "indeterminate",
      returned_at_most_one_row: true,
    };
  } finally {
    if (began) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The connection is closed immediately after the audit.
      }
    }
  }
}

function groupedPrivileges(rows, objectNameKey) {
  const groups = new Map();
  for (const row of rows ?? []) {
    const objectName = row[objectNameKey];
    const key = `${objectName}\u0000${row.grantee}`;
    const existing = groups.get(key) ?? {
      [objectNameKey]: objectName,
      grantee: row.grantee,
      privileges: [],
    };
    existing.privileges.push(
      `${row.privilege_type}${row.is_grantable ? " (grantable)" : ""}`,
    );
    groups.set(key, existing);
  }
  return [...groups.values()].sort((a, b) =>
    `${a[objectNameKey]}:${a.grantee}`.localeCompare(
      `${b[objectNameKey]}:${b.grantee}`,
    ),
  );
}

function toMarkdownCell(value) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function statusWord(status) {
  return status === "pass"
    ? "PASS"
    : status === "fail"
      ? "FAIL"
      : status === "unknown"
        ? "UNKNOWN"
        : "ERROR";
}

/**
 * Unknown is deliberately non-passing. In particular, catalog-only DB-13
 * evidence cannot certify provider gateway exposure when provider settings are
 * unavailable; callers receive an UNKNOWN report and a nonzero process exit.
 */
export function overallStatusFromChecks(checks) {
  if (!Array.isArray(checks)) return "fail";
  if (
    checks.some(
      (check) => check?.status === "fail" || check?.status === "error",
    )
  )
    return "fail";
  if (checks.some((check) => check?.status === "unknown")) return "unknown";
  return "pass";
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.map(toMarkdownCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(toMarkdownCell).join(" | ")} |`),
  ].join("\n");
}

export function renderMarkdown(report) {
  const checks = report.checks ?? [];
  const inventory = report.evidence.tables ?? [];
  const policies = report.evidence.policies ?? [];
  const adminInventory = report.evidence.admin_tables ?? [];
  const adminFunctions = report.evidence.admin_functions ?? [];
  const tablePrivileges = groupedPrivileges(
    report.evidence.table_acl_privileges ?? [],
    "table_name",
  );
  const sequencePrivileges = groupedPrivileges(
    report.evidence.sequence_acl_privileges ?? [],
    "sequence_name",
  );
  const columnPrivileges = groupedPrivileges(
    report.evidence.column_acl_privileges ?? [],
    "column_key",
  );
  const routinePrivileges = groupedPrivileges(
    report.evidence.routine_acl_privileges ?? [],
    "routine_name",
  );
  const schemaPrivileges = groupedPrivileges(
    report.evidence.schema_acl_privileges ?? [],
    "schema_name",
  );
  const defaultPrivilegeEvaluation = checks.find(
    (check) => check.name === "default_privileges",
  )?.evidence?.evaluation;
  const conditionalTypeUsage =
    defaultPrivilegeEvaluation?.conditional_type_usage ?? [];
  const futureFunctionDefaultGrants = (
    defaultPrivilegeEvaluation?.hazardous_default_grants ?? []
  ).filter(
    (grant) =>
      grant.object_type === "functions" && grant.privilege_type === "EXECUTE",
  );
  const externalPrivilegeEvaluation = checks.find(
    (check) => check.name === "all_non_owner_schema_object_privileges",
  )?.evidence;
  const adminAuthorizationEvaluation = checks.find(
    (check) => check.name === "reviewed_admin_authorization_contract",
  )?.evidence;
  const appLoginAuthorizationEvaluation = checks.find(
    (check) =>
      check.name === "dedicated_application_login_authorization_contract",
  )?.evidence;
  const reviewedManagedCapabilities =
    externalPrivilegeEvaluation?.reviewed_managed_capabilities ?? {};
  const reviewedCapabilityEvidenceAvailable = Boolean(
    externalPrivilegeEvaluation?.reviewed_managed_capabilities,
  );
  const reviewedCapabilityCount = reviewedCapabilityEvidenceAvailable
    ? Object.values(reviewedManagedCapabilities).reduce(
        (total, rows) => total + (Array.isArray(rows) ? rows.length : 0),
        0,
      )
    : null;
  const reviewedGroupCount = (group) =>
    !reviewedCapabilityEvidenceAvailable
      ? null
      : Array.isArray(reviewedManagedCapabilities[group])
        ? reviewedManagedCapabilities[group].length
        : 0;
  const lines = [
    "# Circles Supabase PostgreSQL security audit",
    "",
    `**Overall status:** ${statusWord(report.overall_status)}`,
    "",
    "## Scope and guardrails",
    "",
    `- **Target:** Supabase project \`${PROJECT_REF}\`, database \`postgres\`, private schemas \`${SCHEMA}\` and \`${ADMIN_SCHEMA}\`.`,
    `- **Executed (UTC):** ${report.executed_at_utc}`,
    `- **Source tree:** ${report.source_tree}`,
    "- **Method:** bounded read-only PostgreSQL catalog queries and `SELECT 1 ... LIMIT 1` role probes; no application row values, credentials, token material, fingerprints, raw driver errors, DDL, DML, or data changes are included.",
    "- **Connection:** `pg` is resolved from the supplied project; `getPostgresConnectionOptions` is invoked from that project with certificate validation. The secret is only consumed in memory.",
    "",
    "## Automated checks",
    "",
    markdownTable(
      ["Check", "Source tree", "Date (UTC)", "Target", "Status", "Summary"],
      checks.map((check) => [
        check.name,
        check.source_tree,
        check.date_utc,
        check.target,
        statusWord(check.status),
        check.summary,
      ]),
    ),
    "",
    "Every check above carries the same immutable audit context in the JSON artifact; individual evidence is under its check and in the evidence section below.",
    "",
    "## Table inventory, RLS, and ownership",
    "",
    `Expected inventory: **26 application tables + \`${MARKER_TABLE}\` = 27 tables**.`,
    `Reviewed admin inventory: **${toMarkdownCell(adminInventory.length)} exact tables**.`,
    "",
    markdownTable(
      ["Table", "Owner", "RLS enabled", "RLS forced", "Policy count"],
      inventory.map((table) => [
        table.table_name,
        table.owner,
        table.rls_enabled,
        table.rls_forced,
        table.policy_count,
      ]),
    ),
    "",
    "## Exact application/admin RLS policies",
    "",
    markdownTable(
      [
        "Schema",
        "Table",
        "Policy",
        "Mode",
        "Roles",
        "Command",
        "USING qualification",
        "WITH CHECK qualification",
      ],
      policies.map((policy) => [
        policy.schema_name,
        policy.table_name,
        policy.policy_name,
        policy.permissive,
        normalizedRoles(policy.roles).join(", "),
        policy.command,
        policy.using_qualification,
        policy.with_check_qualification,
      ]),
    ),
    "",
    "> Policy acceptance requires one whole named pre/post DB-09 contract state; arbitrary subsets are not accepted. All expected backend policies with `USING true` are intentionally **server-only**. They do **not** enforce per-user or per-circle authorization.",
    "",
    "## Roles, effective permissions, and probes",
    "",
    `- Restricted role inspected: \`${report.runtime_role}\` (required: NOLOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS).`,
    `- Reviewed admin authorization contract: **${statusWord(adminAuthorizationEvaluation?.status)}**; failed subchecks: **${toMarkdownCell(adminAuthorizationEvaluation?.failed_checks?.length ?? 0)}**.`,
    `- Dedicated application-login contract: **${statusWord(appLoginAuthorizationEvaluation?.status)}**; matched state: **${toMarkdownCell(appLoginAuthorizationEvaluation?.matched_variant)}**.`,
    `- Ordinary/API/runtime effective or direct privilege findings: ${report.summary.external_catalog_grants === 0 ? "**none detected**" : `**${report.summary.external_catalog_grants ?? "unknown"} detected or incomplete**`}.`,
    `- Reviewed provider-managed effective capabilities retained as separate evidence: **${toMarkdownCell(reviewedCapabilityCount)}** (${toMarkdownCell(externalPrivilegeEvaluation?.reviewed_effective_privilege_counts?.schema)} schema, ${toMarkdownCell(externalPrivilegeEvaluation?.reviewed_effective_privilege_counts?.tables)} table, ${toMarkdownCell(externalPrivilegeEvaluation?.reviewed_effective_privilege_counts?.columns)} column, ${toMarkdownCell(externalPrivilegeEvaluation?.reviewed_effective_privilege_counts?.sequences)} sequence, ${toMarkdownCell(externalPrivilegeEvaluation?.reviewed_effective_privilege_counts?.routines)} routine rows).`,
    `- Unsafe transfer path from a reviewed privileged role to an untrusted role: **${toMarkdownCell(externalPrivilegeEvaluation?.unsafe_privileged_membership_paths?.length)}** (required: 0).`,
    `- Roles cataloged for complete-matrix evaluation: **${toMarkdownCell(report.evidence.roles?.length)}**; membership edges recorded: **${toMarkdownCell(report.evidence.role_memberships?.length)}**.`,
    `- Backend app-table and marker read-only probe: **${toMarkdownCell(report.evidence.backend_probe?.app_select)}** / **${toMarkdownCell(report.evidence.backend_probe?.marker_select)}**.`,
    `- Marker catalog DML privilege result: **${report.summary.marker_dml_denied ? "denied as required" : "not denied"}**. No DML statement was issued.`,
    "",
    markdownTable(
      [
        "External role",
        "App probe table",
        "Read-only SELECT 1 result",
        "Bounded",
      ],
      (report.evidence.external_probes ?? []).map((probe) => [
        probe.role_name,
        probe.table_name,
        probe.outcome,
        probe.returned_at_most_one_row,
      ]),
    ),
    "",
    markdownTable(
      [
        "External role",
        "Admin probe table",
        "Read-only SELECT 1 result",
        "Bounded",
      ],
      (report.evidence.external_admin_probes ?? []).map((probe) => [
        probe.role_name,
        probe.table_name,
        probe.outcome,
        probe.returned_at_most_one_row,
      ]),
    ),
    "",
    "### Effective capability classification",
    "",
    markdownTable(
      ["Classification", "Effective rows", "Reviewed exact names"],
      [
        [
          "Ordinary/API/runtime or other unreviewed roles (failing)",
          report.summary.external_catalog_grants ?? "unknown",
          "none",
        ],
        [
          "Built-in non-login capabilities (reviewed)",
          reviewedGroupCount("builtin_non_login_capabilities"),
          "pg_read_all_data, pg_write_all_data, pg_maintain",
        ],
        [
          "Provider superuser (reviewed)",
          reviewedGroupCount("provider_superuser"),
          "supabase_admin",
        ],
        [
          "Managed admin roles (reviewed)",
          reviewedGroupCount("managed_admin_roles"),
          "supabase_etl_admin, supabase_read_only_user",
        ],
      ],
    ),
    "",
    "> `has_*_privilege` metadata records an effective catalog capability (including inheritance or PUBLIC) only. It is **not** a demonstrated RLS row exposure, a row-returning query, or Data API exposure. Ordinary/API roles still fail closed; the listed provider-managed roles are retained for review rather than mislabeled as anonymous data exposure.",
    "",
    "### Schema ACL metadata",
    "",
    schemaPrivileges.length
      ? markdownTable(
          ["Schema", "Grantee", "Privileges"],
          schemaPrivileges.map((row) => [
            row.schema_name,
            row.grantee,
            row.privileges.join(", "),
          ]),
        )
      : "No explicit schema ACL rows returned.",
    "",
    "### Table ACL metadata",
    "",
    tablePrivileges.length
      ? markdownTable(
          ["Table", "Grantee", "Privileges"],
          tablePrivileges.map((row) => [
            row.table_name,
            row.grantee,
            row.privileges.join(", "),
          ]),
        )
      : "No explicit table ACL rows returned.",
    "",
    "### Sequence ACL metadata",
    "",
    sequencePrivileges.length
      ? markdownTable(
          ["Sequence", "Grantee", "Privileges"],
          sequencePrivileges.map((row) => [
            row.sequence_name,
            row.grantee,
            row.privileges.join(", "),
          ]),
        )
      : "No explicit sequence ACL rows returned.",
    "",
    "### Column ACL metadata",
    "",
    columnPrivileges.length
      ? markdownTable(
          ["Table/column", "Grantee", "Privileges"],
          columnPrivileges.map((row) => [
            row.column_key,
            row.grantee,
            row.privileges.join(", "),
          ]),
        )
      : "No column-specific ACL rows returned.",
    "",
    "### Routine ACL metadata",
    "",
    routinePrivileges.length
      ? markdownTable(
          ["Routine", "Grantee", "Privileges"],
          routinePrivileges.map((row) => [
            row.routine_name,
            row.grantee,
            row.privileges.join(", "),
          ]),
        )
      : "No routine ACL rows returned.",
    "",
    "### Default privileges",
    "",
    (report.evidence.default_privilege_contexts ?? []).length
      ? markdownTable(
          [
            "Defining owner",
            "Object type",
            "Global override configured",
            "Schema-additive ACL configured",
          ],
          report.evidence.default_privilege_contexts.map((row) => [
            row.defining_owner,
            row.object_type,
            row.global_override_configured,
            row.schema_additive_acl_configured,
          ]),
        )
      : "Default-ACL creator/type context was unavailable.",
    "",
    (report.evidence.default_privileges ?? []).length
      ? markdownTable(
          [
            "Defining owner",
            "Object type",
            "ACL source",
            "Grantee",
            "Privilege",
          ],
          report.evidence.default_privileges.map((row) => [
            row.defining_owner,
            row.object_type,
            row.acl_source,
            row.grantee,
            `${row.privilege_type}${row.is_grantable ? " (grantable)" : ""}`,
          ]),
        )
      : "No non-owner effective default privilege row was returned after global-override and schema-additive merging.",
    "",
    conditionalTypeUsage.length
      ? `> **Conditional future type usage:** ${conditionalTypeUsage.length} default TYPE USAGE row(s) were retained as metadata. Current non-owner schema USAGE is **${toMarkdownCell(defaultPrivilegeEvaluation?.schema_usage_for_current_nonowners)}**; TYPE USAGE is not part of the 27-table contract and does not by itself establish current Data API disclosure. It becomes relevant if schema USAGE or an exposure path changes.`
      : "No conditional default TYPE USAGE row was returned.",
    "",
    futureFunctionDefaultGrants.length
      ? `> **Future function risk:** ${futureFunctionDefaultGrants.length} default function EXECUTE grant(s) remain a genuine risk for future private-schema functions and are retained as failing evidence.`
      : "No default function EXECUTE grant was returned.",
    "",
    "## Functions and schema-exposure indicators",
    "",
    (report.evidence.functions ?? []).length
      ? markdownTable(
          [
            "Function",
            "Owner",
            "SECURITY DEFINER",
            "Explicit search_path",
            "pg_catalog first",
          ],
          report.evidence.functions.map((row) => [
            row.function_name,
            row.owner,
            row.security_definer,
            row.has_explicit_search_path,
            row.search_path_pg_catalog_first,
          ]),
        )
      : "No functions were returned from the application schema.",
    "",
    "### Reviewed admin helper contract",
    "",
    adminFunctions.length
      ? markdownTable(
          [
            "Function",
            "Owner",
            "SECURITY DEFINER",
            "Explicit search_path",
            "pg_catalog first",
            "anon EXECUTE",
            "authenticated EXECUTE",
            "app runtime EXECUTE",
          ],
          adminFunctions.map((row) => [
            row.function_name,
            row.owner,
            row.security_definer,
            row.has_explicit_search_path,
            row.search_path_pg_catalog_first,
            row.anon_execute,
            row.authenticated_execute,
            row.runtime_execute,
          ]),
        )
      : "No admin helper metadata was returned.",
    "",
    `- **Function risk result:** ${toMarkdownCell(report.summary.function_risk_status)}. Function bodies and settings values were not exported.`,
    `- **Schema exposure indicator:** **${toMarkdownCell(report.evidence.schema_exposure?.status)}** — ${toMarkdownCell(report.evidence.schema_exposure?.explanation)}. Missing/unsupported PostgREST settings are explicitly recorded as **unknown**, not as proof that no API gateway can expose the schema.`,
    "",
    "## Findings and residual risks",
    "",
    ...report.findings.map((finding) => `- ${finding}`),
    "",
    "### Historical Supabase advisor evidence (separate; not a live advisor run)",
    "",
    "The reviewed cutover confirmation records **no ERROR/WARN** advisor findings and **nine INFO no-policy** findings in **other schemas**. This catalog-only audit did not invoke Supabase Advisor, so that statement is preserved as prior evidence rather than a fresh live-success claim.",
    "",
    "## Recommended follow-up",
    "",
    "1. Rotate the privileged PostgreSQL connection credential through Supabase protected controls and update the server-only deployment secret. The privileged `postgres` connection remains a trust boundary because it can `SET ROLE` to the backend role.",
    "2. Keep `circles_app` absent from externally exposed PostgREST/API schema configuration; verify this in Supabase/API-gateway configuration because database catalog evidence alone can be incomplete.",
    "3. Maintain server-side user/circle authorization before any backend-role query. `USING true` backend policies are not row authorization controls.",
    "4. Re-run this checker after role, RLS, grants, functions, default privileges, Supabase exposure configuration, or schema changes.",
    "",
    "## Artifact integrity",
    "",
    "The companion JSON retains structured, metadata-only evidence for this run. This report deliberately omits data rows, connection URLs, passwords, tokens, fingerprints, and raw errors.",
    "",
  ];
  return lines.join("\n");
}

async function collectEvidence(client, schemaName, runtimeRole) {
  const roleResult = await queryCatalog(
    client,
    `
    SELECT r.rolname AS role_name,
           r.rolcanlogin AS can_login,
           r.rolinherit AS inherits,
           r.rolsuper AS is_superuser,
           r.rolbypassrls AS bypasses_rls
    FROM pg_roles AS r
    WHERE r.rolname = $1
    ORDER BY r.rolname
    LIMIT 1`,
    [runtimeRole],
  );

  const membershipResult = await queryCatalog(
    client,
    `
    SELECT parent.rolname AS parent_role,
           member.rolname AS member_role,
           grantor.rolname AS grantor_role,
           membership.inherit_option,
           membership.set_option,
           membership.admin_option
    FROM pg_auth_members AS membership
    JOIN pg_roles AS parent ON parent.oid = membership.roleid
    JOIN pg_roles AS member ON member.oid = membership.member
    JOIN pg_roles AS grantor ON grantor.oid = membership.grantor
    ORDER BY parent.rolname, member.rolname, grantor.rolname,
             membership.inherit_option, membership.set_option, membership.admin_option`,
  );

  const rolesResult = await queryCatalog(
    client,
    `
    SELECT r.rolname AS role_name,
           r.rolcanlogin AS can_login,
           r.rolinherit AS inherits,
           r.rolsuper AS is_superuser,
           r.rolcreatedb AS can_create_db,
           r.rolcreaterole AS can_create_role,
           r.rolbypassrls AS bypasses_rls,
           r.rolreplication AS can_replicate,
           (r.oid < 16384) AS is_catalog_builtin
    FROM pg_roles AS r
    ORDER BY r.rolname`,
  );

  const schemaResult = await queryCatalog(
    client,
    `
    SELECT n.nspname AS schema_name,
           pg_get_userbyid(n.nspowner) AS owner,
           COALESCE(n.nspacl::text, '') AS acl_metadata
    FROM pg_namespace AS n
    WHERE n.nspname = $1
    ORDER BY n.nspname
    LIMIT 1`,
    [schemaName],
  );

  const tableResult = await queryCatalog(
    client,
    `
    SELECT c.relname AS table_name,
           pg_get_userbyid(c.relowner) AS owner,
           c.relrowsecurity AS rls_enabled,
           c.relforcerowsecurity AS rls_forced,
           COALESCE(c.relacl::text, '') AS acl_metadata
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = $1
      AND c.relkind IN ('r', 'p')
    ORDER BY c.relname`,
    [schemaName],
  );

  const policyResult = await queryCatalog(
    client,
    `
    SELECT p.tablename AS table_name,
           p.policyname AS policy_name,
           p.permissive AS permissive,
           p.roles AS roles,
           p.cmd AS command,
           p.qual AS using_qualification,
           p.with_check AS with_check_qualification
    FROM pg_policies AS p
    WHERE p.schemaname = $1
    ORDER BY p.tablename, p.policyname`,
    [schemaName],
  );

  const policyCountsResult = await queryCatalog(
    client,
    `
    SELECT p.tablename AS table_name,
           count(*)::integer AS policy_count
    FROM pg_policies AS p
    WHERE p.schemaname = $1
    GROUP BY p.tablename
    ORDER BY p.tablename`,
    [schemaName],
  );

  const schemaAclResult = await queryCatalog(
    client,
    `
    SELECT n.nspname AS schema_name,
           pg_get_userbyid(n.nspowner) AS owner,
           COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
           privilege.privilege_type AS privilege_type,
           privilege.is_grantable AS is_grantable
    FROM pg_namespace AS n
    CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) AS privilege
    LEFT JOIN pg_roles AS grantee ON grantee.oid = privilege.grantee
    WHERE n.nspname = $1
    ORDER BY grantee, privilege.privilege_type`,
    [schemaName],
  );

  const tableAclResult = await queryCatalog(
    client,
    `
    SELECT c.relname AS table_name,
           pg_get_userbyid(c.relowner) AS owner,
           COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
           privilege.privilege_type AS privilege_type,
           privilege.is_grantable AS is_grantable
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS privilege
    LEFT JOIN pg_roles AS grantee ON grantee.oid = privilege.grantee
    WHERE n.nspname = $1
      AND c.relkind IN ('r', 'p')
    ORDER BY c.relname, grantee, privilege.privilege_type`,
    [schemaName],
  );

  const columnsResult = await queryCatalog(
    client,
    `
    SELECT c.relname AS table_name,
           a.attname AS column_name,
           pg_get_userbyid(c.relowner) AS owner
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    JOIN pg_attribute AS a ON a.attrelid = c.oid
    WHERE n.nspname = $1
      AND c.relkind IN ('r', 'p')
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY c.relname, a.attnum`,
    [schemaName],
  );

  const columnAclResult = await queryCatalog(
    client,
    `
    SELECT c.relname AS table_name,
           a.attname AS column_name,
           pg_get_userbyid(c.relowner) AS owner,
           COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
           privilege.privilege_type AS privilege_type,
           privilege.is_grantable AS is_grantable
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    JOIN pg_attribute AS a ON a.attrelid = c.oid
    CROSS JOIN LATERAL aclexplode(a.attacl) AS privilege
    LEFT JOIN pg_roles AS grantee ON grantee.oid = privilege.grantee
    WHERE n.nspname = $1
      AND c.relkind IN ('r', 'p')
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY c.relname, a.attnum, grantee, privilege.privilege_type`,
    [schemaName],
  );

  const sequencesResult = await queryCatalog(
    client,
    `
    SELECT c.relname AS sequence_name,
           pg_get_userbyid(c.relowner) AS owner,
           COALESCE(c.relacl::text, '') AS acl_metadata
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = $1
      AND c.relkind = 'S'
    ORDER BY c.relname`,
    [schemaName],
  );

  const sequenceAclResult = await queryCatalog(
    client,
    `
    SELECT c.relname AS sequence_name,
           pg_get_userbyid(c.relowner) AS owner,
           COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
           privilege.privilege_type AS privilege_type,
           privilege.is_grantable AS is_grantable
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('S', c.relowner))) AS privilege
    LEFT JOIN pg_roles AS grantee ON grantee.oid = privilege.grantee
    WHERE n.nspname = $1
      AND c.relkind = 'S'
    ORDER BY c.relname, grantee, privilege.privilege_type`,
    [schemaName],
  );

  const defaultContextsResult = await queryCatalog(
    client,
    `
    WITH object_types(object_type, object_kind) AS (
      VALUES ('tables'::text, 'r'::"char"), ('sequences'::text, 'S'::"char"),
             ('functions'::text, 'f'::"char"), ('types'::text, 'T'::"char")
    ), eligible_creators(owner_oid) AS (
      SELECT n.nspowner FROM pg_namespace AS n WHERE n.nspname = $1
      UNION
      SELECT role_catalog.oid
      FROM pg_roles AS role_catalog
      JOIN pg_namespace AS n ON n.nspname = $1
      WHERE has_schema_privilege(role_catalog.oid, n.oid, 'CREATE')
    )
    SELECT pg_get_userbyid(eligible_creators.owner_oid) AS defining_owner,
           object_types.object_type,
           global_acl.oid IS NOT NULL AS global_override_configured,
           schema_acl.oid IS NOT NULL AS schema_additive_acl_configured
    FROM eligible_creators
    CROSS JOIN object_types
    LEFT JOIN pg_default_acl AS global_acl
      ON global_acl.defaclnamespace = 0
     AND global_acl.defaclrole = eligible_creators.owner_oid
     AND global_acl.defaclobjtype = object_types.object_kind
    LEFT JOIN pg_namespace AS n ON n.nspname = $1
    LEFT JOIN pg_default_acl AS schema_acl
      ON schema_acl.defaclnamespace = n.oid
     AND schema_acl.defaclrole = eligible_creators.owner_oid
     AND schema_acl.defaclobjtype = object_types.object_kind
    ORDER BY defining_owner, object_types.object_type`,
    [schemaName],
  );

  const defaultPrivilegesResult = await queryCatalog(
    client,
    // Global defaults replace PostgreSQL's built-in defaults; schema-specific
    // entries are additive and cannot revoke a global grant (PostgreSQL 17).
    `
    WITH object_types(object_type, object_kind) AS (
      VALUES ('tables'::text, 'r'::"char"), ('sequences'::text, 'S'::"char"),
             ('functions'::text, 'f'::"char"), ('types'::text, 'T'::"char")
    ), eligible_creators(owner_oid) AS (
      SELECT n.nspowner FROM pg_namespace AS n WHERE n.nspname = $1
      UNION
      SELECT role_catalog.oid
      FROM pg_roles AS role_catalog
      JOIN pg_namespace AS n ON n.nspname = $1
      WHERE has_schema_privilege(role_catalog.oid, n.oid, 'CREATE')
    ), effective_default_acl AS (
      SELECT eligible_creators.owner_oid,
             object_types.object_type,
             'global'::text AS acl_source,
             privilege.*
      FROM eligible_creators
      CROSS JOIN object_types
      LEFT JOIN pg_default_acl AS global_acl
        ON global_acl.defaclnamespace = 0
       AND global_acl.defaclrole = eligible_creators.owner_oid
       AND global_acl.defaclobjtype = object_types.object_kind
      CROSS JOIN LATERAL aclexplode(
        COALESCE(
          global_acl.defaclacl,
          acldefault(object_types.object_kind, eligible_creators.owner_oid)
        )
      ) AS privilege
      UNION ALL
      SELECT schema_acl.defaclrole AS owner_oid,
             object_types.object_type,
             'schema_additive'::text AS acl_source,
             privilege.*
      FROM pg_default_acl AS schema_acl
      JOIN pg_namespace AS n ON n.oid = schema_acl.defaclnamespace
      JOIN eligible_creators ON eligible_creators.owner_oid = schema_acl.defaclrole
      JOIN object_types ON object_types.object_kind = schema_acl.defaclobjtype
      CROSS JOIN LATERAL aclexplode(schema_acl.defaclacl) AS privilege
      WHERE n.nspname = $1
    )
    SELECT pg_get_userbyid(effective_default_acl.owner_oid) AS defining_owner,
           effective_default_acl.object_type,
           effective_default_acl.acl_source,
           COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
           effective_default_acl.privilege_type,
           effective_default_acl.is_grantable
    FROM effective_default_acl
    LEFT JOIN pg_roles AS grantee ON grantee.oid = effective_default_acl.grantee
    WHERE effective_default_acl.grantee <> effective_default_acl.owner_oid
    ORDER BY defining_owner, object_type, acl_source, grantee, privilege_type`,
    [schemaName],
  );

  const functionResult = await queryCatalog(
    client,
    `
    SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS function_name,
           pg_get_userbyid(p.proowner) AS owner,
           p.prosecdef AS security_definer,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
           has_function_privilege($2, p.oid, 'EXECUTE') AS runtime_execute,
           EXISTS (
             SELECT 1
             FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg(setting)
             WHERE cfg.setting LIKE 'search_path=%'
           ) AS has_explicit_search_path,
           EXISTS (
             SELECT 1
             FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg(setting)
             WHERE cfg.setting = 'search_path=pg_catalog'
                OR cfg.setting LIKE 'search_path=pg_catalog,%'
           ) AS search_path_pg_catalog_first
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = $1
    ORDER BY function_name`,
    [schemaName, runtimeRole],
  );

  const routineAclResult = await queryCatalog(
    client,
    `
    SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS routine_name,
           pg_get_userbyid(p.proowner) AS owner,
           COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
           privilege.privilege_type AS privilege_type,
           privilege.is_grantable AS is_grantable
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS privilege
    LEFT JOIN pg_roles AS grantee ON grantee.oid = privilege.grantee
    WHERE n.nspname = $1
    ORDER BY routine_name, grantee, privilege.privilege_type`,
    [schemaName],
  );

  const exposureResult = await queryCatalog(
    client,
    `
    SELECT current_setting('pgrst.db_schemas', true) IS NOT NULL AS session_setting_present,
           EXISTS (
             SELECT 1
             FROM pg_db_role_setting AS settings
             CROSS JOIN LATERAL unnest(settings.setconfig) AS cfg(setting)
             WHERE cfg.setting LIKE 'pgrst.db_schemas=%'
           ) AS catalog_setting_present,
           EXISTS (
             SELECT 1
             FROM pg_db_role_setting AS settings
             CROSS JOIN LATERAL unnest(settings.setconfig) AS cfg(setting)
             WHERE cfg.setting LIKE 'pgrst.db_schemas=%'
               AND position($1 IN cfg.setting) > 0
           ) AS catalog_mentions_private_schema
    LIMIT 1`,
    [schemaName],
  );

  const externalSchemaResult = await queryCatalog(
    client,
    `
    SELECT role_catalog.rolname AS role_name,
           n.nspname AS schema_name,
           has_schema_privilege(role_catalog.oid, n.oid, 'USAGE') AS has_usage,
           has_schema_privilege(role_catalog.oid, n.oid, 'CREATE') AS has_create
    FROM pg_roles AS role_catalog
    JOIN pg_namespace AS n ON n.nspname = $1
    WHERE role_catalog.oid <> n.nspowner
    ORDER BY role_catalog.rolname`,
    [schemaName],
  );

  const externalTableResult = await queryCatalog(
    client,
    `
    SELECT role_catalog.rolname AS role_name,
           c.relname AS table_name,
           has_table_privilege(role_catalog.oid, c.oid, 'SELECT') AS can_select,
           has_table_privilege(role_catalog.oid, c.oid, 'INSERT') AS can_insert,
           has_table_privilege(role_catalog.oid, c.oid, 'UPDATE') AS can_update,
           has_table_privilege(role_catalog.oid, c.oid, 'DELETE') AS can_delete,
           has_table_privilege(role_catalog.oid, c.oid, 'TRUNCATE') AS can_truncate,
           has_table_privilege(role_catalog.oid, c.oid, 'REFERENCES') AS can_references,
           has_table_privilege(role_catalog.oid, c.oid, 'TRIGGER') AS can_trigger,
           has_table_privilege(role_catalog.oid, c.oid, 'MAINTAIN') AS can_maintain
    FROM pg_roles AS role_catalog
    CROSS JOIN pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = $1
      AND c.relkind IN ('r', 'p')
      AND role_catalog.oid <> c.relowner
    ORDER BY role_catalog.rolname, c.relname`,
    [schemaName],
  );

  const externalSequenceResult = await queryCatalog(
    client,
    `
    SELECT role_catalog.rolname AS role_name,
           c.relname AS sequence_name,
           has_sequence_privilege(role_catalog.oid, c.oid, 'USAGE') AS can_usage,
           has_sequence_privilege(role_catalog.oid, c.oid, 'SELECT') AS can_select,
           has_sequence_privilege(role_catalog.oid, c.oid, 'UPDATE') AS can_update
    FROM pg_roles AS role_catalog
    CROSS JOIN pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = $1
      AND c.relkind = 'S'
      AND role_catalog.oid <> c.relowner
    ORDER BY role_catalog.rolname, c.relname`,
    [schemaName],
  );

  const externalColumnResult = await queryCatalog(
    client,
    `
    SELECT role_catalog.rolname AS role_name,
           c.relname AS table_name,
           a.attname AS column_name,
           has_column_privilege(role_catalog.oid, c.oid, a.attnum, 'SELECT') AS can_select,
           has_column_privilege(role_catalog.oid, c.oid, a.attnum, 'INSERT') AS can_insert,
           has_column_privilege(role_catalog.oid, c.oid, a.attnum, 'UPDATE') AS can_update,
           has_column_privilege(role_catalog.oid, c.oid, a.attnum, 'REFERENCES') AS can_references
    FROM pg_roles AS role_catalog
    CROSS JOIN pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    JOIN pg_attribute AS a ON a.attrelid = c.oid
    WHERE n.nspname = $1
      AND c.relkind IN ('r', 'p')
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND role_catalog.oid <> c.relowner
    ORDER BY role_catalog.rolname, c.relname, a.attnum`,
    [schemaName],
  );

  const externalRoutineResult = await queryCatalog(
    client,
    `
    SELECT role_catalog.rolname AS role_name,
           p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS routine_name,
           has_function_privilege(role_catalog.oid, p.oid, 'EXECUTE') AS can_execute
    FROM pg_roles AS role_catalog
    CROSS JOIN pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = $1
      AND role_catalog.oid <> p.proowner
    ORDER BY role_catalog.rolname, routine_name`,
    [schemaName],
  );

  const runtimeSchemaResult = await queryCatalog(
    client,
    `
    SELECT has_schema_privilege($1, $2, 'USAGE') AS has_usage,
           has_schema_privilege($1, $2, 'CREATE') AS has_create
    LIMIT 1`,
    [runtimeRole, schemaName],
  );

  const runtimeTableResult = await queryCatalog(
    client,
    `
    SELECT c.relname AS table_name,
           has_table_privilege($2, c.oid, 'SELECT') AS can_select,
           has_table_privilege($2, c.oid, 'INSERT') AS can_insert,
           has_table_privilege($2, c.oid, 'UPDATE') AS can_update,
           has_table_privilege($2, c.oid, 'DELETE') AS can_delete,
           has_table_privilege($2, c.oid, 'TRUNCATE') AS can_truncate,
           has_table_privilege($2, c.oid, 'REFERENCES') AS can_references,
           has_table_privilege($2, c.oid, 'TRIGGER') AS can_trigger,
           has_table_privilege($2, c.oid, 'MAINTAIN') AS can_maintain
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = $1
      AND c.relkind IN ('r', 'p')
    ORDER BY c.relname`,
    [schemaName, runtimeRole],
  );

  const runtimeSequenceResult = await queryCatalog(
    client,
    `
    SELECT c.relname AS sequence_name,
           has_sequence_privilege($2, c.oid, 'USAGE') AS can_usage,
           has_sequence_privilege($2, c.oid, 'SELECT') AS can_select,
           has_sequence_privilege($2, c.oid, 'UPDATE') AS can_update
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = $1
      AND c.relkind = 'S'
    ORDER BY c.relname`,
    [schemaName, runtimeRole],
  );

  const runtimeRoutineResult = await queryCatalog(
    client,
    `
    SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS routine_name,
           has_function_privilege($2, p.oid, 'EXECUTE') AS can_execute
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = $1
    ORDER BY routine_name`,
    [schemaName, runtimeRole],
  );

  const columns = withColumnKeys(rowsOrNull(columnsResult));
  const columnAclPrivileges = withColumnKeys(rowsOrNull(columnAclResult));
  const externalColumnPrivileges = withColumnKeys(
    rowsOrNull(externalColumnResult),
  );
  const functions = rowsOrNull(functionResult)?.map((row) => ({
    ...row,
    routine_name: row.function_name,
  }));

  const data = {
    runtime_role: rowsOrNull(roleResult)?.[0] ?? null,
    role_memberships: rowsOrNull(membershipResult),
    roles: rowsOrNull(rolesResult),
    schema: rowsOrNull(schemaResult)?.[0] ?? null,
    raw_tables: rowsOrNull(tableResult),
    policies: rowsOrNull(policyResult),
    policy_counts: rowsOrNull(policyCountsResult),
    schema_acl_privileges: rowsOrNull(schemaAclResult),
    table_acl_privileges: rowsOrNull(tableAclResult),
    columns,
    column_acl_privileges: columnAclPrivileges,
    sequences: rowsOrNull(sequencesResult),
    sequence_acl_privileges: rowsOrNull(sequenceAclResult),
    default_privilege_contexts: rowsOrNull(defaultContextsResult),
    default_privileges: rowsOrNull(defaultPrivilegesResult),
    functions,
    routine_acl_privileges: rowsOrNull(routineAclResult),
    schema_exposure_raw: rowsOrNull(exposureResult)?.[0] ?? null,
    external_schema_privileges: rowsOrNull(externalSchemaResult),
    external_table_privileges: rowsOrNull(externalTableResult),
    external_sequence_privileges: rowsOrNull(externalSequenceResult),
    external_column_privileges: externalColumnPrivileges,
    external_routine_privileges: rowsOrNull(externalRoutineResult),
    runtime_schema_privilege: rowsOrNull(runtimeSchemaResult)?.[0] ?? null,
    runtime_table_privileges: rowsOrNull(runtimeTableResult),
    runtime_sequence_privileges: rowsOrNull(runtimeSequenceResult),
    runtime_routine_privileges: rowsOrNull(runtimeRoutineResult),
  };
  return data;
}

function unavailable(context, name, summary) {
  return safeFailureCheck(context, name, summary);
}

function evaluateOwners(schema, tables, sequences) {
  if (!schema || !Array.isArray(tables) || !Array.isArray(sequences))
    return null;
  const unexpected = [];
  if (schema.owner !== "postgres")
    unexpected.push(`schema:${schema.owner ?? "unknown"}`);
  for (const table of tables)
    if (table.owner !== "postgres")
      unexpected.push(`table:${table.table_name}:${table.owner ?? "unknown"}`);
  for (const sequence of sequences)
    if (sequence.owner !== "postgres")
      unexpected.push(
        `sequence:${sequence.sequence_name}:${sequence.owner ?? "unknown"}`,
      );
  return {
    status: unexpected.length === 0 ? "pass" : "fail",
    unexpected_owners: unexpected,
  };
}

function evaluateFunctions(functions) {
  if (!Array.isArray(functions)) return null;
  const risks = functions.filter(
    (fn) =>
      fn.security_definer &&
      (!fn.has_explicit_search_path || !fn.search_path_pg_catalog_first),
  );
  return {
    status: risks.length === 0 ? "pass" : "fail",
    risk_functions: risks.map((fn) => fn.function_name),
  };
}

function exposureIndicator(raw) {
  if (!raw) {
    return {
      status: "unknown",
      explanation:
        "PostgREST schema settings could not be inspected with this catalog-only connection.",
      session_setting_present: null,
      catalog_setting_present: null,
      catalog_mentions_private_schema: null,
    };
  }
  if (raw.catalog_mentions_private_schema) {
    return {
      status: "fail",
      explanation:
        "A database-role PostgREST schema setting mentions the private schema; confirm and remove external exposure unless explicitly reviewed.",
      session_setting_present: raw.session_setting_present,
      catalog_setting_present: raw.catalog_setting_present,
      catalog_mentions_private_schema: true,
    };
  }
  return {
    status: "unknown",
    explanation:
      "No database-role PostgREST setting mentioned the private schema; catalog settings cannot establish all API-gateway exposure paths.",
    session_setting_present: raw.session_setting_present,
    catalog_setting_present: raw.catalog_setting_present,
    catalog_mentions_private_schema: false,
  };
}

function checkFromEvaluation(
  context,
  name,
  evaluation,
  passSummary,
  failSummary,
  evidence = evaluation,
) {
  if (!evaluation)
    return unavailable(context, name, `${name} catalog query unavailable`);
  return makeCheck(
    context,
    name,
    evaluation.status,
    evaluation.status === "pass" ? passSummary : failSummary,
    evidence,
  );
}

function hydrateTables(rawTables, policyCounts) {
  if (!Array.isArray(rawTables) || !Array.isArray(policyCounts)) return null;
  const counts = new Map(
    policyCounts.map((row) => [row.table_name, row.policy_count]),
  );
  return rawTables.map((row) => ({
    ...row,
    policy_count: counts.get(row.table_name) ?? 0,
  }));
}

function buildFindings(report) {
  const failures = report.checks.filter(
    (check) => check.status === "fail" || check.status === "error",
  );
  const findings = [];
  if (failures.length === 0) {
    findings.push(
      "No failing configuration finding was measured by the completed catalog and bounded-probe checks.",
    );
  } else {
    findings.push(
      `Configuration findings require review in ${failures.length} failing or unavailable automated check(s): ${failures.map((check) => check.name).join(", ")}.`,
    );
  }
  findings.push(
    "The privileged PostgreSQL connection principal is a trust boundary: it can select the restricted backend role. Rotate the database credential and keep it server-only.",
  );
  findings.push(
    "The `USING true` backend RLS policies intentionally gate only the server runtime role; they do not impose per-user or per-circle authorization.",
  );
  findings.push(
    "Catalog-visible PostgREST settings are an incomplete exposure indicator. Missing or unsupported settings are reported as unknown rather than as evidence of non-exposure.",
  );
  findings.push(
    "This audit did not test live account actions, signed-in authorization flows, session revocation, native clients, or a public API endpoint; it makes no claims about those outcomes.",
  );
  return findings;
}

function baseReport(context, runtimeRole = "circles_app_runtime") {
  return {
    report_version: 1,
    audit_name: "circles_supabase_postgresql_security_audit",
    overall_status: "fail",
    executed_at_utc: context.executedAt,
    source_tree: context.sourceTree,
    target: context.target,
    runtime_role: runtimeRole,
    method: {
      database_access: "catalog_metadata_and_bounded_select_1_only",
      mutation_statement_issued: false,
      application_row_values_exported: false,
      secrets_or_raw_errors_exported: false,
    },
    checks: [],
    summary: {},
    evidence: {},
    findings: [],
  };
}

export async function runAudit(options) {
  const projectDir = resolve(options.projectDir ?? DEFAULT_PROJECT_DIR);
  const context = {
    sourceTree: await getSourceTree(projectDir),
    executedAt: new Date().toISOString(),
    target: `Supabase project ${PROJECT_REF}; database postgres; schemas ${SCHEMA}, ${ADMIN_SCHEMA}`,
  };
  let report = baseReport(context);
  let client;
  try {
    const { configuration, manifest, currentAppNames } =
      await loadProjectConfiguration(projectDir);
    const runtimeRole = configuration.RUNTIME_ROLE;
    if (runtimeRole !== "circles_app_runtime")
      throw new Error("Unexpected runtime role configuration");
    report.runtime_role = runtimeRole;
    const { Client } = requirePgFromProject(projectDir);
    // This calls the project's certificate-verifying connection helper. Its returned
    // password is passed only to pg and never copied into report data or errors.
    const connectionOptions = configuration.getPostgresConnectionOptions(
      process.env,
      projectDir,
    );
    client = new Client(connectionOptions);
    await client.connect();
    report.checks.push(
      makeCheck(
        context,
        "verified_connection_configuration",
        "pass",
        "Project connection helper and project-resolved pg client connected without exposing connection material.",
      ),
    );

    let evidence;
    let adminEvidence;
    let catalogTransactionBegan = false;
    try {
      await client.query("BEGIN READ ONLY");
      catalogTransactionBegan = true;
      evidence = await collectEvidence(client, SCHEMA, runtimeRole);
      adminEvidence = await collectEvidence(client, ADMIN_SCHEMA, runtimeRole);
    } finally {
      if (catalogTransactionBegan) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Individual unavailable catalog results remain fail-closed and redacted.
        }
      }
    }
    const expectedAppNames = [...currentAppNames];
    const expectedNames = [...expectedAppNames, manifest.DATA_MIGRATION_TABLE];
    const tables = hydrateTables(evidence.raw_tables, evidence.policy_counts);
    const adminTables = hydrateTables(
      adminEvidence.raw_tables,
      adminEvidence.policy_counts,
    );
    const policies = (evidence.policies ?? []).map((policy) => ({
      ...policy,
      roles: normalizedRoles(policy.roles),
    }));
    const adminPolicies = (adminEvidence.policies ?? []).map((policy) => ({
      ...policy,
      roles: normalizedRoles(policy.roles),
    }));

    report.evidence = {
      schema: evidence.schema,
      tables,
      policies: [...policies, ...adminPolicies],
      admin_schema: adminEvidence.schema,
      admin_tables: adminTables,
      admin_policies: adminPolicies,
      admin_functions: adminEvidence.functions,
      roles: evidence.roles,
      role_memberships: evidence.role_memberships,
      schema_acl_privileges: evidence.schema_acl_privileges,
      table_acl_privileges: evidence.table_acl_privileges,
      columns: evidence.columns,
      column_acl_privileges: evidence.column_acl_privileges,
      sequences: evidence.sequences,
      sequence_acl_privileges: evidence.sequence_acl_privileges,
      functions: evidence.functions,
      routine_acl_privileges: evidence.routine_acl_privileges,
      default_privilege_contexts: evidence.default_privilege_contexts,
      default_privileges: evidence.default_privileges,
      runtime_role: evidence.runtime_role,
      runtime_schema_privilege: evidence.runtime_schema_privilege,
      runtime_table_privileges: evidence.runtime_table_privileges,
      runtime_sequence_privileges: evidence.runtime_sequence_privileges,
      runtime_routine_privileges: evidence.runtime_routine_privileges,
    };

    const inventory = Array.isArray(evidence.raw_tables)
      ? evaluateInventory(expectedNames, evidence.raw_tables)
      : null;
    report.checks.push(
      checkFromEvaluation(
        context,
        "private_table_inventory",
        inventory,
        "Exactly 27 expected private tables were cataloged (26 application tables plus _dataMigrations).",
        "Private table inventory differs from the 27 expected objects.",
      ),
    );

    const rls = Array.isArray(evidence.raw_tables)
      ? evaluateRls(expectedNames, evidence.raw_tables)
      : null;
    report.checks.push(
      checkFromEvaluation(
        context,
        "row_level_security",
        rls,
        "RLS is enabled on every expected private table.",
        "One or more expected private tables lack enabled RLS.",
      ),
    );

    const policyEvaluation =
      Array.isArray(evidence.policies) && Array.isArray(adminEvidence.policies)
        ? evaluateAppAdminPolicies([...policies, ...adminPolicies])
        : null;
    report.checks.push(
      checkFromEvaluation(
        context,
        "exact_runtime_rls_policies",
        policyEvaluation,
        "Every app/admin policy matches one complete reviewed pre/post DB-09 named variant, including browser-deny, app-runtime, admin-runtime, and native-executor predicates.",
        "An app/admin RLS policy name, role, command, permissiveness, predicate, count, or reviewed transition variant differs from the finite authorization contract.",
      ),
    );

    const runtimeRoleEvaluation = evaluateRuntimeRole(
      evidence.runtime_role,
      evidence.role_memberships,
    );
    report.checks.push(
      checkFromEvaluation(
        context,
        "restricted_backend_role_flags",
        runtimeRoleEvaluation,
        "circles_app_runtime is NOLOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS, and has no role-membership elevation path.",
        "circles_app_runtime is absent, has an unsafe role attribute, or has a role-membership elevation path.",
      ),
    );

    const adminAuthorizationEvaluation = evaluateAdminAuthorizationContract(
      evidence,
      adminEvidence,
    );
    report.checks.push(
      checkFromEvaluation(
        context,
        "reviewed_admin_authorization_contract",
        adminAuthorizationEvaluation,
        "The two reviewed admin roles, their exact membership edges, app-side schema/table/column/sequence ACLs, admin table inventory, and native helper set match the finite contract.",
        "Reviewed admin-role flags, membership, app ACLs, admin inventory, native helpers, or named DB-08 helper-path state differ from the finite contract.",
      ),
    );

    const appLoginAuthorizationEvaluation =
      evaluateAppLoginAuthorizationContract(evidence);
    report.checks.push(
      checkFromEvaluation(
        context,
        "dedicated_application_login_authorization_contract",
        appLoginAuthorizationEvaluation,
        "Dedicated application-login evidence matches one whole reviewed DB-02 state: historical baseline, NOLOGIN provisioning, or protected LOGIN cutover; any direct object ACL or extra membership edge is absent.",
        "Dedicated application-login role flags, its SET-only runtime membership, direct object ACL boundary, or named DB-02 transition state differs from the finite contract.",
      ),
    );

    const ownerEvaluation = evaluateOwners(
      evidence.schema,
      evidence.raw_tables,
      evidence.sequences,
    );
    report.checks.push(
      checkFromEvaluation(
        context,
        "schema_table_sequence_owners",
        ownerEvaluation,
        "Private schema, tables, and identity sequences are owned by postgres as expected.",
        "One or more private schema objects have an unexpected owner.",
      ),
    );

    const externalPrivilegeEvidence = withoutReviewedContractRoleEvidence({
      roles: evidence.roles,
      role_memberships: evidence.role_memberships,
      schema: evidence.schema,
      tables: evidence.raw_tables,
      columns: evidence.columns,
      sequences: evidence.sequences,
      routines: evidence.functions,
      schema_privileges: evidence.external_schema_privileges,
      table_privileges: evidence.external_table_privileges,
      column_privileges: evidence.external_column_privileges,
      sequence_privileges: evidence.external_sequence_privileges,
      routine_privileges: evidence.external_routine_privileges,
      schema_acl_privileges: evidence.schema_acl_privileges,
      table_acl_privileges: evidence.table_acl_privileges,
      column_acl_privileges: evidence.column_acl_privileges,
      sequence_acl_privileges: evidence.sequence_acl_privileges,
      routine_acl_privileges: evidence.routine_acl_privileges,
    });
    const externalPrivilegeEvaluation = evaluateExternalPrivileges(
      externalPrivilegeEvidence,
    );
    report.checks.push(
      checkFromEvaluation(
        context,
        "all_non_owner_schema_object_privileges",
        externalPrivilegeEvaluation,
        "Every non-admin role remains in the complete effective-privilege matrix; no ordinary/API/runtime role has an unsafe effective privilege or direct ACL, and only exact reviewed provider-managed capabilities were separately classified.",
        "Privilege evidence is incomplete; an ordinary/API/runtime or unreviewed role has an effective privilege; a direct ACL or grant option exists; a reviewed-role identity check failed; or a trusted privileged role reaches an untrusted member.",
      ),
    );

    const defaultPrivilegesEvaluation = evaluateDefaultPrivileges(
      evidence.default_privilege_contexts,
      evidence.default_privileges,
      schemaUsageForCurrentNonowners(
        evidence.external_schema_privileges,
        runtimeRole,
      ),
    );
    report.checks.push(
      checkFromEvaluation(
        context,
        "default_privileges",
        defaultPrivilegesEvaluation,
        "Every current private-schema creator has no dangerous non-owner effective global or schema-additive default privilege grant; default TYPE USAGE is recorded separately as a conditional future-type condition.",
        "Effective global-plus-schema default ACL metadata is incomplete or contains a dangerous future-object grant, including function EXECUTE; default TYPE USAGE remains separately recorded rather than treated as current table or Data API disclosure.",
        {
          default_privilege_contexts: evidence.default_privilege_contexts,
          default_privileges: evidence.default_privileges,
          evaluation: defaultPrivilegesEvaluation,
        },
      ),
    );

    const runtimePrivilegesEvaluation = Array.isArray(
      evidence.runtime_table_privileges,
    )
      ? evaluateRuntimePrivileges(
          expectedAppNames,
          MARKER_TABLE,
          evidence.runtime_table_privileges,
        )
      : null;
    report.checks.push(
      checkFromEvaluation(
        context,
        "backend_table_privileges_and_marker_dml",
        runtimePrivilegesEvaluation,
        "Backend has all application-table DML privileges, marker SELECT, and no TRUNCATE/REFERENCES/TRIGGER/MAINTAIN or marker DML privilege (catalog verification only).",
        "Backend application privileges, destructive table privileges, or marker read-only privilege boundary differs from the expected design.",
      ),
    );

    const runtimeSequenceEvaluation =
      Array.isArray(evidence.sequences) &&
      Array.isArray(evidence.runtime_sequence_privileges)
        ? evaluateRuntimeSequencePrivileges(
            evidence.sequences,
            evidence.runtime_sequence_privileges,
          )
        : null;
    report.checks.push(
      checkFromEvaluation(
        context,
        "backend_sequence_privileges",
        runtimeSequenceEvaluation,
        "Backend has required USAGE/SELECT and no UPDATE privilege on every private sequence.",
        "Backend sequence privilege metadata is incomplete or differs from the required USAGE/SELECT-only boundary.",
      ),
    );

    const runtimeRoutineEvaluation =
      Array.isArray(evidence.functions) &&
      Array.isArray(evidence.runtime_routine_privileges)
        ? evaluateRuntimeRoutinePrivileges(
            evidence.functions,
            evidence.runtime_routine_privileges,
          )
        : null;
    report.checks.push(
      checkFromEvaluation(
        context,
        "backend_routine_privileges",
        runtimeRoutineEvaluation,
        "Backend has no EXECUTE privilege on any current private-schema routine.",
        "Backend routine privilege metadata is incomplete or grants EXECUTE in the private schema.",
      ),
    );

    const runtimeSchemaEvaluation =
      evidence.runtime_schema_privilege === null
        ? null
        : evaluateRuntimeSchemaPrivileges(evidence.runtime_schema_privilege);
    report.checks.push(
      checkFromEvaluation(
        context,
        "backend_schema_usage_and_no_create",
        runtimeSchemaEvaluation,
        "Backend role has required private-schema USAGE and no CREATE privilege.",
        "Backend schema privilege metadata is incomplete, lacks required USAGE, or permits CREATE.",
      ),
    );

    const externalProbes = [];
    for (const roleName of EXTERNAL_ROLES) {
      externalProbes.push(
        await runRoleProbe(client, roleName, SCHEMA, "users"),
      );
    }
    report.evidence.external_probes = externalProbes;
    const probeOutcomes = externalProbes.map((probe) => probe.outcome);
    const externalProbeStatus = probeOutcomes.every(
      (outcome) => outcome === "denied",
    )
      ? "pass"
      : probeOutcomes.includes("allowed")
        ? "fail"
        : "error";
    report.checks.push(
      makeCheck(
        context,
        "external_role_read_only_permission_probes",
        externalProbeStatus,
        externalProbeStatus === "pass"
          ? "Per-role read-only transactions denied bounded SELECT 1 probes on circles_app.users and rolled back safely."
          : "One or more external role probes were allowed or could not be classified without exposing driver details.",
        { probes: externalProbes },
      ),
    );

    const externalAdminProbes = [];
    for (const roleName of EXTERNAL_ROLES) {
      externalAdminProbes.push(
        await runRoleProbe(client, roleName, ADMIN_SCHEMA, "audit"),
      );
    }
    report.evidence.external_admin_probes = externalAdminProbes;
    const externalAdminProbeOutcomes = externalAdminProbes.map(
      (probe) => probe.outcome,
    );
    const externalAdminProbeStatus = externalAdminProbeOutcomes.every(
      (outcome) => outcome === "denied",
    )
      ? "pass"
      : externalAdminProbeOutcomes.includes("allowed")
        ? "fail"
        : "error";
    report.checks.push(
      makeCheck(
        context,
        "external_admin_schema_read_only_permission_probes",
        externalAdminProbeStatus,
        externalAdminProbeStatus === "pass"
          ? "Per-role read-only transactions denied bounded SELECT 1 probes on circles_admin.audit and rolled back safely."
          : "One or more external admin-schema probes were allowed or could not be classified without exposing driver details.",
        { probes: externalAdminProbes },
      ),
    );

    const backendProbe = await runBackendProbe(
      client,
      runtimeRole,
      SCHEMA,
      "users",
      MARKER_TABLE,
    );
    report.evidence.backend_probe = backendProbe;
    const backendProbeStatus =
      backendProbe.app_select === "allowed" &&
      backendProbe.marker_select === "allowed"
        ? "pass"
        : "error";
    report.checks.push(
      makeCheck(
        context,
        "backend_read_only_permission_probes",
        backendProbeStatus,
        backendProbeStatus === "pass"
          ? "Backend role was allowed bounded read-only SELECT 1 probes on an application table and the migration marker; transaction rolled back."
          : "Backend permission probe could not be completed without exposing driver details.",
        { probe: backendProbe },
      ),
    );

    const functionEvaluation = evaluateFunctions(evidence.functions);
    report.checks.push(
      checkFromEvaluation(
        context,
        "functions_security_definer_search_path",
        functionEvaluation,
        "No SECURITY DEFINER function lacks an explicit pg_catalog-first search_path in the private schema.",
        "One or more SECURITY DEFINER functions have an unsafe or unpinned search_path.",
      ),
    );

    const exposure = exposureIndicator(evidence.schema_exposure_raw);
    report.evidence.schema_exposure = exposure;
    report.checks.push(
      makeCheck(
        context,
        "schema_exposure_indicator",
        exposure.status,
        exposure.status === "fail"
          ? exposure.explanation
          : "Database catalog exposure indicators are incomplete; status is intentionally unknown unless a private-schema PostgREST setting is found.",
        exposure,
      ),
    );

    report.summary = {
      expected_table_count: expectedNames.length,
      cataloged_table_count: tables?.length ?? null,
      external_catalog_grants: externalPrivilegeEvaluation?.unauthorized
        ? Object.values(externalPrivilegeEvaluation.unauthorized).reduce(
            (total, rows) => total + rows.length,
            0,
          )
        : null,
      reviewed_provider_managed_capability_flags:
        externalPrivilegeEvaluation?.reviewed_effective_privilege_counts
          ? {
              total:
                externalPrivilegeEvaluation.reviewed_effective_privilege_total,
              by_category:
                externalPrivilegeEvaluation.reviewed_effective_privilege_counts,
            }
          : null,
      unsafe_privileged_membership_paths:
        externalPrivilegeEvaluation?.unsafe_privileged_membership_paths
          ?.length ?? null,
      marker_dml_denied: runtimePrivilegesEvaluation?.marker_read_only ?? null,
      runtime_sequence_boundary: runtimeSequenceEvaluation?.status ?? "unknown",
      function_risk_status: functionEvaluation?.status ?? "unknown",
      schema_exposure_indicator: exposure.status,
    };
  } catch {
    report.checks.push(
      makeCheck(
        context,
        "verified_connection_configuration",
        "error",
        "Project configuration, project-resolved pg, or database connection was unavailable; no connection details were retained.",
        { safe_error: "unavailable" },
      ),
    );
    report.summary = {
      expected_table_count: null,
      cataloged_table_count: null,
      external_catalog_grants: null,
      reviewed_provider_managed_capability_flags: null,
      unsafe_privileged_membership_paths: null,
      marker_dml_denied: null,
      runtime_sequence_boundary: "unknown",
      function_risk_status: "unknown",
      schema_exposure_indicator: "unknown",
    };
    report.evidence.schema_exposure = {
      status: "unknown",
      explanation:
        "Audit connection/configuration unavailable; no exposure conclusion was made.",
    };
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        // Safe to ignore: no raw diagnostics are emitted.
      }
    }
  }
  report.overall_status = overallStatusFromChecks(report.checks);
  report.findings = buildFindings(report);
  return report;
}

function usage() {
  return [
    "Usage: node circles-supabase-security-audit.mjs [options]",
    "  --project-dir <path>      Circles project root (default: /home/ubuntu/circles)",
    "  --json-output <path>      Required new private JSON path outside the Git tree",
    "  --markdown-output <path>  Required new private Markdown path outside the Git tree",
    "  --help                    Show this help",
  ].join("\n");
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch {
    console.error(
      "Security audit arguments are invalid. Use --help for usage.",
    );
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }
  let outputPaths;
  try {
    outputPaths = await validateOutputPaths(options);
  } catch {
    console.error(
      "Security audit output paths are invalid or already exist. Use --help for requirements.",
    );
    process.exitCode = 2;
    return;
  }
  const report = await runAudit(options);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderMarkdown(report);
  try {
    await writePrivateReportPair(outputPaths, json, markdown);
  } catch {
    console.error(
      "Security audit completed but requested report output could not be written.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Security audit ${statusWord(report.overall_status)}. JSON and Markdown were written as new private files.`,
  );
  if (report.overall_status !== "pass") process.exitCode = 1;
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
