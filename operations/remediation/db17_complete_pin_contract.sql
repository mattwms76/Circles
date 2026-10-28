-- Additive completion of the reviewed same-Circle pin contract.
-- Execute via psql autocommit, not an enclosing migration transaction:
-- CREATE INDEX CONCURRENTLY requires it. No row repair or RLS/grant change occurs.
\set ON_ERROR_STOP on
SET search_path = pg_catalog;
SET lock_timeout = '2s';
SET statement_timeout = '30s';
DO $pin_completion_preflight$
DECLARE
  v_definition text;
  v_expected text := 'FOREIGN KEY ("pinnedPostId", id) REFERENCES circles_app.posts(id, "circleId") ON DELETE SET NULL ("pinnedPostId")';
BEGIN
  IF session_user <> 'postgres' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Pin completion requires the reviewed postgres operation';
  END IF;
  IF NOT pg_catalog.pg_try_advisory_lock(pg_catalog.hashtextextended('circles:db17-pin-completion', 0)) THEN
    RAISE EXCEPTION 'Pin completion is already running';
  END IF;
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO STRICT v_definition
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = 'circles_app.circles'::pg_catalog.regclass
    AND c.conname = 'circles_pinned_post_same_circle_db17_fkey'
    AND c.contype = 'f';
  IF v_definition NOT IN (v_expected, v_expected || ' NOT VALID') THEN
    RAISE EXCEPTION 'Pin completion found an unreviewed foreign key';
  END IF;
  IF EXISTS (
    SELECT 1 FROM circles_app.circles c
    WHERE c."pinnedPostId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM circles_app.posts p
      WHERE p.id = c."pinnedPostId" AND p."circleId" = c.id
    )
  ) THEN
    RAISE EXCEPTION 'Pin completion found historical violations; no row repair is authorized';
  END IF;
END;
$pin_completion_preflight$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS circles_pinned_post_same_circle_db17_idx
  ON circles_app.circles ("pinnedPostId", id);
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DO $pin_completion_index$
DECLARE v_names text[];
BEGIN
  SELECT pg_catalog.array_agg(a.attname::text ORDER BY key_column.ordinality)
    INTO v_names
  FROM pg_catalog.pg_index i
  CROSS JOIN LATERAL pg_catalog.unnest(i.indkey) WITH ORDINALITY AS key_column(attnum, ordinality)
  JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = key_column.attnum
  WHERE i.indexrelid = pg_catalog.to_regclass('circles_app.circles_pinned_post_same_circle_db17_idx');
  IF v_names IS DISTINCT FROM ARRAY['pinnedPostId', 'id']::text[] OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class index_class ON index_class.oid = i.indexrelid
    JOIN pg_catalog.pg_am am ON am.oid = index_class.relam
    WHERE i.indexrelid = pg_catalog.to_regclass('circles_app.circles_pinned_post_same_circle_db17_idx')
      AND i.indrelid = 'circles_app.circles'::pg_catalog.regclass
      AND i.indisvalid AND i.indisready AND NOT i.indisunique
      AND i.indnkeyatts = 2 AND i.indnatts = 2
      AND i.indpred IS NULL AND i.indexprs IS NULL
      AND am.amname = 'btree'
      AND index_class.relowner = 'postgres'::pg_catalog.regrole
      AND pg_catalog.pg_get_indexdef(i.indexrelid) =
        'CREATE INDEX circles_pinned_post_same_circle_db17_idx ON circles_app.circles USING btree ("pinnedPostId", id)'
  ) THEN
    RAISE EXCEPTION 'Pin completion found an unreviewed or invalid covering index';
  END IF;
END;
$pin_completion_index$;
ALTER TABLE circles_app.circles
  VALIDATE CONSTRAINT circles_pinned_post_same_circle_db17_fkey;
DO $pin_completion_postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'circles_app.circles'::pg_catalog.regclass
      AND c.conname = 'circles_pinned_post_same_circle_db17_fkey'
      AND c.contype = 'f' AND c.convalidated
      AND pg_catalog.pg_get_constraintdef(c.oid) =
        'FOREIGN KEY ("pinnedPostId", id) REFERENCES circles_app.posts(id, "circleId") ON DELETE SET NULL ("pinnedPostId")'
  ) THEN
    RAISE EXCEPTION 'Pin completion did not certify the exact reviewed historical contract';
  END IF;
END;
$pin_completion_postflight$;
COMMIT;
SELECT pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended('circles:db17-pin-completion', 0));
