-- Current-feature FK-index reconciliation: additive coverage for exactly three current catalog gaps.
--
-- This is a psql-only, autocommit script. Do not use --single-transaction, wrap this
-- file in BEGIN/COMMIT, or use a migration runner that opens a transaction: CREATE INDEX
-- CONCURRENTLY is deliberately required to avoid a long table-write lock.
--
-- Parent approval and a fresh parent-controlled recovery gate are required before any
-- authorized target run:
--   psql -X -v ON_ERROR_STOP=1 -v current_feature_fk_indexes_confirm_no_transaction=1 \
--     -f operations/remediation/current_feature_fk_indexes.sql
--
-- The script creates no rows and never drops/rebuilds an index. It does not change foreign
-- keys, constraints, grants, roles, RLS, policies, functions, ownership, schedules, or
-- original DB-07 twelve-index history. A same-name object with a non-exact definition is a
-- stop condition; IF NOT EXISTS is used only after fail-closed preflight and is rechecked
-- fail-closed after creation.

\set ON_ERROR_STOP on
\if :{?current_feature_fk_indexes_confirm_no_transaction}
\else
  \echo 'Current-feature FK-index reconciliation refused: invoke psql with -v current_feature_fk_indexes_confirm_no_transaction=1 and without --single-transaction.'
  \quit 3
\endif
\if :current_feature_fk_indexes_confirm_no_transaction
\else
  \echo 'Current-feature FK-index reconciliation refused: current_feature_fk_indexes_confirm_no_transaction must be a true psql boolean (use 1).'
  \quit 3
\endif

\echo 'Current-feature FK-index reconciliation: validating three approved FK/index contracts before concurrent creation.'

-- Bound catalog/table-lock waits and index-build/old-snapshot waiting. A timeout or blocked
-- lock is a stop condition for operator investigation, never an instruction to drop/retry.
SET lock_timeout = '5s';
SET statement_timeout = '30min';

-- A non-blocking session-level lock prevents two approved runners from interleaving. It is
-- released explicitly on success and automatically if psql exits after a preflight error.
DO $current_feature_fk_indexes_lock$
BEGIN
  IF NOT pg_catalog.pg_try_advisory_lock(
    pg_catalog.hashtextextended('circles.current_feature_fk_indexes', 0)
  ) THEN
    RAISE EXCEPTION 'current-feature FK-index reconciliation is already running in another session; stop instead of overlapping concurrent index builds';
  END IF;
END;
$current_feature_fk_indexes_lock$;

-- Session-local only: validate the exact child and parent schema/table ownership, one-column
-- FK shape/order/type/deletion semantics, and any same-name index. No persistent helper is
-- created. Existing named indexes must be exact, valid, ready, live, non-primary/non-unique,
-- unpredicated, non-expression, single-key B-trees with the required default operator class,
-- column collation, ascending/nulls-last sort option, and exact pg_get_indexdef output.
CREATE OR REPLACE FUNCTION pg_temp.current_feature_fk_indexes_assert(
  p_child_schema pg_catalog.name,
  p_child_table pg_catalog.name,
  p_constraint pg_catalog.name,
  p_child_column pg_catalog.name,
  p_parent_schema pg_catalog.name,
  p_parent_table pg_catalog.name,
  p_parent_column pg_catalog.name,
  p_column_type pg_catalog.regtype,
  p_delete_action "char",
  p_operator_class pg_catalog.name,
  p_owner pg_catalog.name,
  p_index pg_catalog.name,
  p_must_exist boolean
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $current_feature_fk_indexes_assert$
DECLARE
  v_child_relation pg_catalog.oid;
  v_parent_relation pg_catalog.oid;
  v_child_attnum smallint;
  v_parent_attnum smallint;
  v_child_type pg_catalog.oid;
  v_parent_type pg_catalog.oid;
  v_child_collation pg_catalog.oid;
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
      'current-feature FK-index prerequisite missing for %: expected %.% and %.%',
      p_index, p_child_schema, p_child_table, p_parent_schema, p_parent_table;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE relation.oid = v_child_relation
      AND relation.relkind IN ('r', 'p')
      AND namespace.nspname = p_child_schema
      AND pg_catalog.pg_get_userbyid(namespace.nspowner) = p_owner
      AND pg_catalog.pg_get_userbyid(relation.relowner) = p_owner
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE relation.oid = v_parent_relation
      AND relation.relkind IN ('r', 'p')
      AND namespace.nspname = p_parent_schema
      AND pg_catalog.pg_get_userbyid(namespace.nspowner) = p_owner
      AND pg_catalog.pg_get_userbyid(relation.relowner) = p_owner
  ) THEN
    RAISE EXCEPTION
      'current-feature FK-index ownership or relation-kind drift for %: expected owner % on reviewed schemas/tables',
      p_index, p_owner;
  END IF;

  SELECT attribute.attnum, attribute.atttypid, attribute.attcollation
    INTO v_child_attnum, v_child_type, v_child_collation
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = v_child_relation
    AND attribute.attname = p_child_column
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  SELECT attribute.attnum, attribute.atttypid
    INTO v_parent_attnum, v_parent_type
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = v_parent_relation
    AND attribute.attname = p_parent_column
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF v_child_attnum IS NULL OR v_parent_attnum IS NULL
     OR v_child_type IS DISTINCT FROM p_column_type
     OR v_parent_type IS DISTINCT FROM p_column_type THEN
    RAISE EXCEPTION
      'current-feature FK-index column/type drift for %: expected %.% and %.% to be type %',
      p_index, p_child_table, p_child_column, p_parent_table, p_parent_column, p_column_type::text;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS fk
    WHERE fk.conname = p_constraint
      AND fk.contype = 'f'
      AND fk.convalidated
      AND fk.conrelid = v_child_relation
      AND fk.confrelid = v_parent_relation
      AND pg_catalog.array_length(fk.conkey, 1) = 1
      AND pg_catalog.array_length(fk.confkey, 1) = 1
      AND fk.conkey[1] = v_child_attnum
      AND fk.confkey[1] = v_parent_attnum
      AND fk.confdeltype = p_delete_action
      AND fk.confupdtype = 'a'
      AND fk.confmatchtype = 's'
      AND NOT fk.condeferrable
      AND NOT fk.condeferred
  ) THEN
    RAISE EXCEPTION
      'current-feature FK-index foreign-key contract drift for %: expected named one-column validated FK %.% (%) -> %.% (%)',
      p_index,
      p_child_schema, p_child_table, p_constraint,
      p_parent_schema, p_parent_table, p_parent_column;
  END IF;

  v_index_relation := pg_catalog.to_regclass(
    pg_catalog.format('%I.%I', p_child_schema, p_index)
  );

  IF v_index_relation IS NULL THEN
    IF p_must_exist THEN
      RAISE EXCEPTION
        'current-feature FK-index postcondition failed: expected index %.% is absent',
        p_child_schema, p_index;
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
    JOIN pg_catalog.pg_namespace AS index_namespace
      ON index_namespace.oid = index_relation.relnamespace
    JOIN pg_catalog.pg_am AS access_method
      ON access_method.oid = index_relation.relam
    JOIN LATERAL pg_catalog.unnest(index_metadata.indkey)
      WITH ORDINALITY AS key_column(attnum, ordinality)
      ON key_column.ordinality = 1
    JOIN LATERAL pg_catalog.unnest(index_metadata.indclass)
      WITH ORDINALITY AS key_operator_class(opclass_oid, ordinality)
      ON key_operator_class.ordinality = key_column.ordinality
    JOIN LATERAL pg_catalog.unnest(index_metadata.indcollation)
      WITH ORDINALITY AS key_collation(collation_oid, ordinality)
      ON key_collation.ordinality = key_column.ordinality
    JOIN LATERAL pg_catalog.unnest(index_metadata.indoption)
      WITH ORDINALITY AS key_option(option_bits, ordinality)
      ON key_option.ordinality = key_column.ordinality
    JOIN pg_catalog.pg_opclass AS operator_class
      ON operator_class.oid = key_operator_class.opclass_oid
    JOIN pg_catalog.pg_namespace AS operator_namespace
      ON operator_namespace.oid = operator_class.opcnamespace
    WHERE index_metadata.indexrelid = v_index_relation
      AND index_relation.relkind = 'i'
      AND index_namespace.nspname = p_child_schema
      AND pg_catalog.pg_get_userbyid(index_relation.relowner) = p_owner
      AND index_metadata.indrelid = v_child_relation
      AND access_method.amname = 'btree'
      AND index_metadata.indisvalid
      AND index_metadata.indisready
      AND index_metadata.indislive
      AND NOT index_metadata.indisunique
      AND NOT index_metadata.indisprimary
      AND NOT index_metadata.indnullsnotdistinct
      AND index_metadata.indpred IS NULL
      AND index_metadata.indexprs IS NULL
      AND index_metadata.indnkeyatts = 1
      AND index_metadata.indnatts = 1
      AND key_column.attnum = v_child_attnum
      AND key_collation.collation_oid = v_child_collation
      AND key_option.option_bits = 0
      AND operator_namespace.nspname = 'pg_catalog'
      AND operator_class.opcname = p_operator_class
      AND operator_class.opcintype = v_child_type
      AND operator_class.opcmethod = access_method.oid
      AND operator_class.opcdefault
      AND pg_catalog.pg_get_indexdef(index_metadata.indexrelid) = v_expected_definition
  ) THEN
    RAISE EXCEPTION
      'current-feature FK-index definition drift for %.%: expected exactly %',
      p_child_schema, p_index, v_expected_definition;
  END IF;
END;
$current_feature_fk_indexes_assert$;

-- Preflight every approved current-feature contract before creating any index. These exact
-- definitions came from current-private-schema.sql and current-contract-catalog.json; a
-- mismatch requires fresh review rather than a name-only skip.
SELECT pg_temp.current_feature_fk_indexes_assert(
  'circles_admin', 'review_handoffs', 'review_handoffs_assignee_operator_id_fkey',
  'assignee_operator_id', 'circles_admin', 'operators', 'id', 'uuid', 'c', 'uuid_ops',
  'postgres', 'review_handoffs_assignee_operator_id_fk_idx', false
);
SELECT pg_temp.current_feature_fk_indexes_assert(
  'circles_publish', 'circlePrompts', 'circlePrompts_updatedBy_fkey',
  'updatedBy', 'circles_app', 'users', 'id', 'integer', 'r', 'int4_ops',
  'postgres', 'circle_prompts_updated_by_fk_idx', false
);
SELECT pg_temp.current_feature_fk_indexes_assert(
  'circles_publish', 'promptPosts', 'promptPosts_circleId_fkey',
  'circleId', 'circles_app', 'circles', 'id', 'integer', 'c', 'int4_ops',
  'postgres', 'prompt_posts_circle_id_fk_idx', false
);

-- Keep these as top-level autocommit statements. Do not move them into DO, a function,
-- BEGIN/COMMIT, or a transaction-opening migration runner. IF NOT EXISTS follows the exact
-- preflight and the exact postflight below, so a same-name wrong object cannot be accepted.
CREATE INDEX CONCURRENTLY IF NOT EXISTS review_handoffs_assignee_operator_id_fk_idx
  ON circles_admin.review_handoffs USING btree (assignee_operator_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS circle_prompts_updated_by_fk_idx
  ON circles_publish."circlePrompts" USING btree ("updatedBy");
CREATE INDEX CONCURRENTLY IF NOT EXISTS prompt_posts_circle_id_fk_idx
  ON circles_publish."promptPosts" USING btree ("circleId");

-- Require exact valid/ready/live postconditions for all and therefore refuse a concurrent
-- partial/invalid index or an object raced into one of the reviewed names. Never drop/rebuild
-- such evidence through this candidate; preserve it for a separately approved diagnosis.
SELECT pg_temp.current_feature_fk_indexes_assert(
  'circles_admin', 'review_handoffs', 'review_handoffs_assignee_operator_id_fkey',
  'assignee_operator_id', 'circles_admin', 'operators', 'id', 'uuid', 'c', 'uuid_ops',
  'postgres', 'review_handoffs_assignee_operator_id_fk_idx', true
);
SELECT pg_temp.current_feature_fk_indexes_assert(
  'circles_publish', 'circlePrompts', 'circlePrompts_updatedBy_fkey',
  'updatedBy', 'circles_app', 'users', 'id', 'integer', 'r', 'int4_ops',
  'postgres', 'circle_prompts_updated_by_fk_idx', true
);
SELECT pg_temp.current_feature_fk_indexes_assert(
  'circles_publish', 'promptPosts', 'promptPosts_circleId_fkey',
  'circleId', 'circles_app', 'circles', 'id', 'integer', 'c', 'int4_ops',
  'postgres', 'prompt_posts_circle_id_fk_idx', true
);

DROP FUNCTION pg_temp.current_feature_fk_indexes_assert(
  pg_catalog.name, pg_catalog.name, pg_catalog.name, pg_catalog.name,
  pg_catalog.name, pg_catalog.name, pg_catalog.name, pg_catalog.regtype, "char",
  pg_catalog.name, pg_catalog.name, pg_catalog.name, boolean
);
SELECT pg_catalog.pg_advisory_unlock(
  pg_catalog.hashtextextended('circles.current_feature_fk_indexes', 0)
) AS current_feature_fk_indexes_advisory_lock_released;

\echo 'Current-feature FK-index reconciliation: all three reviewed child-side B-tree indexes passed exact postflight validation.'
