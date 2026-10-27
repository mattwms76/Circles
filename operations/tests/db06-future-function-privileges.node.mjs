import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sql = fs.readFileSync(
  path.join(root, "operations/remediation/db06_future_function_privileges.sql"),
  "utf8",
);
const docs = fs.readFileSync(
  path.join(root, "docs/database-remediation/DB-06.md"),
  "utf8",
);

test("DB-06 keeps supabase_admin default-function change explicitly provider-wide and unactivated", () => {
  assert.match(sql, /PREPARED, NOT ACTIVATED/);
  assert.match(sql, /provider-wide change/i);
  assert.match(
    sql,
    /-- ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin\s+--?\s*\n?\s*--?\s*REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;/,
  );
  assert.doesNotMatch(
    sql,
    /^(?!\s*--).*ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin/m,
  );
});

test("DB-06 records PG17 global-replacement and schema-additive semantics", () => {
  assert.match(sql, /global ALTER DEFAULT PRIVILEGES entry replaces/i);
  assert.match(sql, /IN SCHEMA.*additive/i);
  assert.match(sql, /cannot revoke PUBLIC EXECUTE/i);
  assert.match(docs, /schema-only default revoke is not a fix/i);
  assert.match(docs, /PUBLIC TYPE USAGE.*separate/i);
});

test("DB-06 provides an exact per-routine private-function revoke pattern without bulk alteration", () => {
  assert.match(
    sql,
    /REVOKE EXECUTE ON FUNCTION <private_schema>\.<private_function>\(<identity_args>\)\s+--?\s*\n?\s*FROM PUBLIC;/,
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION <private_schema>\.<private_function>\(<identity_args>\)/,
  );
  assert.match(sql, /Do not use REVOKE \.\.\. ON ALL FUNCTIONS IN SCHEMA/i);
  assert.match(docs, /exact routine identity/i);
});

test("DB-06 preserves current routines and declares a real-PG17 drill prerequisite", () => {
  assert.match(sql, /does not alter existing routines/i);
  assert.match(docs, /real PG17 drill/i);
  assert.match(docs, /provider approval/i);
});
