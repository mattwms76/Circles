-- Staged additive fallback for the existing private operations routine only.
-- Parent release owner: apply once through the approved transactional Supabase
-- migration transport after the existing circles_ops function is present.
-- It creates no schema/table/policy/job, changes no app data, and does not alter
-- global/provider grants. It deliberately does not recreate Cron job 7.
BEGIN;

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('circles_ops.run_daily_migration_health.history-fallback.v1', 0)
);

CREATE OR REPLACE FUNCTION circles_ops.run_daily_migration_health()
RETURNS TABLE (
  run_id bigint,
  ran_at timestamptz,
  healthy boolean,
  error_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_expected_tables pg_catalog.name[] := ARRAY[
    'users'::pg_catalog.name,
    'profiles'::pg_catalog.name,
    'circles'::pg_catalog.name,
    'memberships'::pg_catalog.name,
    'posts'::pg_catalog.name,
    'reactions'::pg_catalog.name,
    'bookmarks'::pg_catalog.name,
    'comments'::pg_catalog.name,
    'conversations'::pg_catalog.name,
    'conversationParticipants'::pg_catalog.name,
    'messages'::pg_catalog.name,
    'follows'::pg_catalog.name,
    'reports'::pg_catalog.name,
    'socialUploads'::pg_catalog.name,
    'socialSeedMarkers'::pg_catalog.name,
    '_dataMigrations'::pg_catalog.name,
    'applicationSessions'::pg_catalog.name,
    'streams'::pg_catalog.name,
    'activeHostLeases'::pg_catalog.name,
    'liveViewers'::pg_catalog.name,
    'liveSignals'::pg_catalog.name,
    'liveChat'::pg_catalog.name
  ];
  v_runtime_dml_tables pg_catalog.name[] := ARRAY[
    'users'::pg_catalog.name,
    'profiles'::pg_catalog.name,
    'circles'::pg_catalog.name,
    'memberships'::pg_catalog.name,
    'posts'::pg_catalog.name,
    'reactions'::pg_catalog.name,
    'bookmarks'::pg_catalog.name,
    'comments'::pg_catalog.name,
    'conversations'::pg_catalog.name,
    'conversationParticipants'::pg_catalog.name,
    'messages'::pg_catalog.name,
    'follows'::pg_catalog.name,
    'reports'::pg_catalog.name,
    'socialUploads'::pg_catalog.name,
    'socialSeedMarkers'::pg_catalog.name,
    'applicationSessions'::pg_catalog.name,
    'streams'::pg_catalog.name,
    'activeHostLeases'::pg_catalog.name,
    'liveViewers'::pg_catalog.name,
    'liveSignals'::pg_catalog.name,
    'liveChat'::pg_catalog.name
  ];
  v_identity_tables pg_catalog.name[] := ARRAY[
    'users'::pg_catalog.name,
    'profiles'::pg_catalog.name,
    'circles'::pg_catalog.name,
    'memberships'::pg_catalog.name,
    'posts'::pg_catalog.name,
    'reactions'::pg_catalog.name,
    'bookmarks'::pg_catalog.name,
    'comments'::pg_catalog.name,
    'conversations'::pg_catalog.name,
    'conversationParticipants'::pg_catalog.name,
    'messages'::pg_catalog.name,
    'follows'::pg_catalog.name,
    'reports'::pg_catalog.name,
    'socialUploads'::pg_catalog.name,
    'streams'::pg_catalog.name,
    'liveSignals'::pg_catalog.name,
    'liveChat'::pg_catalog.name
  ];
  v_api_roles pg_catalog.name[] := ARRAY[
    'anon'::pg_catalog.name,
    'authenticated'::pg_catalog.name,
    'service_role'::pg_catalog.name
  ];
  v_runtime_role_oid pg_catalog.oid;
  v_postgres_role_oid pg_catalog.oid;
  v_app_namespace_oid pg_catalog.oid;
  v_ops_namespace_oid pg_catalog.oid;
  v_session_table_oid pg_catalog.oid;
  v_run_at timestamptz := pg_catalog.clock_timestamp();
  v_observed_table_count integer := 0;
  v_observed_sequence_count integer := 0;
  v_shape_ok boolean := false;
  v_rls_ok boolean := false;
  v_runtime_role_ok boolean := false;
  v_app_schema_usage_ok boolean := false;
  v_table_privileges_ok boolean := false;
  v_sequence_privileges_ok boolean := false;
  v_identity_sequences_ok boolean := false;
  v_policies_ok boolean := false;
  v_marker_ok boolean := false;
  v_session_indexes_ok boolean := false;
  v_ops_boundary_ok boolean := false;
  v_healthy boolean := false;
  v_checks jsonb;
  v_run_id bigint;
BEGIN
  SELECT role_catalog.oid
    INTO v_runtime_role_oid
    FROM pg_catalog.pg_roles AS role_catalog
   WHERE role_catalog.rolname = 'circles_app_runtime'::pg_catalog.name;

  SELECT role_catalog.oid
    INTO v_postgres_role_oid
    FROM pg_catalog.pg_roles AS role_catalog
   WHERE role_catalog.rolname = 'postgres'::pg_catalog.name;

  SELECT namespace_catalog.oid
    INTO v_app_namespace_oid
    FROM pg_catalog.pg_namespace AS namespace_catalog
   WHERE namespace_catalog.nspname = 'circles_app'::pg_catalog.name;

  SELECT namespace_catalog.oid
    INTO v_ops_namespace_oid
    FROM pg_catalog.pg_namespace AS namespace_catalog
   WHERE namespace_catalog.nspname = 'circles_ops'::pg_catalog.name;

  SELECT pg_catalog.count(*)::integer
    INTO v_observed_table_count
    FROM pg_catalog.pg_class AS relation_catalog
   WHERE relation_catalog.relnamespace = v_app_namespace_oid
     AND relation_catalog.relkind IN ('r'::pg_catalog."char", 'p'::pg_catalog."char");

  SELECT pg_catalog.count(*)::integer
    INTO v_observed_sequence_count
    FROM pg_catalog.pg_class AS relation_catalog
   WHERE relation_catalog.relnamespace = v_app_namespace_oid
     AND relation_catalog.relkind = 'S'::pg_catalog."char";

  -- Exact table names and ordered column names from the reviewed 0000_circles_app.sql.
  -- This is catalog-only; it does not count or return application rows.
  WITH expected_shape(table_name, expected_columns) AS (
    VALUES
      ('users'::pg_catalog.name, ARRAY['id'::pg_catalog.name, 'openId'::pg_catalog.name, 'name'::pg_catalog.name, 'email'::pg_catalog.name, 'loginMethod'::pg_catalog.name, 'role'::pg_catalog.name, 'createdAt'::pg_catalog.name, 'updatedAt'::pg_catalog.name, 'lastSignedIn'::pg_catalog.name]),
      ('profiles'::pg_catalog.name, ARRAY['id'::pg_catalog.name, 'userId'::pg_catalog.name, 'name'::pg_catalog.name, 'handle'::pg_catalog.name, 'bio'::pg_catalog.name, 'avatar'::pg_catalog.name, 'cover'::pg_catalog.name, 'createdAt'::pg_catalog.name, 'updatedAt'::pg_catalog.name]),
      ('circles'::pg_catalog.name, ARRAY['id'::pg_catalog.name, 'ownerId'::pg_catalog.name, 'name'::pg_catalog.name, 'description'::pg_catalog.name, 'category'::pg_catalog.name, 'privacy'::pg_catalog.name, 'image'::pg_catalog.name, 'color'::pg_catalog.name, 'createdAt'::pg_catalog.name, 'updatedAt'::pg_catalog.name]),
      ('memberships'::pg_catalog.name, ARRAY['id'::pg_catalog.name, 'circleId'::pg_catalog.name, 'userId'::pg_catalog.name, 'role'::pg_catalog.name, 'createdAt'::pg_catalog.name, 'updatedAt'::pg_catalog.name]),
      ('posts'::pg_catalog.name, ARRAY['id'::pg_catalog.name, 'authorId'::pg_catalog.name, 'circleId'::pg_catalog.name, 'text'::pg_catalog.name, 'media'::pg_catalog.name, 'mediaType'::pg_catalog.name, 'createdAt'::pg_catalog.name, 'updatedAt'::pg_catalog.name]),
      ('reactions'::pg_catalog.name, ARRAY['id'::pg_catalog.name, 'postId'::pg_catalog.name, 'userId'::pg_catalog.name, 'type'::pg_catalog.name, 'createdAt'::pg_catalog.name]),
      ('bookmarks'::pg_catalog.name, ARRAY['id'::pg_catalog.name, 'postId'::pg_catalog.name, 'userId'::pg_catalog.name, 'createdAt'::pg_catalog.name]),
      ('comments'::pg_catalog.name, ARRAY['id'::pg_catalog.name, 'postId'::pg_catalog.name, 'authorId'::pg_catalog.name, 'text'::pg_catalog.name, 'createdAt'::pg_catalog.name, 'updatedAt'::pg_catalog.name]),
      ('conversations'::pg_catalog.name, ARRAY['id'::pg_catalog.name, 'kind'::pg_catalog.name, 'directKey'::pg_catalog.name, 'circleId'::pg_catalog.name, 'createdAt'::pg_catalog.name, 'updatedAt'::pg_catalog.name]),
      ('conversationParticipants'::pg_catalog.name, ARRAY['id'::pg_catalog.name, 'conversationId'::pg_catalog.name, 'userId'::pg_catalog.name, 'lastReadMessageId'::pg_catalog.name, 'lastReadAt'::pg_catalog.name, 'createdAt'::pg_catalog.name, 'updatedAt'::pg_catalog.name]),
      ('messages'::pg_catalog.name, ARRAY['id'::pg_catalog.name, 'conversationId'::pg_catalog.name, 'authorId'::pg_catalog.name, 'text'::pg_catalog.name, 'media'::pg_catalog.name, 'createdAt'::pg_catalog.name, 'clientMessageId'::pg_catalog.name]),
      ('follows'::pg_catalog.name, ARRAY['id'::pg_catalog.name, 'followerId'::pg_catalog.name, 'followingId'::pg_catalog.name, 'createdAt'::pg_catalog.name]),
      ('reports'::pg_catalog.name, ARRAY['id'::pg_catalog.name, 'postId'::pg_catalog.name, 'reporterId'::pg_catalog.name, 'reason'::pg_catalog.name, 'createdAt'::pg_catalog.name, 'updatedAt'::pg_catalog.name]),
      ('socialUploads'::pg_catalog.name, ARRAY['id'::pg_catalog.name, 'userId'::pg_catalog.name, 'storageKey'::pg_catalog.name, 'url'::pg_catalog.name, 'mimeType'::pg_catalog.name, 'bytes'::pg_catalog.name, 'createdAt'::pg_catalog.name, 'claimedAt'::pg_catalog.name]),
      ('socialSeedMarkers'::pg_catalog.name, ARRAY['key'::pg_catalog.name, 'completedAt'::pg_catalog.name]),
      ('_dataMigrations'::pg_catalog.name, ARRAY['key'::pg_catalog.name, 'sourceTree'::pg_catalog.name, 'completedAt'::pg_catalog.name, 'summary'::pg_catalog.name]),
      ('applicationSessions'::pg_catalog.name, ARRAY['sessionFingerprint'::pg_catalog.name, 'userOpenId'::pg_catalog.name, 'appId'::pg_catalog.name, 'expiresAt'::pg_catalog.name, 'revokedAt'::pg_catalog.name, 'createdAt'::pg_catalog.name]),
      ('streams'::pg_catalog.name, ARRAY['id'::pg_catalog.name, 'hostId'::pg_catalog.name, 'title'::pg_catalog.name, 'circleId'::pg_catalog.name, 'thumbnail'::pg_catalog.name, 'status'::pg_catalog.name, 'readyAt'::pg_catalog.name, 'lastHeartbeatAt'::pg_catalog.name, 'hostGeneration'::pg_catalog.name, 'createdAt'::pg_catalog.name, 'endedAt'::pg_catalog.name]),
      ('activeHostLeases'::pg_catalog.name, ARRAY['hostId'::pg_catalog.name, 'streamId'::pg_catalog.name, 'lastHeartbeatAt'::pg_catalog.name]),
      ('liveViewers'::pg_catalog.name, ARRAY['streamId'::pg_catalog.name, 'userId'::pg_catalog.name, 'joinedAt'::pg_catalog.name, 'lastSeenAt'::pg_catalog.name, 'generation'::pg_catalog.name, 'leftAt'::pg_catalog.name]),
      ('liveSignals'::pg_catalog.name, ARRAY['id'::pg_catalog.name, 'streamId'::pg_catalog.name, 'fromId'::pg_catalog.name, 'toId'::pg_catalog.name, 'kind'::pg_catalog.name, 'fromGeneration'::pg_catalog.name, 'toGeneration'::pg_catalog.name, 'payload'::pg_catalog.name, 'createdAt'::pg_catalog.name]),
      ('liveChat'::pg_catalog.name, ARRAY['id'::pg_catalog.name, 'streamId'::pg_catalog.name, 'userId'::pg_catalog.name, 'userName'::pg_catalog.name, 'avatar'::pg_catalog.name, 'text'::pg_catalog.name, 'createdAt'::pg_catalog.name])
  ), observed_shape AS (
    SELECT
      expected_shape.table_name,
      relation_catalog.oid AS relation_oid,
      pg_catalog.array_agg(attribute_catalog.attname ORDER BY attribute_catalog.attnum) AS observed_columns
    FROM expected_shape
    LEFT JOIN pg_catalog.pg_class AS relation_catalog
      ON relation_catalog.relnamespace = v_app_namespace_oid
     AND relation_catalog.relname = expected_shape.table_name
     AND relation_catalog.relkind IN ('r'::pg_catalog."char", 'p'::pg_catalog."char")
    LEFT JOIN pg_catalog.pg_attribute AS attribute_catalog
      ON attribute_catalog.attrelid = relation_catalog.oid
     AND attribute_catalog.attnum > 0
     AND NOT attribute_catalog.attisdropped
    GROUP BY expected_shape.table_name, relation_catalog.oid
  )
  SELECT
    pg_catalog.count(observed_shape.relation_oid) = pg_catalog.cardinality(v_expected_tables)
    AND pg_catalog.bool_and(observed_shape.observed_columns = expected_shape.expected_columns)
    AND v_observed_table_count = pg_catalog.cardinality(v_expected_tables)
    INTO v_shape_ok
    FROM expected_shape
    JOIN observed_shape
      ON observed_shape.table_name = expected_shape.table_name;

  SELECT
    pg_catalog.count(*) = pg_catalog.cardinality(v_expected_tables)
    AND pg_catalog.bool_and(relation_catalog.relrowsecurity)
    INTO v_rls_ok
    FROM pg_catalog.pg_class AS relation_catalog
   WHERE relation_catalog.relnamespace = v_app_namespace_oid
     AND relation_catalog.relkind IN ('r'::pg_catalog."char", 'p'::pg_catalog."char")
     AND relation_catalog.relname = ANY (v_expected_tables);

  SELECT COALESCE(
    (
      SELECT
        NOT role_catalog.rolcanlogin
        AND NOT role_catalog.rolsuper
        AND NOT role_catalog.rolinherit
        AND NOT role_catalog.rolbypassrls
      FROM pg_catalog.pg_roles AS role_catalog
      WHERE role_catalog.oid = v_runtime_role_oid
    ),
    false
  )
  INTO v_runtime_role_ok;

  WITH api_roles AS (
    SELECT role_catalog.oid
    FROM pg_catalog.pg_roles AS role_catalog
    WHERE role_catalog.rolname = ANY (v_api_roles)
  )
  SELECT
    v_app_namespace_oid IS NOT NULL
    AND v_runtime_role_oid IS NOT NULL
    AND pg_catalog.count(*) = pg_catalog.cardinality(v_api_roles)
    AND pg_catalog.has_schema_privilege(v_runtime_role_oid, v_app_namespace_oid, 'USAGE'::pg_catalog.text)
    AND NOT pg_catalog.bool_or(pg_catalog.has_schema_privilege(api_roles.oid, v_app_namespace_oid, 'USAGE'::pg_catalog.text))
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_namespace AS namespace_catalog
      CROSS JOIN LATERAL pg_catalog.aclexplode(namespace_catalog.nspacl) AS acl_entry
      WHERE namespace_catalog.oid = v_app_namespace_oid
        AND acl_entry.grantee = 0
        AND acl_entry.privilege_type = 'USAGE'::pg_catalog.text
    )
    INTO v_app_schema_usage_ok
    FROM api_roles;

  WITH app_relations AS (
    SELECT relation_catalog.oid, relation_catalog.relname, relation_catalog.relacl
    FROM pg_catalog.pg_class AS relation_catalog
    WHERE relation_catalog.relnamespace = v_app_namespace_oid
      AND relation_catalog.relkind IN ('r'::pg_catalog."char", 'p'::pg_catalog."char")
      AND relation_catalog.relname = ANY (v_expected_tables)
  ), api_roles AS (
    SELECT role_catalog.oid
    FROM pg_catalog.pg_roles AS role_catalog
    WHERE role_catalog.rolname = ANY (v_api_roles)
  )
  SELECT
    v_runtime_role_oid IS NOT NULL
    AND (SELECT pg_catalog.count(*) FROM app_relations) = pg_catalog.cardinality(v_expected_tables)
    AND (SELECT pg_catalog.count(*) FROM api_roles) = pg_catalog.cardinality(v_api_roles)
    AND NOT EXISTS (
      SELECT 1
      FROM app_relations
      CROSS JOIN api_roles
      WHERE pg_catalog.has_table_privilege(api_roles.oid, app_relations.oid, 'SELECT'::pg_catalog.text)
         OR pg_catalog.has_table_privilege(api_roles.oid, app_relations.oid, 'INSERT'::pg_catalog.text)
         OR pg_catalog.has_table_privilege(api_roles.oid, app_relations.oid, 'UPDATE'::pg_catalog.text)
         OR pg_catalog.has_table_privilege(api_roles.oid, app_relations.oid, 'DELETE'::pg_catalog.text)
         OR pg_catalog.has_table_privilege(api_roles.oid, app_relations.oid, 'TRUNCATE'::pg_catalog.text)
         OR pg_catalog.has_table_privilege(api_roles.oid, app_relations.oid, 'REFERENCES'::pg_catalog.text)
         OR pg_catalog.has_table_privilege(api_roles.oid, app_relations.oid, 'TRIGGER'::pg_catalog.text)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM app_relations
      CROSS JOIN LATERAL pg_catalog.aclexplode(app_relations.relacl) AS acl_entry
      WHERE acl_entry.grantee = 0
    )
    AND NOT EXISTS (
      SELECT 1
      FROM app_relations
      WHERE app_relations.relname = ANY (v_runtime_dml_tables)
        AND (
          NOT pg_catalog.has_table_privilege(v_runtime_role_oid, app_relations.oid, 'SELECT'::pg_catalog.text)
          OR NOT pg_catalog.has_table_privilege(v_runtime_role_oid, app_relations.oid, 'INSERT'::pg_catalog.text)
          OR NOT pg_catalog.has_table_privilege(v_runtime_role_oid, app_relations.oid, 'UPDATE'::pg_catalog.text)
          OR NOT pg_catalog.has_table_privilege(v_runtime_role_oid, app_relations.oid, 'DELETE'::pg_catalog.text)
          OR pg_catalog.has_table_privilege(v_runtime_role_oid, app_relations.oid, 'TRUNCATE'::pg_catalog.text)
          OR pg_catalog.has_table_privilege(v_runtime_role_oid, app_relations.oid, 'REFERENCES'::pg_catalog.text)
          OR pg_catalog.has_table_privilege(v_runtime_role_oid, app_relations.oid, 'TRIGGER'::pg_catalog.text)
        )
    )
    AND EXISTS (
      SELECT 1
      FROM app_relations
      WHERE app_relations.relname = '_dataMigrations'::pg_catalog.name
        AND pg_catalog.has_table_privilege(v_runtime_role_oid, app_relations.oid, 'SELECT'::pg_catalog.text)
        AND NOT pg_catalog.has_table_privilege(v_runtime_role_oid, app_relations.oid, 'INSERT'::pg_catalog.text)
        AND NOT pg_catalog.has_table_privilege(v_runtime_role_oid, app_relations.oid, 'UPDATE'::pg_catalog.text)
        AND NOT pg_catalog.has_table_privilege(v_runtime_role_oid, app_relations.oid, 'DELETE'::pg_catalog.text)
        AND NOT pg_catalog.has_table_privilege(v_runtime_role_oid, app_relations.oid, 'TRUNCATE'::pg_catalog.text)
        AND NOT pg_catalog.has_table_privilege(v_runtime_role_oid, app_relations.oid, 'REFERENCES'::pg_catalog.text)
        AND NOT pg_catalog.has_table_privilege(v_runtime_role_oid, app_relations.oid, 'TRIGGER'::pg_catalog.text)
    )
    INTO v_table_privileges_ok;

  WITH app_sequences AS (
    SELECT relation_catalog.oid, relation_catalog.relacl
    FROM pg_catalog.pg_class AS relation_catalog
    WHERE relation_catalog.relnamespace = v_app_namespace_oid
      AND relation_catalog.relkind = 'S'::pg_catalog."char"
  ), api_roles AS (
    SELECT role_catalog.oid
    FROM pg_catalog.pg_roles AS role_catalog
    WHERE role_catalog.rolname = ANY (v_api_roles)
  )
  SELECT
    v_runtime_role_oid IS NOT NULL
    AND (SELECT pg_catalog.count(*) FROM app_sequences) = pg_catalog.cardinality(v_identity_tables)
    AND (SELECT pg_catalog.count(*) FROM api_roles) = pg_catalog.cardinality(v_api_roles)
    AND NOT EXISTS (
      SELECT 1
      FROM app_sequences
      WHERE NOT pg_catalog.has_sequence_privilege(v_runtime_role_oid, app_sequences.oid, 'USAGE'::pg_catalog.text)
         OR NOT pg_catalog.has_sequence_privilege(v_runtime_role_oid, app_sequences.oid, 'SELECT'::pg_catalog.text)
         OR pg_catalog.has_sequence_privilege(v_runtime_role_oid, app_sequences.oid, 'UPDATE'::pg_catalog.text)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM app_sequences
      CROSS JOIN api_roles
      WHERE pg_catalog.has_sequence_privilege(api_roles.oid, app_sequences.oid, 'USAGE'::pg_catalog.text)
         OR pg_catalog.has_sequence_privilege(api_roles.oid, app_sequences.oid, 'SELECT'::pg_catalog.text)
         OR pg_catalog.has_sequence_privilege(api_roles.oid, app_sequences.oid, 'UPDATE'::pg_catalog.text)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM app_sequences
      CROSS JOIN LATERAL pg_catalog.aclexplode(app_sequences.relacl) AS acl_entry
      WHERE acl_entry.grantee = 0
    )
    INTO v_sequence_privileges_ok;

  SELECT
    pg_catalog.count(*) = pg_catalog.cardinality(v_identity_tables)
    AND pg_catalog.bool_and(
      pg_catalog.pg_get_serial_sequence(
        pg_catalog.format('%I.%I'::pg_catalog.text, 'circles_app'::pg_catalog.text, identity_table.table_name),
        'id'::pg_catalog.text
      ) IS NOT NULL
    )
    INTO v_identity_sequences_ok
    FROM pg_catalog.unnest(v_identity_tables) AS identity_table(table_name);

  WITH app_relations AS (
    SELECT relation_catalog.oid, relation_catalog.relname
    FROM pg_catalog.pg_class AS relation_catalog
    WHERE relation_catalog.relnamespace = v_app_namespace_oid
      AND relation_catalog.relkind IN ('r'::pg_catalog."char", 'p'::pg_catalog."char")
      AND relation_catalog.relname = ANY (v_expected_tables)
  )
  SELECT
    v_runtime_role_oid IS NOT NULL
    AND (SELECT pg_catalog.count(*) FROM app_relations) = pg_catalog.cardinality(v_expected_tables)
    AND NOT EXISTS (
      SELECT 1
      FROM app_relations
      LEFT JOIN pg_catalog.pg_policy AS policy_catalog
        ON policy_catalog.polrelid = app_relations.oid
      GROUP BY app_relations.oid, app_relations.relname
      HAVING pg_catalog.count(policy_catalog.oid) <> 1
         OR NOT pg_catalog.bool_and(
           policy_catalog.polroles = ARRAY[v_runtime_role_oid]::pg_catalog.oid[]
           AND (
             (
               app_relations.relname = '_dataMigrations'::pg_catalog.name
               AND policy_catalog.polcmd = 'r'::pg_catalog."char"
               AND policy_catalog.polqual IS NOT NULL
               AND pg_catalog.pg_get_expr(policy_catalog.polqual, policy_catalog.polrelid) = 'true'::pg_catalog.text
             )
             OR (
               app_relations.relname <> '_dataMigrations'::pg_catalog.name
               AND policy_catalog.polcmd = '*'::pg_catalog."char"
               AND policy_catalog.polqual IS NOT NULL
               AND policy_catalog.polwithcheck IS NOT NULL
               AND pg_catalog.pg_get_expr(policy_catalog.polqual, policy_catalog.polrelid) = 'true'::pg_catalog.text
               AND pg_catalog.pg_get_expr(policy_catalog.polwithcheck, policy_catalog.polrelid) = 'true'::pg_catalog.text
             )
           )
         )
    )
    INTO v_policies_ok;

  -- Read a fixed marker predicate only. The key and sourceTree are never selected,
  -- returned, logged, or stored in health history.
  SELECT EXISTS (
    SELECT 1
    FROM circles_app."_dataMigrations" AS migration_marker
    WHERE migration_marker.key = 'circles-mysql-to-supabase-v1'::pg_catalog.text
      AND migration_marker."sourceTree" = 'manifest-sha256:1196b25e66280952d905d860e3488fa82af9d082983c5315f28ead30b35172a7'::pg_catalog.text
    LIMIT 1
  )
  INTO v_marker_ok;

  SELECT relation_catalog.oid
    INTO v_session_table_oid
    FROM pg_catalog.pg_class AS relation_catalog
   WHERE relation_catalog.relnamespace = v_app_namespace_oid
     AND relation_catalog.relname = 'applicationSessions'::pg_catalog.name
     AND relation_catalog.relkind IN ('r'::pg_catalog."char", 'p'::pg_catalog."char");

  SELECT
    v_session_table_oid IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index AS index_catalog
      JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.oid = index_catalog.indexrelid
      WHERE index_catalog.indrelid = v_session_table_oid
        AND index_relation.relname = 'applicationSessions_pkey'::pg_catalog.name
        AND index_catalog.indisprimary
        AND index_catalog.indisunique
        AND index_catalog.indisvalid
        AND index_catalog.indisready
        AND index_catalog.indislive
        AND index_catalog.indnkeyatts = 1
        AND index_catalog.indnatts = 1
        AND index_catalog.indexprs IS NULL
        AND index_catalog.indpred IS NULL
        AND pg_catalog.pg_get_indexdef(index_catalog.indexrelid, 1, true) = '"sessionFingerprint"'::pg_catalog.text
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index AS index_catalog
      JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.oid = index_catalog.indexrelid
      WHERE index_catalog.indrelid = v_session_table_oid
        AND index_relation.relname = 'application_sessions_user_app_idx'::pg_catalog.name
        AND NOT index_catalog.indisunique
        AND index_catalog.indisvalid
        AND index_catalog.indisready
        AND index_catalog.indislive
        AND index_catalog.indnkeyatts = 2
        AND index_catalog.indnatts = 2
        AND index_catalog.indexprs IS NULL
        AND index_catalog.indpred IS NULL
        AND pg_catalog.pg_get_indexdef(index_catalog.indexrelid, 1, true) = '"userOpenId"'::pg_catalog.text
        AND pg_catalog.pg_get_indexdef(index_catalog.indexrelid, 2, true) = '"appId"'::pg_catalog.text
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index AS index_catalog
      JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.oid = index_catalog.indexrelid
      WHERE index_catalog.indrelid = v_session_table_oid
        AND index_relation.relname = 'application_sessions_expiry_idx'::pg_catalog.name
        AND NOT index_catalog.indisunique
        AND index_catalog.indisvalid
        AND index_catalog.indisready
        AND index_catalog.indislive
        AND index_catalog.indnkeyatts = 1
        AND index_catalog.indnatts = 1
        AND index_catalog.indexprs IS NULL
        AND index_catalog.indpred IS NULL
        AND pg_catalog.pg_get_indexdef(index_catalog.indexrelid, 1, true) = '"expiresAt"'::pg_catalog.text
    )
    INTO v_session_indexes_ok;

  -- Verify the new private operations boundary as well as the app boundary.
  WITH denied_roles AS (
    SELECT role_catalog.oid
    FROM pg_catalog.pg_roles AS role_catalog
    WHERE role_catalog.rolname = ANY (v_api_roles || ARRAY['circles_app_runtime'::pg_catalog.name])
  ), health_relation AS (
    SELECT relation_catalog.oid, relation_catalog.relacl, relation_catalog.relrowsecurity
    FROM pg_catalog.pg_class AS relation_catalog
    WHERE relation_catalog.relnamespace = v_ops_namespace_oid
      AND relation_catalog.relname = 'health_runs'::pg_catalog.name
      AND relation_catalog.relkind = 'r'::pg_catalog."char"
  ), health_function AS (
    SELECT procedure_catalog.oid, procedure_catalog.proacl, procedure_catalog.proowner, procedure_catalog.prosecdef, procedure_catalog.proconfig
    FROM pg_catalog.pg_proc AS procedure_catalog
    WHERE procedure_catalog.pronamespace = v_ops_namespace_oid
      AND procedure_catalog.proname = 'run_daily_migration_health'::pg_catalog.name
      AND procedure_catalog.pronargs = 0
  )
  SELECT
    v_ops_namespace_oid IS NOT NULL
    AND v_postgres_role_oid IS NOT NULL
    AND (SELECT pg_catalog.count(*) FROM denied_roles) = pg_catalog.cardinality(v_api_roles) + 1
    AND (SELECT pg_catalog.count(*) FROM health_relation) = 1
    AND (SELECT pg_catalog.count(*) FROM health_function) = 1
    AND (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_policy AS policy_catalog
      JOIN health_relation
        ON policy_catalog.polrelid = health_relation.oid
    ) = 1
    AND (SELECT health_relation.relrowsecurity FROM health_relation)
    AND (SELECT health_function.prosecdef FROM health_function)
    AND (SELECT health_function.proowner = v_postgres_role_oid FROM health_function)
    AND (SELECT health_function.proconfig FROM health_function) = ARRAY['search_path=pg_catalog'::pg_catalog.text]
    AND NOT pg_catalog.bool_or(pg_catalog.has_schema_privilege(denied_roles.oid, v_ops_namespace_oid, 'USAGE'::pg_catalog.text))
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_namespace AS namespace_catalog
      CROSS JOIN LATERAL pg_catalog.aclexplode(namespace_catalog.nspacl) AS acl_entry
      WHERE namespace_catalog.oid = v_ops_namespace_oid
        AND acl_entry.grantee = 0
        AND acl_entry.privilege_type = 'USAGE'::pg_catalog.text
    )
    AND NOT EXISTS (
      SELECT 1
      FROM health_relation
      CROSS JOIN denied_roles
      WHERE pg_catalog.has_table_privilege(denied_roles.oid, health_relation.oid, 'SELECT'::pg_catalog.text)
         OR pg_catalog.has_table_privilege(denied_roles.oid, health_relation.oid, 'INSERT'::pg_catalog.text)
         OR pg_catalog.has_table_privilege(denied_roles.oid, health_relation.oid, 'UPDATE'::pg_catalog.text)
         OR pg_catalog.has_table_privilege(denied_roles.oid, health_relation.oid, 'DELETE'::pg_catalog.text)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM health_relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(health_relation.relacl) AS acl_entry
      WHERE acl_entry.grantee = 0
    )
    AND NOT EXISTS (
      SELECT 1
      FROM health_function
      CROSS JOIN denied_roles
      WHERE pg_catalog.has_function_privilege(denied_roles.oid, health_function.oid, 'EXECUTE'::pg_catalog.text)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM health_function
      CROSS JOIN LATERAL pg_catalog.aclexplode(health_function.proacl) AS acl_entry
      WHERE acl_entry.grantee = 0
        AND acl_entry.privilege_type = 'EXECUTE'::pg_catalog.text
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policy AS policy_catalog
      JOIN health_relation
        ON policy_catalog.polrelid = health_relation.oid
      WHERE policy_catalog.polroles = ARRAY[v_postgres_role_oid]::pg_catalog.oid[]
        AND policy_catalog.polcmd = '*'::pg_catalog."char"
        AND policy_catalog.polqual IS NOT NULL
        AND policy_catalog.polwithcheck IS NOT NULL
    )
    INTO v_ops_boundary_ok
    FROM denied_roles;

  v_healthy := v_shape_ok
    AND v_rls_ok
    AND v_runtime_role_ok
    AND v_app_schema_usage_ok
    AND v_table_privileges_ok
    AND v_sequence_privileges_ok
    AND v_identity_sequences_ok
    AND v_policies_ok
    AND v_marker_ok
    AND v_session_indexes_ok
    AND v_ops_boundary_ok;

  v_checks := pg_catalog.jsonb_build_object(
    'expected_app_table_count', pg_catalog.cardinality(v_expected_tables),
    'observed_app_table_count', v_observed_table_count,
    'expected_identity_sequence_count', pg_catalog.cardinality(v_identity_tables),
    'observed_app_sequence_count', v_observed_sequence_count,
    'required_table_column_shape', v_shape_ok,
    'all_app_rls_enabled', v_rls_ok,
    'runtime_role_hardened', v_runtime_role_ok,
    'app_schema_usage_restricted', v_app_schema_usage_ok,
    'table_privileges_restricted', v_table_privileges_ok,
    'sequence_privileges_restricted', v_sequence_privileges_ok,
    'identity_sequences_valid', v_identity_sequences_ok,
    'backend_policies_restricted', v_policies_ok,
    'import_marker_matches_manifest', v_marker_ok,
    'durable_session_indexes_valid', v_session_indexes_ok,
    'operations_boundary_restricted', v_ops_boundary_ok
  );

  -- Retention applies only to this operational history table. It never deletes app data.
  DELETE FROM circles_ops.health_runs AS expired_run
   WHERE expired_run.ran_at < v_run_at - pg_catalog.make_interval(days => 90);

  INSERT INTO circles_ops.health_runs (ran_at, healthy, error_code, checks)
  VALUES (
    v_run_at,
    v_healthy,
    CASE WHEN v_healthy THEN NULL ELSE 'drift_detected'::pg_catalog.text END,
    v_checks
  )
  RETURNING health_runs.run_id
    INTO v_run_id;

  RETURN QUERY
  SELECT
    v_run_id,
    v_run_at,
    v_healthy,
    CASE WHEN v_healthy THEN NULL ELSE 'drift_detected'::pg_catalog.text END;
EXCEPTION
  -- An outer failure rolls back the health body. Persist the fixed result only
  -- when the existing history boundary remains available; never surface SQL text.
  WHEN invalid_schema_name OR undefined_table OR undefined_object THEN
    BEGIN
      v_checks := pg_catalog.jsonb_build_object('health_check_exception', false);
      INSERT INTO circles_ops.health_runs (ran_at, healthy, error_code, checks)
      VALUES (v_run_at, false, 'missing_catalog_object'::pg_catalog.text, v_checks)
      RETURNING health_runs.run_id INTO v_run_id;
      RETURN QUERY
      SELECT v_run_id, v_run_at, false, 'missing_catalog_object'::pg_catalog.text;
    EXCEPTION
      WHEN invalid_schema_name OR undefined_table OR undefined_object OR insufficient_privilege THEN
        RETURN QUERY
        SELECT NULL::bigint, v_run_at, false, 'health_history_unavailable'::pg_catalog.text;
      WHEN OTHERS THEN
        RETURN QUERY
        SELECT NULL::bigint, v_run_at, false, 'health_history_unavailable'::pg_catalog.text;
    END;
  WHEN insufficient_privilege THEN
    BEGIN
      v_checks := pg_catalog.jsonb_build_object('health_check_exception', false);
      INSERT INTO circles_ops.health_runs (ran_at, healthy, error_code, checks)
      VALUES (v_run_at, false, 'permission_denied'::pg_catalog.text, v_checks)
      RETURNING health_runs.run_id INTO v_run_id;
      RETURN QUERY
      SELECT v_run_id, v_run_at, false, 'permission_denied'::pg_catalog.text;
    EXCEPTION
      WHEN invalid_schema_name OR undefined_table OR undefined_object OR insufficient_privilege THEN
        RETURN QUERY
        SELECT NULL::bigint, v_run_at, false, 'health_history_unavailable'::pg_catalog.text;
      WHEN OTHERS THEN
        RETURN QUERY
        SELECT NULL::bigint, v_run_at, false, 'health_history_unavailable'::pg_catalog.text;
    END;
  WHEN OTHERS THEN
    BEGIN
      v_checks := pg_catalog.jsonb_build_object('health_check_exception', false);
      INSERT INTO circles_ops.health_runs (ran_at, healthy, error_code, checks)
      VALUES (v_run_at, false, 'health_check_exception'::pg_catalog.text, v_checks)
      RETURNING health_runs.run_id INTO v_run_id;
      RETURN QUERY
      SELECT v_run_id, v_run_at, false, 'health_check_exception'::pg_catalog.text;
    EXCEPTION
      WHEN invalid_schema_name OR undefined_table OR undefined_object OR insufficient_privilege THEN
        RETURN QUERY
        SELECT NULL::bigint, v_run_at, false, 'health_history_unavailable'::pg_catalog.text;
      WHEN OTHERS THEN
        RETURN QUERY
        SELECT NULL::bigint, v_run_at, false, 'health_history_unavailable'::pg_catalog.text;
    END;

END;
$function$;

ALTER FUNCTION circles_ops.run_daily_migration_health() OWNER TO postgres;
REVOKE ALL ON FUNCTION circles_ops.run_daily_migration_health() FROM PUBLIC, anon, authenticated, service_role, circles_app_runtime;
GRANT EXECUTE ON FUNCTION circles_ops.run_daily_migration_health() TO postgres;

COMMIT;
