-- DB-14 current receipt daily-wrapper compatibility. Prepared only; parent-owned operations apply once.
-- This changes one closed receipt-shape predicate inside the already-reviewed daily wrapper.
-- It preserves the wrapper OID, owner, ACL, return shape, history behavior, and all non-receipt checks.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('circles_ops.db14-current-receipt-daily-wrapper.v1', 0)
);

DO $db14_current_receipt_daily_wrapper$
DECLARE
  v_postgres_oid pg_catalog.oid;
  v_daily_oid pg_catalog.oid;
  v_daily_count integer;
  v_daily_definition text;
  v_daily_body text;
  v_daily_owner pg_catalog.oid;
  v_daily_security_definer boolean;
  v_daily_config text[];
  v_daily_acl pg_catalog.aclitem[];
  v_helper_oid pg_catalog.oid;
  v_helper_count integer;
  v_helper_definition text;
  v_helper_body text;
  v_helper_owner pg_catalog.oid;
  v_helper_security_definer boolean;
  v_helper_config text[];
  v_helper_acl pg_catalog.aclitem[];
  v_anchor constant text := $db14_current_receipt_daily_anchor$
  SELECT pg_catalog.jsonb_build_object(
    'critical_feature_contract',
    COALESCE((
      SELECT critical_feature_health.healthy
      FROM circles_ops.run_daily_critical_feature_health() AS critical_feature_health
      LIMIT 1
    ), false)
  )
    INTO v_checks;$db14_current_receipt_daily_anchor$;
  v_replacement constant text := $db14_current_receipt_daily_replacement$
  SELECT pg_catalog.jsonb_build_object(
    'critical_feature_contract',
    COALESCE((
      SELECT critical_feature_health.healthy
      FROM circles_ops.run_daily_critical_feature_health() AS critical_feature_health
      LIMIT 1
    ), false)
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS receipt_relation
      JOIN pg_catalog.pg_namespace AS receipt_namespace
        ON receipt_namespace.oid = receipt_relation.relnamespace
      WHERE receipt_relation.oid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"')
        AND receipt_namespace.nspname = 'circles_publish'::pg_catalog.name
        AND receipt_relation.relname = 'postPublishReceipts'::pg_catalog.name
        AND receipt_relation.relkind = 'r'::pg_catalog."char"
        AND (
          (
            (SELECT pg_catalog.count(*)
             FROM pg_catalog.pg_attribute AS attribute_catalog
             WHERE attribute_catalog.attrelid = receipt_relation.oid
               AND attribute_catalog.attnum > 0
               AND NOT attribute_catalog.attisdropped) = 5
            AND NOT EXISTS (
              SELECT 1
              FROM (VALUES
                ('actorId'::pg_catalog.name, 1::pg_catalog.int2, 'integer'::pg_catalog.text, true, ''::pg_catalog."char"),
                ('operationId'::pg_catalog.name, 2::pg_catalog.int2, 'character varying(96)'::pg_catalog.text, true, ''::pg_catalog."char"),
                ('payloadHash'::pg_catalog.name, 3::pg_catalog.int2, 'character varying(64)'::pg_catalog.text, true, ''::pg_catalog."char"),
                ('postId'::pg_catalog.name, 4::pg_catalog.int2, 'integer'::pg_catalog.text, false, ''::pg_catalog."char"),
                ('createdAt'::pg_catalog.name, 5::pg_catalog.int2, 'timestamp with time zone'::pg_catalog.text, true, ''::pg_catalog."char")
              ) AS expected_column(column_name, ordinal, data_type, not_null, identity_kind)
              LEFT JOIN pg_catalog.pg_attribute AS attribute_catalog
                ON attribute_catalog.attrelid = receipt_relation.oid
               AND attribute_catalog.attname = expected_column.column_name
               AND attribute_catalog.attnum = expected_column.ordinal
               AND attribute_catalog.attnum > 0
               AND NOT attribute_catalog.attisdropped
              WHERE attribute_catalog.attnum IS NULL
                 OR attribute_catalog.attnotnull IS DISTINCT FROM expected_column.not_null
                 OR attribute_catalog.attidentity IS DISTINCT FROM expected_column.identity_kind
                 OR pg_catalog.format_type(attribute_catalog.atttypid, attribute_catalog.atttypmod) <> expected_column.data_type
            )
            AND EXISTS (
              SELECT 1
              FROM pg_catalog.pg_constraint AS constraint_catalog
              JOIN pg_catalog.pg_index AS index_catalog
                ON index_catalog.indexrelid = constraint_catalog.conindid
              WHERE constraint_catalog.conrelid = receipt_relation.oid
                AND constraint_catalog.conname = 'post_publish_receipts_actor_operation_unique'::pg_catalog.name
                AND constraint_catalog.contype = 'u'::pg_catalog."char"
                AND constraint_catalog.convalidated
                AND NOT constraint_catalog.condeferrable
                AND NOT constraint_catalog.condeferred
                AND constraint_catalog.conkey::pg_catalog.int2[] = ARRAY[1, 2]::pg_catalog.int2[]
                AND index_catalog.indisunique
                AND NOT index_catalog.indisprimary
                AND index_catalog.indisvalid
                AND index_catalog.indisready
                AND index_catalog.indislive
                AND index_catalog.indnkeyatts = 2
                AND index_catalog.indnatts = 2
                AND index_catalog.indexprs IS NULL
                AND index_catalog.indpred IS NULL
            )
            AND (
              (
                (SELECT pg_catalog.count(*)
                 FROM pg_catalog.pg_constraint AS constraint_catalog
                 WHERE constraint_catalog.conrelid = receipt_relation.oid) = 5
                AND (SELECT pg_catalog.count(*)
                     FROM pg_catalog.pg_index AS index_catalog
                     WHERE index_catalog.indrelid = receipt_relation.oid) = 2
              )
              OR (
                (SELECT pg_catalog.count(*)
                 FROM pg_catalog.pg_constraint AS constraint_catalog
                 WHERE constraint_catalog.conrelid = receipt_relation.oid) = 6
                AND (SELECT pg_catalog.count(*)
                     FROM pg_catalog.pg_index AS index_catalog
                     WHERE index_catalog.indrelid = receipt_relation.oid) = 3
                AND EXISTS (
                  SELECT 1
                  FROM pg_catalog.pg_constraint AS constraint_catalog
                  JOIN pg_catalog.pg_index AS index_catalog
                    ON index_catalog.indexrelid = constraint_catalog.conindid
                  WHERE constraint_catalog.conrelid = receipt_relation.oid
                    AND constraint_catalog.conname = 'post_publish_receipts_pkey'::pg_catalog.name
                    AND constraint_catalog.contype = 'p'::pg_catalog."char"
                    AND constraint_catalog.convalidated
                    AND NOT constraint_catalog.condeferrable
                    AND NOT constraint_catalog.condeferred
                    AND constraint_catalog.conkey::pg_catalog.int2[] = ARRAY[1, 2]::pg_catalog.int2[]
                    AND index_catalog.indisunique
                    AND index_catalog.indisprimary
                    AND index_catalog.indisvalid
                    AND index_catalog.indisready
                    AND index_catalog.indislive
                    AND index_catalog.indnkeyatts = 2
                    AND index_catalog.indnatts = 2
                    AND index_catalog.indexprs IS NULL
                    AND index_catalog.indpred IS NULL
                )
              )
            )
          )
          OR (
            (SELECT pg_catalog.count(*)
             FROM pg_catalog.pg_attribute AS attribute_catalog
             WHERE attribute_catalog.attrelid = receipt_relation.oid
               AND attribute_catalog.attnum > 0
               AND NOT attribute_catalog.attisdropped) = 6
            AND NOT EXISTS (
              SELECT 1
              FROM (VALUES
                ('actorId'::pg_catalog.name, 1::pg_catalog.int2, 'integer'::pg_catalog.text, true, ''::pg_catalog."char"),
                ('operationId'::pg_catalog.name, 2::pg_catalog.int2, 'character varying(96)'::pg_catalog.text, true, ''::pg_catalog."char"),
                ('payloadHash'::pg_catalog.name, 3::pg_catalog.int2, 'character varying(64)'::pg_catalog.text, true, ''::pg_catalog."char"),
                ('postId'::pg_catalog.name, 4::pg_catalog.int2, 'integer'::pg_catalog.text, false, ''::pg_catalog."char"),
                ('createdAt'::pg_catalog.name, 5::pg_catalog.int2, 'timestamp with time zone'::pg_catalog.text, true, ''::pg_catalog."char"),
                ('id'::pg_catalog.name, 6::pg_catalog.int2, 'bigint'::pg_catalog.text, true, 'a'::pg_catalog."char")
              ) AS expected_column(column_name, ordinal, data_type, not_null, identity_kind)
              LEFT JOIN pg_catalog.pg_attribute AS attribute_catalog
                ON attribute_catalog.attrelid = receipt_relation.oid
               AND attribute_catalog.attname = expected_column.column_name
               AND attribute_catalog.attnum = expected_column.ordinal
               AND attribute_catalog.attnum > 0
               AND NOT attribute_catalog.attisdropped
              WHERE attribute_catalog.attnum IS NULL
                 OR attribute_catalog.attnotnull IS DISTINCT FROM expected_column.not_null
                 OR attribute_catalog.attidentity IS DISTINCT FROM expected_column.identity_kind
                 OR pg_catalog.format_type(attribute_catalog.atttypid, attribute_catalog.atttypmod) <> expected_column.data_type
            )
            AND (SELECT pg_catalog.count(*)
                 FROM pg_catalog.pg_constraint AS constraint_catalog
                 WHERE constraint_catalog.conrelid = receipt_relation.oid) = 6
            AND (SELECT pg_catalog.count(*)
                 FROM pg_catalog.pg_index AS index_catalog
                 WHERE index_catalog.indrelid = receipt_relation.oid) = 3
            AND CASE WHEN EXISTS (
              SELECT 1
              FROM pg_catalog.pg_attribute AS identity_attribute
              WHERE identity_attribute.attrelid = receipt_relation.oid
                AND identity_attribute.attname = 'id'::pg_catalog.name
                AND identity_attribute.attnum = 6
                AND NOT identity_attribute.attisdropped
                AND identity_attribute.attidentity = 'a'::pg_catalog."char"
            ) THEN pg_catalog.pg_get_serial_sequence(
              'circles_publish."postPublishReceipts"'::pg_catalog.text,
              'id'::pg_catalog.text
            ) = 'circles_publish."postPublishReceipts_id_seq"'::pg_catalog.text
            ELSE false END
            AND EXISTS (
              SELECT 1
              FROM pg_catalog.pg_constraint AS constraint_catalog
              JOIN pg_catalog.pg_index AS index_catalog
                ON index_catalog.indexrelid = constraint_catalog.conindid
              WHERE constraint_catalog.conrelid = receipt_relation.oid
                AND constraint_catalog.conname = 'post_publish_receipts_actor_operation_unique'::pg_catalog.name
                AND constraint_catalog.contype = 'u'::pg_catalog."char"
                AND constraint_catalog.convalidated
                AND NOT constraint_catalog.condeferrable
                AND NOT constraint_catalog.condeferred
                AND constraint_catalog.conkey::pg_catalog.int2[] = ARRAY[1, 2]::pg_catalog.int2[]
                AND index_catalog.indisunique
                AND NOT index_catalog.indisprimary
                AND index_catalog.indisvalid
                AND index_catalog.indisready
                AND index_catalog.indislive
                AND index_catalog.indnkeyatts = 2
                AND index_catalog.indnatts = 2
                AND index_catalog.indexprs IS NULL
                AND index_catalog.indpred IS NULL
            )
            AND EXISTS (
              SELECT 1
              FROM pg_catalog.pg_constraint AS constraint_catalog
              JOIN pg_catalog.pg_index AS index_catalog
                ON index_catalog.indexrelid = constraint_catalog.conindid
              WHERE constraint_catalog.conrelid = receipt_relation.oid
                AND constraint_catalog.conname = 'post_publish_receipts_pkey'::pg_catalog.name
                AND constraint_catalog.contype = 'p'::pg_catalog."char"
                AND constraint_catalog.convalidated
                AND NOT constraint_catalog.condeferrable
                AND NOT constraint_catalog.condeferred
                AND constraint_catalog.conkey::pg_catalog.int2[] = ARRAY[6]::pg_catalog.int2[]
                AND index_catalog.indisunique
                AND index_catalog.indisprimary
                AND index_catalog.indisvalid
                AND index_catalog.indisready
                AND index_catalog.indislive
                AND index_catalog.indnkeyatts = 1
                AND index_catalog.indnatts = 1
                AND index_catalog.indexprs IS NULL
                AND index_catalog.indpred IS NULL
            )
          )
        )
    )
  )
    INTO v_checks;$db14_current_receipt_daily_replacement$;
  v_candidate text;
  v_post_daily_oid pg_catalog.oid;
  v_post_daily_definition text;
  v_post_daily_body text;
  v_post_daily_owner pg_catalog.oid;
  v_post_daily_security_definer boolean;
  v_post_daily_config text[];
  v_post_daily_acl pg_catalog.aclitem[];
BEGIN
  IF current_user <> 'postgres'::pg_catalog.name
     OR session_user <> 'postgres'::pg_catalog.name THEN
    RAISE EXCEPTION 'DB-14 current receipt daily-wrapper compatibility requires reviewed postgres session and current role';
  END IF;

  SELECT role_catalog.oid
    INTO v_postgres_oid
    FROM pg_catalog.pg_roles AS role_catalog
   WHERE role_catalog.rolname = 'postgres'::pg_catalog.name;
  IF v_postgres_oid IS NULL THEN
    RAISE EXCEPTION 'DB-14 current receipt daily-wrapper compatibility requires reviewed postgres owner role';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO v_daily_count
    FROM pg_catalog.pg_proc AS function_catalog
    JOIN pg_catalog.pg_namespace AS namespace_catalog
      ON namespace_catalog.oid = function_catalog.pronamespace
   WHERE namespace_catalog.nspname = 'circles_ops'::pg_catalog.name
     AND function_catalog.proname = 'run_daily_migration_health'::pg_catalog.name;
  v_daily_oid := pg_catalog.to_regprocedure('circles_ops.run_daily_migration_health()');
  IF v_daily_count <> 1 OR v_daily_oid IS NULL THEN
    RAISE EXCEPTION 'DB-14 current receipt daily-wrapper compatibility requires exactly one reviewed daily health signature; missing function or overload drift';
  END IF;

  SELECT
    pg_catalog.pg_get_functiondef(function_catalog.oid),
    function_catalog.prosrc,
    function_catalog.proowner,
    function_catalog.prosecdef,
    function_catalog.proconfig,
    function_catalog.proacl
  INTO
    v_daily_definition,
    v_daily_body,
    v_daily_owner,
    v_daily_security_definer,
    v_daily_config,
    v_daily_acl
  FROM pg_catalog.pg_proc AS function_catalog
  WHERE function_catalog.oid = v_daily_oid;

  IF v_daily_owner <> v_postgres_oid
     OR NOT v_daily_security_definer
     OR v_daily_config IS DISTINCT FROM ARRAY['search_path=pg_catalog'::pg_catalog.text]
     OR v_daily_acl IS DISTINCT FROM ARRAY['postgres=X/postgres'::pg_catalog.aclitem]
     OR pg_catalog.md5(v_daily_definition) <> '8a2551dee9f2ea3216d61f82fef70fa1'::pg_catalog.text
     OR pg_catalog.md5(v_daily_body) <> '57fab8e62c7c01e34d393b78b972bd11'::pg_catalog.text
  THEN
    RAISE EXCEPTION 'DB-14 current receipt daily-wrapper compatibility golden definition or security metadata drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO v_helper_count
    FROM pg_catalog.pg_proc AS function_catalog
    JOIN pg_catalog.pg_namespace AS namespace_catalog
      ON namespace_catalog.oid = function_catalog.pronamespace
   WHERE namespace_catalog.nspname = 'circles_ops'::pg_catalog.name
     AND function_catalog.proname = 'run_daily_critical_feature_health'::pg_catalog.name;
  v_helper_oid := pg_catalog.to_regprocedure('circles_ops.run_daily_critical_feature_health()');
  IF v_helper_count <> 1 OR v_helper_oid IS NULL THEN
    RAISE EXCEPTION 'DB-14 current receipt daily-wrapper compatibility requires exactly one current critical helper signature; missing function or overload drift';
  END IF;

  SELECT
    pg_catalog.pg_get_functiondef(function_catalog.oid),
    function_catalog.prosrc,
    function_catalog.proowner,
    function_catalog.prosecdef,
    function_catalog.proconfig,
    function_catalog.proacl
  INTO
    v_helper_definition,
    v_helper_body,
    v_helper_owner,
    v_helper_security_definer,
    v_helper_config,
    v_helper_acl
  FROM pg_catalog.pg_proc AS function_catalog
  WHERE function_catalog.oid = v_helper_oid;

  IF v_helper_owner <> v_postgres_oid
     OR NOT v_helper_security_definer
     OR v_helper_config IS DISTINCT FROM ARRAY['search_path=pg_catalog'::pg_catalog.text]
     OR v_helper_acl IS DISTINCT FROM ARRAY['postgres=X/postgres'::pg_catalog.aclitem]
     OR pg_catalog.md5(v_helper_definition) <> 'ba01f17b09fd2a4464edaf10b55d4389'::pg_catalog.text
     OR pg_catalog.md5(v_helper_body) <> '617ada00bb1d5df53565b7b042236225'::pg_catalog.text
  THEN
    RAISE EXCEPTION 'DB-14 current receipt daily-wrapper compatibility refuses an old or unreviewed critical helper baseline';
  END IF;

  IF pg_catalog.strpos(v_daily_definition, v_anchor) = 0
     OR pg_catalog.strpos(
       pg_catalog.substr(v_daily_definition, pg_catalog.strpos(v_daily_definition, v_anchor) + pg_catalog.char_length(v_anchor)),
       v_anchor
     ) > 0 THEN
    RAISE EXCEPTION 'DB-14 current receipt daily-wrapper compatibility receipt predicate anchor is absent or non-unique';
  END IF;

  v_candidate := pg_catalog.replace(v_daily_definition, v_anchor, v_replacement);
  EXECUTE v_candidate || ';'::pg_catalog.text;

  SELECT
    function_catalog.oid,
    pg_catalog.pg_get_functiondef(function_catalog.oid),
    function_catalog.prosrc,
    function_catalog.proowner,
    function_catalog.prosecdef,
    function_catalog.proconfig,
    function_catalog.proacl
  INTO
    v_post_daily_oid,
    v_post_daily_definition,
    v_post_daily_body,
    v_post_daily_owner,
    v_post_daily_security_definer,
    v_post_daily_config,
    v_post_daily_acl
  FROM pg_catalog.pg_proc AS function_catalog
  WHERE function_catalog.oid = v_daily_oid;

  IF v_post_daily_oid IS DISTINCT FROM v_daily_oid
     OR v_post_daily_definition IS DISTINCT FROM v_candidate
     OR v_post_daily_body IS NULL
     OR v_post_daily_owner IS DISTINCT FROM v_daily_owner
     OR v_post_daily_security_definer IS DISTINCT FROM v_daily_security_definer
     OR v_post_daily_config IS DISTINCT FROM v_daily_config
     OR v_post_daily_acl IS DISTINCT FROM v_daily_acl
  THEN
    RAISE EXCEPTION 'DB-14 current receipt daily-wrapper compatibility postflight identity or security contract failed';
  END IF;
END;
$db14_current_receipt_daily_wrapper$;

COMMIT;
