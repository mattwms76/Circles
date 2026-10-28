-- DB-17: unactivated candidate for same-Circle pinned-post integrity.
--
-- Apply only after parent approval and an isolated PostgreSQL 17 drill. This file is not an
-- applied migration and performs no data normalization, DML, grants, RLS, policy, or role change.
--
-- Runner contract:
--   * Execute with psql/driver autocommit enabled. CREATE INDEX CONCURRENTLY cannot run inside a
--     transaction block, so do not wrap this file in BEGIN/COMMIT or a migration runner transaction.
--   * Run against the exact reviewed Circles schema only, with a bounded lock/statement timeout.
--   * The separate DB-04 validation candidate may validate the pre-existing single-column pin FK.
--     This candidate deliberately leaves its new composite FK NOT VALID; that enforces future
--     inserts/updates without claiming that this file certified history.
--   * Do not activate the live host/Circle/stream alternatives described in docs/database-remediation/DB-17.md
--     until their deletion/tombstone decisions are explicitly approved.
--
-- The existing circles_home_pinned_post_id_fkey retains ON DELETE SET NULL. The composite FK below
-- makes (pinnedPostId, circles.id) reference (posts.id, posts.circleId), so every subsequent writer
-- must choose a post owned by the same Circle. Its column-list SET NULL preserves nullable pins and
-- the established clear-on-post-delete behavior.

SET lock_timeout = '5s';
SET statement_timeout = '5min';

DO $db17_pin_preflight$
DECLARE
  v_circle_id_attnum smallint;
  v_circle_pin_attnum smallint;
  v_post_id_attnum smallint;
  v_post_circle_attnum smallint;
BEGIN
  IF pg_catalog.to_regclass('circles_app.circles') IS NULL
     OR pg_catalog.to_regclass('circles_app.posts') IS NULL THEN
    RAISE EXCEPTION 'DB-17 requires circles_app.circles and circles_app.posts';
  END IF;

  SELECT attnum INTO v_circle_id_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'circles_app.circles'::pg_catalog.regclass
    AND attname = 'id'::pg_catalog.name
    AND NOT attisdropped
    AND atttypid = 'integer'::pg_catalog.regtype;

  SELECT attnum INTO v_circle_pin_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'circles_app.circles'::pg_catalog.regclass
    AND attname = 'pinnedPostId'::pg_catalog.name
    AND NOT attisdropped
    AND atttypid = 'integer'::pg_catalog.regtype
    AND NOT attnotnull;

  SELECT attnum INTO v_post_id_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'circles_app.posts'::pg_catalog.regclass
    AND attname = 'id'::pg_catalog.name
    AND NOT attisdropped
    AND atttypid = 'integer'::pg_catalog.regtype;

  SELECT attnum INTO v_post_circle_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'circles_app.posts'::pg_catalog.regclass
    AND attname = 'circleId'::pg_catalog.name
    AND NOT attisdropped
    AND atttypid = 'integer'::pg_catalog.regtype;

  IF v_circle_id_attnum IS NULL
     OR v_circle_pin_attnum IS NULL
     OR v_post_id_attnum IS NULL
     OR v_post_circle_attnum IS NULL THEN
    RAISE EXCEPTION 'DB-17 requires integer circles.id, nullable circles.pinnedPostId, integer posts.id, and integer posts.circleId';
  END IF;

  -- Preserve the original pointer FK and its deletion behavior. Either validation state is allowed
  -- because DB-04 may validate this historical constraint before DB-17 is reviewed.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    WHERE c.conname = 'circles_home_pinned_post_id_fkey'::pg_catalog.name
      AND c.contype = 'f'
      AND c.conrelid = 'circles_app.circles'::pg_catalog.regclass
      AND c.confrelid = 'circles_app.posts'::pg_catalog.regclass
      AND c.conkey = ARRAY[v_circle_pin_attnum]
      AND c.confkey = ARRAY[v_post_id_attnum]
      AND c.confdeltype = 'n'
      AND c.confupdtype = 'a'
      AND c.confmatchtype = 's'
      AND NOT c.condeferrable
      AND NOT c.condeferred
  ) THEN
    RAISE EXCEPTION 'DB-17 requires the exact circles_home_pinned_post_id_fkey with ON DELETE SET NULL';
  END IF;

  -- A differently named pre-existing composite uniqueness contract is not silently adopted. It
  -- needs explicit compatibility review because this candidate relies on its exact target shape.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    WHERE c.contype = 'u'
      AND c.conrelid = 'circles_app.posts'::pg_catalog.regclass
      AND c.conkey = ARRAY[v_post_id_attnum, v_post_circle_attnum]
      AND c.conname <> 'circles_posts_id_circle_id_db17_key'::pg_catalog.name
  ) THEN
    RAISE EXCEPTION 'DB-17 found an unexpected posts(id, circleId) unique constraint; review compatibility before activation';
  END IF;
END;
$db17_pin_preflight$;

-- The explicit post id is already unique, but PostgreSQL requires this ordered composite unique
-- target for the same-parent foreign key. IF NOT EXISTS is followed by an exact catalog check.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS circles_posts_id_circle_id_db17_key
  ON circles_app.posts (id, "circleId");

DO $db17_pin_target$
DECLARE
  v_index oid := pg_catalog.to_regclass('circles_app.circles_posts_id_circle_id_db17_key');
  v_attnames pg_catalog.name[];
  v_constraint_name pg_catalog.name;
BEGIN
  IF v_index IS NULL THEN
    RAISE EXCEPTION 'DB-17 composite target index was not created';
  END IF;

  SELECT pg_catalog.array_agg(a.attname ORDER BY key_column.ordinality)
    INTO v_attnames
  FROM pg_catalog.pg_index i
  CROSS JOIN LATERAL pg_catalog.unnest(i.indkey) WITH ORDINALITY AS key_column(attnum, ordinality)
  JOIN pg_catalog.pg_attribute a
    ON a.attrelid = i.indrelid
   AND a.attnum = key_column.attnum
  WHERE i.indexrelid = v_index;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index i
    WHERE i.indexrelid = v_index
      AND i.indrelid = 'circles_app.posts'::pg_catalog.regclass
      AND i.indisunique
      AND i.indisvalid
      AND i.indisready
      AND i.indnkeyatts = 2
      AND i.indnatts = 2
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
  ) OR v_attnames IS DISTINCT FROM ARRAY['id'::pg_catalog.name, 'circleId'::pg_catalog.name] THEN
    RAISE EXCEPTION 'DB-17 composite target index has an unexpected definition';
  END IF;

  SELECT c.conname INTO v_constraint_name
  FROM pg_catalog.pg_constraint c
  WHERE c.conindid = v_index
    AND c.conrelid = 'circles_app.posts'::pg_catalog.regclass
    AND c.contype = 'u';

  IF v_constraint_name IS NULL THEN
    ALTER TABLE circles_app.posts
      ADD CONSTRAINT circles_posts_id_circle_id_db17_key
      UNIQUE USING INDEX circles_posts_id_circle_id_db17_key;
  ELSIF v_constraint_name <> 'circles_posts_id_circle_id_db17_key'::pg_catalog.name THEN
    RAISE EXCEPTION 'DB-17 composite target index is owned by unexpected constraint %', v_constraint_name;
  END IF;
END;
$db17_pin_target$;

DO $db17_same_parent_fk$
DECLARE
  v_circle_id_attnum smallint;
  v_circle_pin_attnum smallint;
  v_post_id_attnum smallint;
  v_post_circle_attnum smallint;
BEGIN
  SELECT attnum INTO v_circle_id_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'circles_app.circles'::pg_catalog.regclass
    AND attname = 'id'::pg_catalog.name
    AND NOT attisdropped;

  SELECT attnum INTO v_circle_pin_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'circles_app.circles'::pg_catalog.regclass
    AND attname = 'pinnedPostId'::pg_catalog.name
    AND NOT attisdropped;

  SELECT attnum INTO v_post_id_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'circles_app.posts'::pg_catalog.regclass
    AND attname = 'id'::pg_catalog.name
    AND NOT attisdropped;

  SELECT attnum INTO v_post_circle_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'circles_app.posts'::pg_catalog.regclass
    AND attname = 'circleId'::pg_catalog.name
    AND NOT attisdropped;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'circles_app.circles'::pg_catalog.regclass
      AND c.contype = 'f'
      AND c.conkey = ARRAY[v_circle_pin_attnum, v_circle_id_attnum]
      AND c.confrelid = 'circles_app.posts'::pg_catalog.regclass
      AND c.confkey = ARRAY[v_post_id_attnum, v_post_circle_attnum]
      AND c.conname <> 'circles_pinned_post_same_circle_db17_fkey'::pg_catalog.name
  ) THEN
    RAISE EXCEPTION 'DB-17 found an unexpected same-parent pin FK; review compatibility before activation';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    WHERE c.conname = 'circles_pinned_post_same_circle_db17_fkey'::pg_catalog.name
      AND c.conrelid = 'circles_app.circles'::pg_catalog.regclass
  ) THEN
    ALTER TABLE circles_app.circles
      ADD CONSTRAINT circles_pinned_post_same_circle_db17_fkey
      FOREIGN KEY ("pinnedPostId", id)
      REFERENCES circles_app.posts (id, "circleId")
      ON DELETE SET NULL ("pinnedPostId")
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    WHERE c.conname = 'circles_pinned_post_same_circle_db17_fkey'::pg_catalog.name
      AND c.contype = 'f'
      AND c.conrelid = 'circles_app.circles'::pg_catalog.regclass
      AND c.confrelid = 'circles_app.posts'::pg_catalog.regclass
      AND c.conkey = ARRAY[v_circle_pin_attnum, v_circle_id_attnum]
      AND c.confkey = ARRAY[v_post_id_attnum, v_post_circle_attnum]
      AND c.confdeltype = 'n'
      AND c.confupdtype = 'a'
      AND c.confmatchtype = 's'
      AND NOT c.condeferrable
      AND NOT c.condeferred
  ) THEN
    RAISE EXCEPTION 'DB-17 same-parent pin FK has an unexpected definition';
  END IF;
END;
$db17_same_parent_fk$;

RESET lock_timeout;
RESET statement_timeout;
