-- Approved Circle Home v1 storage. This additive migration preserves existing circle rows and
-- changes no grants, RLS policies, application roles, or schemas outside circles_app.
-- NOT VALID constraints deliberately avoid scanning or rewriting historic rows while enforcing
-- all new and updated values. Apply only through the parent-approved private migration workflow.
BEGIN;

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('circles_app.circle_home_v1'::text, 0)
);

DO $circle_home_v1$
BEGIN
  IF pg_catalog.to_regclass('circles_app.circles') IS NULL
     OR pg_catalog.to_regclass('circles_app.posts') IS NULL THEN
    RAISE EXCEPTION 'circles_app circles and posts baseline is required before 0008_circles_home';
  END IF;

  ALTER TABLE circles_app.circles
    ADD COLUMN IF NOT EXISTS "welcomeMessage" text NOT NULL DEFAULT ''::text,
    ADD COLUMN IF NOT EXISTS rules jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS "pinnedPostId" integer;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'circles_home_welcome_message_check'
      AND conrelid = 'circles_app.circles'::pg_catalog.regclass
  ) THEN
    ALTER TABLE circles_app.circles
      ADD CONSTRAINT circles_home_welcome_message_check
      CHECK (pg_catalog.char_length("welcomeMessage") <= 2000) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'circles_home_rules_check'
      AND conrelid = 'circles_app.circles'::pg_catalog.regclass
  ) THEN
    ALTER TABLE circles_app.circles
      ADD CONSTRAINT circles_home_rules_check
      CHECK (
        CASE
          WHEN pg_catalog.jsonb_typeof(rules) = 'array' THEN
            pg_catalog.jsonb_array_length(rules) <= 10
            AND NOT pg_catalog.jsonb_path_exists(
              rules,
              '$[*] ? (@.type() != "string" || @ like_regex "^.{150}.{150}." flag "s" || @ like_regex "[\r\n]" || @ like_regex "^[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]|[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]$" || @ like_regex "^[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*$")'
            )
            -- Mirror circleHomeRuleKey: ASCII case-insensitive, other Unicode exact.
            AND (rules ->> 0 IS NULL OR rules ->> 1 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 0), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 1), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 0 IS NULL OR rules ->> 2 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 0), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 2), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 0 IS NULL OR rules ->> 3 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 0), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 3), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 0 IS NULL OR rules ->> 4 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 0), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 4), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 0 IS NULL OR rules ->> 5 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 0), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 5), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 0 IS NULL OR rules ->> 6 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 0), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 6), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 0 IS NULL OR rules ->> 7 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 0), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 7), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 0 IS NULL OR rules ->> 8 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 0), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 8), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 0 IS NULL OR rules ->> 9 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 0), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 9), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 1 IS NULL OR rules ->> 2 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 1), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 2), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 1 IS NULL OR rules ->> 3 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 1), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 3), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 1 IS NULL OR rules ->> 4 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 1), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 4), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 1 IS NULL OR rules ->> 5 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 1), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 5), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 1 IS NULL OR rules ->> 6 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 1), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 6), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 1 IS NULL OR rules ->> 7 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 1), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 7), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 1 IS NULL OR rules ->> 8 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 1), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 8), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 1 IS NULL OR rules ->> 9 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 1), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 9), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 2 IS NULL OR rules ->> 3 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 2), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 3), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 2 IS NULL OR rules ->> 4 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 2), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 4), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 2 IS NULL OR rules ->> 5 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 2), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 5), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 2 IS NULL OR rules ->> 6 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 2), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 6), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 2 IS NULL OR rules ->> 7 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 2), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 7), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 2 IS NULL OR rules ->> 8 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 2), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 8), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 2 IS NULL OR rules ->> 9 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 2), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 9), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 3 IS NULL OR rules ->> 4 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 3), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 4), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 3 IS NULL OR rules ->> 5 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 3), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 5), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 3 IS NULL OR rules ->> 6 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 3), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 6), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 3 IS NULL OR rules ->> 7 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 3), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 7), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 3 IS NULL OR rules ->> 8 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 3), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 8), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 3 IS NULL OR rules ->> 9 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 3), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 9), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 4 IS NULL OR rules ->> 5 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 4), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 5), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 4 IS NULL OR rules ->> 6 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 4), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 6), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 4 IS NULL OR rules ->> 7 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 4), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 7), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 4 IS NULL OR rules ->> 8 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 4), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 8), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 4 IS NULL OR rules ->> 9 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 4), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 9), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 5 IS NULL OR rules ->> 6 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 5), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 6), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 5 IS NULL OR rules ->> 7 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 5), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 7), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 5 IS NULL OR rules ->> 8 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 5), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 8), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 5 IS NULL OR rules ->> 9 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 5), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 9), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 6 IS NULL OR rules ->> 7 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 6), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 7), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 6 IS NULL OR rules ->> 8 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 6), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 8), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 6 IS NULL OR rules ->> 9 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 6), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 9), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 7 IS NULL OR rules ->> 8 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 7), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 8), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 7 IS NULL OR rules ->> 9 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 7), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 9), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
            AND (rules ->> 8 IS NULL OR rules ->> 9 IS NULL OR pg_catalog.translate(pg_catalog.btrim(rules ->> 8), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> pg_catalog.translate(pg_catalog.btrim(rules ->> 9), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
          ELSE false
        END
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'circles_home_pinned_post_id_positive_check'
      AND conrelid = 'circles_app.circles'::pg_catalog.regclass
  ) THEN
    ALTER TABLE circles_app.circles
      ADD CONSTRAINT circles_home_pinned_post_id_positive_check
      CHECK ("pinnedPostId" IS NULL OR "pinnedPostId" > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'circles_home_pinned_post_id_fkey'
      AND conrelid = 'circles_app.circles'::pg_catalog.regclass
  ) THEN
    ALTER TABLE circles_app.circles
      ADD CONSTRAINT circles_home_pinned_post_id_fkey
      FOREIGN KEY ("pinnedPostId")
      REFERENCES circles_app.posts(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END;
$circle_home_v1$;

COMMIT;
