-- CBA-04: durable live-chat poll/admission indexes.
--
-- Prepared only. This additive migration has not been applied to any live database.
-- Run it once, after the CBA-04 disposable PG17 drill and explicit approval, through
-- the reviewed private PostgreSQL migration workflow. The application now rejects new
-- rows at bounded stream/participant limits without deleting existing live history;
-- this migration intentionally contains no retention DELETE, archive, or data cleanup.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('circles.cba04.live-chat-bounds.v1'::pg_catalog.text, 0)
);

DO $cba04_preflight$
DECLARE
  v_live_chat_relation pg_catalog.oid;
  v_stream_id_attribute smallint;
  v_user_id_attribute smallint;
  v_created_at_attribute smallint;
  v_id_attribute smallint;
BEGIN
  SELECT relation_catalog.oid
    INTO v_live_chat_relation
    FROM pg_catalog.pg_class AS relation_catalog
    INNER JOIN pg_catalog.pg_namespace AS namespace_catalog
      ON namespace_catalog.oid = relation_catalog.relnamespace
   WHERE namespace_catalog.nspname = 'circles_app'::pg_catalog.name
     AND relation_catalog.relname = 'liveChat'::pg_catalog.name
     AND relation_catalog.relkind = 'r'::pg_catalog."char";

  IF v_live_chat_relation IS NULL THEN
    RAISE EXCEPTION 'CBA-04 requires circles_app."liveChat" as an ordinary table';
  END IF;

  SELECT attribute_catalog.attnum
    INTO v_stream_id_attribute
    FROM pg_catalog.pg_attribute AS attribute_catalog
   WHERE attribute_catalog.attrelid = v_live_chat_relation
     AND attribute_catalog.attname = 'streamId'::pg_catalog.name
     AND NOT attribute_catalog.attisdropped
     AND attribute_catalog.attnotnull
     AND pg_catalog.format_type(attribute_catalog.atttypid, attribute_catalog.atttypmod) = 'integer';
  SELECT attribute_catalog.attnum
    INTO v_user_id_attribute
    FROM pg_catalog.pg_attribute AS attribute_catalog
   WHERE attribute_catalog.attrelid = v_live_chat_relation
     AND attribute_catalog.attname = 'userId'::pg_catalog.name
     AND NOT attribute_catalog.attisdropped
     AND attribute_catalog.attnotnull
     AND pg_catalog.format_type(attribute_catalog.atttypid, attribute_catalog.atttypmod) = 'integer';
  SELECT attribute_catalog.attnum
    INTO v_created_at_attribute
    FROM pg_catalog.pg_attribute AS attribute_catalog
   WHERE attribute_catalog.attrelid = v_live_chat_relation
     AND attribute_catalog.attname = 'createdAt'::pg_catalog.name
     AND NOT attribute_catalog.attisdropped
     AND attribute_catalog.attnotnull
     AND pg_catalog.format_type(attribute_catalog.atttypid, attribute_catalog.atttypmod) = 'timestamp with time zone';
  SELECT attribute_catalog.attnum
    INTO v_id_attribute
    FROM pg_catalog.pg_attribute AS attribute_catalog
   WHERE attribute_catalog.attrelid = v_live_chat_relation
     AND attribute_catalog.attname = 'id'::pg_catalog.name
     AND NOT attribute_catalog.attisdropped
     AND attribute_catalog.attnotnull
     AND pg_catalog.format_type(attribute_catalog.atttypid, attribute_catalog.atttypmod) = 'integer';

  IF v_stream_id_attribute IS NULL
     OR v_user_id_attribute IS NULL
     OR v_created_at_attribute IS NULL
     OR v_id_attribute IS NULL THEN
    RAISE EXCEPTION 'CBA-04 found an incompatible circles_app."liveChat" column contract';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS index_catalog
      INNER JOIN pg_catalog.pg_namespace AS namespace_catalog
        ON namespace_catalog.oid = index_catalog.relnamespace
     WHERE namespace_catalog.nspname = 'circles_app'::pg_catalog.name
       AND index_catalog.relname IN (
         'live_chat_stream_created_id_idx'::pg_catalog.name,
         'live_chat_stream_user_created_idx'::pg_catalog.name
       )
       AND index_catalog.relkind <> 'i'::pg_catalog."char"
  ) THEN
    RAISE EXCEPTION 'CBA-04 index name is occupied by a non-index relation';
  END IF;
END;
$cba04_preflight$;

-- The first index exactly matches chat polling by stream and newest-first order.
-- PostgreSQL can use it for LIMIT 100 without sorting retained history.
CREATE INDEX IF NOT EXISTS live_chat_stream_created_id_idx
  ON circles_app."liveChat" ("streamId", "createdAt" DESC, id DESC);

-- The second index bounds the participant-specific rate and retained-row counts.
CREATE INDEX IF NOT EXISTS live_chat_stream_user_created_idx
  ON circles_app."liveChat" ("streamId", "userId", "createdAt" DESC);

DO $cba04_postcondition$
DECLARE
  v_live_chat_relation pg_catalog.oid;
  v_poll_index_count integer;
  v_admission_index_count integer;
BEGIN
  SELECT relation_catalog.oid
    INTO v_live_chat_relation
    FROM pg_catalog.pg_class AS relation_catalog
    INNER JOIN pg_catalog.pg_namespace AS namespace_catalog
      ON namespace_catalog.oid = relation_catalog.relnamespace
   WHERE namespace_catalog.nspname = 'circles_app'::pg_catalog.name
     AND relation_catalog.relname = 'liveChat'::pg_catalog.name
     AND relation_catalog.relkind = 'r'::pg_catalog."char";

  SELECT pg_catalog.count(*)::integer
    INTO v_poll_index_count
    FROM pg_catalog.pg_index AS index_definition
    INNER JOIN pg_catalog.pg_class AS index_catalog
      ON index_catalog.oid = index_definition.indexrelid
   WHERE index_definition.indrelid = v_live_chat_relation
     AND index_catalog.relname = 'live_chat_stream_created_id_idx'::pg_catalog.name
     AND index_definition.indisvalid
     AND index_definition.indisready
     AND pg_catalog.pg_get_indexdef(index_definition.indexrelid) =
       'CREATE INDEX live_chat_stream_created_id_idx ON circles_app."liveChat" USING btree ("streamId", "createdAt" DESC, id DESC)'::pg_catalog.text;

  SELECT pg_catalog.count(*)::integer
    INTO v_admission_index_count
    FROM pg_catalog.pg_index AS index_definition
    INNER JOIN pg_catalog.pg_class AS index_catalog
      ON index_catalog.oid = index_definition.indexrelid
   WHERE index_definition.indrelid = v_live_chat_relation
     AND index_catalog.relname = 'live_chat_stream_user_created_idx'::pg_catalog.name
     AND index_definition.indisvalid
     AND index_definition.indisready
     AND pg_catalog.pg_get_indexdef(index_definition.indexrelid) =
       'CREATE INDEX live_chat_stream_user_created_idx ON circles_app."liveChat" USING btree ("streamId", "userId", "createdAt" DESC)'::pg_catalog.text;

  IF v_poll_index_count <> 1 OR v_admission_index_count <> 1 THEN
    RAISE EXCEPTION 'CBA-04 live-chat index postcondition failed';
  END IF;
END;
$cba04_postcondition$;
COMMIT;
