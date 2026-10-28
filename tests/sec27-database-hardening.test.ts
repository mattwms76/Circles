import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CURRENT_CONNECTION_PRINCIPAL,
  PROPOSED_RUNTIME_BOOTSTRAP_PRINCIPAL,
  RUNTIME_ROLE,
  getPostgresConnectionOptions,
} from "../server/_core/postgres-config.mjs";
import {
  RUNTIME_PRINCIPAL_READINESS_SQL,
  hasExpectedRuntimePrincipal,
} from "../server/runtime-role-pool";

const projectRoot = resolve(import.meta.dirname, "..");
const directSyntheticUrl =
  "postgresql://postgres:synthetic-only-password@db.vvclcsqletcxzoaayqzq.supabase.co:5432/postgres";

function source(relativePath: string) {
  return readFileSync(resolve(projectRoot, relativePath), "utf8");
}

describe("SEC-027 database auditor scope", () => {
  it("documents the source-derived 27-table boundary and all five schema modules", () => {
    const documentation = source("docs/supabase-security-audit.md");

    expect(documentation).toContain("27-table `circles_app` boundary");
    expect(documentation).toContain(
      "26 application tables plus `_dataMigrations`",
    );
    for (const module of [
      "drizzle/schema.ts",
      "drizzle/live-schema.ts",
      "drizzle/session-schema.ts",
      "drizzle/activity-schema.ts",
      "drizzle/moderation-schema.ts",
    ]) {
      expect(documentation).toContain(`\`${module}\``);
    }
    expect(documentation).not.toContain("22-table `circles_app` boundary");
  });
});

describe("SEC-020 dedicated bootstrap preparation", () => {
  it("keeps the active source principal exact while evaluating only the exact proposed role readiness evidence", () => {
    const options = getPostgresConnectionOptions(
      { SUPABASE_DATABASE_URL: directSyntheticUrl },
      projectRoot,
    );

    expect(CURRENT_CONNECTION_PRINCIPAL).toBe("postgres");
    expect(options.user).toBe("postgres.vvclcsqletcxzoaayqzq");
    expect(PROPOSED_RUNTIME_BOOTSTRAP_PRINCIPAL).toBe("circles_app_bootstrap");
    expect(RUNTIME_PRINCIPAL_READINESS_SQL).toContain(
      "session_user::text AS session_principal",
    );
    expect(RUNTIME_PRINCIPAL_READINESS_SQL).toContain(
      "current_user::text AS runtime_role",
    );
    expect(RUNTIME_PRINCIPAL_READINESS_SQL).toContain(
      "pg_catalog.pg_has_role(session_user, current_user, 'SET ROLE')",
    );
    expect(
      hasExpectedRuntimePrincipal({
        session_principal: PROPOSED_RUNTIME_BOOTSTRAP_PRINCIPAL,
        runtime_role: RUNTIME_ROLE,
        may_set_runtime_role: true,
      }),
    ).toBe(true);
    for (const invalidEvidence of [
      undefined,
      {
        session_principal: CURRENT_CONNECTION_PRINCIPAL,
        runtime_role: RUNTIME_ROLE,
        may_set_runtime_role: true,
      },
      {
        session_principal: PROPOSED_RUNTIME_BOOTSTRAP_PRINCIPAL,
        runtime_role: CURRENT_CONNECTION_PRINCIPAL,
        may_set_runtime_role: true,
      },
      {
        session_principal: PROPOSED_RUNTIME_BOOTSTRAP_PRINCIPAL,
        runtime_role: RUNTIME_ROLE,
        may_set_runtime_role: false,
      },
    ]) {
      expect(hasExpectedRuntimePrincipal(invalidEvidence)).toBe(false);
    }
  });

  it("keeps the bootstrap role proposal unapplied, narrowly scoped, and free of arbitrary role routing", () => {
    const proposal = source(
      "operations/security-proposals/sec27-runtime-bootstrap-principal.sql",
    );

    expect(proposal).toContain("DO NOT add this file to a migration journal");
    expect(proposal).toContain(
      "CREATE ROLE circles_app_bootstrap\n  LOGIN\n  NOINHERIT\n  NOSUPERUSER",
    );
    expect(proposal).toContain(
      "GRANT circles_app_runtime TO circles_app_bootstrap\n  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE",
    );
    expect(proposal).toContain("session_principal=circles_app_bootstrap");
    expect(proposal).not.toMatch(/ALTER\s+DEFAULT\s+PRIVILEGES/i);
    expect(proposal).not.toMatch(/CREATE\s+(?:TABLE|SCHEMA)\s+public\./i);
    expect(proposal).not.toContain("identity0014");
    expect(proposal).not.toContain("circles_admin");
  });
});

describe("SEC-019, SEC-032, and SEC-033 review gates", () => {
  it("requires transaction-local actor context, a legacy privacy contract, and value-free coordinated evidence", () => {
    const proposal = source(
      "docs/security-proposals/sec27-database-hardening.md",
    );

    expect(proposal).toContain("Do not apply a policy to all 27 tables");
    expect(proposal).toContain("set_config(..., true)");
    expect(proposal).toContain(
      "never from a tRPC input, header, cookie string",
    );
    expect(proposal).toContain("welcome_text");
    expect(proposal).toContain("onboarding_completed_at");
    expect(proposal).toContain("Discovery teaser fields remain separate");
    expect(proposal).toContain("The old PAT is never reused");
    expect(proposal).toContain("both** existing consumers");
    expect(proposal).toContain("working GitHub integration");
    expect(proposal).toContain(
      "no secret values, token prefixes, DSNs, hashes",
    );
  });
});
