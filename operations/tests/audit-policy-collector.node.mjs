import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateAppAdminPolicies } from "../../scripts/circles-supabase-security-audit.mjs";
import { POLICY_CONTRACT_VARIANTS } from "../../scripts/circles-database-security-contract.mjs";

const source = readFileSync(
  new URL("../../scripts/circles-supabase-security-audit.mjs", import.meta.url),
  "utf8",
);

test("the actual policy catalog projection retains schema identity across app/admin collection", () => {
  assert.match(
    source,
    /SELECT p\.schemaname AS schema_name,\s+p\.tablename AS table_name,[\s\S]*?FROM pg_policies AS p\s+WHERE p\.schemaname = \$1/,
  );
  const baseline = structuredClone(
    POLICY_CONTRACT_VARIANTS.pre_db09_duplicate_consolidation,
  );
  assert.equal(evaluateAppAdminPolicies(baseline).status, "pass");
  const missingSchema = baseline.map(({ schema_name: _schema, ...row }) => row);
  assert.equal(evaluateAppAdminPolicies(missingSchema).status, "fail");
});
