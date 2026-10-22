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
import { isAbsolute, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);
const DEFAULT_PROJECT_DIR = "/home/ubuntu/circles";
const PROJECT_REF = "vvclcsqletcxzoaayqzq";
const SCHEMA = "circles_app";
const MARKER_TABLE = "_dataMigrations";
const EXTERNAL_ROLES = Object.freeze(["anon", "authenticated", "service_role"]);
const REQUIRED_RUNTIME_FLAGS = Object.freeze({
  can_login: false,
  inherits: false,
  is_superuser: false,
  bypasses_rls: false,
});

function absoluteOutputPath(value) {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
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

export function evaluateRuntimeRole(roleRow) {
  const violations = [];
  if (!roleRow) return { status: "fail", violations: ["runtime_role_missing"] };
  for (const [key, expected] of Object.entries(REQUIRED_RUNTIME_FLAGS)) {
    if (roleRow[key] !== expected) violations.push(key);
  }
  return { status: violations.length === 0 ? "pass" : "fail", violations };
}

export function evaluateExternalPrivileges(
  schemaPrivileges,
  tablePrivileges,
  sequencePrivileges,
) {
  const schemaViolations = schemaPrivileges
    .filter((row) => row.has_usage === true)
    .map((row) => row.role_name);
  const tableViolations = tablePrivileges.filter(
    (row) =>
      row.can_select || row.can_insert || row.can_update || row.can_delete,
  );
  const sequenceViolations = sequencePrivileges.filter(
    (row) => row.can_usage || row.can_select || row.can_update,
  );
  return {
    status:
      schemaViolations.length === 0 &&
      tableViolations.length === 0 &&
      sequenceViolations.length === 0
        ? "pass"
        : "fail",
    schema_usage_roles: schemaViolations,
    table_grants: tableViolations.map((row) => ({
      role_name: row.role_name,
      table_name: row.table_name,
      select: row.can_select,
      insert: row.can_insert,
      update: row.can_update,
      delete: row.can_delete,
    })),
    sequence_grants: sequenceViolations.map((row) => ({
      role_name: row.role_name,
      sequence_name: row.sequence_name,
      usage: row.can_usage,
      select: row.can_select,
      update: row.can_update,
    })),
  };
}

export function evaluateRuntimePrivileges(appNames, markerTable, runtimeRows) {
  const rows = new Map(runtimeRows.map((row) => [row.table_name, row]));
  const missingAppPrivileges = appNames.filter((name) => {
    const row = rows.get(name);
    return (
      !row ||
      !row.can_select ||
      !row.can_insert ||
      !row.can_update ||
      !row.can_delete
    );
  });
  const marker = rows.get(markerTable);
  const markerCorrect =
    Boolean(marker?.can_select) &&
    !marker?.can_insert &&
    !marker?.can_update &&
    !marker?.can_delete;
  return {
    status:
      missingAppPrivileges.length === 0 && markerCorrect ? "pass" : "fail",
    missing_app_privileges: missingAppPrivileges,
    marker_read_only: markerCorrect,
  };
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
  return { configuration, manifest };
}

function rowsOrNull(result) {
  return result ? result.rows : null;
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
  const tablePrivileges = groupedPrivileges(
    report.evidence.table_acl_privileges ?? [],
    "table_name",
  );
  const sequencePrivileges = groupedPrivileges(
    report.evidence.sequence_acl_privileges ?? [],
    "sequence_name",
  );
  const schemaPrivileges = groupedPrivileges(
    report.evidence.schema_acl_privileges ?? [],
    "schema_name",
  );
  const lines = [
    "# Circles Supabase PostgreSQL security audit",
    "",
    `**Overall status:** ${statusWord(report.overall_status)}`,
    "",
    "## Scope and guardrails",
    "",
    `- **Target:** Supabase project \`${PROJECT_REF}\`, database \`postgres\`, private schema \`${SCHEMA}\`.`,
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
    `Expected inventory: **21 application tables + \`${MARKER_TABLE}\` = 22 tables**.`,
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
    "## Exact RLS policies",
    "",
    markdownTable(
      [
        "Table",
        "Policy",
        "Roles",
        "Command",
        "USING qualification",
        "WITH CHECK qualification",
      ],
      policies.map((policy) => [
        policy.table_name,
        policy.policy_name,
        normalizedRoles(policy.roles).join(", "),
        policy.command,
        policy.using_qualification,
        policy.with_check_qualification,
      ]),
    ),
    "",
    "> All expected backend policies with `USING true` are intentionally **server-only**. They permit the restricted backend role after the application has selected it; they do **not** enforce per-user or per-circle authorization. Application resource authorization therefore remains a server-side responsibility.",
    "",
    "## Roles, effective permissions, and probes",
    "",
    `- Restricted role inspected: \`${report.runtime_role}\` (required: NOLOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS).`,
    `- External-role catalog grants to schema/tables/sequences: ${report.summary.external_catalog_grants === 0 ? "**none detected**" : `**${report.summary.external_catalog_grants} detected**`}.`,
    `- Backend app-table and marker read-only probe: **${toMarkdownCell(report.evidence.backend_probe?.app_select)}** / **${toMarkdownCell(report.evidence.backend_probe?.marker_select)}**.`,
    `- Marker catalog DML privilege result: **${report.summary.marker_dml_denied ? "denied as required" : "not denied"}**. No DML statement was issued.`,
    "",
    markdownTable(
      ["External role", "Probe table", "Read-only SELECT 1 result", "Bounded"],
      (report.evidence.external_probes ?? []).map((probe) => [
        probe.role_name,
        probe.table_name,
        probe.outcome,
        probe.returned_at_most_one_row,
      ]),
    ),
    "",
    "### Explicit schema ACL metadata",
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
    "### Explicit table ACL metadata",
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
    "### Explicit sequence ACL metadata",
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
    "### Default privileges",
    "",
    (report.evidence.default_privileges ?? []).length
      ? markdownTable(
          [
            "Defining owner",
            "Object type",
            "Explicit ACL entry count",
            "ACL metadata",
          ],
          report.evidence.default_privileges.map((row) => [
            row.defining_owner,
            row.object_type,
            row.explicit_acl_entry_count,
            row.acl_metadata,
          ]),
        )
      : "No schema-scoped default-ACL records were returned. Absence is recorded as metadata, not assumed to prove external gateway exposure settings.",
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
      : "No functions were returned from the private schema.",
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
           member.rolname AS member_role
    FROM pg_auth_members AS membership
    JOIN pg_roles AS parent ON parent.oid = membership.roleid
    JOIN pg_roles AS member ON member.oid = membership.member
    WHERE member.rolname = $1
    ORDER BY parent.rolname
    LIMIT 20`,
    [runtimeRole],
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
    ORDER BY c.relname
    LIMIT 50`,
    [schemaName],
  );

  const policyResult = await queryCatalog(
    client,
    `
    SELECT p.tablename AS table_name,
           p.policyname AS policy_name,
           p.roles AS roles,
           p.cmd AS command,
           p.qual AS using_qualification,
           p.with_check AS with_check_qualification
    FROM pg_policies AS p
    WHERE p.schemaname = $1
    ORDER BY p.tablename, p.policyname
    LIMIT 100`,
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
    ORDER BY p.tablename
    LIMIT 50`,
    [schemaName],
  );

  const schemaAclResult = await queryCatalog(
    client,
    `
    SELECT n.nspname AS schema_name,
           COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
           privilege.privilege_type AS privilege_type,
           privilege.is_grantable AS is_grantable
    FROM pg_namespace AS n
    CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) AS privilege
    LEFT JOIN pg_roles AS grantee ON grantee.oid = privilege.grantee
    WHERE n.nspname = $1
    ORDER BY grantee, privilege.privilege_type
    LIMIT 100`,
    [schemaName],
  );

  const tableAclResult = await queryCatalog(
    client,
    `
    SELECT c.relname AS table_name,
           COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
           privilege.privilege_type AS privilege_type,
           privilege.is_grantable AS is_grantable
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS privilege
    LEFT JOIN pg_roles AS grantee ON grantee.oid = privilege.grantee
    WHERE n.nspname = $1
      AND c.relkind IN ('r', 'p')
    ORDER BY c.relname, grantee, privilege.privilege_type
    LIMIT 500`,
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
    ORDER BY c.relname
    LIMIT 100`,
    [schemaName],
  );

  const sequenceAclResult = await queryCatalog(
    client,
    `
    SELECT c.relname AS sequence_name,
           COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
           privilege.privilege_type AS privilege_type,
           privilege.is_grantable AS is_grantable
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('S', c.relowner))) AS privilege
    LEFT JOIN pg_roles AS grantee ON grantee.oid = privilege.grantee
    WHERE n.nspname = $1
      AND c.relkind = 'S'
    ORDER BY c.relname, grantee, privilege.privilege_type
    LIMIT 500`,
    [schemaName],
  );

  const defaultPrivilegesResult = await queryCatalog(
    client,
    `
    SELECT pg_get_userbyid(d.defaclrole) AS defining_owner,
           CASE d.defaclobjtype
             WHEN 'r' THEN 'tables'
             WHEN 'S' THEN 'sequences'
             WHEN 'f' THEN 'functions'
             WHEN 'T' THEN 'types'
             WHEN 'n' THEN 'schemas'
             ELSE d.defaclobjtype::text
           END AS object_type,
           COALESCE(cardinality(d.defaclacl), 0)::integer AS explicit_acl_entry_count,
           COALESCE(d.defaclacl::text, '{}') AS acl_metadata
    FROM pg_default_acl AS d
    JOIN pg_namespace AS n ON n.oid = d.defaclnamespace
    WHERE n.nspname = $1
    ORDER BY defining_owner, object_type
    LIMIT 100`,
    [schemaName],
  );

  const defaultExternalGrantResult = await queryCatalog(
    client,
    `
    SELECT COALESCE(bool_or(COALESCE(grantee.rolname, 'PUBLIC') = ANY($2::text[])), false) AS external_default_grant_detected
    FROM pg_default_acl AS d
    JOIN pg_namespace AS n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) AS privilege
    LEFT JOIN pg_roles AS grantee ON grantee.oid = privilege.grantee
    WHERE n.nspname = $1
    LIMIT 1`,
    [schemaName, [...EXTERNAL_ROLES, "PUBLIC"]],
  );

  const functionResult = await queryCatalog(
    client,
    `
    SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS function_name,
           pg_get_userbyid(p.proowner) AS owner,
           p.prosecdef AS security_definer,
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
    ORDER BY function_name
    LIMIT 100`,
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
    WITH target_roles(role_name) AS (
      VALUES ('anon'::text), ('authenticated'::text), ('service_role'::text)
    )
    SELECT target_roles.role_name,
           has_schema_privilege(target_roles.role_name, $1, 'USAGE') AS has_usage
    FROM target_roles
    ORDER BY target_roles.role_name
    LIMIT 10`,
    [schemaName],
  );

  const externalTableResult = await queryCatalog(
    client,
    `
    WITH target_roles(role_name) AS (
      VALUES ('anon'::text), ('authenticated'::text), ('service_role'::text)
    )
    SELECT target_roles.role_name,
           c.relname AS table_name,
           has_table_privilege(target_roles.role_name, c.oid, 'SELECT') AS can_select,
           has_table_privilege(target_roles.role_name, c.oid, 'INSERT') AS can_insert,
           has_table_privilege(target_roles.role_name, c.oid, 'UPDATE') AS can_update,
           has_table_privilege(target_roles.role_name, c.oid, 'DELETE') AS can_delete
    FROM target_roles
    CROSS JOIN pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = $1
      AND c.relkind IN ('r', 'p')
    ORDER BY target_roles.role_name, c.relname
    LIMIT 100`,
    [schemaName],
  );

  const externalSequenceResult = await queryCatalog(
    client,
    `
    WITH target_roles(role_name) AS (
      VALUES ('anon'::text), ('authenticated'::text), ('service_role'::text)
    )
    SELECT target_roles.role_name,
           c.relname AS sequence_name,
           has_sequence_privilege(target_roles.role_name, c.oid, 'USAGE') AS can_usage,
           has_sequence_privilege(target_roles.role_name, c.oid, 'SELECT') AS can_select,
           has_sequence_privilege(target_roles.role_name, c.oid, 'UPDATE') AS can_update
    FROM target_roles
    CROSS JOIN pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = $1
      AND c.relkind = 'S'
    ORDER BY target_roles.role_name, c.relname
    LIMIT 300`,
    [schemaName],
  );

  const runtimeSchemaResult = await queryCatalog(
    client,
    `
    SELECT has_schema_privilege($1, $2, 'USAGE') AS has_usage
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
           has_table_privilege($2, c.oid, 'DELETE') AS can_delete
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = $1
      AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
    LIMIT 50`,
    [schemaName, runtimeRole],
  );

  const data = {
    runtime_role: rowsOrNull(roleResult)?.[0] ?? null,
    role_memberships: rowsOrNull(membershipResult),
    schema: rowsOrNull(schemaResult)?.[0] ?? null,
    raw_tables: rowsOrNull(tableResult),
    policies: rowsOrNull(policyResult),
    policy_counts: rowsOrNull(policyCountsResult),
    schema_acl_privileges: rowsOrNull(schemaAclResult),
    table_acl_privileges: rowsOrNull(tableAclResult),
    sequences: rowsOrNull(sequencesResult),
    sequence_acl_privileges: rowsOrNull(sequenceAclResult),
    default_privileges: rowsOrNull(defaultPrivilegesResult),
    default_external_grant: rowsOrNull(defaultExternalGrantResult)?.[0] ?? null,
    functions: rowsOrNull(functionResult),
    schema_exposure_raw: rowsOrNull(exposureResult)?.[0] ?? null,
    external_schema_privileges: rowsOrNull(externalSchemaResult),
    external_table_privileges: rowsOrNull(externalTableResult),
    external_sequence_privileges: rowsOrNull(externalSequenceResult),
    runtime_schema_privilege: rowsOrNull(runtimeSchemaResult)?.[0] ?? null,
    runtime_table_privileges: rowsOrNull(runtimeTableResult),
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
  const counts = new Map(
    (policyCounts ?? []).map((row) => [row.table_name, row.policy_count]),
  );
  return (rawTables ?? []).map((row) => ({
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
    target: `Supabase project ${PROJECT_REF}; database postgres; schema ${SCHEMA}`,
  };
  let report = baseReport(context);
  let client;
  try {
    const { configuration, manifest } =
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

    const evidence = await collectEvidence(client, SCHEMA, runtimeRole);
    const expectedAppNames = [...manifest.LEGACY_TABLE_NAMES];
    const expectedNames = [...expectedAppNames, manifest.DATA_MIGRATION_TABLE];
    const tables = hydrateTables(evidence.raw_tables, evidence.policy_counts);
    const policies = (evidence.policies ?? []).map((policy) => ({
      ...policy,
      roles: normalizedRoles(policy.roles),
    }));

    report.evidence = {
      schema: evidence.schema,
      tables,
      policies,
      role_memberships: evidence.role_memberships,
      schema_acl_privileges: evidence.schema_acl_privileges ?? [],
      table_acl_privileges: evidence.table_acl_privileges ?? [],
      sequences: evidence.sequences ?? [],
      sequence_acl_privileges: evidence.sequence_acl_privileges ?? [],
      default_privileges: evidence.default_privileges ?? [],
      runtime_role: evidence.runtime_role,
    };

    const inventory = Array.isArray(evidence.raw_tables)
      ? evaluateInventory(expectedNames, evidence.raw_tables)
      : null;
    report.checks.push(
      checkFromEvaluation(
        context,
        "private_table_inventory",
        inventory,
        "Exactly 22 expected private tables were cataloged (21 application tables plus _dataMigrations).",
        "Private table inventory differs from the 22 expected objects.",
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

    const policyEvaluation = Array.isArray(evidence.policies)
      ? evaluatePolicies(expectedAppNames, MARKER_TABLE, policies, runtimeRole)
      : null;
    report.checks.push(
      checkFromEvaluation(
        context,
        "exact_runtime_rls_policies",
        policyEvaluation,
        "Each application table has one ALL runtime policy with USING/WITH CHECK true; the marker has one SELECT-only runtime policy.",
        "RLS policy role, command, qualification, count, or table coverage differs from the expected server-only design.",
      ),
    );

    const runtimeRoleEvaluation = evaluateRuntimeRole(evidence.runtime_role);
    report.checks.push(
      checkFromEvaluation(
        context,
        "restricted_backend_role_flags",
        runtimeRoleEvaluation,
        "circles_app_runtime is NOLOGIN, NOINHERIT, NOSUPERUSER, and NOBYPASSRLS.",
        "circles_app_runtime is absent or has an unsafe role attribute.",
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

    const privilegesAvailable =
      Array.isArray(evidence.external_schema_privileges) &&
      Array.isArray(evidence.external_table_privileges) &&
      Array.isArray(evidence.external_sequence_privileges);
    const externalPrivilegeEvaluation = privilegesAvailable
      ? evaluateExternalPrivileges(
          evidence.external_schema_privileges,
          evidence.external_table_privileges,
          evidence.external_sequence_privileges,
        )
      : null;
    report.checks.push(
      checkFromEvaluation(
        context,
        "external_schema_table_sequence_privileges",
        externalPrivilegeEvaluation,
        "anon, authenticated, and service_role have no effective USAGE or table/sequence privileges in the private schema.",
        "One or more external roles have an effective private-schema, table, or sequence privilege.",
      ),
    );

    const defaultPrivilegesEvaluation =
      evidence.default_external_grant === null
        ? null
        : {
            status: evidence.default_external_grant
              .external_default_grant_detected
              ? "fail"
              : "pass",
          };
    report.checks.push(
      checkFromEvaluation(
        context,
        "default_privileges",
        defaultPrivilegesEvaluation,
        "No schema-scoped default privilege grant to PUBLIC, anon, authenticated, or service_role was cataloged.",
        "A schema-scoped default privilege grants a target external role.",
        {
          default_privileges: evidence.default_privileges ?? [],
          default_external_grant: evidence.default_external_grant,
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
        "Backend has all application-table DML privileges, marker SELECT, and no marker INSERT/UPDATE/DELETE privilege (catalog verification only).",
        "Backend application privileges or marker read-only privilege boundary differs from the expected design.",
      ),
    );

    const runtimeSchemaEvaluation =
      evidence.runtime_schema_privilege === null
        ? null
        : {
            status: evidence.runtime_schema_privilege.has_usage
              ? "pass"
              : "fail",
          };
    report.checks.push(
      checkFromEvaluation(
        context,
        "backend_schema_usage",
        runtimeSchemaEvaluation,
        "Backend role has required USAGE on the private schema.",
        "Backend role lacks required private-schema USAGE.",
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
      cataloged_table_count: tables.length,
      external_catalog_grants: externalPrivilegeEvaluation
        ? externalPrivilegeEvaluation.schema_usage_roles.length +
          externalPrivilegeEvaluation.table_grants.length +
          externalPrivilegeEvaluation.sequence_grants.length
        : null,
      marker_dml_denied: runtimePrivilegesEvaluation?.marker_read_only ?? null,
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
      expected_table_count: 22,
      cataloged_table_count: null,
      external_catalog_grants: null,
      marker_dml_denied: null,
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
  report.overall_status = report.checks.some(
    (check) => check.status === "fail" || check.status === "error",
  )
    ? "fail"
    : "pass";
  report.findings = buildFindings(report);
  return report;
}

function usage() {
  return [
    "Usage: node circles-supabase-security-audit.mjs [options]",
    "  --project-dir <path>      Circles project root (default: /home/ubuntu/circles)",
    "  --json-output <path>      Write structured metadata-only JSON report",
    "  --markdown-output <path>  Write human-readable Markdown report",
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
  const report = await runAudit(options);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderMarkdown(report);
  try {
    if (options.jsonOutput)
      await writeFile(options.jsonOutput, json, {
        encoding: "utf8",
        mode: 0o600,
      });
    if (options.markdownOutput)
      await writeFile(options.markdownOutput, markdown, {
        encoding: "utf8",
        mode: 0o600,
      });
  } catch {
    console.error(
      "Security audit completed but requested report output could not be written.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Security audit ${statusWord(report.overall_status)}. JSON: ${options.jsonOutput ?? "not requested"}; Markdown: ${options.markdownOutput ?? "not requested"}.`,
  );
  if (report.overall_status !== "pass") process.exitCode = 1;
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
