import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const remediation = fs.readFileSync(
  path.join(
    root,
    "operations/remediation/remaining_db06_future_function_default_acl.sql",
  ),
  "utf8",
);
const preflight = fs.readFileSync(
  path.join(
    root,
    "operations/remediation/remaining_db06_provider_preflight.sql",
  ),
  "utf8",
);
const helper = fs.readFileSync(
  path.join(root, "scripts/remaining-db06-preflight.mjs"),
  "utf8",
);
const docs = fs.readFileSync(
  path.join(root, "docs/database-remaining/DB-06.md"),
  "utf8",
);

function nonCommentSqlLines(source) {
  return source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

const exactSchemaRecords = [
  ["cron", "{postgres=X*/supabase_admin}"],
  ["extensions", "{postgres=X*/supabase_admin}"],
  [
    "graphql",
    "{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}",
  ],
  [
    "graphql_public",
    "{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}",
  ],
  [
    "public",
    "{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}",
  ],
  ["realtime", "{postgres=X/supabase_admin,dashboard_user=X/supabase_admin}"],
];

test("remaining DB-06 has one narrowly scoped executable global revoke", () => {
  assert.match(
    remediation,
    /ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin\s+REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;/,
  );
  assert.equal(
    (
      remediation.match(/ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin/g) ??
      []
    ).length,
    1,
  );
  assert.doesNotMatch(
    remediation,
    /ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA/i,
  );
  assert.match(
    remediation,
    /neither changes existing functions nor role memberships/i,
  );
});

test("remaining DB-06 fails closed on absent authority, a global override, or schema baseline drift", () => {
  assert.match(remediation, /DB06_AUTHORITY_REQUIRED/);
  assert.match(
    remediation,
    /pg_has_role\(current_user, v_target_oid, 'MEMBER'\)/,
  );
  assert.match(remediation, /v_executor_is_superuser/);
  assert.match(remediation, /v_global_function_default_row_count <> 0/);
  assert.match(
    remediation,
    /expected zero global supabase_admin FUNCTION default-ACL records/,
  );
  assert.match(remediation, /v_schema_function_default_row_count <> 6/);
  assert.match(
    remediation,
    /provider schema-additive FUNCTION default-ACL records do not match the approved six-record baseline/,
  );
  assert.match(
    remediation,
    /has_schema_privilege\(v_target_oid, v_schema_oid, 'CREATE'\)/,
  );
  assert.doesNotMatch(remediation, /GRANT\s+[^;]*\s+TO\s+supabase_admin/i);
  assert.doesNotMatch(remediation, /SET\s+ROLE/i);
});

test("remaining DB-06 pins and preserves all six legitimate provider schema ACL records", () => {
  for (const [schema, acl] of exactSchemaRecords) {
    assert.match(remediation, new RegExp(`'${schema}'::text`));
    assert.ok(remediation.includes(`'${acl}'::text`));
    assert.match(preflight, new RegExp(`'${schema}'::text`));
    assert.ok(preflight.includes(`'${acl}'::text`));
  }
  assert.match(
    remediation,
    /DB06_POSTCONDITION_FAILED provider schema-additive FUNCTION default ACL changed/,
  );
  assert.match(
    remediation,
    /DB06_POSTCONDITION_FAILED an unrelated default ACL changed/,
  );
  assert.match(remediation, /default_acl\.defaclobjtype = 'f'/);
});

test("remaining DB-06 validates the generated current default and preserves unrelated ACL records", () => {
  assert.match(remediation, /acldefault\('f', v_target_oid\)/);
  assert.match(remediation, /privilege\.grantee = 0/);
  assert.match(
    remediation,
    /CREATE TEMPORARY TABLE pg_temp\.db06_default_acl_snapshot/,
  );
  assert.match(remediation, /DB06_POSTCONDITION_FAILED PUBLIC EXECUTE remains/);
});

test("remaining DB-06 preflight remains bounded, catalog-only, and connection-free", () => {
  assert.match(preflight, /^BEGIN READ ONLY;/m);
  assert.match(preflight, /statement_timeout = '3s'/);
  assert.match(preflight, /LIMIT 128;/);
  assert.match(preflight, /matches_db06_current_baseline/);
  assert.match(preflight, /schema_function_overrides_match_expected/);
  assert.match(preflight, /executor_can_alter_target_defaults/);
  assert.match(preflight, /target_can_create_circles_app/);
  assert.match(
    preflight,
    /AS matches_db06_current_baseline\s+LIMIT 1;[\s\S]*WHERE namespace_catalog\.nspname = 'circles_app'\s+LIMIT 1;/,
  );
  assert.match(preflight, /ROLLBACK;/);
  assert.doesNotMatch(
    nonCommentSqlLines(preflight),
    /^\s*(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/im,
  );
  assert.match(helper, /--print-sql/);
  assert.doesNotMatch(
    helper,
    /process\.env\.[A-Z_]*(?:DATABASE|PG|SUPABASE|URL)/,
  );
  assert.doesNotMatch(helper, /\b(?:pg|Client|connect)\b/i);
});

test("remaining DB-06 documents authority, six-record baseline, blockers, and no production activation claim", () => {
  assert.match(
    docs,
    /\*\*zero global\*\* `supabase_admin` `FUNCTION` default-ACL records/i,
  );
  assert.match(
    docs,
    /\*\*exactly six\*\* legitimate provider-managed schema-additive/i,
  );
  assert.match(docs, /`PUBLIC` non-grantable `EXECUTE`/);
  assert.match(docs, /Database capability is not provider approval/i);
  assert.match(docs, /do not add membership or escalate it/i);
  assert.match(docs, /No live provider query or DDL was performed/i);
  assert.match(docs, /Production activation remains blocked/i);
  assert.match(
    docs,
    /43-table\/current 9-admin-table, 23-admin-function, 117-policy/i,
  );
});
