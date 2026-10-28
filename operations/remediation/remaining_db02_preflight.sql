-- DB-02: read-only preflight for the separately approved app-login cutover.
-- Execute only through scripts/remaining-db02-cutover.mjs with a protected
-- operational URI. This file contains no passwords and makes no role, grant,
-- schema, routine, table, policy, or data changes.

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('circles.remaining-db02.app-login.v1', 0)
);

DO $db02_preflight$
DECLARE
  v_login pg_catalog.pg_roles%ROWTYPE;
  v_runtime pg_catalog.pg_roles%ROWTYPE;
  v_private_table_count integer;
BEGIN
  IF pg_catalog.current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'DB-02 expected database postgres';
  END IF;

  SELECT * INTO v_login
  FROM pg_catalog.pg_roles
  WHERE rolname = 'circles_app_login';
  SELECT * INTO v_runtime
  FROM pg_catalog.pg_roles
  WHERE rolname = 'circles_app_runtime';

  IF NOT FOUND OR v_login.oid IS NULL THEN
    RAISE EXCEPTION 'DB-02 dedicated application login is absent';
  END IF;
  IF v_login.rolcanlogin OR v_login.rolinherit OR v_login.rolsuper
     OR v_login.rolcreatedb OR v_login.rolcreaterole
     OR v_login.rolreplication OR v_login.rolbypassrls
     OR v_login.rolconnlimit <> -1 OR v_login.rolconfig IS NOT NULL THEN
    RAISE EXCEPTION 'DB-02 dedicated application login is not in the approved detached state';
  END IF;

  IF v_runtime.oid IS NULL OR v_runtime.rolcanlogin OR v_runtime.rolinherit
     OR v_runtime.rolsuper OR v_runtime.rolcreatedb OR v_runtime.rolcreaterole
     OR v_runtime.rolreplication OR v_runtime.rolbypassrls
     OR v_runtime.rolconnlimit <> -1 OR v_runtime.rolconfig IS NOT NULL THEN
    RAISE EXCEPTION 'DB-02 runtime role flags differ from the approved restricted state';
  END IF;

  -- The approved live state is deliberately detached: it has no outgoing role
  -- membership at all. It retains only the provider-owned incoming postgres
  -- administrator edge. Activation adds the one SET-only runtime edge in its
  -- own transaction; rollback removes it again.
  IF EXISTS (
       SELECT 1
       FROM pg_catalog.pg_auth_members AS membership
       WHERE membership.member = v_login.oid
     ) OR (SELECT count(*)
             FROM pg_catalog.pg_auth_members AS membership
            WHERE membership.roleid = v_login.oid) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_auth_members AS membership
       JOIN pg_catalog.pg_roles AS member_role
         ON member_role.oid = membership.member
       JOIN pg_catalog.pg_roles AS grantor_role
         ON grantor_role.oid = membership.grantor
       WHERE membership.roleid = v_login.oid
         AND member_role.rolname = 'postgres'
         AND grantor_role.rolname = 'supabase_admin'
         AND membership.admin_option = TRUE
         AND membership.inherit_option = FALSE
         AND membership.set_option = FALSE
     ) THEN
    RAISE EXCEPTION 'DB-02 application login is not in the exact approved detached membership state';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members
    WHERE member = v_runtime.oid
  ) THEN
    RAISE EXCEPTION 'DB-02 runtime role has an unreviewed elevation membership';
  END IF;

  IF NOT pg_catalog.has_database_privilege(
    v_login.oid, pg_catalog.current_database(), 'CONNECT'
  ) OR pg_catalog.has_database_privilege(
    v_login.oid, pg_catalog.current_database(), 'CREATE'
  ) THEN
    RAISE EXCEPTION 'DB-02 application-login database privileges are not limited to CONNECT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'circles_admin'::pg_catalog.name,
      'circles_app'::pg_catalog.name,
      'circles_auth'::pg_catalog.name,
      'circles_identity'::pg_catalog.name,
      'circles_ops'::pg_catalog.name,
      'circles_publish'::pg_catalog.name
    ]) AS expected(schema_name)
    WHERE pg_catalog.to_regnamespace(expected.schema_name) IS NULL
       OR pg_catalog.has_schema_privilege(v_login.oid, expected.schema_name, 'USAGE')
       OR pg_catalog.has_schema_privilege(v_login.oid, expected.schema_name, 'CREATE')
  ) THEN
    RAISE EXCEPTION 'DB-02 application login has direct private-schema authority';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace AS namespace_catalog
    CROSS JOIN LATERAL pg_catalog.aclexplode(namespace_catalog.nspacl) AS acl
    WHERE acl.grantee = v_login.oid
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS class_catalog
    CROSS JOIN LATERAL pg_catalog.aclexplode(class_catalog.relacl) AS acl
    WHERE acl.grantee = v_login.oid
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute_catalog
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute_catalog.attacl) AS acl
    WHERE acl.grantee = v_login.oid
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_catalog
    CROSS JOIN LATERAL pg_catalog.aclexplode(procedure_catalog.proacl) AS acl
    WHERE acl.grantee = v_login.oid
  ) THEN
    RAISE EXCEPTION 'DB-02 application login has an unreviewed direct object ACL';
  END IF;

  SELECT count(*) INTO v_private_table_count
  FROM pg_catalog.pg_class AS class_catalog
  JOIN pg_catalog.pg_namespace AS namespace_catalog
    ON namespace_catalog.oid = class_catalog.relnamespace
  WHERE namespace_catalog.nspname = ANY (ARRAY[
    'circles_admin'::pg_catalog.name,
    'circles_app'::pg_catalog.name,
    'circles_auth'::pg_catalog.name,
    'circles_identity'::pg_catalog.name,
    'circles_publish'::pg_catalog.name
  ])
    AND class_catalog.relkind IN ('r', 'p');
  IF v_private_table_count <> 43 THEN
    RAISE EXCEPTION 'DB-02 expected the approved 43-table private inventory';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'circles_admin'::pg_catalog.name,
      'circles_app'::pg_catalog.name,
      'circles_auth'::pg_catalog.name,
      'circles_identity'::pg_catalog.name,
      'circles_publish'::pg_catalog.name
    ]) AS expected(schema_name)
    WHERE NOT pg_catalog.has_schema_privilege(v_runtime.oid, expected.schema_name, 'USAGE')
       OR pg_catalog.has_schema_privilege(v_runtime.oid, expected.schema_name, 'CREATE')
  ) OR pg_catalog.has_schema_privilege(v_runtime.oid, 'circles_ops', 'USAGE')
     OR pg_catalog.has_schema_privilege(v_runtime.oid, 'circles_ops', 'CREATE') THEN
    RAISE EXCEPTION 'DB-02 runtime private-schema privileges no longer match the approved boundary';
  END IF;

  -- Keep the application and helper access actually consumed by the current
  -- server. This is a grant-preservation test, not a new grant.
  IF NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_app.users', 'SELECT')
     OR NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_app.users', 'INSERT')
     OR NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_app.users', 'UPDATE')
     OR NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_app.users', 'DELETE')
     OR NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_auth.oauth_pending_states', 'SELECT')
     OR NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_auth.oauth_pending_states', 'INSERT')
     OR NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_auth.oauth_pending_states', 'DELETE')
     OR NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_identity.provider_links', 'SELECT')
     OR NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_identity.provider_links', 'INSERT')
     OR NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_publish."circlePrompts"', 'SELECT')
     OR NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_publish."circlePrompts"', 'INSERT')
     OR NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_publish."circlePrompts"', 'UPDATE')
     OR NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_publish."circlePrompts"', 'DELETE')
     OR NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_publish."devicePushTokens"', 'SELECT')
     OR NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_publish."devicePushTokens"', 'INSERT')
     OR NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_publish."devicePushTokens"', 'UPDATE')
     OR NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_publish."devicePushTokens"', 'DELETE')
     OR NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_publish."mediaObjects"', 'SELECT')
     OR NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_publish."mediaObjects"', 'INSERT')
     OR NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_publish."postPublishReceipts"', 'SELECT')
     OR NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_publish."postPublishReceipts"', 'INSERT')
     OR NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_publish."postPublishReceipts"', 'UPDATE')
     OR NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_publish."promptPosts"', 'SELECT')
     OR NOT pg_catalog.has_table_privilege(v_runtime.oid, 'circles_publish."promptPosts"', 'INSERT')
     OR NOT pg_catalog.has_function_privilege(
       v_runtime.oid,
       'circles_admin.read_mobile_feature_settings()'::pg_catalog.regprocedure,
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'DB-02 required runtime application/helper grants are absent';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS class_catalog
    JOIN pg_catalog.pg_namespace AS namespace_catalog
      ON namespace_catalog.oid = class_catalog.relnamespace
    WHERE namespace_catalog.nspname = ANY (ARRAY[
      'circles_app'::pg_catalog.name,
      'circles_auth'::pg_catalog.name,
      'circles_identity'::pg_catalog.name,
      'circles_publish'::pg_catalog.name
    ])
      AND class_catalog.relkind IN ('r', 'p')
      AND pg_catalog.has_table_privilege(v_runtime.oid, class_catalog.oid, 'TRUNCATE')
  ) THEN
    RAISE EXCEPTION 'DB-02 runtime role has unexpected TRUNCATE authority';
  END IF;
END
$db02_preflight$;

COMMIT;
