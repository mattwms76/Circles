import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluateAdminAuthorizationContract,
  evaluateAppAdminPolicies,
  evaluateAppLoginAuthorizationContract,
  evaluateSchemaIdentity,
} from "../../scripts/circles-supabase-security-audit.mjs";
import {
  ADMIN_FUNCTION_CONTRACT_VARIANTS,
  ADMIN_TABLE_EXPECTATIONS,
  APP_LOGIN_CONTRACT_VARIANTS,
  APPLICATION_ADMIN_ACL,
  REVIEWED_ROLE_EXPECTATIONS,
  REVIEWED_ROLE_MEMBERSHIPS,
} from "../../scripts/circles-database-security-contract.mjs";

const currentContract = JSON.parse(
  readFileSync(
    new URL(
      "../../scripts/fixtures/current-authorization-contract.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

function detachedLoginEvidence() {
  const detached = structuredClone(
    APP_LOGIN_CONTRACT_VARIANTS.no_login_detached_provider_owned_incoming_edge,
  );
  return {
    roles: detached.roles,
    role_memberships: detached.memberships,
    schema_acl_privileges: [],
    table_acl_privileges: [],
    column_acl_privileges: [],
    sequence_acl_privileges: [],
    routine_acl_privileges: [],
  };
}

function currentAppEvidence() {
  const login = detachedLoginEvidence();
  return {
    roles: [
      ...structuredClone(REVIEWED_ROLE_EXPECTATIONS),
      ...structuredClone(login.roles),
    ],
    role_memberships: [
      ...structuredClone(REVIEWED_ROLE_MEMBERSHIPS),
      ...structuredClone(login.role_memberships),
    ],
    schema_acl_privileges: structuredClone(APPLICATION_ADMIN_ACL.schema),
    table_acl_privileges: structuredClone(APPLICATION_ADMIN_ACL.tables),
    column_acl_privileges: structuredClone(APPLICATION_ADMIN_ACL.columns),
    sequence_acl_privileges: structuredClone(APPLICATION_ADMIN_ACL.sequences),
    routine_acl_privileges: structuredClone(APPLICATION_ADMIN_ACL.routines),
  };
}

function withPostgresOwner(rows) {
  return structuredClone(rows).map((row) => ({ ...row, owner: "postgres" }));
}

function currentAdminEvidence() {
  return {
    raw_tables: structuredClone(currentContract.admin_tables),
    functions: structuredClone(currentContract.admin_functions),
    schema_acl_privileges: withPostgresOwner(currentContract.admin_schema_acl),
    table_acl_privileges: withPostgresOwner(currentContract.admin_table_acl),
    column_acl_privileges: withPostgresOwner(currentContract.admin_column_acl),
  };
}

function legacyAppEvidence() {
  return {
    roles: structuredClone(REVIEWED_ROLE_EXPECTATIONS),
    role_memberships: structuredClone(REVIEWED_ROLE_MEMBERSHIPS),
    schema_acl_privileges: structuredClone(APPLICATION_ADMIN_ACL.schema),
    table_acl_privileges: structuredClone(APPLICATION_ADMIN_ACL.tables),
    column_acl_privileges: structuredClone(APPLICATION_ADMIN_ACL.columns),
    sequence_acl_privileges: structuredClone(APPLICATION_ADMIN_ACL.sequences),
    routine_acl_privileges: structuredClone(APPLICATION_ADMIN_ACL.routines),
  };
}

function legacyAdminEvidence() {
  return {
    raw_tables: structuredClone(ADMIN_TABLE_EXPECTATIONS),
    functions: structuredClone(
      ADMIN_FUNCTION_CONTRACT_VARIANTS.pre_db08_invoker_search_path_pin,
    ),
  };
}

test("collector schema identity is explicit and fails closed", () => {
  assert.equal(
    evaluateSchemaIdentity(
      { schema_name: "circles_app", owner: "postgres" },
      "circles_app",
    ).status,
    "pass",
  );
  assert.equal(
    evaluateSchemaIdentity(
      { schema_name: "circles_publish", owner: "postgres" },
      "circles_app",
    ).status,
    "fail",
  );
  assert.equal(evaluateSchemaIdentity(null, "circles_app").status, "fail");
});

test("current captured state is a complete finite policy, admin, and detached-login contract", () => {
  const policyResult = evaluateAppAdminPolicies(
    structuredClone(currentContract.policies),
  );
  assert.equal(policyResult.status, "pass");
  assert.equal(policyResult.matched_variant, "current_complete_20261028");

  const loginResult = evaluateAppLoginAuthorizationContract(
    detachedLoginEvidence(),
  );
  assert.equal(loginResult.status, "pass");
  assert.equal(
    loginResult.matched_variant,
    "no_login_detached_provider_owned_incoming_edge",
  );

  const adminResult = evaluateAdminAuthorizationContract(
    currentAppEvidence(),
    currentAdminEvidence(),
  );
  assert.equal(adminResult.status, "pass");
  assert.equal(
    adminResult.checks.admin_complete_state.matched_variant,
    "current_complete_20261028",
  );
  assert.equal(currentContract.admin_tables.length, 9);
  assert.equal(currentContract.admin_functions.length, 23);
});

test("preserved legacy admin function/table variants remain accepted as whole states", () => {
  const result = evaluateAdminAuthorizationContract(
    legacyAppEvidence(),
    legacyAdminEvidence(),
  );
  assert.equal(result.status, "pass");
  assert.match(
    result.checks.admin_complete_state.matched_variant,
    /^legacy:pre_db08_invoker_search_path_pin$/,
  );
});

test("current policy contract rejects additions, removals, field changes, and partial transition states", () => {
  const removed = structuredClone(currentContract.policies);
  removed.pop();
  assert.equal(evaluateAppAdminPolicies(removed).status, "fail");

  const extra = structuredClone(currentContract.policies);
  extra.push({
    schema_name: "circles_admin",
    table_name: "review_handoffs",
    policy_name: "unexpected_grant",
    permissive: "PERMISSIVE",
    roles: ["authenticated"],
    command: "SELECT",
    using_qualification: "true",
    with_check_qualification: null,
  });
  assert.equal(evaluateAppAdminPolicies(extra).status, "fail");

  const changed = structuredClone(currentContract.policies);
  changed.find(
    (policy) =>
      policy.table_name === "auth_subjects" &&
      policy.policy_name === "closed_table_deny_all",
  ).roles = ["authenticated"];
  assert.equal(evaluateAppAdminPolicies(changed).status, "fail");

  const partial = structuredClone(currentContract.policies).filter(
    (policy) =>
      !(
        policy.table_name === "review_handoffs" &&
        policy.policy_name === "circles_admin_review_handoffs_runtime_delete"
      ),
  );
  assert.equal(evaluateAppAdminPolicies(partial).status, "fail");
});

test("current admin state rejects extra or removed tables, functions, membership edges, and direct grants", () => {
  const app = currentAppEvidence();
  const admin = currentAdminEvidence();

  const extraTable = structuredClone(admin);
  extraTable.raw_tables.push({
    table_name: "unapproved_admin_table",
    owner: "postgres",
    rls_enabled: true,
    rls_forced: true,
  });
  assert.equal(
    evaluateAdminAuthorizationContract(app, extraTable).status,
    "fail",
  );

  const removedTable = structuredClone(admin);
  removedTable.raw_tables = removedTable.raw_tables.filter(
    (table) => table.table_name !== "review_handoffs",
  );
  assert.equal(
    evaluateAdminAuthorizationContract(app, removedTable).status,
    "fail",
  );

  const extraFunction = structuredClone(admin);
  extraFunction.functions.push(structuredClone(extraFunction.functions[0]));
  extraFunction.functions.at(-1).function_name = "unapproved_helper()";
  assert.equal(
    evaluateAdminAuthorizationContract(app, extraFunction).status,
    "fail",
  );

  const removedFunction = structuredClone(admin);
  removedFunction.functions.pop();
  assert.equal(
    evaluateAdminAuthorizationContract(app, removedFunction).status,
    "fail",
  );

  const extraMember = currentAppEvidence();
  extraMember.role_memberships.push({
    parent_role: "circles_admin_runtime",
    member_role: "unreviewed_member",
    grantor_role: "postgres",
    inherit_option: false,
    set_option: false,
    admin_option: false,
  });
  assert.equal(
    evaluateAdminAuthorizationContract(extraMember, admin).status,
    "fail",
  );

  const removedMember = currentAppEvidence();
  removedMember.role_memberships.splice(
    removedMember.role_memberships.findIndex(
      (membership) =>
        membership.parent_role === "circles_admin_runtime" &&
        membership.member_role === "postgres",
    ),
    1,
  );
  assert.equal(
    evaluateAdminAuthorizationContract(removedMember, admin).status,
    "fail",
  );

  const directGrant = structuredClone(admin);
  directGrant.table_acl_privileges.push({
    table_name: "review_handoffs",
    owner: "postgres",
    grantee: "authenticated",
    privilege_type: "SELECT",
    is_grantable: false,
  });
  assert.equal(
    evaluateAdminAuthorizationContract(app, directGrant).status,
    "fail",
  );
});

test("current helper state pins body, path, executor flags, and direct routine ACLs", () => {
  const app = currentAppEvidence();
  const original = currentAdminEvidence();
  for (const [field, value] of [
    ["body_definition_md5", "00000000000000000000000000000000"],
    ["search_path", ["search_path=public"]],
    ["admin_runtime_execute", false],
    ["native_executor_execute", false],
  ]) {
    const altered = structuredClone(original);
    const target = [
      "admin_runtime_execute",
      "native_executor_execute",
    ].includes(field)
      ? altered.functions.find((fn) => fn[field] === true)
      : altered.functions[0];
    assert.ok(target);
    target[field] = value;
    assert.equal(
      evaluateAdminAuthorizationContract(app, altered).status,
      "fail",
      `changed ${field} must fail`,
    );
  }
  const alteredAcl = structuredClone(original);
  alteredAcl.functions.find(
    (fn) => fn.direct_acl.length > 0,
  ).direct_acl[0].is_grantable = true;
  assert.equal(
    evaluateAdminAuthorizationContract(app, alteredAcl).status,
    "fail",
  );
});

test("detached application login permits only exact NOLOGIN incoming-edge evidence", () => {
  const active = detachedLoginEvidence();
  active.roles[0].can_login = true;
  assert.equal(evaluateAppLoginAuthorizationContract(active).status, "fail");

  const changedIncomingEdge = detachedLoginEvidence();
  changedIncomingEdge.role_memberships[0].set_option = true;
  assert.equal(
    evaluateAppLoginAuthorizationContract(changedIncomingEdge).status,
    "fail",
  );

  const directAcl = detachedLoginEvidence();
  directAcl.table_acl_privileges.push({
    table_name: "users",
    owner: "postgres",
    grantee: "circles_app_login",
    privilege_type: "SELECT",
    is_grantable: false,
  });
  assert.equal(evaluateAppLoginAuthorizationContract(directAcl).status, "fail");
});
