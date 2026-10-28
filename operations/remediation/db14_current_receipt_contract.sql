-- DB-14 current receipt contract reconciliation. Prepared only; parent-owned operations apply once.
-- It replaces only the captured helper in place, preserving its OID, owner, ACL, daily helper,
-- health-history relation, schedules, and all unrelated health predicates.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('circles_ops.db14-current-receipt-contract.v1', 0)
);
DO $db14_current_receipt_preflight$
DECLARE
  helper_oid pg_catalog.oid;
  daily_oid pg_catalog.oid;
  history_oid pg_catalog.oid;
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_proc AS f
    JOIN pg_catalog.pg_namespace AS n ON n.oid = f.pronamespace
    WHERE n.nspname = 'circles_ops'::pg_catalog.name
      AND f.proname = 'run_daily_critical_feature_health'::pg_catalog.name
  ) <> 1 THEN
    RAISE EXCEPTION 'DB-14 current receipt reconciliation requires exactly one existing critical helper';
  END IF;
  SELECT f.oid INTO helper_oid
  FROM pg_catalog.pg_proc AS f
  JOIN pg_catalog.pg_namespace AS n ON n.oid = f.pronamespace
  JOIN pg_catalog.pg_roles AS o ON o.oid = f.proowner
  WHERE n.nspname = 'circles_ops'::pg_catalog.name
    AND f.proname = 'run_daily_critical_feature_health'::pg_catalog.name
    AND f.pronargs = 0
    AND pg_catalog.pg_get_function_identity_arguments(f.oid) = ''::pg_catalog.text
    AND f.prokind = 'f'::pg_catalog."char"
    AND f.prolang = (
      SELECT language_catalog.oid
      FROM pg_catalog.pg_language AS language_catalog
      WHERE language_catalog.lanname = 'plpgsql'::pg_catalog.name
    )
    AND f.prorettype = 'record'::pg_catalog.regtype
    AND f.proallargtypes = ARRAY[16, 25]::pg_catalog.oid[]
    AND f.proargmodes = ARRAY['t'::pg_catalog."char", 't'::pg_catalog."char"]
    AND f.proargnames = ARRAY['healthy'::pg_catalog.text, 'error_code'::pg_catalog.text]
    AND f.prosecdef
    AND f.proconfig = ARRAY['search_path=pg_catalog'::pg_catalog.text]
    AND o.rolname = 'postgres'::pg_catalog.name
    AND f.proacl = ARRAY['postgres=X/postgres'::pg_catalog.aclitem]
    AND pg_catalog.md5(pg_catalog.pg_get_functiondef(f.oid)) = 'b264e91a24358686129a2b2386b9dcdf'::pg_catalog.text;
  IF helper_oid IS NULL THEN
    RAISE EXCEPTION 'DB-14 current receipt reconciliation refuses an unreviewed critical helper baseline';
  END IF;
  SELECT pg_catalog.to_regprocedure('circles_ops.run_daily_migration_health()'),
         pg_catalog.to_regclass('circles_ops.health_runs')
    INTO daily_oid, history_oid;
  IF daily_oid IS NULL OR history_oid IS NULL THEN
    RAISE EXCEPTION 'DB-14 current receipt reconciliation requires existing daily health and history';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS r
    JOIN pg_catalog.pg_namespace AS n ON n.oid = r.relnamespace
    WHERE n.nspname = 'circles_publish'::pg_catalog.name
      AND r.relname = 'postPublishReceipts'::pg_catalog.name
      AND r.relkind = 'r'::pg_catalog."char"
      AND r.relrowsecurity AND r.relforcerowsecurity
      AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute AS a
           WHERE a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped) = 6
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a
                  WHERE a.attrelid = r.oid AND a.attname = 'id'::pg_catalog.name
                    AND a.attnum = 6 AND a.attidentity = 'a'::pg_catalog."char"
                    AND a.attnotnull AND pg_catalog.format_type(a.atttypid, a.atttypmod) = 'bigint'::pg_catalog.text)
      AND CASE WHEN EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute AS identity_attribute
        WHERE identity_attribute.attrelid = r.oid
          AND identity_attribute.attname = 'id'::pg_catalog.name
          AND identity_attribute.attnum = 6
          AND NOT identity_attribute.attisdropped
          AND identity_attribute.attidentity = 'a'::pg_catalog."char"
      ) THEN pg_catalog.pg_get_serial_sequence('circles_publish."postPublishReceipts"'::pg_catalog.text, 'id'::pg_catalog.text) = 'circles_publish."postPublishReceipts_id_seq"'::pg_catalog.text
      ELSE false END
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS c
                  WHERE c.conrelid = r.oid AND c.conname = 'post_publish_receipts_pkey'::pg_catalog.name
                    AND c.contype = 'p'::pg_catalog."char" AND c.convalidated
                    AND NOT c.condeferrable AND NOT c.condeferred
                    AND c.conkey::pg_catalog.int2[] = ARRAY[6]::pg_catalog.int2[])
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS c
                  WHERE c.conrelid = r.oid AND c.conname = 'post_publish_receipts_actor_operation_unique'::pg_catalog.name
                    AND c.contype = 'u'::pg_catalog."char" AND c.convalidated
                    AND NOT c.condeferrable AND NOT c.condeferred
                    AND c.conkey::pg_catalog.int2[] = ARRAY[1, 2]::pg_catalog.int2[])
  ) THEN
    RAISE EXCEPTION 'DB-14 current receipt reconciliation requires exact six-column surrogate receipt state';
  END IF;
  PERFORM pg_catalog.set_config('circles_ops.db14_receipt_helper_oid', helper_oid::pg_catalog.text, true);
  PERFORM pg_catalog.set_config('circles_ops.db14_receipt_daily_oid', daily_oid::pg_catalog.text, true);
  PERFORM pg_catalog.set_config('circles_ops.db14_receipt_history_oid', history_oid::pg_catalog.text, true);
END;
$db14_current_receipt_preflight$;

CREATE OR REPLACE FUNCTION circles_ops.run_daily_critical_feature_health()
RETURNS TABLE (healthy boolean, error_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_runtime_role_oid pg_catalog.oid;
  v_critical_contract_ok boolean := false;
BEGIN
  SELECT role_catalog.oid
    INTO v_runtime_role_oid
    FROM pg_catalog.pg_roles AS role_catalog
   WHERE role_catalog.rolname = 'circles_app_runtime'::pg_catalog.name;

  SELECT
    v_runtime_role_oid IS NOT NULL
    -- Preserve the installed operations boundary rather than replacing its history or schedule.
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS function_catalog
      JOIN pg_catalog.pg_namespace AS namespace_catalog
        ON namespace_catalog.oid = function_catalog.pronamespace
      JOIN pg_catalog.pg_roles AS owner_catalog
        ON owner_catalog.oid = function_catalog.proowner
      WHERE namespace_catalog.nspname = 'circles_ops'::pg_catalog.name
        AND function_catalog.proname = 'run_daily_migration_health'::pg_catalog.name
        AND function_catalog.pronargs = 0
        AND function_catalog.prosecdef
        AND owner_catalog.rolname = 'postgres'::pg_catalog.name
        AND function_catalog.proconfig = ARRAY['search_path=pg_catalog'::pg_catalog.text]
    )
    -- The social integrity migration added these app columns and constraints. NOT VALID checks
    -- are deliberately accepted here: DB-04 separately owns historical VALIDATE CONSTRAINT.
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute_catalog
      WHERE attribute_catalog.attrelid = pg_catalog.to_regclass('circles_app.messages')
        AND attribute_catalog.attname = 'clientMessageId'::pg_catalog.name
        AND attribute_catalog.attnum > 0
        AND NOT attribute_catalog.attisdropped
        AND NOT attribute_catalog.attnotnull
        AND pg_catalog.format_type(attribute_catalog.atttypid, attribute_catalog.atttypmod) = 'character varying(96)'::pg_catalog.text
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute_catalog
      WHERE attribute_catalog.attrelid = pg_catalog.to_regclass('circles_app."socialUploads"')
        AND attribute_catalog.attname = 'claimedAt'::pg_catalog.name
        AND attribute_catalog.attnum > 0
        AND NOT attribute_catalog.attisdropped
        AND NOT attribute_catalog.attnotnull
        AND pg_catalog.format_type(attribute_catalog.atttypid, attribute_catalog.atttypmod) = 'timestamp with time zone'::pg_catalog.text
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute_catalog
      WHERE attribute_catalog.attrelid = pg_catalog.to_regclass('circles_app.conversations')
        AND attribute_catalog.attname = 'kind'::pg_catalog.name
        AND attribute_catalog.attnum > 0
        AND NOT attribute_catalog.attisdropped
        AND attribute_catalog.attnotnull
        AND pg_catalog.format_type(attribute_catalog.atttypid, attribute_catalog.atttypmod) = 'circles_app.conversation_kind'::pg_catalog.text
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute_catalog
      WHERE attribute_catalog.attrelid = pg_catalog.to_regclass('circles_app."conversationParticipants"')
        AND attribute_catalog.attname = 'lastReadMessageId'::pg_catalog.name
        AND attribute_catalog.attnum > 0
        AND NOT attribute_catalog.attisdropped
        AND attribute_catalog.attnotnull
        AND pg_catalog.format_type(attribute_catalog.atttypid, attribute_catalog.atttypmod) = 'integer'::pg_catalog.text
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (
        VALUES
          ('conversations_kind_target_check'::pg_catalog.name, 'c'::pg_catalog."char", pg_catalog.to_regclass('circles_app.conversations')),
          ('messages_content_check'::pg_catalog.name, 'c'::pg_catalog."char", pg_catalog.to_regclass('circles_app.messages')),
          ('messages_client_message_id_check'::pg_catalog.name, 'c'::pg_catalog."char", pg_catalog.to_regclass('circles_app.messages')),
          ('messages_conversationId_fkey'::pg_catalog.name, 'f'::pg_catalog."char", pg_catalog.to_regclass('circles_app.messages')),
          ('messages_authorId_fkey'::pg_catalog.name, 'f'::pg_catalog."char", pg_catalog.to_regclass('circles_app.messages')),
          ('conversationParticipants_conversationId_fkey'::pg_catalog.name, 'f'::pg_catalog."char", pg_catalog.to_regclass('circles_app."conversationParticipants"')),
          ('conversationParticipants_userId_fkey'::pg_catalog.name, 'f'::pg_catalog."char", pg_catalog.to_regclass('circles_app."conversationParticipants"')),
          ('conversations_circleId_fkey'::pg_catalog.name, 'f'::pg_catalog."char", pg_catalog.to_regclass('circles_app.conversations')),
          ('conversation_participants_conversation_user_unique'::pg_catalog.name, 'u'::pg_catalog."char", pg_catalog.to_regclass('circles_app."conversationParticipants"'))
      ) AS expected_constraint(constraint_name, constraint_type, relation_oid)
      LEFT JOIN pg_catalog.pg_constraint AS constraint_catalog
        ON constraint_catalog.conname = expected_constraint.constraint_name
       AND constraint_catalog.contype = expected_constraint.constraint_type
       AND constraint_catalog.conrelid = expected_constraint.relation_oid
      WHERE constraint_catalog.oid IS NULL
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_catalog
      WHERE constraint_catalog.conname = 'messages_conversationId_fkey'::pg_catalog.name
        AND constraint_catalog.conrelid = pg_catalog.to_regclass('circles_app.messages')
        AND constraint_catalog.convalidated
        AND constraint_catalog.confrelid = pg_catalog.to_regclass('circles_app.conversations')
        AND constraint_catalog.confdeltype = 'c'::pg_catalog."char"
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_catalog
      WHERE constraint_catalog.conname = 'messages_authorId_fkey'::pg_catalog.name
        AND constraint_catalog.conrelid = pg_catalog.to_regclass('circles_app.messages')
        AND constraint_catalog.convalidated
        AND constraint_catalog.confrelid = pg_catalog.to_regclass('circles_app.users')
        AND constraint_catalog.confdeltype = 'c'::pg_catalog."char"
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (
        VALUES
          ('conversationParticipants_conversationId_fkey'::pg_catalog.name, pg_catalog.to_regclass('circles_app."conversationParticipants"'), pg_catalog.to_regclass('circles_app.conversations')),
          ('conversationParticipants_userId_fkey'::pg_catalog.name, pg_catalog.to_regclass('circles_app."conversationParticipants"'), pg_catalog.to_regclass('circles_app.users')),
          ('conversations_circleId_fkey'::pg_catalog.name, pg_catalog.to_regclass('circles_app.conversations'), pg_catalog.to_regclass('circles_app.circles'))
      ) AS expected_fk(constraint_name, relation_oid, referenced_relation_oid)
      LEFT JOIN pg_catalog.pg_constraint AS constraint_catalog
        ON constraint_catalog.conname = expected_fk.constraint_name
       AND constraint_catalog.conrelid = expected_fk.relation_oid
       AND constraint_catalog.contype = 'f'::pg_catalog."char"
       AND constraint_catalog.convalidated
       AND constraint_catalog.confrelid = expected_fk.referenced_relation_oid
       AND constraint_catalog.confdeltype = 'c'::pg_catalog."char"
      WHERE constraint_catalog.oid IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (
        VALUES
          ('conversation_participants_conversation_user_unique'::pg_catalog.name, pg_catalog.to_regclass('circles_app."conversationParticipants"'), ARRAY[2, 3]::pg_catalog.int2[]),
          ('conversations_direct_key_unique'::pg_catalog.name, pg_catalog.to_regclass('circles_app.conversations'), ARRAY[3]::pg_catalog.int2[]),
          ('conversations_circle_id_unique'::pg_catalog.name, pg_catalog.to_regclass('circles_app.conversations'), ARRAY[4]::pg_catalog.int2[])
      ) AS expected_unique(constraint_name, relation_oid, key_columns)
      LEFT JOIN pg_catalog.pg_constraint AS constraint_catalog
        ON constraint_catalog.conname = expected_unique.constraint_name
       AND constraint_catalog.conrelid = expected_unique.relation_oid
       AND constraint_catalog.contype = 'u'::pg_catalog."char"
       AND constraint_catalog.convalidated
       AND constraint_catalog.conkey::pg_catalog.int2[] = expected_unique.key_columns
      LEFT JOIN pg_catalog.pg_index AS index_catalog
        ON index_catalog.indexrelid = constraint_catalog.conindid
       AND index_catalog.indisunique
       AND index_catalog.indisvalid
       AND index_catalog.indisready
       AND index_catalog.indislive
      WHERE index_catalog.indexrelid IS NULL
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index AS index_catalog
      JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.oid = index_catalog.indexrelid
      WHERE index_catalog.indrelid = pg_catalog.to_regclass('circles_app.messages')
        AND index_relation.relname = 'messages_conversation_author_client_message_id_unique'::pg_catalog.name
        AND index_catalog.indisunique
        AND index_catalog.indisvalid
        AND index_catalog.indisready
        AND index_catalog.indislive
        AND index_catalog.indnkeyatts = 3
        AND index_catalog.indnatts = 3
        AND index_catalog.indexprs IS NULL
        AND index_catalog.indpred IS NOT NULL
        AND pg_catalog.pg_get_indexdef(index_catalog.indexrelid, 1, true) = '"conversationId"'::pg_catalog.text
        AND pg_catalog.pg_get_indexdef(index_catalog.indexrelid, 2, true) = '"authorId"'::pg_catalog.text
        AND pg_catalog.pg_get_indexdef(index_catalog.indexrelid, 3, true) = '"clientMessageId"'::pg_catalog.text
        AND pg_catalog.strpos(pg_catalog.pg_get_expr(index_catalog.indpred, index_catalog.indrelid), '"clientMessageId" IS NOT NULL'::pg_catalog.text) > 0
    )
    -- Trigger existence alone is not treated as semantic proof: verify identity, timing, invoker
    -- mode, fixed path, owner, source-owned body fingerprint, and non-executability by runtime.
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_catalog
      JOIN pg_catalog.pg_proc AS function_catalog
        ON function_catalog.oid = trigger_catalog.tgfoid
      JOIN pg_catalog.pg_namespace AS namespace_catalog
        ON namespace_catalog.oid = function_catalog.pronamespace
      JOIN pg_catalog.pg_roles AS owner_catalog
        ON owner_catalog.oid = function_catalog.proowner
      WHERE trigger_catalog.tgname = 'messages_author_authorized_trigger'::pg_catalog.name
        AND trigger_catalog.tgrelid = pg_catalog.to_regclass('circles_app.messages')
        AND NOT trigger_catalog.tgisinternal
        AND trigger_catalog.tgenabled = 'O'::pg_catalog."char"
        AND trigger_catalog.tgconstraint <> 0
        AND trigger_catalog.tgdeferrable
        AND NOT trigger_catalog.tginitdeferred
        AND namespace_catalog.nspname = 'circles_app'::pg_catalog.name
        AND function_catalog.proname = 'enforce_message_author_authorized'::pg_catalog.name
        AND function_catalog.pronargs = 0
        AND NOT function_catalog.prosecdef
        AND owner_catalog.rolname = 'postgres'::pg_catalog.name
        AND function_catalog.proconfig = ARRAY['search_path=pg_catalog, circles_app'::pg_catalog.text]
        AND pg_catalog.md5(function_catalog.prosrc) = '0a08011f0d65ba73717aa1c9922aa586'::pg_catalog.text
        AND NOT pg_catalog.has_function_privilege(v_runtime_role_oid, function_catalog.oid, 'EXECUTE')
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              function_catalog.proacl,
              pg_catalog.acldefault('f'::pg_catalog."char", function_catalog.proowner)
            )
          ) AS function_acl
          WHERE function_acl.grantee = 0
            AND function_acl.privilege_type = 'EXECUTE'::pg_catalog.text
        )
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policy AS policy_catalog
      WHERE policy_catalog.polname = 'runtime_messages_policy'::pg_catalog.name
        AND policy_catalog.polrelid = pg_catalog.to_regclass('circles_app.messages')
        AND policy_catalog.polpermissive
        AND policy_catalog.polcmd = '*'::pg_catalog."char"
        AND policy_catalog.polroles = ARRAY[v_runtime_role_oid]::pg_catalog.oid[]
        AND pg_catalog.pg_get_expr(policy_catalog.polqual, policy_catalog.polrelid) = 'true'::pg_catalog.text
        AND pg_catalog.pg_get_expr(policy_catalog.polwithcheck, policy_catalog.polrelid) = 'true'::pg_catalog.text
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policy AS policy_catalog
      WHERE policy_catalog.polname = 'circles_app_deny_anon_authenticated'::pg_catalog.name
        AND policy_catalog.polrelid = pg_catalog.to_regclass('circles_app.messages')
        AND NOT policy_catalog.polpermissive
        AND policy_catalog.polcmd = '*'::pg_catalog."char"
        AND pg_catalog.cardinality(policy_catalog.polroles) = 2
        AND policy_catalog.polroles @> ARRAY[
          (SELECT role_catalog.oid FROM pg_catalog.pg_roles AS role_catalog WHERE role_catalog.rolname = 'anon'::pg_catalog.name),
          (SELECT role_catalog.oid FROM pg_catalog.pg_roles AS role_catalog WHERE role_catalog.rolname = 'authenticated'::pg_catalog.name)
        ]::pg_catalog.oid[]
        AND pg_catalog.pg_get_expr(policy_catalog.polqual, policy_catalog.polrelid) = 'false'::pg_catalog.text
        AND pg_catalog.pg_get_expr(policy_catalog.polwithcheck, policy_catalog.polrelid) = 'false'::pg_catalog.text
    )
    -- Receipt states are finite: five-column baseline, five-column composite-PK, or captured six-column surrogate-PK.
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_class AS r
      JOIN pg_catalog.pg_namespace AS n ON n.oid = r.relnamespace
      JOIN pg_catalog.pg_roles AS o ON o.oid = r.relowner
      WHERE r.oid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"')
        AND n.nspname = 'circles_publish'::pg_catalog.name
        AND r.relname = 'postPublishReceipts'::pg_catalog.name
        AND r.relkind = 'r'::pg_catalog."char"
        AND r.relrowsecurity AND r.relforcerowsecurity
        AND o.rolname = 'postgres'::pg_catalog.name
    )
    AND pg_catalog.has_schema_privilege(v_runtime_role_oid, 'circles_publish'::pg_catalog.name, 'USAGE'::pg_catalog.text)
    AND pg_catalog.has_table_privilege(v_runtime_role_oid, pg_catalog.to_regclass('circles_publish."postPublishReceipts"'), 'SELECT'::pg_catalog.text)
    AND pg_catalog.has_table_privilege(v_runtime_role_oid, pg_catalog.to_regclass('circles_publish."postPublishReceipts"'), 'INSERT'::pg_catalog.text)
    AND pg_catalog.has_table_privilege(v_runtime_role_oid, pg_catalog.to_regclass('circles_publish."postPublishReceipts"'), 'UPDATE'::pg_catalog.text)
    AND NOT pg_catalog.has_table_privilege(v_runtime_role_oid, pg_catalog.to_regclass('circles_publish."postPublishReceipts"'), 'DELETE'::pg_catalog.text)
    AND NOT pg_catalog.has_table_privilege(v_runtime_role_oid, pg_catalog.to_regclass('circles_publish."postPublishReceipts"'), 'TRUNCATE'::pg_catalog.text)
    AND NOT pg_catalog.has_table_privilege(v_runtime_role_oid, pg_catalog.to_regclass('circles_publish."postPublishReceipts"'), 'REFERENCES'::pg_catalog.text)
    AND NOT pg_catalog.has_table_privilege(v_runtime_role_oid, pg_catalog.to_regclass('circles_publish."postPublishReceipts"'), 'TRIGGER'::pg_catalog.text)
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS r
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(r.relacl, pg_catalog.acldefault('r'::pg_catalog."char", r.relowner))
      ) AS acl
      WHERE r.oid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"')
        AND (
          acl.grantee = 0
          OR acl.grantee NOT IN (r.relowner, v_runtime_role_oid)
          OR (acl.grantee = v_runtime_role_oid AND (
            acl.privilege_type NOT IN ('SELECT'::pg_catalog.text, 'INSERT'::pg_catalog.text, 'UPDATE'::pg_catalog.text)
            OR acl.is_grantable
          ))
        )
    )
    AND (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_class AS r
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(r.relacl, pg_catalog.acldefault('r'::pg_catalog."char", r.relowner))
      ) AS acl
      WHERE r.oid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"')
        AND acl.grantee = v_runtime_role_oid
        AND acl.privilege_type IN ('SELECT'::pg_catalog.text, 'INSERT'::pg_catalog.text, 'UPDATE'::pg_catalog.text)
        AND NOT acl.is_grantable
    ) = 3
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('actorId'::pg_catalog.name, 1::pg_catalog.int2, 'integer'::pg_catalog.text, true, ''::pg_catalog."char"),
        ('operationId'::pg_catalog.name, 2::pg_catalog.int2, 'character varying(96)'::pg_catalog.text, true, ''::pg_catalog."char"),
        ('payloadHash'::pg_catalog.name, 3::pg_catalog.int2, 'character varying(64)'::pg_catalog.text, true, ''::pg_catalog."char"),
        ('postId'::pg_catalog.name, 4::pg_catalog.int2, 'integer'::pg_catalog.text, false, ''::pg_catalog."char"),
        ('createdAt'::pg_catalog.name, 5::pg_catalog.int2, 'timestamp with time zone'::pg_catalog.text, true, ''::pg_catalog."char")
      ) AS expected(name, ordinal, data_type, not_null, identity_kind)
      LEFT JOIN pg_catalog.pg_attribute AS a
        ON a.attrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"') AND a.attname = expected.name AND a.attnum = expected.ordinal
       AND a.attnum > 0 AND NOT a.attisdropped
      WHERE a.attnum IS NULL
         OR a.attnotnull IS DISTINCT FROM expected.not_null
         OR a.attidentity IS DISTINCT FROM expected.identity_kind
         OR pg_catalog.format_type(a.atttypid, a.atttypmod) <> expected.data_type
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint AS c
      JOIN pg_catalog.pg_index AS i ON i.indexrelid = c.conindid
      WHERE c.conrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"')
        AND c.conname = 'post_publish_receipts_actor_operation_unique'::pg_catalog.name
        AND c.contype = 'u'::pg_catalog."char" AND c.convalidated
        AND NOT c.condeferrable AND NOT c.condeferred
        AND c.conkey::pg_catalog.int2[] = ARRAY[1, 2]::pg_catalog.int2[]
        AND i.indisunique AND NOT i.indisprimary AND i.indisvalid AND i.indisready AND i.indislive
        AND i.indnkeyatts = 2 AND i.indnatts = 2 AND i.indexprs IS NULL AND i.indpred IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('postPublishReceipts_actorId_fkey'::pg_catalog.name, 'f'::pg_catalog."char", ARRAY[1]::pg_catalog.int2[], pg_catalog.to_regclass('circles_app.users'), 'c'::pg_catalog."char"),
        ('postPublishReceipts_postId_fkey'::pg_catalog.name, 'f'::pg_catalog."char", ARRAY[4]::pg_catalog.int2[], pg_catalog.to_regclass('circles_app.posts'), 'n'::pg_catalog."char"),
        ('post_publish_receipts_operation_id_check'::pg_catalog.name, 'c'::pg_catalog."char", NULL::pg_catalog.int2[], NULL::pg_catalog.oid, NULL::pg_catalog."char"),
        ('post_publish_receipts_payload_hash_check'::pg_catalog.name, 'c'::pg_catalog."char", NULL::pg_catalog.int2[], NULL::pg_catalog.oid, NULL::pg_catalog."char")
      ) AS expected(name, kind, key_columns, refrel, delete_kind)
      LEFT JOIN pg_catalog.pg_constraint AS c
        ON c.conrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"') AND c.conname = expected.name AND c.contype = expected.kind
       AND c.convalidated
       AND (expected.key_columns IS NULL OR c.conkey::pg_catalog.int2[] = expected.key_columns)
       AND (expected.refrel IS NULL OR c.confrelid = expected.refrel)
       AND (expected.delete_kind IS NULL OR c.confdeltype = expected.delete_kind)
      WHERE c.oid IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_index AS i
      JOIN pg_catalog.pg_class AS ci ON ci.oid = i.indexrelid
      WHERE i.indrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"')
        AND ci.relname = 'post_publish_receipts_post_idx'::pg_catalog.name
        AND NOT i.indisunique AND NOT i.indisprimary AND i.indisvalid AND i.indisready AND i.indislive
        AND i.indnkeyatts = 1 AND i.indnatts = 1 AND i.indexprs IS NULL AND i.indpred IS NULL
        AND pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) = '"postId"'::pg_catalog.text
    )
    AND (
      (
        (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute AS a WHERE a.attrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"') AND a.attnum > 0 AND NOT a.attisdropped) = 5
        AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS c WHERE c.conrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"')) = 5
        AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_index AS i WHERE i.indrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"')) = 2
      )
      OR (
        (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute AS a WHERE a.attrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"') AND a.attnum > 0 AND NOT a.attisdropped) = 5
        AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS c WHERE c.conrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"')) = 6
        AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_index AS i WHERE i.indrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"')) = 3
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_constraint AS c JOIN pg_catalog.pg_index AS i ON i.indexrelid = c.conindid
          WHERE c.conrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"') AND c.conname = 'post_publish_receipts_pkey'::pg_catalog.name
            AND c.contype = 'p'::pg_catalog."char" AND c.convalidated
            AND NOT c.condeferrable AND NOT c.condeferred AND c.conkey::pg_catalog.int2[] = ARRAY[1, 2]::pg_catalog.int2[]
            AND i.indisunique AND i.indisprimary AND i.indisvalid AND i.indisready AND i.indislive
            AND i.indnkeyatts = 2 AND i.indnatts = 2 AND i.indexprs IS NULL AND i.indpred IS NULL
        )
      )
      OR (
        (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute AS a WHERE a.attrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"') AND a.attnum > 0 AND NOT a.attisdropped) = 6
        AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS c WHERE c.conrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"')) = 6
        AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_index AS i WHERE i.indrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"')) = 3
        AND NOT EXISTS (
          SELECT 1 FROM (VALUES ('id'::pg_catalog.name, 6::pg_catalog.int2, 'bigint'::pg_catalog.text, true, 'a'::pg_catalog."char"))
            AS expected(name, ordinal, data_type, not_null, identity_kind)
          LEFT JOIN pg_catalog.pg_attribute AS a
            ON a.attrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"') AND a.attname = expected.name AND a.attnum = expected.ordinal
           AND a.attnum > 0 AND NOT a.attisdropped
          WHERE a.attnum IS NULL OR a.attnotnull IS DISTINCT FROM expected.not_null
             OR a.attidentity IS DISTINCT FROM expected.identity_kind
             OR pg_catalog.format_type(a.atttypid, a.atttypmod) <> expected.data_type
        )
        AND CASE WHEN EXISTS (
          SELECT 1 FROM pg_catalog.pg_attribute AS identity_attribute
          WHERE identity_attribute.attrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"')
            AND identity_attribute.attname = 'id'::pg_catalog.name
            AND identity_attribute.attnum = 6
            AND NOT identity_attribute.attisdropped
            AND identity_attribute.attidentity = 'a'::pg_catalog."char"
        ) THEN pg_catalog.pg_get_serial_sequence('circles_publish."postPublishReceipts"'::pg_catalog.text, 'id'::pg_catalog.text) = 'circles_publish."postPublishReceipts_id_seq"'::pg_catalog.text
        ELSE false END
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_class AS s
          JOIN pg_catalog.pg_namespace AS n ON n.oid = s.relnamespace
          JOIN pg_catalog.pg_roles AS o ON o.oid = s.relowner
          JOIN pg_catalog.pg_depend AS d ON d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
            AND d.objid = s.oid AND d.objsubid = 0 AND d.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass
            AND d.refobjid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"') AND d.refobjsubid = 6 AND d.deptype = 'i'::pg_catalog."char"
          WHERE n.nspname = 'circles_publish'::pg_catalog.name AND s.relname = 'postPublishReceipts_id_seq'::pg_catalog.name
            AND s.relkind = 'S'::pg_catalog."char" AND o.rolname = 'postgres'::pg_catalog.name
        )
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_constraint AS c JOIN pg_catalog.pg_index AS i ON i.indexrelid = c.conindid
          WHERE c.conrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"') AND c.conname = 'post_publish_receipts_pkey'::pg_catalog.name
            AND c.contype = 'p'::pg_catalog."char" AND c.convalidated
            AND NOT c.condeferrable AND NOT c.condeferred AND c.conkey::pg_catalog.int2[] = ARRAY[6]::pg_catalog.int2[]
            AND i.indisunique AND i.indisprimary AND i.indisvalid AND i.indisready AND i.indislive
            AND i.indnkeyatts = 1 AND i.indnatts = 1 AND i.indexprs IS NULL AND i.indpred IS NULL
        )
      )
    )
    AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policy AS p WHERE p.polrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"')) = 3
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('post_publish_receipts_runtime_select'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::pg_catalog.text, NULL::pg_catalog.text),
        ('post_publish_receipts_runtime_insert'::pg_catalog.name, 'a'::pg_catalog."char", NULL::pg_catalog.text, 'true'::pg_catalog.text),
        ('post_publish_receipts_runtime_update'::pg_catalog.name, 'w'::pg_catalog."char", 'true'::pg_catalog.text, 'true'::pg_catalog.text)
      ) AS expected(name, command, qual, with_check)
      LEFT JOIN pg_catalog.pg_policy AS p
        ON p.polrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"') AND p.polname = expected.name AND p.polpermissive
       AND p.polcmd = expected.command AND p.polroles = ARRAY[v_runtime_role_oid]::pg_catalog.oid[]
       AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) IS NOT DISTINCT FROM expected.qual
       AND pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) IS NOT DISTINCT FROM expected.with_check
      WHERE p.oid IS NULL
    )
    -- Identity is optional until email auth is enabled. If its schema is installed, however, a
    -- malformed private mapping is drift and must not be silently accepted by health.
    AND (
      NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_namespace AS namespace_catalog
        WHERE namespace_catalog.nspname = 'circles_identity'::pg_catalog.name
      )
      OR (
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS relation_catalog
          JOIN pg_catalog.pg_namespace AS namespace_catalog
            ON namespace_catalog.oid = relation_catalog.relnamespace
          WHERE namespace_catalog.nspname = 'circles_identity'::pg_catalog.name
            AND relation_catalog.relname = 'provider_links'::pg_catalog.name
            AND relation_catalog.relkind = 'r'::pg_catalog."char"
            AND relation_catalog.relrowsecurity
            AND relation_catalog.relforcerowsecurity
        )
        AND (
          SELECT pg_catalog.count(*)
          FROM pg_catalog.pg_attribute AS attribute_catalog
          WHERE attribute_catalog.attrelid = pg_catalog.to_regclass('circles_identity.provider_links')
            AND attribute_catalog.attnum > 0
            AND NOT attribute_catalog.attisdropped
        ) = 3
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_constraint AS constraint_catalog
          WHERE constraint_catalog.conrelid = pg_catalog.to_regclass('circles_identity.provider_links')
            AND constraint_catalog.contype = 'p'::pg_catalog."char"
            AND constraint_catalog.convalidated
            AND constraint_catalog.conkey::pg_catalog.int2[] = ARRAY[1]::pg_catalog.int2[]
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_constraint AS constraint_catalog
          WHERE constraint_catalog.conrelid = pg_catalog.to_regclass('circles_identity.provider_links')
            AND constraint_catalog.contype = 'u'::pg_catalog."char"
            AND constraint_catalog.convalidated
            AND constraint_catalog.conkey::pg_catalog.int2[] = ARRAY[2]::pg_catalog.int2[]
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_constraint AS constraint_catalog
          WHERE constraint_catalog.conrelid = pg_catalog.to_regclass('circles_identity.provider_links')
            AND constraint_catalog.contype = 'f'::pg_catalog."char"
            AND constraint_catalog.convalidated
            AND constraint_catalog.conkey::pg_catalog.int2[] = ARRAY[2]::pg_catalog.int2[]
            AND constraint_catalog.confrelid = pg_catalog.to_regclass('circles_app.users')
            AND constraint_catalog.confdeltype = 'c'::pg_catalog."char"
        )
        AND NOT EXISTS (
          SELECT 1
          FROM (
            VALUES
              ('circles_identity_provider_links_runtime_select'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::pg_catalog.text, NULL::pg_catalog.text),
              ('circles_identity_provider_links_runtime_insert'::pg_catalog.name, 'a'::pg_catalog."char", NULL::pg_catalog.text, 'true'::pg_catalog.text)
          ) AS expected_policy(policy_name, command, expected_qual, expected_with_check)
          LEFT JOIN pg_catalog.pg_policy AS policy_catalog
            ON policy_catalog.polname = expected_policy.policy_name
           AND policy_catalog.polrelid = pg_catalog.to_regclass('circles_identity.provider_links')
           AND policy_catalog.polpermissive
           AND policy_catalog.polcmd = expected_policy.command
           AND policy_catalog.polroles = ARRAY[v_runtime_role_oid]::pg_catalog.oid[]
           AND pg_catalog.pg_get_expr(policy_catalog.polqual, policy_catalog.polrelid) IS NOT DISTINCT FROM expected_policy.expected_qual
           AND pg_catalog.pg_get_expr(policy_catalog.polwithcheck, policy_catalog.polrelid) IS NOT DISTINCT FROM expected_policy.expected_with_check
          WHERE policy_catalog.oid IS NULL
        )
      )
    )
    INTO v_critical_contract_ok;

  RETURN QUERY
  SELECT
    COALESCE(v_critical_contract_ok, false),
    CASE
      WHEN COALESCE(v_critical_contract_ok, false) THEN NULL::pg_catalog.text
      ELSE 'critical_feature_catalog_drift'::pg_catalog.text
    END;
EXCEPTION
  WHEN invalid_schema_name OR undefined_table OR undefined_object OR insufficient_privilege THEN
    RETURN QUERY SELECT false, 'critical_feature_catalog_unavailable'::pg_catalog.text;
  WHEN OTHERS THEN
    -- Never return dynamic catalog/SQL details through this operational contract.
    RETURN QUERY SELECT false, 'critical_feature_catalog_exception'::pg_catalog.text;
END;
$function$;

ALTER FUNCTION circles_ops.run_daily_critical_feature_health() OWNER TO postgres;
DO $db14_current_receipt_postflight$
DECLARE
  helper_oid pg_catalog.oid;
  helper_owner pg_catalog.oid;
  helper_acl pg_catalog.aclitem[];
  helper_definer boolean;
  helper_config text[];
BEGIN
  SELECT f.oid, f.proowner, f.proacl, f.prosecdef, f.proconfig
    INTO helper_oid, helper_owner, helper_acl, helper_definer, helper_config
  FROM pg_catalog.pg_proc AS f
  JOIN pg_catalog.pg_namespace AS n ON n.oid = f.pronamespace
  WHERE n.nspname = 'circles_ops'::pg_catalog.name
    AND f.proname = 'run_daily_critical_feature_health'::pg_catalog.name
    AND f.pronargs = 0;
  IF helper_oid IS DISTINCT FROM pg_catalog.current_setting('circles_ops.db14_receipt_helper_oid', true)::pg_catalog.oid
     OR helper_owner <> (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'postgres'::pg_catalog.name)
     OR NOT helper_definer
     OR helper_config IS DISTINCT FROM ARRAY['search_path=pg_catalog'::pg_catalog.text]
     OR helper_acl IS DISTINCT FROM ARRAY['postgres=X/postgres'::pg_catalog.aclitem]
     OR pg_catalog.strpos(
       (SELECT pg_catalog.pg_get_functiondef(oid) FROM pg_catalog.pg_proc WHERE oid = helper_oid),
       'postPublishReceipts_id_seq'::pg_catalog.text
     ) = 0
     OR pg_catalog.to_regprocedure('circles_ops.run_daily_migration_health()') IS DISTINCT FROM pg_catalog.current_setting('circles_ops.db14_receipt_daily_oid', true)::pg_catalog.oid
     OR pg_catalog.to_regclass('circles_ops.health_runs') IS DISTINCT FROM pg_catalog.current_setting('circles_ops.db14_receipt_history_oid', true)::pg_catalog.oid
  THEN
    RAISE EXCEPTION 'DB-14 current receipt reconciliation postflight identity, ACL, or operations boundary failed';
  END IF;
END;
$db14_current_receipt_postflight$;
COMMIT;
