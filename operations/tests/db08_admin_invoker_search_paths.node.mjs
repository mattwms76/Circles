import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDirectory, "../..");
const migrationPath = path.join(
  root,
  "operations/migrations/0020_circles_admin_invoker_search_paths.sql",
);
const documentationPath = path.join(
  root,
  "docs/database-remediation/DB-08.md",
);

async function readMigration() {
  return readFile(migrationPath, "utf8");
}

test("DB-08 static migration pins only the two audited zero-argument invoker helpers", async () => {
  const sql = await readMigration();
  const executableSql = sql.replace(/^--.*$/gm, "");
  const alterStatements = [
    ...executableSql.matchAll(/^\s*ALTER\s+FUNCTION\s+([^;]+);\s*$/gim),
  ].map((match) => match[1].replace(/\s+/g, " ").trim());

  assert.deepEqual(alterStatements, [
    "circles_admin.touch_updated_at() SET search_path TO pg_catalog",
    "circles_admin.reject_audit_mutation() SET search_path TO pg_catalog",
  ]);
  assert.match(sql, /\bBEGIN;[\s\S]*\bCOMMIT;/);
  assert.match(sql, /pg_catalog\.pg_advisory_xact_lock/);
  assert.match(sql, /pg_catalog\.to_regprocedure\(v_target\)/);
  assert.match(sql, /pg_catalog\.pg_get_function_identity_arguments\(procedure_catalog\.oid\)/);
  assert.match(sql, /v_function\.prokind <> 'f'::"char"/);
  assert.match(sql, /v_function\.prorettype <> 'pg_catalog\.trigger'::pg_catalog\.regtype/);
  assert.match(sql, /v_function\.prosecdef IS DISTINCT FROM false/);
  assert.match(sql, /owner_name <> 'postgres'::pg_catalog\.name/);
  assert.match(sql, /v_function\.proconfig IS NOT NULL/);
  assert.match(
    sql,
    /procedure_catalog\.proconfig = ARRAY\['search_path=pg_catalog'::pg_catalog\.text\]/,
  );
});

test("DB-08 static migration cannot replace functions or change access-control properties", async () => {
  const sql = await readMigration();
  const executableSql = sql.replace(/^--.*$/gm, "");

  for (const prohibitedPattern of [
    /\bCREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\b/i,
    /\bDROP\s+FUNCTION\b/i,
    /\bGRANT\b/i,
    /\bREVOKE\b/i,
    /\bOWNER\s+TO\b/i,
    /\bSECURITY\s+DEFINER\b/i,
    /\bSET\s+ROLE\b/i,
    /\bALTER\s+ROLE\b/i,
    /\bCREATE\s+ROLE\b/i,
    /\bALTER\s+TABLE\b/i,
    /\bEXECUTE\b/i,
  ]) {
    assert.doesNotMatch(executableSql, prohibitedPattern);
  }
});

test("DB-08 documentation retains source-only and approval-gated status", async () => {
  const documentation = await readFile(documentationPath, "utf8");

  assert.match(documentation, /DB-08/);
  assert.match(documentation, /source prepared/i);
  assert.match(documentation, /not applied/i);
  assert.match(documentation, /parent.*approval/i);
  assert.match(documentation, /no production connection/i);
});
