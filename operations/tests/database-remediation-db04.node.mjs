import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migrationPath =
  "operations/migrations/0016_circles_validate_constraints.sql";
const pg17DrillPath = "operations/tests/database-remediation-db04.pg17.mjs";

const expectedConstraints = [
  [
    "circles_app.circles",
    "circles_home_pinned_post_id_fkey",
    "ef005e99691f3a1c1f87a369bf117a48",
  ],
  [
    "circles_app.circles",
    "circles_home_pinned_post_id_positive_check",
    "67d24420e58902f64c65043092aeb2df",
  ],
  [
    "circles_app.circles",
    "circles_home_rules_check",
    "a97fc7b1f9e9d092d3a863cec9f0e9ea",
  ],
  [
    "circles_app.circles",
    "circles_home_welcome_message_check",
    "d03867ab2b197815a9f5410d9630e9d0",
  ],
  [
    "circles_app.conversations",
    "conversations_kind_target_check",
    "4833098a4ae543979a094d661f52ad36",
  ],
  [
    "circles_app.follows",
    "follows_not_self_check",
    "f0c8fb81849829465814d8e3f24a072c",
  ],
  [
    "circles_app.messages",
    "messages_client_message_id_check",
    "81343648ac11f0cc44bc59a5f6b91f19",
  ],
  [
    "circles_app.messages",
    "messages_content_check",
    "da3bfbf21d55a4c7f5b5446e67664831",
  ],
  [
    "circles_app.profiles",
    "profiles_onboarding_completion_check",
    "c78cd4c855bbd1916f63bb8b26b76f56",
  ],
  [
    "circles_app.profiles",
    "profiles_onboarding_interests_check",
    "f6889dd2a2963d3a23772fc7e781f9cb",
  ],
  [
    "circles_app.profiles",
    "profiles_onboarding_step_check",
    "a59e7281b7ab7734949243411693b147",
  ],
];

const pg17Cases = [
  "pinned_post_missing_target",
  "pinned_post_non_positive",
  "rules_duplicate_after_ascii_fold",
  "welcome_message_over_limit",
  "conversation_kind_target_mismatch",
  "follow_self",
  "client_message_id_too_short",
  "message_without_text_or_media",
  "onboarding_complete_without_timestamp",
  "onboarding_interest_not_allowlisted",
  "onboarding_step_outside_enum",
];

test("DB-04 migration pins exactly the eleven catalog constraints before validation", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const executableSql = migration.replace(/^--.*$/gm, "");

  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /\nCOMMIT;\n$/);
  assert.match(migration, /SET LOCAL lock_timeout = '5s';/);
  assert.match(migration, /SET LOCAL statement_timeout = '5min';/);
  assert.match(migration, /LOCK TABLE[\s\S]*IN SHARE UPDATE EXCLUSIVE MODE;/);
  assert.match(
    migration,
    /pg_catalog\.pg_get_constraintdef\(constraint_catalog\.oid, true\)/,
  );
  assert.match(migration, /pg_catalog\.md5\(/);
  assert.match(migration, /NOT\[\[:space:\]\]\+VALID/);
  assert.match(migration, /circles_app\.posts/);
  assert.match(migration, /actual\.confdeltype <> 'n'::"char"/);
  assert.match(migration, /actual\.confupdtype <> 'a'::"char"/);
  assert.match(migration, /actual\.confmatchtype <> 's'::"char"/);

  for (const [
    relation,
    constraint,
    definitionFingerprint,
  ] of expectedConstraints) {
    assert.match(migration, new RegExp(`'${relation}'::text`));
    assert.match(migration, new RegExp(`'${constraint}'::text`));
    assert.match(migration, new RegExp(definitionFingerprint));
  }

  assert.equal(
    (migration.match(/ALTER TABLE %s VALIDATE CONSTRAINT %I/g) ?? []).length,
    1,
    "validation must use the one guarded dynamic command rather than unguarded statements",
  );
  assert.match(
    migration,
    /IF NOT \([\s\S]*convalidated[\s\S]*\) THEN[\s\S]*ALTER TABLE %s VALIDATE CONSTRAINT %I/,
  );
  assert.match(migration, /DB-04 validation did not certify/);
  assert.doesNotMatch(
    executableSql,
    /^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/gim,
  );
});

test("DB-04 PG17 drill stays opt-in, local, and covers clean plus each failing historical fixture", async () => {
  const drill = await readFile(pg17DrillPath, "utf8");

  assert.match(drill, /CIRCLES_DB04_LOCAL_PG17/);
  assert.match(drill, /127\.0\.0\.1/);
  assert.match(drill, /initdb/);
  assert.match(drill, /pg_ctl/);
  assert.match(drill, /POSTGRES17_BIN/);
  assert.doesNotMatch(drill, /DATABASE_URL|SUPABASE|postgresql:\/\//i);
  assert.match(
    drill,
    /valid historical fixture validates all eleven constraints/,
  );
  assert.match(
    drill,
    /failing historical fixture leaves every target unvalidated/,
  );
  for (const fixtureName of pg17Cases) {
    assert.match(drill, new RegExp(fixtureName));
  }
});
