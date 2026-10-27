-- DB-04: certify the eleven historical constraints that were deliberately installed NOT VALID.
--
-- Prepared only. Apply once through the parent-approved private PostgreSQL migration workflow
-- after the disposable PostgreSQL 17 drill and explicit production approval. This migration does
-- not add, replace, disable, or rewrite constraints; it only validates the exact pre-existing
-- definitions after fail-closed catalog checks. It never reads or repairs application rows.

BEGIN;

-- Bound both wait-for-DDL and validation work. A timeout leaves the transaction uncommitted.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- Serialize this validation and retain table-level DDL protection from catalog verification through
-- the final postcondition. SHARE UPDATE EXCLUSIVE is the lock mode used by VALIDATE CONSTRAINT.
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('circles_app.db04_constraint_validation'::text, 0)
);

LOCK TABLE
  circles_app.circles,
  circles_app.conversations,
  circles_app.follows,
  circles_app.messages,
  circles_app.profiles
IN SHARE UPDATE EXCLUSIVE MODE;

-- The expected definition fingerprints are md5 values of the PostgreSQL 17 catalog definition after
-- removing the state marker NOT VALID, ASCII whitespace, and case. They pin the supplied catalog's
-- exact expressions while permitting a safe rerun after a constraint has become validated.
DO $db04_verify_expected_constraints$
DECLARE
  expected record;
  actual record;
BEGIN
  IF pg_catalog.to_regclass('circles_app.circles') IS NULL
     OR pg_catalog.to_regclass('circles_app.conversations') IS NULL
     OR pg_catalog.to_regclass('circles_app.follows') IS NULL
     OR pg_catalog.to_regclass('circles_app.messages') IS NULL
     OR pg_catalog.to_regclass('circles_app.profiles') IS NULL
     OR pg_catalog.to_regclass('circles_app.posts') IS NULL THEN
    RAISE EXCEPTION 'DB-04 requires the current circles_app social, profile, circle, and post tables';
  END IF;

  FOR expected IN
    SELECT *
    FROM (
      VALUES
        ('circles_app.circles'::text, 'circles_home_pinned_post_id_fkey'::text, 'f'::"char", 'ef005e99691f3a1c1f87a369bf117a48'::text),
        ('circles_app.circles'::text, 'circles_home_pinned_post_id_positive_check'::text, 'c'::"char", '67d24420e58902f64c65043092aeb2df'::text),
        ('circles_app.circles'::text, 'circles_home_rules_check'::text, 'c'::"char", 'a97fc7b1f9e9d092d3a863cec9f0e9ea'::text),
        ('circles_app.circles'::text, 'circles_home_welcome_message_check'::text, 'c'::"char", 'd03867ab2b197815a9f5410d9630e9d0'::text),
        ('circles_app.conversations'::text, 'conversations_kind_target_check'::text, 'c'::"char", '4833098a4ae543979a094d661f52ad36'::text),
        ('circles_app.follows'::text, 'follows_not_self_check'::text, 'c'::"char", 'f0c8fb81849829465814d8e3f24a072c'::text),
        ('circles_app.messages'::text, 'messages_client_message_id_check'::text, 'c'::"char", '81343648ac11f0cc44bc59a5f6b91f19'::text),
        ('circles_app.messages'::text, 'messages_content_check'::text, 'c'::"char", 'da3bfbf21d55a4c7f5b5446e67664831'::text),
        ('circles_app.profiles'::text, 'profiles_onboarding_completion_check'::text, 'c'::"char", 'c78cd4c855bbd1916f63bb8b26b76f56'::text),
        ('circles_app.profiles'::text, 'profiles_onboarding_interests_check'::text, 'c'::"char", 'f6889dd2a2963d3a23772fc7e781f9cb'::text),
        ('circles_app.profiles'::text, 'profiles_onboarding_step_check'::text, 'c'::"char", 'a59e7281b7ab7734949243411693b147'::text)
    ) AS required(relation_name, constraint_name, constraint_type, definition_md5)
  LOOP
    SELECT
      constraint_catalog.oid,
      constraint_catalog.contype,
      pg_catalog.md5(
        pg_catalog.lower(
          pg_catalog.translate(
            pg_catalog.regexp_replace(
              pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true),
              'NOT[[:space:]]+VALID',
              '',
              'gi'
            ),
            E' \t\n\r\f\013',
            ''
          )
        )
      ) AS definition_md5
      INTO actual
      FROM pg_catalog.pg_constraint AS constraint_catalog
      WHERE constraint_catalog.conrelid = pg_catalog.to_regclass(expected.relation_name)
        AND constraint_catalog.conname = expected.constraint_name;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'DB-04 expected constraint %.% is absent', expected.relation_name, expected.constraint_name;
    END IF;

    IF actual.contype <> expected.constraint_type
       OR actual.definition_md5 <> expected.definition_md5 THEN
      RAISE EXCEPTION 'DB-04 expected definition mismatch for %.%', expected.relation_name, expected.constraint_name;
    END IF;
  END LOOP;

  SELECT
    constraint_catalog.confrelid,
    constraint_catalog.confdeltype,
    constraint_catalog.confupdtype,
    constraint_catalog.confmatchtype,
    constraint_catalog.condeferrable,
    constraint_catalog.condeferred,
    constraint_catalog.conkey,
    constraint_catalog.confkey
    INTO actual
    FROM pg_catalog.pg_constraint AS constraint_catalog
    WHERE constraint_catalog.conrelid = 'circles_app.circles'::pg_catalog.regclass
      AND constraint_catalog.conname = 'circles_home_pinned_post_id_fkey';

  IF actual.confrelid <> 'circles_app.posts'::pg_catalog.regclass
     OR actual.confdeltype <> 'n'::"char"
     OR actual.confupdtype <> 'a'::"char"
     OR actual.confmatchtype <> 's'::"char"
     OR actual.condeferrable
     OR actual.condeferred
     OR actual.conkey <> ARRAY[(
       SELECT attribute_catalog.attnum
       FROM pg_catalog.pg_attribute AS attribute_catalog
       WHERE attribute_catalog.attrelid = 'circles_app.circles'::pg_catalog.regclass
         AND attribute_catalog.attname = 'pinnedPostId'
         AND NOT attribute_catalog.attisdropped
     )]::int2[]
     OR actual.confkey <> ARRAY[(
       SELECT attribute_catalog.attnum
       FROM pg_catalog.pg_attribute AS attribute_catalog
       WHERE attribute_catalog.attrelid = 'circles_app.posts'::pg_catalog.regclass
         AND attribute_catalog.attname = 'id'
         AND NOT attribute_catalog.attisdropped
     )]::int2[] THEN
    RAISE EXCEPTION 'DB-04 pinned-post foreign key target, action, timing, or key columns differ from the approved definition';
  END IF;
END;
$db04_verify_expected_constraints$;

-- Only constraints still marked NOT VALID are touched, making a successful approved rerun harmless.
DO $db04_validate_constraints$
DECLARE
  required record;
BEGIN
  FOR required IN
    SELECT *
    FROM (
      VALUES
        ('circles_app.circles'::text, 'circles_home_pinned_post_id_fkey'::text),
        ('circles_app.circles'::text, 'circles_home_pinned_post_id_positive_check'::text),
        ('circles_app.circles'::text, 'circles_home_rules_check'::text),
        ('circles_app.circles'::text, 'circles_home_welcome_message_check'::text),
        ('circles_app.conversations'::text, 'conversations_kind_target_check'::text),
        ('circles_app.follows'::text, 'follows_not_self_check'::text),
        ('circles_app.messages'::text, 'messages_client_message_id_check'::text),
        ('circles_app.messages'::text, 'messages_content_check'::text),
        ('circles_app.profiles'::text, 'profiles_onboarding_completion_check'::text),
        ('circles_app.profiles'::text, 'profiles_onboarding_interests_check'::text),
        ('circles_app.profiles'::text, 'profiles_onboarding_step_check'::text)
    ) AS expected(relation_name, constraint_name)
  LOOP
    IF NOT (
      SELECT constraint_catalog.convalidated
      FROM pg_catalog.pg_constraint AS constraint_catalog
      WHERE constraint_catalog.conrelid = pg_catalog.to_regclass(required.relation_name)
        AND constraint_catalog.conname = required.constraint_name
    ) THEN
      EXECUTE pg_catalog.format(
        'ALTER TABLE %s VALIDATE CONSTRAINT %I',
        required.relation_name,
        required.constraint_name
      );
    END IF;
  END LOOP;
END;
$db04_validate_constraints$;

DO $db04_assert_validated$
DECLARE
  expected record;
BEGIN
  FOR expected IN
    SELECT *
    FROM (
      VALUES
        ('circles_app.circles'::text, 'circles_home_pinned_post_id_fkey'::text),
        ('circles_app.circles'::text, 'circles_home_pinned_post_id_positive_check'::text),
        ('circles_app.circles'::text, 'circles_home_rules_check'::text),
        ('circles_app.circles'::text, 'circles_home_welcome_message_check'::text),
        ('circles_app.conversations'::text, 'conversations_kind_target_check'::text),
        ('circles_app.follows'::text, 'follows_not_self_check'::text),
        ('circles_app.messages'::text, 'messages_client_message_id_check'::text),
        ('circles_app.messages'::text, 'messages_content_check'::text),
        ('circles_app.profiles'::text, 'profiles_onboarding_completion_check'::text),
        ('circles_app.profiles'::text, 'profiles_onboarding_interests_check'::text),
        ('circles_app.profiles'::text, 'profiles_onboarding_step_check'::text)
    ) AS required(relation_name, constraint_name)
  LOOP
    IF NOT COALESCE((
      SELECT constraint_catalog.convalidated
      FROM pg_catalog.pg_constraint AS constraint_catalog
      WHERE constraint_catalog.conrelid = pg_catalog.to_regclass(expected.relation_name)
        AND constraint_catalog.conname = expected.constraint_name
    ), false) THEN
      RAISE EXCEPTION 'DB-04 validation did not certify %.%', expected.relation_name, expected.constraint_name;
    END IF;
  END LOOP;
END;
$db04_assert_validated$;

COMMIT;
