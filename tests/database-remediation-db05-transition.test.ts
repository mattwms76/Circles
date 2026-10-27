import { beforeAll, describe, expect, it } from "vitest";

type AuditRow = Record<string, unknown>;

type AppLoginEvidence = {
  roles: AuditRow[];
  role_memberships: AuditRow[];
  schema_acl_privileges: AuditRow[];
  table_acl_privileges: AuditRow[];
  column_acl_privileges: AuditRow[];
  sequence_acl_privileges: AuditRow[];
  routine_acl_privileges: AuditRow[];
};

let evaluateAppLoginAuthorizationContract: (evidence: AppLoginEvidence) => {
  status: string;
  matched_variant?: string | null;
};
let evaluateAppAdminPolicies: (policies: AuditRow[]) => { status: string };
let APP_LOGIN_CONTRACT_VARIANTS: Record<
  string,
  { roles: AuditRow[]; memberships: AuditRow[] }
>;
let POLICY_CONTRACT_VARIANTS: Record<string, AuditRow[]>;

beforeAll(async () => {
  const audit = (await import(
    ["..", "scripts", "circles-supabase-security-audit.mjs"].join("/")
  )) as {
    evaluateAppLoginAuthorizationContract: (evidence: AppLoginEvidence) => {
      status: string;
      matched_variant?: string | null;
    };
    evaluateAppAdminPolicies: (policies: AuditRow[]) => { status: string };
  };
  const contract = (await import(
    ["..", "scripts", "circles-database-security-contract.mjs"].join("/")
  )) as {
    APP_LOGIN_CONTRACT_VARIANTS: Record<
      string,
      { roles: AuditRow[]; memberships: AuditRow[] }
    >;
    POLICY_CONTRACT_VARIANTS: Record<string, AuditRow[]>;
  };
  ({ evaluateAppLoginAuthorizationContract, evaluateAppAdminPolicies } = audit);
  ({ APP_LOGIN_CONTRACT_VARIANTS, POLICY_CONTRACT_VARIANTS } = contract);
});

function evidenceFor(variantName: string): AppLoginEvidence {
  const variant = structuredClone(APP_LOGIN_CONTRACT_VARIANTS[variantName]) as {
    roles: AuditRow[];
    memberships: AuditRow[];
  };
  return {
    roles: variant.roles,
    role_memberships: variant.memberships,
    schema_acl_privileges: [],
    table_acl_privileges: [],
    column_acl_privileges: [],
    sequence_acl_privileges: [],
    routine_acl_privileges: [],
  };
}

describe("DB-05 / DB-02 finite application-login transition", () => {
  it("accepts the historical baseline and only the two complete named post-migration states", () => {
    for (const variantName of [
      "baseline_pre_db02",
      "no_login_provisioned",
      "login_cutover",
    ] as const) {
      const result = evaluateAppLoginAuthorizationContract(
        evidenceFor(variantName),
      );
      expect(result).toMatchObject({
        status: "pass",
        matched_variant: variantName,
      });
    }
  });

  it("rejects a non-runtime edge, ADMIN OPTION, and direct application object ACL", () => {
    const extraEdge = evidenceFor("no_login_provisioned");
    extraEdge.role_memberships.push({
      parent_role: "unreviewed_parent",
      member_role: "circles_app_login",
      grantor_role: "postgres",
      inherit_option: false,
      set_option: true,
      admin_option: false,
    });
    expect(evaluateAppLoginAuthorizationContract(extraEdge).status).toBe(
      "fail",
    );

    const adminOption = evidenceFor("no_login_provisioned");
    adminOption.role_memberships[0].admin_option = true;
    expect(evaluateAppLoginAuthorizationContract(adminOption).status).toBe(
      "fail",
    );

    const directAcl = evidenceFor("no_login_provisioned");
    directAcl.column_acl_privileges.push({
      table_name: "users",
      column_name: "email",
      column_key: JSON.stringify(["users", "email"]),
      owner: "postgres",
      grantee: "circles_app_login",
      privilege_type: "SELECT",
      is_grantable: false,
    });
    expect(evaluateAppLoginAuthorizationContract(directAcl).status).toBe(
      "fail",
    );
  });

  it("retains whole named DB-09 policy variants and rejects a partial state", () => {
    const partial = structuredClone(
      POLICY_CONTRACT_VARIANTS.post_db09_keep_parity_names,
    ).slice(1);
    expect(evaluateAppAdminPolicies(partial).status).toBe("fail");
  });
});
