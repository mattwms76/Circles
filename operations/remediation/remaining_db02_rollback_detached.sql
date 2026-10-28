-- DB-02: return a temporarily activated dedicated app login to NOLOGIN.
-- Parent must first restore and verify the legacy application consumer, drain
-- dedicated-login sessions, and then invoke this through the protected runner.
-- This preserves the separately provisioned credential and SET-only membership
-- for a later reviewed retry; it does not rotate or disclose any secret.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('circles.remaining-db02.app-login.v1', 0)
);

DO $db02_rollback$
DECLARE
  v_login pg_catalog.pg_roles%ROWTYPE;
  v_runtime pg_catalog.pg_roles%ROWTYPE;
BEGIN
  IF pg_catalog.current_setting('circles.db02_cutover_action', true)
       IS DISTINCT FROM 'ROLLBACK_DETACHED_V1' THEN
    RAISE EXCEPTION 'DB-02 rollback requires the protected runner action';
  END IF;
  IF pg_catalog.current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'DB-02 expected database postgres';
  END IF;

  SELECT * INTO v_login
  FROM pg_catalog.pg_roles
  WHERE rolname = 'circles_app_login';
  SELECT * INTO v_runtime
  FROM pg_catalog.pg_roles
  WHERE rolname = 'circles_app_runtime';

  IF v_login.oid IS NULL OR NOT v_login.rolcanlogin OR v_login.rolinherit
     OR v_login.rolsuper OR v_login.rolcreatedb OR v_login.rolcreaterole
     OR v_login.rolreplication OR v_login.rolbypassrls
     OR v_login.rolconnlimit <> -1 OR v_login.rolconfig IS NOT NULL THEN
    RAISE EXCEPTION 'DB-02 dedicated application login is not safely active for rollback';
  END IF;
  IF v_runtime.oid IS NULL OR v_runtime.rolcanlogin OR v_runtime.rolinherit
     OR v_runtime.rolsuper OR v_runtime.rolcreatedb OR v_runtime.rolcreaterole
     OR v_runtime.rolreplication OR v_runtime.rolbypassrls
     OR v_runtime.rolconnlimit <> -1 OR v_runtime.rolconfig IS NOT NULL THEN
    RAISE EXCEPTION 'DB-02 runtime role flags differ from the approved restricted state';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_auth_members WHERE member = v_login.oid) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_auth_members AS membership
       WHERE membership.member = v_login.oid
         AND membership.roleid = v_runtime.oid
         AND membership.admin_option = FALSE
         AND membership.inherit_option = FALSE
         AND membership.set_option = TRUE
     ) OR (SELECT count(*)
             FROM pg_catalog.pg_auth_members WHERE roleid = v_login.oid) <> 1
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
     ) OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = v_runtime.oid
     ) THEN
    RAISE EXCEPTION 'DB-02 role membership is not the approved SET-only runtime boundary';
  END IF;
  IF NOT pg_catalog.has_database_privilege(v_login.oid, pg_catalog.current_database(), 'CONNECT')
     OR pg_catalog.has_database_privilege(v_login.oid, pg_catalog.current_database(), 'CREATE')
     OR EXISTS (
       SELECT 1
       FROM unnest(ARRAY[
         'circles_admin'::pg_catalog.name, 'circles_app'::pg_catalog.name,
         'circles_auth'::pg_catalog.name, 'circles_identity'::pg_catalog.name,
         'circles_ops'::pg_catalog.name, 'circles_publish'::pg_catalog.name
       ]) AS expected(schema_name)
       WHERE pg_catalog.to_regnamespace(expected.schema_name) IS NULL
          OR pg_catalog.has_schema_privilege(v_login.oid, expected.schema_name, 'USAGE')
          OR pg_catalog.has_schema_privilege(v_login.oid, expected.schema_name, 'CREATE')
     ) THEN
    RAISE EXCEPTION 'DB-02 application login privilege precondition failed';
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

  -- Do not merely turn off future logins while a cutover consumer remains
  -- connected. Operators must restore the legacy consumer and verify its
  -- readiness before this transaction can detach the dedicated identity.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_stat_activity
    WHERE datname = pg_catalog.current_database()
      AND usename = 'circles_app_login'
      AND pid <> pg_catalog.pg_backend_pid()
  ) THEN
    RAISE EXCEPTION 'DB-02 refuses to detach while dedicated application sessions remain';
  END IF;

  REVOKE circles_app_runtime FROM circles_app_login;
  ALTER ROLE circles_app_login NOLOGIN;

  SELECT * INTO v_login
  FROM pg_catalog.pg_roles
  WHERE rolname = 'circles_app_login';
  IF v_login.oid IS NULL OR v_login.rolcanlogin OR v_login.rolinherit
     OR v_login.rolsuper OR v_login.rolcreatedb OR v_login.rolcreaterole
     OR v_login.rolreplication OR v_login.rolbypassrls
     OR v_login.rolconnlimit <> -1 OR v_login.rolconfig IS NOT NULL THEN
    RAISE EXCEPTION 'DB-02 dedicated application login detachment postcondition failed';
  END IF;
  IF EXISTS (
       SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = v_login.oid
     ) OR (SELECT count(*)
             FROM pg_catalog.pg_auth_members WHERE roleid = v_login.oid) <> 1
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
    RAISE EXCEPTION 'DB-02 detached membership rollback postcondition failed';
  END IF;
END
$db02_rollback$;

COMMIT;
