-- Transactional compatibility repair for the approved current mediaObjects CHECK.
-- PostgreSQL ARE repetition bounds are limited to255. Splitting0..511 into
-- 0..255 +0..255 +0..1 preserves the exact intended ASCII language/max512 key.
-- Apply through migration management, or psql --single-transaction; not autocommit.
-- No UPDATE/DELETE/INSERT, grants, RLS changes, keys, policies or blob changes.
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE ONLY circles_publish."mediaObjects" IN ACCESS EXCLUSIVE MODE;

DO $preflight$
DECLARE
  target_oid oid := pg_catalog.to_regclass('circles_publish."mediaObjects"');
  old_definition text;
  old_validated boolean;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Refusing media-key compatibility repair: operational owner required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = target_oid AND relation.relkind = 'r'
      AND pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'
      AND relation.relrowsecurity AND relation.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_inherits WHERE inhparent = target_oid OR inhrelid = target_oid
  ) THEN
    RAISE EXCEPTION 'Refusing media-key compatibility repair: table/security shape differs';
  END IF;
  IF (SELECT array_agg(attribute.attname::text ORDER BY attribute.attnum)
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = target_oid AND attribute.attnum > 0 AND NOT attribute.attisdropped)
       IS DISTINCT FROM ARRAY['key','bytes','createdAt']::text[]
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = target_oid AND attribute.attname = 'key'
         AND attribute.attnotnull AND attribute.attidentity = ''
         AND pg_catalog.format_type(attribute.atttypid,attribute.atttypmod) = 'character varying(512)'
     ) THEN
    RAISE EXCEPTION 'Refusing media-key compatibility repair: key/column contract differs';
  END IF;
  SELECT pg_catalog.pg_get_constraintdef(constraint_catalog.oid,true),constraint_catalog.convalidated
    INTO old_definition,old_validated
  FROM pg_catalog.pg_constraint AS constraint_catalog
  WHERE constraint_catalog.conrelid = target_oid
    AND constraint_catalog.conname = 'media_objects_key_check'
    AND constraint_catalog.contype = 'c'
    AND constraint_catalog.conislocal AND constraint_catalog.coninhcount = 0
    AND NOT constraint_catalog.connoinherit;
  IF old_definition IS DISTINCT FROM $expected$CHECK (key::text ~ '^[A-Za-z0-9][A-Za-z0-9_./-]{0,511}$'::text AND key::text !~ '\.\.'::text)$expected$
     OR old_validated IS DISTINCT FROM true
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint
       WHERE conrelid = target_oid AND conname = 'media_objects_key_compat_pending'
     ) THEN
    RAISE EXCEPTION 'Refusing media-key compatibility repair: missing, changed, partial or already-applied CHECK';
  END IF;
END
$preflight$;

ALTER TABLE ONLY circles_publish."mediaObjects"
  ADD CONSTRAINT media_objects_key_compat_pending
  CHECK (key::text ~ '^[A-Za-z0-9][A-Za-z0-9_./-]{0,255}[A-Za-z0-9_./-]{0,255}[A-Za-z0-9_./-]{0,1}$'::text
         AND key::text !~ '\.\.'::text) NOT VALID;
ALTER TABLE ONLY circles_publish."mediaObjects"
  VALIDATE CONSTRAINT media_objects_key_compat_pending;
ALTER TABLE ONLY circles_publish."mediaObjects"
  DROP CONSTRAINT media_objects_key_check;
ALTER TABLE ONLY circles_publish."mediaObjects"
  RENAME CONSTRAINT media_objects_key_compat_pending TO media_objects_key_check;

DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS constraint_catalog
    WHERE constraint_catalog.conrelid = pg_catalog.to_regclass('circles_publish."mediaObjects"')
      AND constraint_catalog.conname = 'media_objects_key_check'
      AND constraint_catalog.contype = 'c' AND constraint_catalog.convalidated
      AND pg_catalog.pg_get_constraintdef(constraint_catalog.oid,true) = $expected$CHECK (key::text ~ '^[A-Za-z0-9][A-Za-z0-9_./-]{0,255}[A-Za-z0-9_./-]{0,255}[A-Za-z0-9_./-]{0,1}$'::text AND key::text !~ '\.\.'::text)$expected$
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid = pg_catalog.to_regclass('circles_publish."mediaObjects"')
      AND pg_catalog.pg_get_userbyid(relowner) = 'postgres'
      AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Media-key compatibility postflight failed';
  END IF;
END
$postflight$;
