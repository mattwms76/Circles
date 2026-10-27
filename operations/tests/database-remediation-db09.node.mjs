import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../migrations/0021_circles_duplicate_policy_consolidation.sql",
    import.meta.url,
  ),
  "utf8",
);

const expectedPairs = [
  {
    schema: "circles_app",
    table: "circles",
    survivor: "circles_admin_read_circles",
    duplicate: "circles_admin_parity_read_circles",
  },
  {
    schema: "circles_app",
    table: "comments",
    survivor: "circles_admin_read_comments",
    duplicate: "circles_admin_parity_read_comments",
  },
  {
    schema: "circles_app",
    table: '"liveViewers"',
    survivor: "circles_admin_read_liveviewers",
    duplicate: "circles_admin_parity_read_liveviewers",
  },
  {
    schema: "circles_app",
    table: "memberships",
    survivor: "circles_admin_read_memberships",
    duplicate: "circles_admin_parity_read_memberships",
  },
  {
    schema: "circles_app",
    table: "posts",
    survivor: "circles_admin_read_posts",
    duplicate: "circles_admin_parity_read_posts",
  },
  {
    schema: "circles_app",
    table: "profiles",
    survivor: "circles_admin_read_profiles",
    duplicate: "circles_admin_parity_read_profiles",
  },
  {
    schema: "circles_app",
    table: "reactions",
    survivor: "circles_admin_read_reactions",
    duplicate: "circles_admin_parity_read_reactions",
  },
  {
    schema: "circles_app",
    table: "reports",
    survivor: "circles_admin_read_reports",
    duplicate: "circles_admin_parity_read_reports",
  },
  {
    schema: "circles_app",
    table: "streams",
    survivor: "circles_admin_read_streams",
    duplicate: "circles_admin_parity_read_streams",
  },
  {
    schema: "circles_app",
    table: "users",
    survivor: "circles_admin_read_users",
    duplicate: "circles_admin_parity_read_users",
  },
  {
    schema: "circles_admin",
    table: "audit",
    survivor: "circles_admin_runtime_audit_select",
    duplicate: "circles_admin_parity_audit_read",
  },
  {
    schema: "circles_admin",
    table: "audit",
    survivor: "circles_admin_runtime_audit_insert",
    duplicate: "circles_admin_parity_audit_append",
  },
];

test("DB-09 enumerates exactly the twelve catalog-confirmed duplicate policy names", () => {
  assert.equal(
    (migration.match(/DROP POLICY IF EXISTS/g) ?? []).length,
    expectedPairs.length,
  );

  for (const pair of expectedPairs) {
    assert.match(migration, new RegExp(`'${pair.survivor}'`));
    assert.match(migration, new RegExp(`'${pair.duplicate}'`));
    assert.ok(
      migration.includes(
        `DROP POLICY IF EXISTS "${pair.duplicate}" ON ${pair.schema}.${pair.table};`,
      ),
      `expected an explicit, scoped drop for ${pair.duplicate}`,
    );
  }

  assert.doesNotMatch(migration, /FOREACH[\s\S]*DROP POLICY/i);
  assert.doesNotMatch(migration, /EXECUTE[\s\S]*DROP POLICY/i);
});

test("DB-09 fails closed unless duplicate catalog definitions exactly match reviewed survivors", () => {
  for (const requiredCatalogField of [
    "polroles",
    "polcmd",
    "polpermissive",
    "polqual::text",
    "polwithcheck::text",
  ]) {
    assert.match(
      migration,
      new RegExp(requiredCatalogField.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }

  assert.match(
    migration,
    /v_duplicate_count NOT IN \(0, 12\)/,
    "partial duplicate-policy states must fail rather than receive a subset drop",
  );
  assert.match(migration, /circles_admin_runtime/);
  assert.match(migration, /circles_admin_runtime_audit_insert/);
  assert.match(migration, /audit\.actor_operator_id/);
  assert.match(migration, /audit\.actor_role/);
});

test("DB-09 preserves restrictive browser denials and native-executor policy shapes", () => {
  assert.match(migration, /circles_app_deny_anon_authenticated/);
  assert.match(migration, /circles_admin_native_audit_read/);
  assert.match(migration, /circles_admin_native_audit_append/);
  assert.match(migration, /circles_admin_native_users_lock_only/);
  assert.match(migration, /has_table_privilege/);
  assert.match(migration, /has_schema_privilege/);
  assert.match(
    migration,
    /browser role access to a selected private relation or schema is not denied/,
  );
});

test("DB-09 has an exact idempotent post-state assertion", () => {
  assert.match(migration, /\$db09_duplicate_policy_poststate\$/);
  assert.match(
    migration,
    /selected duplicate policies remain or survivor definitions changed/,
  );
  assert.equal(
    (migration.match(/circles_admin_parity_audit_append/g) ?? []).length >= 3,
    true,
    "the audit INSERT duplicate must be preflighted, explicitly dropped, and post-checked",
  );
});
