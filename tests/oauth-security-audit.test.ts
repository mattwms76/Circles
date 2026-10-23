import { describe, expect, it } from "vitest";
import {
  AUTH_SCHEMA,
  EXTERNAL_ROLES,
  PENDING_TABLE,
  RUNTIME_ROLE,
  evaluateEvidence,
  evaluateExternalProbes,
  evaluateInventoryAndOwnership,
  evaluatePrivileges,
  evaluateRuntimeProbe,
  sanitizeForOutput,
} from "../scripts/circles-oauth-security-audit.mjs";

type Row = Record<string, unknown>;
type Checks = Record<string, { status: string }>;

function privilegeRows() {
  return [RUNTIME_ROLE, ...EXTERNAL_ROLES].map((role_name) => ({
    role_name,
    role_exists: true,
    has_usage: role_name === RUNTIME_ROLE,
    has_create: false,
  }));
}

function tablePrivilegeRows() {
  return [RUNTIME_ROLE, ...EXTERNAL_ROLES].map((role_name) => ({
    role_name,
    role_exists: true,
    can_select: role_name === RUNTIME_ROLE,
    can_insert: role_name === RUNTIME_ROLE,
    can_update: false,
    can_delete: role_name === RUNTIME_ROLE,
    can_truncate: false,
    can_references: false,
    can_trigger: false,
  }));
}

function positiveEvidence(): Record<string, unknown> {
  const constraintRows: Row[] = [
    {
      constraint_name:
        "circles_auth_oauth_pending_states_cookie_fingerprint_check",
      constraint_type: "c",
      definition:
        "CHECK (cookie_binding_fingerprint IS NULL OR cookie_binding_fingerprint ~ '^[0-9a-f]{64}$'::text)",
      is_validated: true,
    },
    {
      constraint_name: "circles_auth_oauth_pending_states_expiry_check",
      constraint_type: "c",
      definition: "CHECK (expires_at > created_at)",
      is_validated: true,
    },
    {
      constraint_name: "circles_auth_oauth_pending_states_flow_binding_check",
      constraint_type: "c",
      definition:
        "CHECK (flow_kind = 'web'::text AND cookie_binding_fingerprint IS NOT NULL AND flow_token_fingerprint IS NULL AND frontend_origin IS NOT NULL AND length(frontend_origin) > 0 OR flow_kind = 'native'::text AND cookie_binding_fingerprint IS NULL AND flow_token_fingerprint IS NOT NULL AND frontend_origin IS NULL)",
      is_validated: true,
    },
    {
      constraint_name:
        "circles_auth_oauth_pending_states_flow_fingerprint_check",
      constraint_type: "c",
      definition:
        "CHECK (flow_token_fingerprint IS NULL OR flow_token_fingerprint ~ '^[0-9a-f]{64}$'::text)",
      is_validated: true,
    },
    {
      constraint_name: "circles_auth_oauth_pending_states_flow_kind_check",
      constraint_type: "c",
      definition:
        "CHECK (flow_kind = ANY (ARRAY['web'::text, 'native'::text]))",
      is_validated: true,
    },
    {
      constraint_name: "circles_auth_oauth_pending_states_nonce_check",
      constraint_type: "c",
      definition: "CHECK (nonce ~ '^[A-Za-z0-9_-]{32,128}$'::text)",
      is_validated: true,
    },
    {
      constraint_name:
        "circles_auth_oauth_pending_states_state_fingerprint_check",
      constraint_type: "c",
      definition: "CHECK (state_fingerprint ~ '^[0-9a-f]{64}$'::text)",
      is_validated: true,
    },
    {
      constraint_name: "oauth_pending_states_pkey",
      constraint_type: "p",
      definition: "PRIMARY KEY (state_fingerprint)",
      is_validated: true,
    },
  ];
  return {
    schema_rows: [{ schema_name: AUTH_SCHEMA, owner: "postgres" }],
    table_rows: [
      {
        table_name: PENDING_TABLE,
        owner: "postgres",
        rls_enabled: true,
        rls_forced: true,
      },
    ],
    policy_rows: [
      {
        table_name: PENDING_TABLE,
        policy_name: "circles_auth_oauth_pending_states_runtime_backend_policy",
        roles: [RUNTIME_ROLE],
        command: "ALL",
        using_qualification: "(true)",
        with_check_qualification: "true",
      },
    ],
    runtime_role_rows: [
      {
        role_name: RUNTIME_ROLE,
        can_login: false,
        inherits: false,
        is_superuser: false,
        bypasses_rls: false,
      },
    ],
    membership_rows: [],
    schema_privilege_rows: privilegeRows(),
    table_privilege_rows: tablePrivilegeRows(),
    schema_acl_rows: [
      { grantee: RUNTIME_ROLE, privilege_type: "USAGE", is_grantable: false },
    ],
    table_acl_rows: ["SELECT", "INSERT", "DELETE"].map((privilege_type) => ({
      grantee: RUNTIME_ROLE,
      privilege_type,
      is_grantable: false,
    })),
    column_rows: [
      {
        column_name: "state_fingerprint",
        data_type: "text",
        not_null: true,
        column_default: null,
      },
      {
        column_name: "flow_kind",
        data_type: "text",
        not_null: true,
        column_default: null,
      },
      {
        column_name: "cookie_binding_fingerprint",
        data_type: "text",
        not_null: false,
        column_default: null,
      },
      {
        column_name: "flow_token_fingerprint",
        data_type: "text",
        not_null: false,
        column_default: null,
      },
      {
        column_name: "redirect_uri",
        data_type: "text",
        not_null: true,
        column_default: null,
      },
      {
        column_name: "nonce",
        data_type: "text",
        not_null: true,
        column_default: null,
      },
      {
        column_name: "frontend_origin",
        data_type: "text",
        not_null: false,
        column_default: null,
      },
      {
        column_name: "expires_at",
        data_type: "timestamp with time zone",
        not_null: true,
        column_default: null,
      },
      {
        column_name: "created_at",
        data_type: "timestamp with time zone",
        not_null: true,
        column_default: "pg_catalog.clock_timestamp()",
      },
    ],
    constraint_rows: constraintRows,
    index_rows: [
      {
        index_name: "circles_auth_oauth_pending_states_expires_at_idx",
        is_primary: false,
        is_unique: false,
        definition:
          "CREATE INDEX circles_auth_oauth_pending_states_expires_at_idx ON circles_auth.oauth_pending_states USING btree (expires_at)",
        is_valid: true,
        is_ready: true,
      },
      {
        index_name: "circles_auth_oauth_pending_states_native_flow_token_idx",
        is_primary: false,
        is_unique: true,
        definition:
          "CREATE UNIQUE INDEX circles_auth_oauth_pending_states_native_flow_token_idx ON circles_auth.oauth_pending_states USING btree (flow_token_fingerprint) WHERE (flow_kind = 'native'::text)",
        is_valid: true,
        is_ready: true,
      },
      {
        index_name: "oauth_pending_states_pkey",
        is_primary: true,
        is_unique: true,
        definition:
          "CREATE UNIQUE INDEX oauth_pending_states_pkey ON circles_auth.oauth_pending_states USING btree (state_fingerprint)",
        is_valid: true,
        is_ready: true,
      },
    ],
    function_rows: [],
    function_acl_rows: [],
    default_acl_rows: [],
    external_probes: EXTERNAL_ROLES.map((role_name) => ({
      role_name,
      outcome: "denied",
      bounded_select_1_limit_1: true,
    })),
    runtime_probe: {
      role_name: RUNTIME_ROLE,
      outcome: "allowed",
      bounded_select_1_limit_1: true,
    },
  };
}

describe("Circles OAuth pending-state audit evaluators", () => {
  it("accepts the complete migration-shaped synthetic catalog and bounded probes", () => {
    const result = evaluateEvidence(positiveEvidence());

    expect(result.status).toBe("pass");
    expect(
      Object.values(result.checks).every((check) => check.status === "pass"),
    ).toBe(true);
  });

  it("fails closed for an unexpected table, unsafe RLS policy, and external SELECT grant", () => {
    const evidence = positiveEvidence();
    (evidence.table_rows as Row[]).push({
      table_name: "unexpected_helper",
      owner: "postgres",
      rls_enabled: true,
      rls_forced: true,
    });
    (evidence.policy_rows as Row[])[0]!.roles = [RUNTIME_ROLE, "authenticated"];
    (evidence.table_privilege_rows as Row[]).find(
      (row) => row.role_name === "anon",
    )!.can_select = true;

    const result = evaluateEvidence(evidence);
    const checks = result.checks as Checks;

    expect(result.status).toBe("fail");
    expect(checks.inventory_and_ownership?.status).toBe("fail");
    expect(checks.forced_rls_and_runtime_only_policy?.status).toBe("fail");
    expect(checks.exact_schema_and_table_privileges?.status).toBe("fail");
  });

  it("reports an absent fixed schema/table as a failure rather than a pass", () => {
    expect(evaluateInventoryAndOwnership([], []).status).toBe("fail");
    expect(
      evaluateInventoryAndOwnership(
        [{ schema_name: AUTH_SCHEMA, owner: "postgres" }],
        [],
      ).status,
    ).toBe("fail");
  });

  it("treats malformed catalog metadata and indeterminate probes as unknown", () => {
    const evidence = positiveEvidence();
    (evidence.policy_rows as Row[])[0]!.roles = "not-a-postgres-array";
    (evidence.external_probes as Row[])[0]!.outcome = "indeterminate";

    const result = evaluateEvidence(evidence);
    const checks = result.checks as Checks;

    expect(result.status).toBe("fail");
    expect(checks.forced_rls_and_runtime_only_policy?.status).toBe("unknown");
    expect(checks.external_role_select_1_denials?.status).toBe("unknown");
  });

  it("requires exact direct ACLs and safe runtime probe shape", () => {
    expect(
      evaluatePrivileges(
        privilegeRows(),
        tablePrivilegeRows(),
        [{ grantee: "PUBLIC", privilege_type: "USAGE", is_grantable: false }],
        [],
      ).status,
    ).toBe("fail");
    expect(
      evaluateRuntimeProbe({
        role_name: RUNTIME_ROLE,
        outcome: "allowed",
        bounded_select_1_limit_1: false,
      }).status,
    ).toBe("unknown");
    expect(
      evaluateExternalProbes([
        ...EXTERNAL_ROLES.map((role_name) => ({
          role_name,
          outcome: "denied",
          bounded_select_1_limit_1: true,
        })),
        {
          role_name: "extra",
          outcome: "denied",
          bounded_select_1_limit_1: true,
        },
      ]).status,
    ).toBe("fail");
  });

  it("redacts synthetic secrets and raw error-like values before output serialization", () => {
    const sanitized = sanitizeForOutput({
      safe: "catalog-only",
      password: "do-not-export",
      nested: {
        raw_error: "postgresql://private-value",
        state: "bearer-quality-value",
      },
      url: "postgresql://private-value",
    });
    const rendered = JSON.stringify(sanitized);

    expect(sanitized.safe).toBe("catalog-only");
    expect(rendered).not.toContain("do-not-export");
    expect(rendered).not.toContain("private-value");
    expect(rendered).not.toContain("bearer-quality-value");
    expect(rendered).toContain("[redacted]");
  });

  it("uses only the fixed helper scope constants", () => {
    expect(AUTH_SCHEMA).toBe("circles_auth");
    expect(PENDING_TABLE).toBe("oauth_pending_states");
    expect(RUNTIME_ROLE).toBe("circles_app_runtime");
  });
});

describe("exact reviewed OAuth structural boundary", () => {
  it("rejects an OR-true weakening even with every original constraint keyword", () => {
    const e = positiveEvidence();
    const row = (e.constraint_rows as Row[]).find((r) =>
      String(r.constraint_name).endsWith("_expiry_check"),
    )!;
    row.definition = "CHECK ((expires_at > created_at) OR true)";
    expect(evaluateEvidence(e).status).toBe("fail");
  });
  it("rejects an expiry-named index over the wrong column", () => {
    const e = positiveEvidence();
    const row = (e.index_rows as Row[]).find((r) =>
      String(r.index_name).endsWith("_expires_at_idx"),
    )!;
    row.definition = String(row.definition).replace(
      "(expires_at)",
      "(created_at)",
    );
    expect(evaluateEvidence(e).status).toBe("fail");
  });
  it("requires validated constraints and valid ready indexes", () => {
    for (const [field, flag] of [
      ["constraint_rows", "is_validated"],
      ["index_rows", "is_valid"],
      ["index_rows", "is_ready"],
    ]) {
      const e = positiveEvidence();
      (e[field!] as Row[])[0]![flag!] = false;
      expect(evaluateEvidence(e).status).toBe("fail");
    }
  });
  it("preserves case and whitespace inside regex literals", () => {
    const e = positiveEvidence();
    const row = (e.constraint_rows as Row[]).find((r) =>
      String(r.constraint_name).endsWith("_nonce_check"),
    )!;
    row.definition = String(row.definition).replace("A-Za-z", "a-za-z");
    expect(evaluateEvidence(e).status).toBe("fail");
  });
  it("rejects arbitrary custom-role grants as well as named API roles", () => {
    const e = positiveEvidence();
    (e.schema_acl_rows as Row[]).push({
      grantee: "rogue_custom_role",
      privilege_type: "USAGE",
      is_grantable: false,
    });
    expect(evaluateEvidence(e).status).toBe("fail");
  });
});
