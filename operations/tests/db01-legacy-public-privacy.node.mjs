import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sqlPath = fileURLToPath(
  new URL("../remediation/db01_legacy_public_privacy.sql", import.meta.url),
);
const sql = readFileSync(sqlPath, "utf8");

const expectedPolicies = [
  {
    table: "circles",
    policy: "Signed in members can discover circle listings",
    prior: "pg_catalog.pg_get_expr(v_policy.polqual, v_relation_oid) <> 'true'",
    predicate: "((is_private IS FALSE) OR (owner_id = (SELECT auth.uid())))",
  },
  {
    table: "profiles",
    policy: "Profiles are visible to signed in members",
    prior: "pg_catalog.pg_get_expr(v_policy.polqual, v_relation_oid) <> 'true'",
    predicate: "(id = (SELECT auth.uid()))",
  },
  {
    table: "follows",
    policy: "Members see follows",
    prior: "pg_catalog.pg_get_expr(v_policy.polqual, v_relation_oid) <> 'true'",
    predicate: "(follower_id = (SELECT auth.uid()))",
  },
];

test("DB-01 is a transaction-bound, explicit-approval candidate", () => {
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /SET LOCAL lock_timeout = '5s';/);
  assert.match(sql, /SET LOCAL statement_timeout = '30s';/);
  assert.match(
    sql,
    /current_setting\('circles\.db01_legacy_public_privacy_contract', true\)/,
  );
  assert.match(sql, /DB01_LEGACY_PUBLIC_PRIVACY_APPROVED_V1/);
  assert.match(
    sql,
    /DB-01 requires explicit legacy compatibility\/privacy approval/,
  );
});

test("DB-01 asserts the audited pre-state before replacing exactly three broad reads", () => {
  assert.match(sql, /DB-01 legacy table shape drift on public\.%/);
  assert.match(sql, /DB-01 legacy RLS\/owner precondition drift on public\.%/);
  assert.match(
    sql,
    /DB-01 legacy direct SELECT grant precondition drift on public\.%/,
  );
  assert.match(
    sql,
    /DB-01 expected exactly one authenticated SELECT policy on public\.%/,
  );
  assert.match(
    sql,
    /DB-01 expected broad authenticated SELECT policy definition drift on public\.%/,
  );
  assert.match(
    sql,
    /policy_catalog\.polcmd IN \('r'::pg_catalog\."char", '\*'::pg_catalog\."char"\)/,
  );
  assert.match(
    sql,
    /policy_catalog\.polroles = ARRAY\[0::pg_catalog\.oid\]::pg_catalog\.oid\[\]/,
  );

  for (const { table, policy, prior, predicate } of expectedPolicies) {
    assert.match(sql, new RegExp(`'${table}'::pg_catalog\\.name`));
    assert.match(sql, new RegExp(`'${policy}'::text`));
    assert.match(sql, new RegExp(prior.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(
      sql,
      new RegExp(
        `ALTER POLICY "${policy}"\\s+ON public\\.${table}\\s+USING \\(${predicate
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace(/^\\\(/, "")
          .replace(/\\\)$/, "")}\\);`,
        "m",
      ),
    );
  }

  assert.equal((sql.match(/ALTER POLICY/g) ?? []).length, 3);
  assert.equal((sql.match(/USING \(/g) ?? []).length, 3);
});

test("DB-01 preserves non-target grants, DML policies, and identity design", () => {
  assert.doesNotMatch(sql, /\b(?:GRANT|REVOKE)\b/);
  assert.doesNotMatch(
    sql,
    /\b(?:CREATE|DROP)\s+(?:VIEW|TABLE|FUNCTION|ROLE)\b/,
  );
  assert.doesNotMatch(
    sql,
    /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO|FROM|public\.)/,
  );
  assert.doesNotMatch(sql, /pg_catalog\.pg_count\(/);
  assert.doesNotMatch(sql, /auth\.users|circle_memberships|public\.users/);
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /circles_app_runtime/);
});

test("DB-01 postflight proves the narrow predicates and leaves anonymous access denied", () => {
  assert.match(
    sql,
    /DB-01 postflight failed for public\.circles SELECT policy/,
  );
  assert.match(
    sql,
    /DB-01 postflight failed for public\.profiles SELECT policy/,
  );
  assert.match(
    sql,
    /DB-01 postflight failed for public\.follows SELECT policy/,
  );
  assert.match(sql, /DB-01 postflight direct SELECT grant boundary drift/);
  assert.match(
    sql,
    /\(\(is_private IS FALSE\) OR \(owner_id = \( SELECT auth\.uid\(\) AS uid\)\)\)/,
  );
  assert.match(sql, /\(id = \( SELECT auth\.uid\(\) AS uid\)\)/);
  assert.match(sql, /\(follower_id = \( SELECT auth\.uid\(\) AS uid\)\)/);
  assert.equal((sql.match(/'anon'/g) ?? []).length >= 2, true);
});
