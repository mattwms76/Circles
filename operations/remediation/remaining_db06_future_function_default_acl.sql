-- DB-06: authorized provider-admin future-function default-ACL hardening.
--
-- This is an executable, manually invoked transaction candidate. It is not an
-- application migration, must not be placed in an automatic migration chain,
-- and must not be run until the provider and the owner of supabase_admin have
-- expressly approved its provider-wide effect.
--
-- Fresh 2026-10-28 catalog evidence for circles_app records this exact
-- pre-state:
--   * supabase_admin is a provider superuser and can create in circles_app;
--   * there is no global pg_default_acl FUNCTION override for supabase_admin;
--   * six provider-managed schema-additive FUNCTION records exist exactly in
--     cron, extensions, graphql, graphql_public, public, and realtime; and
--   * PostgreSQL's built-in global FUNCTION default therefore grants PUBLIC
--     EXECUTE, while the six schema records retain their exact ACLs.
--
-- A global default entry replaces the built-in default. A schema-specific
-- entry is additive and cannot remove an effective global PUBLIC EXECUTE
-- grant. The single ALTER DEFAULT PRIVILEGES statement below is intentionally
-- global. It affects future functions made by supabase_admin in every schema;
-- it neither changes existing functions nor role memberships, grants, type
-- defaults, RLS, schemas, schedules, or the six provider schema records.
--
-- Preconditions outside SQL:
--   1. Provider and object-owner approval covers every present/future schema
--      in which supabase_admin might create functions.
--   2. The parent has run remaining_db06_provider_preflight.sql in the exact
--      provider change window and the result matches this file's pre-state.
--   3. The provider has supplied its own rollback decision. Do not infer a
--      rollback from PostgreSQL's built-in fallback or this source candidate.
--
-- Failure is intentional: do not weaken or bypass an assertion. A failed
-- transaction changes nothing and must remain an auditor-visible blocker.

BEGIN;

SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $db06_preflight$
DECLARE
  v_target_oid oid;
  v_schema_oid oid;
  v_target_is_superuser boolean;
  v_executor_is_superuser boolean;
  v_global_function_default_row_count integer;
  v_schema_function_default_row_count integer;
BEGIN
  SELECT role_catalog.oid, role_catalog.rolsuper
    INTO v_target_oid, v_target_is_superuser
  FROM pg_catalog.pg_roles AS role_catalog
  WHERE role_catalog.rolname = 'supabase_admin';

  IF NOT FOUND OR NOT v_target_is_superuser THEN
    RAISE EXCEPTION 'DB06_PRECONDITION_FAILED expected provider superuser supabase_admin is unavailable'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT role_catalog.rolsuper
    INTO v_executor_is_superuser
  FROM pg_catalog.pg_roles AS role_catalog
  WHERE role_catalog.rolname = current_user;

  -- ALTER DEFAULT PRIVILEGES FOR ROLE requires the target role itself, a
  -- legitimate member of it, or a superuser. CREATEROLE alone is not accepted.
  IF current_user <> 'supabase_admin'
     AND NOT COALESCE(v_executor_is_superuser, false)
     AND NOT pg_catalog.pg_has_role(current_user, v_target_oid, 'MEMBER') THEN
    RAISE EXCEPTION 'DB06_AUTHORITY_REQUIRED current_user cannot alter supabase_admin default privileges'
      USING ERRCODE = '42501';
  END IF;

  SELECT namespace_catalog.oid
    INTO v_schema_oid
  FROM pg_catalog.pg_namespace AS namespace_catalog
  WHERE namespace_catalog.nspname = 'circles_app';

  IF NOT FOUND
     OR NOT pg_catalog.has_schema_privilege(v_target_oid, v_schema_oid, 'CREATE') THEN
    RAISE EXCEPTION 'DB06_PRECONDITION_FAILED supabase_admin is no longer an eligible circles_app function creator'
      USING ERRCODE = 'P0001';
  END IF;

  -- The approved baseline has no explicit global FUNCTION default ACL: the
  -- hazardous PUBLIC EXECUTE comes only from acldefault. Its six known
  -- schema-additive provider records are legitimate and must match exactly.
  -- Reject a missing, added, or changed record rather than overwriting a
  -- provider-managed grant that this candidate does not own.
  SELECT count(*)
    INTO v_global_function_default_row_count
  FROM pg_catalog.pg_default_acl AS default_acl
  WHERE default_acl.defaclrole = v_target_oid
    AND default_acl.defaclnamespace = 0
    AND default_acl.defaclobjtype = 'f';

  IF v_global_function_default_row_count <> 0 THEN
    RAISE EXCEPTION 'DB06_PRECONDITION_FAILED expected zero global supabase_admin FUNCTION default-ACL records, found %', v_global_function_default_row_count
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)
    INTO v_schema_function_default_row_count
  FROM pg_catalog.pg_default_acl AS default_acl
  WHERE default_acl.defaclrole = v_target_oid
    AND default_acl.defaclnamespace <> 0
    AND default_acl.defaclobjtype = 'f';

  IF v_schema_function_default_row_count <> 6 THEN
    RAISE EXCEPTION 'DB06_PRECONDITION_FAILED expected exactly six provider schema-additive FUNCTION default-ACL records, found %', v_schema_function_default_row_count
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    WITH expected(schema_name, acl_text) AS (
      VALUES
        ('cron'::text, '{postgres=X*/supabase_admin}'::text),
        ('extensions'::text, '{postgres=X*/supabase_admin}'::text),
        ('graphql'::text, '{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}'::text),
        ('graphql_public'::text, '{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}'::text),
        ('public'::text, '{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}'::text),
        ('realtime'::text, '{postgres=X/supabase_admin,dashboard_user=X/supabase_admin}'::text)
    ), actual AS (
      SELECT namespace_catalog.nspname::text AS schema_name,
             default_acl.defaclacl::text AS acl_text
      FROM pg_catalog.pg_default_acl AS default_acl
      JOIN pg_catalog.pg_namespace AS namespace_catalog
        ON namespace_catalog.oid = default_acl.defaclnamespace
      WHERE default_acl.defaclrole = v_target_oid
        AND default_acl.defaclnamespace <> 0
        AND default_acl.defaclobjtype = 'f'
    )
    SELECT 1
    FROM (
      (SELECT schema_name, acl_text FROM actual
       EXCEPT
       SELECT schema_name, acl_text FROM expected)
      UNION ALL
      (SELECT schema_name, acl_text FROM expected
       EXCEPT
       SELECT schema_name, acl_text FROM actual)
    ) AS mismatch
  ) THEN
    RAISE EXCEPTION 'DB06_PRECONDITION_FAILED provider schema-additive FUNCTION default-ACL records do not match the approved six-record baseline'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.aclexplode(pg_catalog.acldefault('f', v_target_oid)) AS privilege
    WHERE privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
      AND privilege.is_grantable = false
  ) THEN
    RAISE EXCEPTION 'DB06_PRECONDITION_FAILED expected built-in supabase_admin PUBLIC EXECUTE default is absent'
      USING ERRCODE = 'P0001';
  END IF;
END;
$db06_preflight$;

-- Snapshot every unrelated default-ACL record in this transaction. The target
-- global FUNCTION record does not yet exist; all other records must compare
-- exactly after the only permitted statement below.
CREATE TEMPORARY TABLE pg_temp.db06_default_acl_snapshot ON COMMIT DROP AS
SELECT
  default_acl.defaclrole,
  default_acl.defaclnamespace,
  default_acl.defaclobjtype,
  default_acl.defaclacl::text AS defaclacl_text
FROM pg_catalog.pg_default_acl AS default_acl
WHERE NOT (
  default_acl.defaclrole = 'supabase_admin'::regrole
  AND default_acl.defaclnamespace = 0
  AND default_acl.defaclobjtype = 'f'
);

-- This is the one approved-scope mutation. Omitting IN SCHEMA is required:
-- a per-schema revoke could not counteract the built-in global PUBLIC default.
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $db06_postflight$
DECLARE
  v_target_oid oid := 'supabase_admin'::regrole;
  v_global_function_default_row_count integer;
BEGIN
  SELECT count(*)
    INTO v_global_function_default_row_count
  FROM pg_catalog.pg_default_acl AS default_acl
  WHERE default_acl.defaclrole = v_target_oid
    AND default_acl.defaclnamespace = 0
    AND default_acl.defaclobjtype = 'f';

  IF v_global_function_default_row_count <> 1 THEN
    RAISE EXCEPTION 'DB06_POSTCONDITION_FAILED expected exactly one global supabase_admin FUNCTION default-ACL record, found %', v_global_function_default_row_count
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_default_acl AS default_acl
    CROSS JOIN LATERAL pg_catalog.aclexplode(default_acl.defaclacl) AS privilege
    WHERE default_acl.defaclrole = v_target_oid
      AND default_acl.defaclnamespace = 0
      AND default_acl.defaclobjtype = 'f'
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'DB06_POSTCONDITION_FAILED PUBLIC EXECUTE remains in supabase_admin global FUNCTION default ACL'
      USING ERRCODE = 'P0001';
  END IF;

  -- The legitimate provider schema-additive records must remain byte-for-byte
  -- equivalent. The global row is the only DB-06-owned catalog difference.
  IF (
    SELECT count(*)
    FROM pg_catalog.pg_default_acl AS default_acl
    WHERE default_acl.defaclrole = v_target_oid
      AND default_acl.defaclnamespace <> 0
      AND default_acl.defaclobjtype = 'f'
  ) <> 6 THEN
    RAISE EXCEPTION 'DB06_POSTCONDITION_FAILED expected exactly six provider schema-additive FUNCTION default-ACL records'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    WITH expected(schema_name, acl_text) AS (
      VALUES
        ('cron'::text, '{postgres=X*/supabase_admin}'::text),
        ('extensions'::text, '{postgres=X*/supabase_admin}'::text),
        ('graphql'::text, '{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}'::text),
        ('graphql_public'::text, '{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}'::text),
        ('public'::text, '{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}'::text),
        ('realtime'::text, '{postgres=X/supabase_admin,dashboard_user=X/supabase_admin}'::text)
    ), actual AS (
      SELECT namespace_catalog.nspname::text AS schema_name,
             default_acl.defaclacl::text AS acl_text
      FROM pg_catalog.pg_default_acl AS default_acl
      JOIN pg_catalog.pg_namespace AS namespace_catalog
        ON namespace_catalog.oid = default_acl.defaclnamespace
      WHERE default_acl.defaclrole = v_target_oid
        AND default_acl.defaclnamespace <> 0
        AND default_acl.defaclobjtype = 'f'
    )
    SELECT 1
    FROM (
      (SELECT schema_name, acl_text FROM actual
       EXCEPT
       SELECT schema_name, acl_text FROM expected)
      UNION ALL
      (SELECT schema_name, acl_text FROM expected
       EXCEPT
       SELECT schema_name, acl_text FROM actual)
    ) AS mismatch
  ) THEN
    RAISE EXCEPTION 'DB06_POSTCONDITION_FAILED provider schema-additive FUNCTION default ACL changed'
      USING ERRCODE = 'P0001';
  END IF;

  -- This comparison deliberately includes other roles, object types, and
  -- provider-managed schema entries. The target global FUNCTION row is the
  -- only permitted catalog difference.
  IF EXISTS (
    (SELECT defaclrole, defaclnamespace, defaclobjtype, defaclacl_text
       FROM pg_temp.db06_default_acl_snapshot
     EXCEPT
     SELECT default_acl.defaclrole,
            default_acl.defaclnamespace,
            default_acl.defaclobjtype,
            default_acl.defaclacl::text
       FROM pg_catalog.pg_default_acl AS default_acl
      WHERE NOT (
        default_acl.defaclrole = v_target_oid
        AND default_acl.defaclnamespace = 0
        AND default_acl.defaclobjtype = 'f'
      ))
    UNION ALL
    (SELECT default_acl.defaclrole,
            default_acl.defaclnamespace,
            default_acl.defaclobjtype,
            default_acl.defaclacl::text
       FROM pg_catalog.pg_default_acl AS default_acl
      WHERE NOT (
        default_acl.defaclrole = v_target_oid
        AND default_acl.defaclnamespace = 0
        AND default_acl.defaclobjtype = 'f'
      )
     EXCEPT
     SELECT defaclrole, defaclnamespace, defaclobjtype, defaclacl_text
       FROM pg_temp.db06_default_acl_snapshot)
  ) THEN
    RAISE EXCEPTION 'DB06_POSTCONDITION_FAILED an unrelated default ACL changed'
      USING ERRCODE = 'P0001';
  END IF;
END;
$db06_postflight$;

COMMIT;
