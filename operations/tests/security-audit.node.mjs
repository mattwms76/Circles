import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateDefaultPrivileges,
  evaluateExternalPrivileges,
  evaluateInventory,
  evaluatePolicies,
  evaluateRls,
  evaluateRuntimePrivileges,
  evaluateRuntimeRole,
  evaluateRuntimeRoutinePrivileges,
  evaluateRuntimeSchemaPrivileges,
  evaluateRuntimeSequencePrivileges,
  normalizeExpression,
  parseArgs,
} from "../../scripts/circles-supabase-security-audit.mjs";

const RUNTIME = "circles_app_runtime";
const APP_TABLES = ["users", "posts"];
const ALL_TABLES = [...APP_TABLES, "_dataMigrations"];
const EXTERNAL_ROLES = ["anon", "authenticated", "service_role"];
const REVIEWED_BUILTINS = [
  "pg_read_all_data",
  "pg_write_all_data",
  "pg_maintain",
];
const REVIEWED_MANAGED_ADMINS = [
  "supabase_etl_admin",
  "supabase_read_only_user",
];
const TABLE_PRIVILEGES = [
  "can_select",
  "can_insert",
  "can_update",
  "can_delete",
  "can_truncate",
  "can_references",
  "can_trigger",
  "can_maintain",
];

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

function privilegeRows(
  objects,
  objectKey,
  privilegeKeys,
  roleNames,
  configure = () => {},
) {
  return objects.flatMap((object) =>
    roleNames
      .filter((role_name) => role_name !== object.owner)
      .map((role_name) => {
        const row = {
          [objectKey]: object[objectKey],
          role_name,
          ...Object.fromEntries(privilegeKeys.map((key) => [key, false])),
        };
        configure(row, object);
        return row;
      }),
  );
}

function roleEvidence(role_name) {
  return {
    role_name,
    can_login: false,
    inherits: role_name !== RUNTIME,
    is_superuser: role_name === "postgres" || role_name === "supabase_admin",
    bypasses_rls: role_name === "postgres" || role_name === "supabase_admin",
    ...(REVIEWED_BUILTINS.includes(role_name)
      ? { is_catalog_builtin: true }
      : {}),
  };
}

function completePrivilegeEvidence(
  roleNames = ["postgres", RUNTIME, ...EXTERNAL_ROLES],
) {
  const schema = { schema_name: "circles_app", owner: "postgres" };
  const tables = [{ table_name: "users", owner: "postgres" }];
  const columns = [
    {
      table_name: "users",
      column_name: "id",
      column_key: JSON.stringify(["users", "id"]),
      owner: "postgres",
    },
  ];
  const sequences = [{ sequence_name: "users_id_seq", owner: "postgres" }];
  const routines = [{ routine_name: "private_helper()", owner: "postgres" }];
  return {
    roles: [...roleNames.map(roleEvidence)],
    role_memberships: [],
    schema,
    tables,
    columns,
    sequences,
    routines,
    schema_privileges: privilegeRows(
      [schema],
      "schema_name",
      ["has_usage", "has_create"],
      roleNames,
      (row) => {
        if (row.role_name === RUNTIME) row.has_usage = true;
      },
    ),
    table_privileges: privilegeRows(
      tables,
      "table_name",
      TABLE_PRIVILEGES,
      roleNames,
    ),
    column_privileges: privilegeRows(
      columns,
      "column_key",
      ["can_select", "can_insert", "can_update", "can_references"],
      roleNames,
    ),
    sequence_privileges: privilegeRows(
      sequences,
      "sequence_name",
      ["can_usage", "can_select", "can_update"],
      roleNames,
    ),
    routine_privileges: privilegeRows(
      routines,
      "routine_name",
      ["can_execute"],
      roleNames,
    ),
    schema_acl_privileges: [],
    table_acl_privileges: [],
    column_acl_privileges: [],
    sequence_acl_privileges: [],
    routine_acl_privileges: [],
  };
}

function runtimeTableRows() {
  return [
    ...APP_TABLES.map((table_name) => ({
      table_name,
      can_select: true,
      can_insert: true,
      can_update: true,
      can_delete: true,
      can_truncate: false,
      can_references: false,
      can_trigger: false,
      can_maintain: false,
    })),
    {
      table_name: "_dataMigrations",
      can_select: true,
      can_insert: false,
      can_update: false,
      can_delete: false,
      can_truncate: false,
      can_references: false,
      can_trigger: false,
      can_maintain: false,
    },
  ];
}

function defaultContexts() {
  return ["tables", "sequences", "functions", "types"].map((object_type) => ({
    defining_owner: "postgres",
    object_type,
    global_override_configured: true,
    schema_additive_acl_configured: false,
  }));
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

test("runtime role permits only reviewed SET ROLE actors and rejects outbound or untrusted membership", () => {
  const safeRole = {
    role_name: RUNTIME,
    can_login: false,
    inherits: false,
    is_superuser: false,
    bypasses_rls: false,
  };
  const runtimeMembership = (member_role, overrides = {}) => ({
    parent_role: RUNTIME,
    member_role,
    grantor_role: "postgres",
    inherit_option: true,
    set_option: true,
    admin_option: false,
    ...overrides,
  });
  assert.equal(evaluateRuntimeRole(safeRole, []).status, "pass");
  assert.equal(
    evaluateRuntimeRole(safeRole, [
      runtimeMembership("postgres"),
      runtimeMembership("supabase_admin"),
    ]).status,
    "pass",
  );
  const outbound = evaluateRuntimeRole(safeRole, [
    {
      parent_role: "other_role",
      member_role: RUNTIME,
      grantor_role: "postgres",
      inherit_option: false,
      set_option: false,
      admin_option: false,
    },
  ]);
  assert.equal(outbound.status, "fail");
  assert.deepEqual(outbound.violations, ["runtime_role_membership_elevation"]);
  const untrustedInbound = evaluateRuntimeRole(safeRole, [
    runtimeMembership("authenticated"),
  ]);
  assert.equal(untrustedInbound.status, "fail");
  assert.deepEqual(untrustedInbound.violations, [
    "runtime_role_membership_untrusted_set_role_actor",
  ]);
  const missingSetOption = evaluateRuntimeRole(safeRole, [
    runtimeMembership("postgres", { set_option: false }),
  ]);
  assert.equal(missingSetOption.status, "fail");
  assert.deepEqual(missingSetOption.violations, [
    "runtime_role_membership_set_role_not_permitted",
  ]);
  assert.equal(
    evaluateRuntimeRole(safeRole, [
      runtimeMembership("postgres", { grantor_role: "" }),
    ]).status,
    "fail",
  );
  const fail = evaluateRuntimeRole({
    ...safeRole,
    can_login: true,
    bypasses_rls: true,
  });
  assert.equal(fail.status, "fail");
  assert.deepEqual(fail.violations, ["can_login", "bypasses_rls"]);
});

test("external privilege evaluator accepts only a complete evidence object and rejects PUBLIC, grant option, and PostgreSQL 17 MAINTAIN grants", () => {
  const passEvidence = completePrivilegeEvidence();
  assert.equal(evaluateExternalPrivileges(passEvidence).status, "pass");

  const multiGrantorMembership = structuredClone(passEvidence);
  multiGrantorMembership.role_memberships = [
    {
      parent_role: RUNTIME,
      member_role: "postgres",
      grantor_role: "postgres",
      inherit_option: true,
      set_option: true,
      admin_option: false,
    },
    {
      parent_role: RUNTIME,
      member_role: "postgres",
      grantor_role: RUNTIME,
      inherit_option: true,
      set_option: true,
      admin_option: false,
    },
  ];
  assert.equal(
    evaluateExternalPrivileges(multiGrantorMembership).status,
    "pass",
  );
  const exactDuplicateMembership = structuredClone(multiGrantorMembership);
  exactDuplicateMembership.role_memberships.push(
    structuredClone(multiGrantorMembership.role_memberships[0]),
  );
  const duplicateResult = evaluateExternalPrivileges(exactDuplicateMembership);
  assert.equal(duplicateResult.status, "fail");
  assert.deepEqual(duplicateResult.incomplete_evidence, [
    "duplicate_membership_evidence",
  ]);

  const publicAcl = structuredClone(passEvidence);
  publicAcl.table_acl_privileges.push({
    table_name: "users",
    grantee: "PUBLIC",
    privilege_type: "SELECT",
    is_grantable: false,
  });
  assert.equal(evaluateExternalPrivileges(publicAcl).status, "fail");

  const grantOption = structuredClone(passEvidence);
  grantOption.schema_acl_privileges.push({
    schema_name: "circles_app",
    grantee: RUNTIME,
    privilege_type: "USAGE",
    is_grantable: true,
  });
  assert.equal(evaluateExternalPrivileges(grantOption).status, "fail");

  for (const roleName of EXTERNAL_ROLES) {
    const maintain = structuredClone(passEvidence);
    maintain.table_privileges.find(
      (row) => row.role_name === roleName,
    ).can_maintain = true;
    assert.equal(evaluateExternalPrivileges(maintain).status, "fail");
  }
  const publicMaintain = structuredClone(passEvidence);
  publicMaintain.table_acl_privileges.push({
    table_name: "users",
    grantee: "PUBLIC",
    privilege_type: "MAINTAIN",
    is_grantable: false,
  });
  assert.equal(evaluateExternalPrivileges(publicMaintain).status, "fail");

  const incomplete = structuredClone(passEvidence);
  incomplete.column_privileges.pop();
  assert.equal(evaluateExternalPrivileges(incomplete).status, "fail");
});

test("reviewed provider capabilities are distinct, while anonymous, unknown-admin, and transitive SET ROLE paths fail closed", () => {
  const reviewedRoles = [
    "postgres",
    RUNTIME,
    ...EXTERNAL_ROLES,
    ...REVIEWED_BUILTINS,
    "supabase_admin",
    ...REVIEWED_MANAGED_ADMINS,
  ];
  const reviewed = completePrivilegeEvidence(reviewedRoles);
  const privilegeMatrices = [
    [reviewed.schema_privileges, "has_usage"],
    [reviewed.table_privileges, "can_select"],
    [reviewed.column_privileges, "can_select"],
    [reviewed.sequence_privileges, "can_select"],
    [reviewed.routine_privileges, "can_execute"],
  ];
  for (const role_name of [
    ...REVIEWED_BUILTINS,
    "supabase_admin",
    ...REVIEWED_MANAGED_ADMINS,
  ]) {
    for (const [rows, key] of privilegeMatrices) {
      rows.find((row) => row.role_name === role_name)[key] = true;
    }
  }
  const reviewedResult = evaluateExternalPrivileges(reviewed);
  assert.equal(reviewedResult.status, "pass");
  assert.deepEqual(reviewedResult.reviewed_effective_privilege_counts, {
    schema: 6,
    tables: 6,
    columns: 6,
    sequences: 6,
    routines: 6,
  });
  assert.equal(reviewedResult.reviewed_effective_privilege_total, 30);
  assert.equal(
    reviewedResult.reviewed_managed_capabilities.builtin_non_login_capabilities
      .length,
    15,
  );
  assert.equal(
    reviewedResult.reviewed_managed_capabilities.provider_superuser.length,
    5,
  );
  assert.equal(
    reviewedResult.reviewed_managed_capabilities.managed_admin_roles.length,
    10,
  );

  const anonymousGrant = structuredClone(reviewed);
  anonymousGrant.table_privileges.find(
    (row) => row.role_name === "anon",
  ).can_select = true;
  const anonymousResult = evaluateExternalPrivileges(anonymousGrant);
  assert.equal(anonymousResult.status, "fail");
  assert.equal(
    anonymousResult.unauthorized.tables.some(
      (row) => row.role_name === "anon" && row.can_select,
    ),
    true,
  );

  const unknownAdmin = completePrivilegeEvidence([
    "postgres",
    RUNTIME,
    ...EXTERNAL_ROLES,
    "supabase_admin_shadow",
  ]);
  unknownAdmin.table_privileges.find(
    (row) => row.role_name === "supabase_admin_shadow",
  ).can_select = true;
  const unknownAdminResult = evaluateExternalPrivileges(unknownAdmin);
  assert.equal(unknownAdminResult.status, "fail");
  assert.equal(
    unknownAdminResult.unauthorized.tables.some(
      (row) => row.role_name === "supabase_admin_shadow",
    ),
    true,
  );

  const transitiveMembership = completePrivilegeEvidence([
    "postgres",
    RUNTIME,
    ...EXTERNAL_ROLES,
    "pg_read_all_data",
    "supabase_admin",
  ]);
  transitiveMembership.role_memberships = [
    {
      parent_role: "pg_read_all_data",
      member_role: "supabase_admin",
      grantor_role: "postgres",
      inherit_option: false,
      set_option: true,
      admin_option: false,
    },
    {
      parent_role: "supabase_admin",
      member_role: "authenticated",
      grantor_role: "postgres",
      inherit_option: false,
      set_option: true,
      admin_option: false,
    },
  ];
  const transitiveResult = evaluateExternalPrivileges(transitiveMembership);
  assert.equal(transitiveResult.status, "fail");
  assert.equal(
    transitiveResult.unsafe_privileged_membership_paths.some(
      (path) =>
        path.role_path.join(">") ===
        "pg_read_all_data>supabase_admin>authenticated",
    ),
    true,
  );
});

test("runtime table, sequence, routine, and schema checks reject missing and excess privileges", () => {
  const tables = runtimeTableRows();
  assert.equal(
    evaluateRuntimePrivileges(APP_TABLES, "_dataMigrations", tables).status,
    "pass",
  );
  const tableFailure = structuredClone(tables);
  tableFailure[0].can_maintain = true;
  assert.equal(
    evaluateRuntimePrivileges(APP_TABLES, "_dataMigrations", tableFailure)
      .status,
    "fail",
  );
  const incompleteTable = structuredClone(tables);
  delete incompleteTable[0].can_trigger;
  assert.equal(
    evaluateRuntimePrivileges(APP_TABLES, "_dataMigrations", incompleteTable)
      .status,
    "fail",
  );

  const sequences = [{ sequence_name: "users_id_seq", owner: "postgres" }];
  assert.equal(
    evaluateRuntimeSequencePrivileges(sequences, [
      {
        sequence_name: "users_id_seq",
        can_usage: true,
        can_select: true,
        can_update: false,
      },
    ]).status,
    "pass",
  );
  assert.equal(
    evaluateRuntimeSequencePrivileges(sequences, [
      {
        sequence_name: "users_id_seq",
        can_usage: true,
        can_select: true,
        can_update: true,
      },
    ]).status,
    "fail",
  );

  const routines = [{ routine_name: "private_helper()", owner: "postgres" }];
  assert.equal(
    evaluateRuntimeRoutinePrivileges(routines, [
      { routine_name: "private_helper()", can_execute: false },
    ]).status,
    "pass",
  );
  assert.equal(
    evaluateRuntimeRoutinePrivileges(routines, [
      { routine_name: "private_helper()", can_execute: true },
    ]).status,
    "fail",
  );
  assert.equal(
    evaluateRuntimeSchemaPrivileges({ has_usage: true, has_create: false })
      .status,
    "pass",
  );
  assert.equal(
    evaluateRuntimeSchemaPrivileges({ has_usage: true, has_create: true })
      .status,
    "fail",
  );
});

test("default ACL evaluator records TYPE USAGE conditionally but retains future function execution risk", () => {
  assert.equal(evaluateDefaultPrivileges(defaultContexts(), []).status, "pass");
  const builtinPublicTypeUsage = {
    defining_owner: "postgres",
    object_type: "types",
    acl_source: "global",
    grantee: "PUBLIC",
    privilege_type: "USAGE",
    is_grantable: false,
  };
  const typeUsageOnly = evaluateDefaultPrivileges(
    defaultContexts(),
    [builtinPublicTypeUsage],
    "denied",
  );
  assert.equal(typeUsageOnly.status, "pass");
  assert.deepEqual(typeUsageOnly.hazardous_default_grants, []);
  assert.deepEqual(typeUsageOnly.conditional_type_usage, [
    {
      defining_owner: "postgres",
      object_type: "types",
      acl_source: "global",
      grantee: "PUBLIC",
      privilege_type: "USAGE",
      grantable: false,
      classification: "conditional_future_type_usage",
      schema_usage_for_current_nonowners: "denied",
      current_data_api_disclosure: "not_assessed_from_default_acl_metadata",
    },
  ]);
  const globalPublicExecute = evaluateDefaultPrivileges(defaultContexts(), [
    {
      defining_owner: "postgres",
      object_type: "functions",
      acl_source: "global",
      grantee: "PUBLIC",
      privilege_type: "EXECUTE",
      is_grantable: false,
    },
  ]);
  assert.equal(globalPublicExecute.status, "fail");
  const supabaseAdminFunctionExecute = evaluateDefaultPrivileges(
    defaultContexts(),
    [
      builtinPublicTypeUsage,
      {
        defining_owner: "postgres",
        object_type: "functions",
        acl_source: "global",
        grantee: "supabase_admin",
        privilege_type: "EXECUTE",
        is_grantable: false,
      },
    ],
    "denied",
  );
  assert.equal(supabaseAdminFunctionExecute.status, "fail");
  assert.deepEqual(supabaseAdminFunctionExecute.hazardous_default_grants, [
    {
      defining_owner: "postgres",
      object_type: "functions",
      acl_source: "global",
      grantee: "supabase_admin",
      privilege_type: "EXECUTE",
      grantable: false,
    },
  ]);
  const additiveRuntimeGrant = evaluateDefaultPrivileges(defaultContexts(), [
    {
      defining_owner: "postgres",
      object_type: "tables",
      acl_source: "schema_additive",
      grantee: RUNTIME,
      privilege_type: "SELECT",
      is_grantable: true,
    },
  ]);
  assert.equal(additiveRuntimeGrant.status, "fail");
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
