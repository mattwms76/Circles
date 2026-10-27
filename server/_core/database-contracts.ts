import { getDb } from "../db";
import { withOperationDeadline } from "./bounded-network";

/** Source-owned fingerprint of the exact 0004 message-authorization trigger body. */
export const MESSAGE_AUTHORIZATION_FUNCTION_PROSRC_MD5 =
  "0a08011f0d65ba73717aa1c9922aa586";

export type DatabaseReadinessEvidence = {
  runtime_role: string;
  app_table_count: number;
  oauth_store_ready: boolean;
  critical_contract_ready: boolean;
};

export type PostPublicationContractEvidence = { ready: boolean };
export type PostPublicationStatus = { ready: boolean };

/**
 * Catalog/privilege aggregates only. The query intentionally reads neither application
 * rows nor configuration values. A later additive schema change must extend this
 * reviewed contract rather than silently widening a readiness result.
 */
export const DATABASE_READINESS_SQL = `
  WITH runtime_role AS (
    SELECT role_catalog.oid AS role_oid
    FROM pg_catalog.pg_roles AS role_catalog
    WHERE role_catalog.rolname = 'circles_app_runtime'::pg_catalog.name
  ), app_schema AS (
    SELECT namespace_catalog.oid AS namespace_oid
    FROM pg_catalog.pg_namespace AS namespace_catalog
    WHERE namespace_catalog.nspname = 'circles_app'::pg_catalog.name
  )
  SELECT
    current_user::text AS runtime_role,
    (
      SELECT pg_catalog.count(*)::integer
      FROM pg_catalog.pg_class AS relation_catalog
      JOIN app_schema ON app_schema.namespace_oid = relation_catalog.relnamespace
      WHERE relation_catalog.relkind = 'r'::pg_catalog."char"
        AND relation_catalog.relrowsecurity
        AND pg_catalog.has_schema_privilege(current_user, app_schema.namespace_oid, 'USAGE')
        AND pg_catalog.has_table_privilege(current_user, relation_catalog.oid, 'SELECT')
    ) AS app_table_count,
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation_catalog
      JOIN pg_catalog.pg_namespace AS namespace_catalog
        ON namespace_catalog.oid = relation_catalog.relnamespace
      WHERE namespace_catalog.nspname = 'circles_auth'::pg_catalog.name
        AND relation_catalog.relname = 'oauth_pending_states'::pg_catalog.name
        AND relation_catalog.relkind = 'r'::pg_catalog."char"
        AND relation_catalog.relrowsecurity
        AND relation_catalog.relforcerowsecurity
        AND pg_catalog.has_schema_privilege(current_user, namespace_catalog.oid, 'USAGE')
        AND pg_catalog.has_table_privilege(current_user, relation_catalog.oid, 'SELECT')
        AND pg_catalog.has_table_privilege(current_user, relation_catalog.oid, 'INSERT')
        AND pg_catalog.has_table_privilege(current_user, relation_catalog.oid, 'DELETE')
        AND NOT pg_catalog.has_table_privilege(current_user, relation_catalog.oid, 'UPDATE')
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_policy AS policy_catalog
          WHERE policy_catalog.polrelid = relation_catalog.oid
            AND policy_catalog.polcmd = '*'::pg_catalog."char"
            AND policy_catalog.polroles = ARRAY[(SELECT role_oid FROM runtime_role)]::pg_catalog.oid[]
            AND pg_catalog.pg_get_expr(policy_catalog.polqual, policy_catalog.polrelid) = 'true'::pg_catalog.text
            AND pg_catalog.pg_get_expr(policy_catalog.polwithcheck, policy_catalog.polrelid) = 'true'::pg_catalog.text
        )
    ) AS oauth_store_ready,
    (
      (SELECT pg_catalog.count(*) FROM runtime_role) = 1
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute AS attribute_catalog
        JOIN pg_catalog.pg_class AS relation_catalog
          ON relation_catalog.oid = attribute_catalog.attrelid
        JOIN pg_catalog.pg_namespace AS namespace_catalog
          ON namespace_catalog.oid = relation_catalog.relnamespace
        WHERE namespace_catalog.nspname = 'circles_app'::pg_catalog.name
          AND relation_catalog.relname = 'messages'::pg_catalog.name
          AND relation_catalog.relkind = 'r'::pg_catalog."char"
          AND attribute_catalog.attname = 'clientMessageId'::pg_catalog.name
          AND NOT attribute_catalog.attisdropped
          AND NOT attribute_catalog.attnotnull
          AND pg_catalog.format_type(attribute_catalog.atttypid, attribute_catalog.atttypmod) = 'character varying(96)'::pg_catalog.text
      )
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute AS attribute_catalog
        JOIN pg_catalog.pg_class AS relation_catalog
          ON relation_catalog.oid = attribute_catalog.attrelid
        JOIN pg_catalog.pg_namespace AS namespace_catalog
          ON namespace_catalog.oid = relation_catalog.relnamespace
        WHERE attribute_catalog.attrelid = pg_catalog.to_regclass('circles_app."socialUploads"')
          AND namespace_catalog.nspname = 'circles_app'::pg_catalog.name
          AND relation_catalog.relkind = 'r'::pg_catalog."char"
          AND attribute_catalog.attname = 'claimedAt'::pg_catalog.name
          AND NOT attribute_catalog.attisdropped
          AND NOT attribute_catalog.attnotnull
          AND pg_catalog.format_type(attribute_catalog.atttypid, attribute_catalog.atttypmod) = 'timestamp with time zone'::pg_catalog.text
      )
      AND NOT EXISTS (
        WITH expected_columns(table_name, column_name, data_type, not_null) AS (
          VALUES
            ('conversations'::pg_catalog.name, 'kind'::pg_catalog.name, 'circles_app.conversation_kind'::pg_catalog.text, true),
            ('conversations'::pg_catalog.name, 'directKey'::pg_catalog.name, 'character varying(64)'::pg_catalog.text, false),
            ('conversations'::pg_catalog.name, 'circleId'::pg_catalog.name, 'integer'::pg_catalog.text, false),
            ('conversationParticipants'::pg_catalog.name, 'conversationId'::pg_catalog.name, 'integer'::pg_catalog.text, true),
            ('conversationParticipants'::pg_catalog.name, 'userId'::pg_catalog.name, 'integer'::pg_catalog.text, true),
            ('conversationParticipants'::pg_catalog.name, 'lastReadMessageId'::pg_catalog.name, 'integer'::pg_catalog.text, true),
            ('messages'::pg_catalog.name, 'conversationId'::pg_catalog.name, 'integer'::pg_catalog.text, true),
            ('messages'::pg_catalog.name, 'authorId'::pg_catalog.name, 'integer'::pg_catalog.text, true),
            ('messages'::pg_catalog.name, 'text'::pg_catalog.name, 'text'::pg_catalog.text, true),
            ('messages'::pg_catalog.name, 'media'::pg_catalog.name, 'character varying(2048)'::pg_catalog.text, false)
        )
        SELECT 1
        FROM expected_columns
        LEFT JOIN pg_catalog.pg_class AS relation_catalog
          ON relation_catalog.relnamespace = (SELECT namespace_oid FROM app_schema)
         AND relation_catalog.relname = expected_columns.table_name
         AND relation_catalog.relkind = 'r'::pg_catalog."char"
        LEFT JOIN pg_catalog.pg_attribute AS attribute_catalog
          ON attribute_catalog.attrelid = relation_catalog.oid
         AND attribute_catalog.attname = expected_columns.column_name
         AND attribute_catalog.attnum > 0
         AND NOT attribute_catalog.attisdropped
        WHERE attribute_catalog.attnum IS NULL
          OR attribute_catalog.attnotnull IS DISTINCT FROM expected_columns.not_null
          OR pg_catalog.format_type(attribute_catalog.atttypid, attribute_catalog.atttypmod) <> expected_columns.data_type
      )
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_catalog
        WHERE constraint_catalog.conname = 'conversations_kind_target_check'::pg_catalog.name
          AND constraint_catalog.conrelid = pg_catalog.to_regclass('circles_app.conversations')
          AND constraint_catalog.contype = 'c'::pg_catalog."char"
          AND pg_catalog.strpos(pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true), 'direct'::pg_catalog.text) > 0
          AND pg_catalog.strpos(pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true), 'circle'::pg_catalog.text) > 0
      )
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_catalog
        WHERE constraint_catalog.conname = 'messages_content_check'::pg_catalog.name
          AND constraint_catalog.conrelid = pg_catalog.to_regclass('circles_app.messages')
          AND constraint_catalog.contype = 'c'::pg_catalog."char"
          AND pg_catalog.strpos(pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true), 'btrim(text)'::pg_catalog.text) > 0
      )
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_catalog
        WHERE constraint_catalog.conname = 'messages_client_message_id_check'::pg_catalog.name
          AND constraint_catalog.conrelid = pg_catalog.to_regclass('circles_app.messages')
          AND constraint_catalog.contype = 'c'::pg_catalog."char"
          AND pg_catalog.strpos(pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true), 'clientMessageId'::pg_catalog.text) > 0
          AND pg_catalog.strpos(pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true), '{15,95}'::pg_catalog.text) > 0
      )
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_catalog
        WHERE constraint_catalog.conname = 'messages_conversationId_fkey'::pg_catalog.name
          AND constraint_catalog.conrelid = pg_catalog.to_regclass('circles_app.messages')
          AND constraint_catalog.contype = 'f'::pg_catalog."char"
          AND constraint_catalog.convalidated
          AND constraint_catalog.confrelid = pg_catalog.to_regclass('circles_app.conversations')
          AND constraint_catalog.confdeltype = 'c'::pg_catalog."char"
      )
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_catalog
        WHERE constraint_catalog.conname = 'messages_authorId_fkey'::pg_catalog.name
          AND constraint_catalog.conrelid = pg_catalog.to_regclass('circles_app.messages')
          AND constraint_catalog.contype = 'f'::pg_catalog."char"
          AND constraint_catalog.convalidated
          AND constraint_catalog.confrelid = pg_catalog.to_regclass('circles_app.users')
          AND constraint_catalog.confdeltype = 'c'::pg_catalog."char"
      )
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_catalog
        JOIN pg_catalog.pg_index AS index_catalog
          ON index_catalog.indexrelid = constraint_catalog.conindid
        WHERE constraint_catalog.conname = 'conversation_participants_conversation_user_unique'::pg_catalog.name
          AND constraint_catalog.conrelid = pg_catalog.to_regclass('circles_app."conversationParticipants"')
          AND constraint_catalog.contype = 'u'::pg_catalog."char"
          AND constraint_catalog.convalidated
          AND constraint_catalog.conkey::pg_catalog.int2[] = ARRAY[2, 3]::pg_catalog.int2[]
          AND index_catalog.indisunique
          AND index_catalog.indisvalid
          AND index_catalog.indisready
          AND index_catalog.indislive
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
            ('conversations_direct_key_unique'::pg_catalog.name, ARRAY[3]::pg_catalog.int2[]),
            ('conversations_circle_id_unique'::pg_catalog.name, ARRAY[4]::pg_catalog.int2[])
        ) AS expected_unique(constraint_name, key_columns)
        LEFT JOIN pg_catalog.pg_constraint AS constraint_catalog
          ON constraint_catalog.conname = expected_unique.constraint_name
         AND constraint_catalog.conrelid = pg_catalog.to_regclass('circles_app.conversations')
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
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_trigger AS trigger_catalog
        JOIN pg_catalog.pg_proc AS function_catalog
          ON function_catalog.oid = trigger_catalog.tgfoid
        JOIN pg_catalog.pg_namespace AS function_namespace
          ON function_namespace.oid = function_catalog.pronamespace
        JOIN pg_catalog.pg_roles AS owner_catalog
          ON owner_catalog.oid = function_catalog.proowner
        WHERE trigger_catalog.tgname = 'messages_author_authorized_trigger'::pg_catalog.name
          AND trigger_catalog.tgrelid = pg_catalog.to_regclass('circles_app.messages')
          AND NOT trigger_catalog.tgisinternal
          AND trigger_catalog.tgenabled = 'O'::pg_catalog."char"
          AND trigger_catalog.tgconstraint <> 0
          AND trigger_catalog.tgdeferrable
          AND NOT trigger_catalog.tginitdeferred
          AND function_namespace.nspname = 'circles_app'::pg_catalog.name
          AND function_catalog.proname = 'enforce_message_author_authorized'::pg_catalog.name
          AND function_catalog.pronargs = 0
          AND NOT function_catalog.prosecdef
          AND owner_catalog.rolname = 'postgres'::pg_catalog.name
          AND function_catalog.proconfig = ARRAY['search_path=pg_catalog, circles_app'::pg_catalog.text]
          AND pg_catalog.md5(function_catalog.prosrc) = '${MESSAGE_AUTHORIZATION_FUNCTION_PROSRC_MD5}'::pg_catalog.text
          AND NOT pg_catalog.has_function_privilege((SELECT role_oid FROM runtime_role), function_catalog.oid, 'EXECUTE')
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.aclexplode(
              COALESCE(function_catalog.proacl, pg_catalog.acldefault('f'::pg_catalog."char", function_catalog.proowner))
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
          AND policy_catalog.polroles = ARRAY[(SELECT role_oid FROM runtime_role)]::pg_catalog.oid[]
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
    ) AS critical_contract_ready
  LIMIT 1
`;

/**
 * Conditional email identity contract. It is queried only when email auth is enabled;
 * an absent optional schema is therefore not promoted to a global readiness failure.
 */
export const EMAIL_IDENTITY_READINESS_SQL = `
  WITH runtime_role AS (
    SELECT role_catalog.oid AS role_oid
    FROM pg_catalog.pg_roles AS role_catalog
    WHERE role_catalog.rolname = 'circles_app_runtime'::pg_catalog.name
  ), identity_schema AS (
    SELECT namespace_catalog.oid AS namespace_oid
    FROM pg_catalog.pg_namespace AS namespace_catalog
    WHERE namespace_catalog.nspname = 'circles_identity'::pg_catalog.name
  ), identity_relation AS (
    SELECT relation_catalog.oid, relation_catalog.relowner, relation_catalog.relrowsecurity, relation_catalog.relforcerowsecurity
    FROM pg_catalog.pg_class AS relation_catalog
    JOIN identity_schema ON identity_schema.namespace_oid = relation_catalog.relnamespace
    WHERE relation_catalog.relname = 'provider_links'::pg_catalog.name
      AND relation_catalog.relkind = 'r'::pg_catalog."char"
  )
  SELECT (
    current_user = 'circles_app_runtime'::pg_catalog.name
    AND (SELECT pg_catalog.count(*) FROM runtime_role) = 1
    AND (SELECT pg_catalog.count(*) FROM identity_schema) = 1
    AND (SELECT pg_catalog.count(*) FROM identity_relation) = 1
    AND (SELECT relrowsecurity AND relforcerowsecurity FROM identity_relation)
    AND pg_catalog.has_schema_privilege(current_user, (SELECT namespace_oid FROM identity_schema), 'USAGE')
    AND pg_catalog.has_table_privilege(current_user, (SELECT oid FROM identity_relation), 'SELECT')
    AND pg_catalog.has_table_privilege(current_user, (SELECT oid FROM identity_relation), 'INSERT')
    AND NOT pg_catalog.has_table_privilege(current_user, (SELECT oid FROM identity_relation), 'UPDATE')
    AND NOT pg_catalog.has_table_privilege(current_user, (SELECT oid FROM identity_relation), 'DELETE')
    AND NOT EXISTS (
      WITH expected_columns(column_name, data_type, not_null) AS (
        VALUES
          ('provider_subject'::pg_catalog.name, 'uuid'::pg_catalog.text, true),
          ('user_id'::pg_catalog.name, 'integer'::pg_catalog.text, true),
          ('created_at'::pg_catalog.name, 'timestamp with time zone'::pg_catalog.text, true)
      )
      SELECT 1
      FROM expected_columns
      LEFT JOIN pg_catalog.pg_attribute AS attribute_catalog
        ON attribute_catalog.attrelid = (SELECT oid FROM identity_relation)
       AND attribute_catalog.attname = expected_columns.column_name
       AND attribute_catalog.attnum > 0
       AND NOT attribute_catalog.attisdropped
      WHERE attribute_catalog.attnum IS NULL
        OR attribute_catalog.attnotnull IS DISTINCT FROM expected_columns.not_null
        OR pg_catalog.format_type(attribute_catalog.atttypid, attribute_catalog.atttypmod) <> expected_columns.data_type
    )
    AND (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attribute AS attribute_catalog
      WHERE attribute_catalog.attrelid = (SELECT oid FROM identity_relation)
        AND attribute_catalog.attnum > 0
        AND NOT attribute_catalog.attisdropped
    ) = 3
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_catalog
      WHERE constraint_catalog.conrelid = (SELECT oid FROM identity_relation)
        AND constraint_catalog.contype = 'p'::pg_catalog."char"
        AND constraint_catalog.convalidated
        AND constraint_catalog.conkey::pg_catalog.int2[] = ARRAY[1]::pg_catalog.int2[]
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_catalog
      WHERE constraint_catalog.conrelid = (SELECT oid FROM identity_relation)
        AND constraint_catalog.contype = 'u'::pg_catalog."char"
        AND constraint_catalog.convalidated
        AND constraint_catalog.conkey::pg_catalog.int2[] = ARRAY[2]::pg_catalog.int2[]
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_catalog
      WHERE constraint_catalog.conrelid = (SELECT oid FROM identity_relation)
        AND constraint_catalog.contype = 'f'::pg_catalog."char"
        AND constraint_catalog.convalidated
        AND constraint_catalog.conkey::pg_catalog.int2[] = ARRAY[2]::pg_catalog.int2[]
        AND constraint_catalog.confrelid = pg_catalog.to_regclass('circles_app.users')
        AND constraint_catalog.confdeltype = 'c'::pg_catalog."char"
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policy AS policy_catalog
      WHERE policy_catalog.polname = 'circles_identity_provider_links_runtime_select'::pg_catalog.name
        AND policy_catalog.polrelid = (SELECT oid FROM identity_relation)
        AND policy_catalog.polpermissive
        AND policy_catalog.polcmd = 'r'::pg_catalog."char"
        AND policy_catalog.polroles = ARRAY[(SELECT role_oid FROM runtime_role)]::pg_catalog.oid[]
        AND pg_catalog.pg_get_expr(policy_catalog.polqual, policy_catalog.polrelid) = 'true'::pg_catalog.text
        AND policy_catalog.polwithcheck IS NULL
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policy AS policy_catalog
      WHERE policy_catalog.polname = 'circles_identity_provider_links_runtime_insert'::pg_catalog.name
        AND policy_catalog.polrelid = (SELECT oid FROM identity_relation)
        AND policy_catalog.polpermissive
        AND policy_catalog.polcmd = 'a'::pg_catalog."char"
        AND policy_catalog.polroles = ARRAY[(SELECT role_oid FROM runtime_role)]::pg_catalog.oid[]
        AND policy_catalog.polqual IS NULL
        AND pg_catalog.pg_get_expr(policy_catalog.polwithcheck, policy_catalog.polrelid) = 'true'::pg_catalog.text
    )
  ) AS ready
  LIMIT 1
`;

/**
 * Installed receipt contract used by the protected composer preflight. The named
 * baseline UNIQUE remains mandatory even if DB-11 later adds a compatible primary key.
 */
export const POST_PUBLICATION_STATUS_SQL = `
  WITH runtime_role AS (
    SELECT role_catalog.oid AS role_oid
    FROM pg_catalog.pg_roles AS role_catalog
    WHERE role_catalog.rolname = 'circles_app_runtime'::pg_catalog.name
  ), publish_schema AS (
    SELECT namespace_catalog.oid AS namespace_oid
    FROM pg_catalog.pg_namespace AS namespace_catalog
    WHERE namespace_catalog.nspname = 'circles_publish'::pg_catalog.name
  ), receipt_relation AS (
    SELECT relation_catalog.oid, relation_catalog.relowner, relation_catalog.relrowsecurity, relation_catalog.relforcerowsecurity
    FROM pg_catalog.pg_class AS relation_catalog
    JOIN publish_schema ON publish_schema.namespace_oid = relation_catalog.relnamespace
    WHERE relation_catalog.relname = 'postPublishReceipts'::pg_catalog.name
      AND relation_catalog.relkind = 'r'::pg_catalog."char"
  )
  SELECT (
    current_user = 'circles_app_runtime'::pg_catalog.name
    AND (SELECT pg_catalog.count(*) FROM runtime_role) = 1
    AND (SELECT pg_catalog.count(*) FROM publish_schema) = 1
    AND (SELECT pg_catalog.count(*) FROM receipt_relation) = 1
    AND (SELECT relrowsecurity AND relforcerowsecurity FROM receipt_relation)
    AND pg_catalog.has_schema_privilege(current_user, (SELECT namespace_oid FROM publish_schema), 'USAGE')
    AND pg_catalog.has_table_privilege(current_user, (SELECT oid FROM receipt_relation), 'SELECT')
    AND pg_catalog.has_table_privilege(current_user, (SELECT oid FROM receipt_relation), 'INSERT')
    AND pg_catalog.has_table_privilege(current_user, (SELECT oid FROM receipt_relation), 'UPDATE')
    AND NOT pg_catalog.has_table_privilege(current_user, (SELECT oid FROM receipt_relation), 'DELETE')
    AND NOT pg_catalog.has_table_privilege(current_user, (SELECT oid FROM receipt_relation), 'TRUNCATE')
    AND NOT EXISTS (
      WITH expected_columns(column_name, data_type, not_null) AS (
        VALUES
          ('actorId'::pg_catalog.name, 'integer'::pg_catalog.text, true),
          ('operationId'::pg_catalog.name, 'character varying(96)'::pg_catalog.text, true),
          ('payloadHash'::pg_catalog.name, 'character varying(64)'::pg_catalog.text, true),
          ('postId'::pg_catalog.name, 'integer'::pg_catalog.text, false),
          ('createdAt'::pg_catalog.name, 'timestamp with time zone'::pg_catalog.text, true)
      )
      SELECT 1
      FROM expected_columns
      LEFT JOIN pg_catalog.pg_attribute AS attribute_catalog
        ON attribute_catalog.attrelid = (SELECT oid FROM receipt_relation)
       AND attribute_catalog.attname = expected_columns.column_name
       AND attribute_catalog.attnum > 0
       AND NOT attribute_catalog.attisdropped
      WHERE attribute_catalog.attnum IS NULL
        OR attribute_catalog.attnotnull IS DISTINCT FROM expected_columns.not_null
        OR pg_catalog.format_type(attribute_catalog.atttypid, attribute_catalog.atttypmod) <> expected_columns.data_type
    )
    AND (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attribute AS attribute_catalog
      WHERE attribute_catalog.attrelid = (SELECT oid FROM receipt_relation)
        AND attribute_catalog.attnum > 0
        AND NOT attribute_catalog.attisdropped
    ) = 5
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_catalog
      JOIN pg_catalog.pg_index AS index_catalog
        ON index_catalog.indexrelid = constraint_catalog.conindid
      WHERE constraint_catalog.conname = 'post_publish_receipts_actor_operation_unique'::pg_catalog.name
        AND constraint_catalog.conrelid = (SELECT oid FROM receipt_relation)
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
      WHERE constraint_catalog.conrelid = (SELECT oid FROM receipt_relation)
        AND constraint_catalog.contype IN ('p'::pg_catalog."char", 'u'::pg_catalog."char")
        AND constraint_catalog.convalidated
        AND constraint_catalog.conkey::pg_catalog.int2[] = ARRAY[1, 2]::pg_catalog.int2[]
        AND index_catalog.indisunique
        AND index_catalog.indisvalid
        AND index_catalog.indisready
        AND index_catalog.indislive
        AND index_catalog.indpred IS NULL
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_catalog
      WHERE constraint_catalog.conname = 'postPublishReceipts_actorId_fkey'::pg_catalog.name
        AND constraint_catalog.conrelid = (SELECT oid FROM receipt_relation)
        AND constraint_catalog.contype = 'f'::pg_catalog."char"
        AND constraint_catalog.convalidated
        AND constraint_catalog.conkey::pg_catalog.int2[] = ARRAY[1]::pg_catalog.int2[]
        AND constraint_catalog.confrelid = pg_catalog.to_regclass('circles_app.users')
        AND constraint_catalog.confdeltype = 'c'::pg_catalog."char"
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_catalog
      WHERE constraint_catalog.conname = 'postPublishReceipts_postId_fkey'::pg_catalog.name
        AND constraint_catalog.conrelid = (SELECT oid FROM receipt_relation)
        AND constraint_catalog.contype = 'f'::pg_catalog."char"
        AND constraint_catalog.convalidated
        AND constraint_catalog.conkey::pg_catalog.int2[] = ARRAY[4]::pg_catalog.int2[]
        AND constraint_catalog.confrelid = pg_catalog.to_regclass('circles_app.posts')
        AND constraint_catalog.confdeltype = 'n'::pg_catalog."char"
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_catalog
      WHERE constraint_catalog.conname = 'post_publish_receipts_operation_id_check'::pg_catalog.name
        AND constraint_catalog.conrelid = (SELECT oid FROM receipt_relation)
        AND constraint_catalog.contype = 'c'::pg_catalog."char"
        AND constraint_catalog.convalidated
        AND pg_catalog.strpos(pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true), '{15,95}'::pg_catalog.text) > 0
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_catalog
      WHERE constraint_catalog.conname = 'post_publish_receipts_payload_hash_check'::pg_catalog.name
        AND constraint_catalog.conrelid = (SELECT oid FROM receipt_relation)
        AND constraint_catalog.contype = 'c'::pg_catalog."char"
        AND constraint_catalog.convalidated
        AND pg_catalog.strpos(pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true), '[0-9a-f]{64}'::pg_catalog.text) > 0
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policy AS policy_catalog
      WHERE policy_catalog.polname = 'post_publish_receipts_runtime_select'::pg_catalog.name
        AND policy_catalog.polrelid = (SELECT oid FROM receipt_relation)
        AND policy_catalog.polpermissive
        AND policy_catalog.polcmd = 'r'::pg_catalog."char"
        AND policy_catalog.polroles = ARRAY[(SELECT role_oid FROM runtime_role)]::pg_catalog.oid[]
        AND pg_catalog.pg_get_expr(policy_catalog.polqual, policy_catalog.polrelid) = 'true'::pg_catalog.text
        AND policy_catalog.polwithcheck IS NULL
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policy AS policy_catalog
      WHERE policy_catalog.polname = 'post_publish_receipts_runtime_insert'::pg_catalog.name
        AND policy_catalog.polrelid = (SELECT oid FROM receipt_relation)
        AND policy_catalog.polpermissive
        AND policy_catalog.polcmd = 'a'::pg_catalog."char"
        AND policy_catalog.polroles = ARRAY[(SELECT role_oid FROM runtime_role)]::pg_catalog.oid[]
        AND policy_catalog.polqual IS NULL
        AND pg_catalog.pg_get_expr(policy_catalog.polwithcheck, policy_catalog.polrelid) = 'true'::pg_catalog.text
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policy AS policy_catalog
      WHERE policy_catalog.polname = 'post_publish_receipts_runtime_update'::pg_catalog.name
        AND policy_catalog.polrelid = (SELECT oid FROM receipt_relation)
        AND policy_catalog.polpermissive
        AND policy_catalog.polcmd = 'w'::pg_catalog."char"
        AND policy_catalog.polroles = ARRAY[(SELECT role_oid FROM runtime_role)]::pg_catalog.oid[]
        AND pg_catalog.pg_get_expr(policy_catalog.polqual, policy_catalog.polrelid) = 'true'::pg_catalog.text
        AND pg_catalog.pg_get_expr(policy_catalog.polwithcheck, policy_catalog.polrelid) = 'true'::pg_catalog.text
    )
  ) AS ready
  LIMIT 1
`;

export function postPublicationStatusFromEvidence(
  evidence: PostPublicationContractEvidence | null,
): PostPublicationStatus {
  return { ready: evidence?.ready === true };
}

export type PostPublicationStatusDependencies = {
  getDatabase?: typeof getDb;
  databaseDeadlineMs?: number;
};

/**
 * Safe parent integration target for server/social-service.ts. It retains the
 * composer-facing { ready } shape and does not invoke any social mutation.
 */
export async function getPostPublicationStatus(
  dependencies: PostPublicationStatusDependencies = {},
): Promise<PostPublicationStatus> {
  try {
    const database = await withOperationDeadline(
      (dependencies.getDatabase ?? getDb)(),
      dependencies.databaseDeadlineMs ?? 5_000,
    );
    if (!database) return { ready: false };
    const result = await withOperationDeadline(
      database.$client.query<PostPublicationContractEvidence>(
        POST_PUBLICATION_STATUS_SQL,
      ),
      dependencies.databaseDeadlineMs ?? 5_000,
    );
    return postPublicationStatusFromEvidence(result.rows[0] ?? null);
  } catch {
    // The composer must fail closed without surfacing catalog or driver details.
    return { ready: false };
  }
}
