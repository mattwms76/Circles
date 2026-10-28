-- DB-14 prepared only. Apply once through the parent-approved private PostgreSQL workflow.
-- This additive companion preserves the existing health function, history, Cron identity,
-- schedules, grants, retention, rows, and provider configuration. It performs catalog/ACL
-- aggregate checks only and returns no object definitions, row values, credentials, or hosts.
--
-- Live rollout prerequisite: after a synthetic PostgreSQL 17 drill and protected review, the
-- existing trusted daily operations runner must invoke this postgres-only companion alongside
-- circles_ops.run_daily_migration_health(). This file intentionally does not create/change Cron.

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('circles_ops.db14-critical-feature-health.v1', 0)
);

DO $db14_preconditions$
BEGIN
  -- Never replace an existing signature: CREATE OR REPLACE can retain prior ACL state for a
  -- SECURITY DEFINER routine. A pre-existing overload is also a review boundary, not an upgrade.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function_catalog
    JOIN pg_catalog.pg_namespace AS namespace_catalog
      ON namespace_catalog.oid = function_catalog.pronamespace
    WHERE namespace_catalog.nspname = 'circles_ops'::pg_catalog.name
      AND function_catalog.proname = 'run_daily_critical_feature_health'::pg_catalog.name
  ) THEN
    RAISE EXCEPTION 'DB-14 critical health function or overload already exists; refuse ACL-carrying replacement';
  END IF;
  IF pg_catalog.to_regprocedure('circles_ops.run_daily_migration_health()') IS NULL THEN
    RAISE EXCEPTION 'DB-14 requires the installed circles_ops daily health baseline';
  END IF;
  IF pg_catalog.to_regclass('circles_ops.health_runs') IS NULL THEN
    RAISE EXCEPTION 'DB-14 requires the installed circles_ops health history boundary';
  END IF;
END;
$db14_preconditions$;

CREATE FUNCTION circles_ops.run_daily_critical_feature_health()
RETURNS TABLE (
  healthy boolean,
  error_code text
)
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
    -- Receipt persistence is a required installed contract. The named baseline UNIQUE remains
    -- required while DB-11 may add a compatible primary key over the same two columns.
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation_catalog
      JOIN pg_catalog.pg_namespace AS namespace_catalog
        ON namespace_catalog.oid = relation_catalog.relnamespace
      WHERE namespace_catalog.nspname = 'circles_publish'::pg_catalog.name
        AND relation_catalog.relname = 'postPublishReceipts'::pg_catalog.name
        AND relation_catalog.relkind = 'r'::pg_catalog."char"
        AND relation_catalog.relrowsecurity
        AND relation_catalog.relforcerowsecurity
    )
    AND (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attribute AS attribute_catalog
      WHERE attribute_catalog.attrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"')
        AND attribute_catalog.attnum > 0
        AND NOT attribute_catalog.attisdropped
    ) = 5
    AND NOT EXISTS (
      SELECT 1
      FROM (
        VALUES
          ('actorId'::pg_catalog.name, 'integer'::pg_catalog.text, true),
          ('operationId'::pg_catalog.name, 'character varying(96)'::pg_catalog.text, true),
          ('payloadHash'::pg_catalog.name, 'character varying(64)'::pg_catalog.text, true),
          ('postId'::pg_catalog.name, 'integer'::pg_catalog.text, false),
          ('createdAt'::pg_catalog.name, 'timestamp with time zone'::pg_catalog.text, true)
      ) AS expected_column(column_name, data_type, not_null)
      LEFT JOIN pg_catalog.pg_attribute AS attribute_catalog
        ON attribute_catalog.attrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"')
       AND attribute_catalog.attname = expected_column.column_name
       AND attribute_catalog.attnum > 0
       AND NOT attribute_catalog.attisdropped
      WHERE attribute_catalog.attnum IS NULL
        OR attribute_catalog.attnotnull IS DISTINCT FROM expected_column.not_null
        OR pg_catalog.format_type(attribute_catalog.atttypid, attribute_catalog.atttypmod) <> expected_column.data_type
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_catalog
      JOIN pg_catalog.pg_index AS index_catalog
        ON index_catalog.indexrelid = constraint_catalog.conindid
      WHERE constraint_catalog.conname = 'post_publish_receipts_actor_operation_unique'::pg_catalog.name
        AND constraint_catalog.conrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"')
        AND constraint_catalog.contype = 'u'::pg_catalog."char"
        AND constraint_catalog.convalidated
        AND constraint_catalog.conkey::pg_catalog.int2[] = ARRAY[1, 2]::pg_catalog.int2[]
        AND index_catalog.indisunique
        AND index_catalog.indisvalid
        AND index_catalog.indisready
        AND index_catalog.indislive
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_catalog
      JOIN pg_catalog.pg_index AS index_catalog
        ON index_catalog.indexrelid = constraint_catalog.conindid
      WHERE constraint_catalog.conrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"')
        AND constraint_catalog.contype IN ('p'::pg_catalog."char", 'u'::pg_catalog."char")
        AND constraint_catalog.convalidated
        AND constraint_catalog.conkey::pg_catalog.int2[] = ARRAY[1, 2]::pg_catalog.int2[]
        AND index_catalog.indisunique
        AND index_catalog.indisvalid
        AND index_catalog.indisready
        AND index_catalog.indislive
        AND index_catalog.indpred IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (
        VALUES
          ('postPublishReceipts_actorId_fkey'::pg_catalog.name, 'f'::pg_catalog."char", pg_catalog.to_regclass('circles_app.users'), 'c'::pg_catalog."char"),
          ('postPublishReceipts_postId_fkey'::pg_catalog.name, 'f'::pg_catalog."char", pg_catalog.to_regclass('circles_app.posts'), 'n'::pg_catalog."char"),
          ('post_publish_receipts_operation_id_check'::pg_catalog.name, 'c'::pg_catalog."char", NULL::pg_catalog.oid, NULL::pg_catalog."char"),
          ('post_publish_receipts_payload_hash_check'::pg_catalog.name, 'c'::pg_catalog."char", NULL::pg_catalog.oid, NULL::pg_catalog."char")
      ) AS expected_constraint(constraint_name, constraint_type, referenced_relation_oid, delete_type)
      LEFT JOIN pg_catalog.pg_constraint AS constraint_catalog
        ON constraint_catalog.conname = expected_constraint.constraint_name
       AND constraint_catalog.conrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"')
       AND constraint_catalog.contype = expected_constraint.constraint_type
       AND constraint_catalog.convalidated
       AND (expected_constraint.referenced_relation_oid IS NULL OR constraint_catalog.confrelid = expected_constraint.referenced_relation_oid)
       AND (expected_constraint.delete_type IS NULL OR constraint_catalog.confdeltype = expected_constraint.delete_type)
      WHERE constraint_catalog.oid IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (
        VALUES
          ('post_publish_receipts_runtime_select'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::pg_catalog.text, NULL::pg_catalog.text),
          ('post_publish_receipts_runtime_insert'::pg_catalog.name, 'a'::pg_catalog."char", NULL::pg_catalog.text, 'true'::pg_catalog.text),
          ('post_publish_receipts_runtime_update'::pg_catalog.name, 'w'::pg_catalog."char", 'true'::pg_catalog.text, 'true'::pg_catalog.text)
      ) AS expected_policy(policy_name, command, expected_qual, expected_with_check)
      LEFT JOIN pg_catalog.pg_policy AS policy_catalog
        ON policy_catalog.polname = expected_policy.policy_name
       AND policy_catalog.polrelid = pg_catalog.to_regclass('circles_publish."postPublishReceipts"')
       AND policy_catalog.polpermissive
       AND policy_catalog.polcmd = expected_policy.command
       AND policy_catalog.polroles = ARRAY[v_runtime_role_oid]::pg_catalog.oid[]
       AND pg_catalog.pg_get_expr(policy_catalog.polqual, policy_catalog.polrelid) IS NOT DISTINCT FROM expected_policy.expected_qual
       AND pg_catalog.pg_get_expr(policy_catalog.polwithcheck, policy_catalog.polrelid) IS NOT DISTINCT FROM expected_policy.expected_with_check
      WHERE policy_catalog.oid IS NULL
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

DO $db14_function_acl$
DECLARE
  role_name pg_catalog.name;
BEGIN
  -- Remove default privileges and every direct role grant before adding the one reviewed grant.
  -- The function was just created after the no-prior-signature guard, so no inherited legacy ACL
  -- is acceptable here.
  REVOKE ALL ON FUNCTION circles_ops.run_daily_critical_feature_health() FROM PUBLIC;
  FOR role_name IN
    SELECT role_catalog.rolname
    FROM pg_catalog.pg_roles AS role_catalog
    WHERE role_catalog.rolname <> 'postgres'::pg_catalog.name
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION circles_ops.run_daily_critical_feature_health() FROM %I',
      role_name
    );
  END LOOP;
  REVOKE ALL ON FUNCTION circles_ops.run_daily_critical_feature_health() FROM postgres;
  GRANT EXECUTE ON FUNCTION circles_ops.run_daily_critical_feature_health() TO postgres;
END;
$db14_function_acl$;

DO $db14_postflight$
DECLARE
  function_oid pg_catalog.oid;
  function_owner pg_catalog.oid;
  function_acl pg_catalog.aclitem[];
  function_is_security_definer boolean;
  function_config text[];
BEGIN
  SELECT
    function_catalog.oid,
    function_catalog.proowner,
    function_catalog.proacl,
    function_catalog.prosecdef,
    function_catalog.proconfig
  INTO
    function_oid,
    function_owner,
    function_acl,
    function_is_security_definer,
    function_config
  FROM pg_catalog.pg_proc AS function_catalog
  JOIN pg_catalog.pg_namespace AS namespace_catalog
    ON namespace_catalog.oid = function_catalog.pronamespace
  WHERE namespace_catalog.nspname = 'circles_ops'::pg_catalog.name
    AND function_catalog.proname = 'run_daily_critical_feature_health'::pg_catalog.name
    AND function_catalog.pronargs = 0;

  IF function_oid IS NULL
     OR function_owner <> (
       SELECT role_catalog.oid
       FROM pg_catalog.pg_roles AS role_catalog
       WHERE role_catalog.rolname = 'postgres'::pg_catalog.name
     )
     OR NOT function_is_security_definer
     OR function_config IS DISTINCT FROM ARRAY['search_path=pg_catalog'::pg_catalog.text]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.aclexplode(
         COALESCE(
           function_acl,
           pg_catalog.acldefault('f'::pg_catalog."char", function_owner)
         )
       ) AS acl_entry
       WHERE acl_entry.grantee = function_owner
         AND acl_entry.privilege_type = 'EXECUTE'::pg_catalog.text
         AND NOT acl_entry.is_grantable
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.aclexplode(
         COALESCE(
           function_acl,
           pg_catalog.acldefault('f'::pg_catalog."char", function_owner)
       )
       ) AS acl_entry
       WHERE acl_entry.grantee = 0
          OR acl_entry.grantee <> function_owner
          OR acl_entry.privilege_type <> 'EXECUTE'::pg_catalog.text
          OR acl_entry.is_grantable
     )
  THEN
    RAISE EXCEPTION 'DB-14 critical health function postflight ACL/security contract failed';
  END IF;
END;
$db14_postflight$;

COMMIT;
