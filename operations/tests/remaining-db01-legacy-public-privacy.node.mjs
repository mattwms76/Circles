import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const forwardPath = fileURLToPath(
  new URL(
    "../remediation/remaining_db01_legacy_public_privacy.sql",
    import.meta.url,
  ),
);
const rollbackPath = fileURLToPath(
  new URL(
    "../remediation/remaining_db01_legacy_public_privacy_rollback.sql",
    import.meta.url,
  ),
);
const forward = readFileSync(forwardPath, "utf8");
const rollback = readFileSync(rollbackPath, "utf8");

const expectedPolicies = [
  [
    "circles",
    "Signed in members can discover circle listings",
    "((is_private IS FALSE) OR (owner_id = (SELECT auth.uid())))",
  ],
  [
    "profiles",
    "Profiles are visible to signed in members",
    "(id = (SELECT auth.uid()))",
  ],
  ["follows", "Members see follows", "(follower_id = (SELECT auth.uid()))"],
];

function withoutLineComments(sql) {
  return sql.replace(/^\s*--.*$/gm, "");
}

test("remaining DB-01 is inactive by default and requires separate approval plus acknowledgement", () => {
  assert.match(forward, /^BEGIN;/m);
  assert.match(forward, /COMMIT;\s*$/);
  assert.match(forward, /SET LOCAL lock_timeout = '5s';/);
  assert.match(forward, /SET LOCAL statement_timeout = '30s';/);
  assert.match(forward, /circles\.db01_legacy_public_privacy_contract/);
  assert.match(forward, /DB01_LEGACY_PUBLIC_PRIVACY_APPROVED_V1/);
  assert.match(forward, /circles\.db01_legacy_public_privacy_acknowledgment/);
  assert.match(forward, /DB01_OWNER_AND_COMPATIBILITY_ACKNOWLEDGED_V1/);
  assert.match(forward, /requires explicit owner and compatibility approval/);
  assert.match(
    forward,
    /requires explicit owner\/compatibility-loss acknowledgment/,
  );
});

test("remaining DB-01 pins the audited full row-free catalog before and after the three changes", () => {
  assert.doesNotMatch(forward, /PLACEHOLDER/);
  assert.match(forward, /db01-legacy-public-catalog-v2/);
  assert.match(forward, /a59b8fd2807cdd6e506ed85392adeb49/);
  assert.match(forward, /26a7a9555d07c124e6f98a30dd943a6b/);
  assert.match(forward, /strict current-catalog fingerprint drift/);
  assert.match(forward, /strict postflight catalog fingerprint drift/);
  assert.match(forward, /pg_catalog\.pg_policy/);
  assert.match(forward, /pg_catalog\.has_table_privilege/);
  assert.match(forward, /circles_app_runtime/);
  assert.match(forward, /service_role/);
  assert.match(forward, /DB-01 legacy table shape drift on public\.%/);
  assert.match(
    forward,
    /DB-01 expected broad authenticated SELECT policy definition drift/,
  );

  for (const [table, policy, predicate] of expectedPolicies) {
    assert.match(
      forward,
      new RegExp(
        `ALTER POLICY "${policy}"\\s+ON public\\.${table}\\s+USING \\(${predicate
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace(/^\\\(/, "")
          .replace(/\\\)$/, "")}\\);`,
        "m",
      ),
    );
  }
  assert.equal((forward.match(/ALTER POLICY/g) ?? []).length, 3);
});

test("remaining DB-01 changes neither rows nor ACLs and leaves all non-target policy definitions catalog-pinned", () => {
  const executable = withoutLineComments(forward);
  assert.doesNotMatch(executable, /\b(?:GRANT|REVOKE)\b/);
  assert.doesNotMatch(
    executable,
    /\b(?:CREATE|DROP)\s+(?:TABLE|VIEW|FUNCTION|ROLE|SCHEMA)\b/,
  );
  assert.doesNotMatch(
    executable,
    /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO|FROM|public\.)/,
  );
  assert.doesNotMatch(executable, /circles_app\./);
  assert.match(forward, /complete policy inventory/);
  assert.match(forward, /privilege matrix/);
});

test("remaining DB-01 rollback is separately acknowledged, exact-state guarded, and restores only the three original broad reads", () => {
  assert.doesNotMatch(rollback, /PLACEHOLDER/);
  assert.match(rollback, /^BEGIN;/m);
  assert.match(rollback, /COMMIT;\s*$/);
  assert.match(
    rollback,
    /circles\.db01_legacy_public_privacy_rollback_contract/,
  );
  assert.match(rollback, /DB01_LEGACY_PUBLIC_PRIVACY_ROLLBACK_APPROVED_V1/);
  assert.match(
    rollback,
    /circles\.db01_legacy_public_privacy_rollback_acknowledgment/,
  );
  assert.match(
    rollback,
    /DB01_ROLLBACK_COMPATIBILITY_RESTORATION_ACKNOWLEDGED_V1/,
  );
  assert.match(rollback, /rollback refuses non-V1 narrow catalog state/);
  assert.match(rollback, /rollback broad catalog postflight fingerprint drift/);
  assert.match(rollback, /26a7a9555d07c124e6f98a30dd943a6b/);
  assert.match(rollback, /a59b8fd2807cdd6e506ed85392adeb49/);

  for (const [table, policy] of expectedPolicies) {
    assert.match(
      rollback,
      new RegExp(
        `ALTER POLICY "${policy}"\\s+ON public\\.${table}\\s+USING \\(true\\);`,
        "m",
      ),
    );
  }
  assert.equal((rollback.match(/ALTER POLICY/g) ?? []).length, 3);

  const executable = withoutLineComments(rollback);
  assert.doesNotMatch(executable, /\b(?:GRANT|REVOKE)\b/);
  assert.doesNotMatch(
    executable,
    /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO|FROM|public\.)/,
  );
});
