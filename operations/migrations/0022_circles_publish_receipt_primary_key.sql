-- DB-11: compatible composite primary key for durable publish receipts.
--
-- Prepared only. This additive migration is not applied by this source change. Run it once,
-- after the DB-11 synthetic PG17 drill and explicit live approval, through the reviewed private
-- PostgreSQL migration workflow. It intentionally retains the existing named UNIQUE constraint:
-- post_publish_receipts_actor_operation_unique. Its backing index is already owned by that
-- constraint and therefore cannot be promoted with ADD PRIMARY KEY USING INDEX.
--
-- The new primary key creates its own btree index, post_publish_receipts_pkey, on the same two
-- non-null columns. That preserves the current named uniqueness and the application's
-- ON CONFLICT ("actorId", "operationId") inference while providing formal primary-key metadata
-- for tooling/replication consumers.

BEGIN;

-- Do not wait indefinitely for a write/DDL lock. Operators may raise these only in the reviewed
-- live run plan after assessing table size, logical-replication consumers, and maintenance load.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  receipt_relation oid;
  actor_attribute smallint;
  operation_attribute smallint;
  unique_constraint oid;
  unique_constraint_index oid;
  existing_primary_key_name name;
  primary_key_constraint oid;
  primary_key_index oid;
BEGIN
  SELECT relation_catalog.oid
    INTO receipt_relation
  FROM pg_catalog.pg_class AS relation_catalog
  JOIN pg_catalog.pg_namespace AS namespace_catalog
    ON namespace_catalog.oid = relation_catalog.relnamespace
  WHERE namespace_catalog.nspname = 'circles_publish'
    AND relation_catalog.relname = 'postPublishReceipts'
    AND relation_catalog.relkind = 'r';

  IF receipt_relation IS NULL THEN
    RAISE EXCEPTION
      'DB-11 requires circles_publish."postPublishReceipts" to exist as an ordinary table';
  END IF;

  -- Guard the known receipt shape. The primary key cannot make a nullable business key valid.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute_catalog
    WHERE attribute_catalog.attrelid = receipt_relation
      AND attribute_catalog.attname = 'actorId'
      AND NOT attribute_catalog.attisdropped
      AND pg_catalog.format_type(
        attribute_catalog.atttypid,
        attribute_catalog.atttypmod
      ) = 'integer'
      AND attribute_catalog.attnotnull
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute_catalog
    WHERE attribute_catalog.attrelid = receipt_relation
      AND attribute_catalog.attname = 'operationId'
      AND NOT attribute_catalog.attisdropped
      AND pg_catalog.format_type(
        attribute_catalog.atttypid,
        attribute_catalog.atttypmod
      ) = 'character varying(96)'
      AND attribute_catalog.attnotnull
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute_catalog
    WHERE attribute_catalog.attrelid = receipt_relation
      AND attribute_catalog.attname = 'payloadHash'
      AND NOT attribute_catalog.attisdropped
      AND pg_catalog.format_type(
        attribute_catalog.atttypid,
        attribute_catalog.atttypmod
      ) = 'character varying(64)'
      AND attribute_catalog.attnotnull
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute_catalog
    WHERE attribute_catalog.attrelid = receipt_relation
      AND attribute_catalog.attname = 'postId'
      AND NOT attribute_catalog.attisdropped
      AND pg_catalog.format_type(
        attribute_catalog.atttypid,
        attribute_catalog.atttypmod
      ) = 'integer'
      AND NOT attribute_catalog.attnotnull
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute_catalog
    WHERE attribute_catalog.attrelid = receipt_relation
      AND attribute_catalog.attname = 'createdAt'
      AND NOT attribute_catalog.attisdropped
      AND pg_catalog.format_type(
        attribute_catalog.atttypid,
        attribute_catalog.atttypmod
      ) = 'timestamp with time zone'
      AND attribute_catalog.attnotnull
  ) THEN
    RAISE EXCEPTION
      'DB-11 found an incompatible publish receipt column contract';
  END IF;

  SELECT attribute_catalog.attnum
    INTO actor_attribute
  FROM pg_catalog.pg_attribute AS attribute_catalog
  WHERE attribute_catalog.attrelid = receipt_relation
    AND attribute_catalog.attname = 'actorId'
    AND NOT attribute_catalog.attisdropped;

  SELECT attribute_catalog.attnum
    INTO operation_attribute
  FROM pg_catalog.pg_attribute AS attribute_catalog
  WHERE attribute_catalog.attrelid = receipt_relation
    AND attribute_catalog.attname = 'operationId'
    AND NOT attribute_catalog.attisdropped;

  -- Preserve the original non-deferrable named business-uniqueness arbiter. The service's
  -- ON CONFLICT ("actorId", "operationId") remains compatible with this constraint and the PK.
  SELECT constraint_catalog.oid, constraint_catalog.conindid
    INTO unique_constraint, unique_constraint_index
  FROM pg_catalog.pg_constraint AS constraint_catalog
  WHERE constraint_catalog.conrelid = receipt_relation
    AND constraint_catalog.conname = 'post_publish_receipts_actor_operation_unique'
    AND constraint_catalog.contype = 'u'
    AND constraint_catalog.convalidated
    AND NOT constraint_catalog.condeferrable
    AND NOT constraint_catalog.condeferred
    AND constraint_catalog.conkey = ARRAY[actor_attribute, operation_attribute]::smallint[];

  IF unique_constraint IS NULL OR unique_constraint_index IS NULL THEN
    RAISE EXCEPTION
      'DB-11 requires validated non-deferrable post_publish_receipts_actor_operation_unique on (actorId, operationId)';
  END IF;

  -- Retain the two deletion semantics and both input checks. The PK change must not remove the
  -- receipt tombstone (postId ON DELETE SET NULL), actor cleanup, or payload/operation validation.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_catalog
    WHERE constraint_catalog.conrelid = receipt_relation
      AND constraint_catalog.conname = 'postPublishReceipts_actorId_fkey'
      AND constraint_catalog.contype = 'f'
      AND constraint_catalog.convalidated
      AND constraint_catalog.conkey = ARRAY[actor_attribute]::smallint[]
      AND constraint_catalog.confrelid = 'circles_app.users'::pg_catalog.regclass
      AND constraint_catalog.confdeltype = 'c'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_catalog
    WHERE constraint_catalog.conrelid = receipt_relation
      AND constraint_catalog.conname = 'postPublishReceipts_postId_fkey'
      AND constraint_catalog.contype = 'f'
      AND constraint_catalog.convalidated
      AND constraint_catalog.confrelid = 'circles_app.posts'::pg_catalog.regclass
      AND constraint_catalog.confdeltype = 'n'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_catalog
    WHERE constraint_catalog.conrelid = receipt_relation
      AND constraint_catalog.conname = 'post_publish_receipts_operation_id_check'
      AND constraint_catalog.contype = 'c'
      AND constraint_catalog.convalidated
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_catalog
    WHERE constraint_catalog.conrelid = receipt_relation
      AND constraint_catalog.conname = 'post_publish_receipts_payload_hash_check'
      AND constraint_catalog.contype = 'c'
      AND constraint_catalog.convalidated
  ) THEN
    RAISE EXCEPTION
      'DB-11 found an incompatible publish receipt foreign-key, tombstone, or check contract';
  END IF;

  SELECT constraint_catalog.conname
    INTO existing_primary_key_name
  FROM pg_catalog.pg_constraint AS constraint_catalog
  WHERE constraint_catalog.conrelid = receipt_relation
    AND constraint_catalog.contype = 'p';

  IF existing_primary_key_name IS NOT NULL THEN
    SELECT constraint_catalog.oid, constraint_catalog.conindid
      INTO primary_key_constraint, primary_key_index
    FROM pg_catalog.pg_constraint AS constraint_catalog
    WHERE constraint_catalog.conrelid = receipt_relation
      AND constraint_catalog.conname = 'post_publish_receipts_pkey'
      AND constraint_catalog.contype = 'p'
      AND constraint_catalog.convalidated
      AND NOT constraint_catalog.condeferrable
      AND NOT constraint_catalog.condeferred
      AND constraint_catalog.conkey = ARRAY[actor_attribute, operation_attribute]::smallint[];

    IF primary_key_constraint IS NULL OR primary_key_index IS NULL THEN
      RAISE EXCEPTION
        'DB-11 refuses to replace incompatible existing primary key % on publish receipts',
        existing_primary_key_name;
    END IF;
  ELSE
    -- Do not use the pre-existing unique index here: PostgreSQL associates it with the named
    -- UNIQUE constraint above. ADD PRIMARY KEY intentionally creates a separate PK-owned index.
    EXECUTE
      'ALTER TABLE circles_publish."postPublishReceipts" '
      || 'ADD CONSTRAINT post_publish_receipts_pkey '
      || 'PRIMARY KEY ("actorId", "operationId")';
  END IF;

  -- Exact idempotent post-state: both constraints must exist, use the same ordered columns, and
  -- own distinct backing indexes. A second invocation only verifies this state.
  SELECT constraint_catalog.oid, constraint_catalog.conindid
    INTO primary_key_constraint, primary_key_index
  FROM pg_catalog.pg_constraint AS constraint_catalog
  WHERE constraint_catalog.conrelid = receipt_relation
    AND constraint_catalog.conname = 'post_publish_receipts_pkey'
    AND constraint_catalog.contype = 'p'
    AND constraint_catalog.convalidated
    AND NOT constraint_catalog.condeferrable
    AND NOT constraint_catalog.condeferred
    AND constraint_catalog.conkey = ARRAY[actor_attribute, operation_attribute]::smallint[];

  IF primary_key_constraint IS NULL
    OR primary_key_index IS NULL
    OR primary_key_index = unique_constraint_index THEN
    RAISE EXCEPTION
      'DB-11 primary-key post-state is missing, incompatible, or reuses the named UNIQUE index';
  END IF;
END
$$;

COMMIT;
