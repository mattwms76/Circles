-- DB-07: additive coverage for the twelve catalog-identified foreign-key child columns.
--
-- This is a psql-only, autocommit script.  Do not use --single-transaction, wrap this
-- file in BEGIN/COMMIT, or run it through a migration runner that opens a transaction:
-- CREATE INDEX CONCURRENTLY is intentionally required to avoid a long write lock.
--
-- Required invocation (after parent approval, against an authorized target only):
--   psql -X -v ON_ERROR_STOP=1 -v db07_confirm_no_transaction=1 \
--     -f operations/remediation/db07_foreign_key_indexes.sql
--
-- The required variable is an acknowledgement of the no-transaction runner contract.
-- The script never drops/rebuilds an index or changes rows, constraints, roles, grants,
-- RLS, policies, or schema ownership. An incompatible pre-existing index with one of the
-- reviewed names is a stop condition; IF NOT EXISTS is not accepted as sufficient proof.

\set ON_ERROR_STOP on
\if :{?db07_confirm_no_transaction}
\else
  \echo 'DB-07 refused: invoke psql with -v db07_confirm_no_transaction=1 and without --single-transaction.'
  \quit 3
\endif
\if :db07_confirm_no_transaction
\else
  \echo 'DB-07 refused: db07_confirm_no_transaction must be a true psql boolean (use 1).'
  \quit 3
\endif

\echo 'DB-07: validating the reviewed foreign-key/index contracts before concurrent creation.'

-- Bound any catalog/table-lock wait. The longer statement cap bounds index-build and
-- old-snapshot waiting; an operator must investigate rather than blindly retry a timeout.
SET lock_timeout = '5s';
SET statement_timeout = '30min';

-- A non-blocking session advisory lock stops two DB-07 runners from interleaving. It is
-- released explicitly on success and automatically if this psql session terminates on error.
DO $db07_lock$
BEGIN
  IF NOT pg_catalog.pg_try_advisory_lock(
    pg_catalog.hashtextextended('circles.db07.foreign_key_indexes', 0)
  ) THEN
    RAISE EXCEPTION 'DB-07 is already running in another session; stop instead of overlapping concurrent index builds';
  END IF;
END;
$db07_lock$;

-- This temporary helper is session-local. It checks both the exact FK being covered and
-- the exact named index definition when that index already exists. It creates no permanent
-- function and makes an invalid/partial index a fail-closed condition.
CREATE OR REPLACE FUNCTION pg_temp.db07_assert_fk_index(
  p_child_schema pg_catalog.name,
  p_child_table pg_catalog.name,
  p_constraint pg_catalog.name,
  p_child_column pg_catalog.name,
  p_parent_schema pg_catalog.name,
  p_parent_table pg_catalog.name,
  p_parent_column pg_catalog.name,
  p_index pg_catalog.name,
  p_must_exist boolean
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $db07_assert$
DECLARE
  v_child_relation pg_catalog.oid;
  v_parent_relation pg_catalog.oid;
  v_child_attnum smallint;
  v_parent_attnum smallint;
  v_index_relation pg_catalog.oid;
  v_expected_definition text;
BEGIN
  v_child_relation := pg_catalog.to_regclass(
    pg_catalog.format('%I.%I', p_child_schema, p_child_table)
  );
  v_parent_relation := pg_catalog.to_regclass(
    pg_catalog.format('%I.%I', p_parent_schema, p_parent_table)
  );

  IF v_child_relation IS NULL OR v_parent_relation IS NULL THEN
    RAISE EXCEPTION
      'DB-07 prerequisite missing for %: expected %.% and %.%',
      p_index, p_child_schema, p_child_table, p_parent_schema, p_parent_table;
  END IF;

  SELECT a.attnum
  INTO v_child_attnum
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = v_child_relation
    AND a.attname = p_child_column
    AND a.attnum > 0
    AND NOT a.attisdropped;

  SELECT a.attnum
  INTO v_parent_attnum
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = v_parent_relation
    AND a.attname = p_parent_column
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_child_attnum IS NULL OR v_parent_attnum IS NULL THEN
    RAISE EXCEPTION
      'DB-07 prerequisite missing column for %: %.% -> %.%',
      p_index, p_child_table, p_child_column, p_parent_table, p_parent_column;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS fk
    WHERE fk.conname = p_constraint
      AND fk.contype = 'f'
      AND fk.conrelid = v_child_relation
      AND fk.confrelid = v_parent_relation
      AND pg_catalog.array_length(fk.conkey, 1) = 1
      AND pg_catalog.array_length(fk.confkey, 1) = 1
      AND fk.conkey[1] = v_child_attnum
      AND fk.confkey[1] = v_parent_attnum
  ) THEN
    RAISE EXCEPTION
      'DB-07 foreign-key contract drift for %: expected named single-column FK %.% (%) -> %.% (%)',
      p_index,
      p_child_schema, p_child_table, p_constraint,
      p_parent_schema, p_parent_table, p_parent_column;
  END IF;

  v_index_relation := pg_catalog.to_regclass(
    pg_catalog.format('%I.%I', p_child_schema, p_index)
  );

  IF v_index_relation IS NULL THEN
    IF p_must_exist THEN
      RAISE EXCEPTION 'DB-07 postcondition failed: expected index %.% is absent', p_child_schema, p_index;
    END IF;
    RETURN;
  END IF;

  v_expected_definition := pg_catalog.format(
    'CREATE INDEX %I ON %I.%I USING btree (%I)',
    p_index, p_child_schema, p_child_table, p_child_column
  );

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_metadata
    JOIN pg_catalog.pg_class AS index_relation
      ON index_relation.oid = index_metadata.indexrelid
    JOIN pg_catalog.pg_am AS access_method
      ON access_method.oid = index_relation.relam
    WHERE index_metadata.indexrelid = v_index_relation
      AND index_metadata.indrelid = v_child_relation
      AND access_method.amname = 'btree'
      AND index_metadata.indisvalid
      AND index_metadata.indisready
      AND index_metadata.indislive
      AND NOT index_metadata.indisunique
      AND NOT index_metadata.indisprimary
      AND index_metadata.indpred IS NULL
      AND index_metadata.indexprs IS NULL
      AND index_metadata.indnkeyatts = 1
      AND index_metadata.indnatts = 1
      AND pg_catalog.pg_get_indexdef(index_metadata.indexrelid) = v_expected_definition
  ) THEN
    RAISE EXCEPTION
      'DB-07 index definition drift for %.%: expected exactly %',
      p_child_schema, p_index, v_expected_definition;
  END IF;
END;
$db07_assert$;

-- Preflight all twelve current catalog contracts before creating any index. The catalog
-- evidence is source base e0e83778af66494c60dfdd0511b51b50e3d369a5; a mismatched live
-- definition needs a new review rather than a name-only IF NOT EXISTS skip.
SELECT pg_temp.db07_assert_fk_index('circles_admin', 'entity_state', 'entity_state_updated_by_fkey', 'updated_by', 'circles_admin', 'operators', 'id', 'circles_admin_entity_state_updated_by_fk_idx', false);
SELECT pg_temp.db07_assert_fk_index('circles_admin', 'report_reviews', 'report_reviews_reviewer_operator_id_fkey', 'reviewer_operator_id', 'circles_admin', 'operators', 'id', 'circles_admin_report_reviews_reviewer_operator_id_fk_idx', false);
SELECT pg_temp.db07_assert_fk_index('circles_admin', 'settings', 'settings_updated_by_fkey', 'updated_by', 'circles_admin', 'operators', 'id', 'circles_admin_settings_updated_by_fk_idx', false);
SELECT pg_temp.db07_assert_fk_index('circles_app', 'circles', 'circles_home_pinned_post_id_fkey', 'pinnedPostId', 'circles_app', 'posts', 'id', 'circles_app_circles_pinned_post_id_fk_idx', false);
SELECT pg_temp.db07_assert_fk_index('circles_app', 'comments', 'comments_authorId_fkey', 'authorId', 'circles_app', 'users', 'id', 'circles_app_comments_author_id_fk_idx', false);
SELECT pg_temp.db07_assert_fk_index('circles_app', 'messages', 'messages_authorId_fkey', 'authorId', 'circles_app', 'users', 'id', 'circles_app_messages_author_id_fk_idx', false);
SELECT pg_temp.db07_assert_fk_index('circles_app', 'moderationCases', 'moderationCases_subjectUserId_fkey', 'subjectUserId', 'circles_app', 'users', 'id', 'circles_app_moderation_cases_subject_user_id_fk_idx', false);
SELECT pg_temp.db07_assert_fk_index('circles_app', 'reports', 'reports_reporterId_fkey', 'reporterId', 'circles_app', 'users', 'id', 'circles_app_reports_reporter_id_fk_idx', false);
SELECT pg_temp.db07_assert_fk_index('private', 'store_transactions', 'store_transactions_user_id_fkey', 'user_id', 'public', 'profiles', 'id', 'private_store_transactions_user_id_fk_idx', false);
SELECT pg_temp.db07_assert_fk_index('public', 'direct_messages', 'direct_messages_recipient_id_fkey', 'recipient_id', 'public', 'profiles', 'id', 'public_direct_messages_recipient_id_fk_idx', false);
SELECT pg_temp.db07_assert_fk_index('public', 'posts', 'posts_circle_id_fkey', 'circle_id', 'public', 'circles', 'id', 'public_posts_circle_id_fk_idx', false);
SELECT pg_temp.db07_assert_fk_index('public', 'posts', 'posts_topic_id_fkey', 'topic_id', 'public', 'circle_topics', 'id', 'public_posts_topic_id_fk_idx', false);

-- These must remain top-level autocommit statements. Do not move them into DO, a function,
-- BEGIN/COMMIT, or a runner transaction. No existing index is dropped or rebuilt.
CREATE INDEX CONCURRENTLY IF NOT EXISTS circles_admin_entity_state_updated_by_fk_idx ON circles_admin.entity_state USING btree (updated_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS circles_admin_report_reviews_reviewer_operator_id_fk_idx ON circles_admin.report_reviews USING btree (reviewer_operator_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS circles_admin_settings_updated_by_fk_idx ON circles_admin.settings USING btree (updated_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS circles_app_circles_pinned_post_id_fk_idx ON circles_app.circles USING btree ("pinnedPostId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS circles_app_comments_author_id_fk_idx ON circles_app.comments USING btree ("authorId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS circles_app_messages_author_id_fk_idx ON circles_app.messages USING btree ("authorId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS circles_app_moderation_cases_subject_user_id_fk_idx ON circles_app."moderationCases" USING btree ("subjectUserId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS circles_app_reports_reporter_id_fk_idx ON circles_app.reports USING btree ("reporterId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS private_store_transactions_user_id_fk_idx ON private.store_transactions USING btree (user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS public_direct_messages_recipient_id_fk_idx ON public.direct_messages USING btree (recipient_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS public_posts_circle_id_fk_idx ON public.posts USING btree (circle_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS public_posts_topic_id_fk_idx ON public.posts USING btree (topic_id);

-- Postflight reuses the same exact definition validation and requires every named index to
-- be valid, ready, live, non-unique, unpredicated, non-expression, single-key B-tree.
SELECT pg_temp.db07_assert_fk_index('circles_admin', 'entity_state', 'entity_state_updated_by_fkey', 'updated_by', 'circles_admin', 'operators', 'id', 'circles_admin_entity_state_updated_by_fk_idx', true);
SELECT pg_temp.db07_assert_fk_index('circles_admin', 'report_reviews', 'report_reviews_reviewer_operator_id_fkey', 'reviewer_operator_id', 'circles_admin', 'operators', 'id', 'circles_admin_report_reviews_reviewer_operator_id_fk_idx', true);
SELECT pg_temp.db07_assert_fk_index('circles_admin', 'settings', 'settings_updated_by_fkey', 'updated_by', 'circles_admin', 'operators', 'id', 'circles_admin_settings_updated_by_fk_idx', true);
SELECT pg_temp.db07_assert_fk_index('circles_app', 'circles', 'circles_home_pinned_post_id_fkey', 'pinnedPostId', 'circles_app', 'posts', 'id', 'circles_app_circles_pinned_post_id_fk_idx', true);
SELECT pg_temp.db07_assert_fk_index('circles_app', 'comments', 'comments_authorId_fkey', 'authorId', 'circles_app', 'users', 'id', 'circles_app_comments_author_id_fk_idx', true);
SELECT pg_temp.db07_assert_fk_index('circles_app', 'messages', 'messages_authorId_fkey', 'authorId', 'circles_app', 'users', 'id', 'circles_app_messages_author_id_fk_idx', true);
SELECT pg_temp.db07_assert_fk_index('circles_app', 'moderationCases', 'moderationCases_subjectUserId_fkey', 'subjectUserId', 'circles_app', 'users', 'id', 'circles_app_moderation_cases_subject_user_id_fk_idx', true);
SELECT pg_temp.db07_assert_fk_index('circles_app', 'reports', 'reports_reporterId_fkey', 'reporterId', 'circles_app', 'users', 'id', 'circles_app_reports_reporter_id_fk_idx', true);
SELECT pg_temp.db07_assert_fk_index('private', 'store_transactions', 'store_transactions_user_id_fkey', 'user_id', 'public', 'profiles', 'id', 'private_store_transactions_user_id_fk_idx', true);
SELECT pg_temp.db07_assert_fk_index('public', 'direct_messages', 'direct_messages_recipient_id_fkey', 'recipient_id', 'public', 'profiles', 'id', 'public_direct_messages_recipient_id_fk_idx', true);
SELECT pg_temp.db07_assert_fk_index('public', 'posts', 'posts_circle_id_fkey', 'circle_id', 'public', 'circles', 'id', 'public_posts_circle_id_fk_idx', true);
SELECT pg_temp.db07_assert_fk_index('public', 'posts', 'posts_topic_id_fkey', 'topic_id', 'public', 'circle_topics', 'id', 'public_posts_topic_id_fk_idx', true);

DROP FUNCTION pg_temp.db07_assert_fk_index(
  pg_catalog.name, pg_catalog.name, pg_catalog.name, pg_catalog.name,
  pg_catalog.name, pg_catalog.name, pg_catalog.name, pg_catalog.name, boolean
);
SELECT pg_catalog.pg_advisory_unlock(
  pg_catalog.hashtextextended('circles.db07.foreign_key_indexes', 0)
) AS db07_advisory_lock_released;

\echo 'DB-07: all twelve reviewed child-side B-tree indexes passed exact postflight validation.'
