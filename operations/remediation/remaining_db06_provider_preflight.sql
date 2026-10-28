-- DB-06 parent-operated provider preflight (READ ONLY).
--
-- Run only through an approved provider connection in the intended change
-- window. This file reads catalog metadata only, returns no application rows,
-- issues no role switch, and ends with ROLLBACK. It does not authorize the
-- provider-wide change; its result is evidence for the provider/object owner.

BEGIN READ ONLY;

SET LOCAL lock_timeout = '250ms';
SET LOCAL statement_timeout = '3s';
SET LOCAL idle_in_transaction_session_timeout = '5s';
SET LOCAL transaction_timeout = '8s';

-- Exactly one bounded summary row. `executor_can_alter_target_defaults` is the
-- database-capability condition used by the executable candidate; the separate
-- provider/object-owner approval is still mandatory. The approved baseline is
-- zero global FUNCTION overrides plus the six exact provider schema records.
WITH target AS (
  SELECT role_catalog.oid, role_catalog.rolsuper
  FROM pg_catalog.pg_roles AS role_catalog
  WHERE role_catalog.rolname = 'supabase_admin'
  LIMIT 1
), executor AS (
  SELECT COALESCE((
    SELECT role_catalog.rolsuper
    FROM pg_catalog.pg_roles AS role_catalog
    WHERE role_catalog.rolname = current_user
    LIMIT 1
  ), false) AS is_superuser
), function_default_records AS (
  SELECT default_acl.defaclnamespace,
         COALESCE(namespace_catalog.nspname::text, '') AS schema_name,
         default_acl.defaclacl::text AS acl_text
  FROM pg_catalog.pg_default_acl AS default_acl
  JOIN target ON target.oid = default_acl.defaclrole
  LEFT JOIN pg_catalog.pg_namespace AS namespace_catalog
    ON namespace_catalog.oid = default_acl.defaclnamespace
  WHERE default_acl.defaclobjtype = 'f'
), expected_schema_function_overrides(schema_name, acl_text) AS (
  VALUES
    ('cron'::text, '{postgres=X*/supabase_admin}'::text),
    ('extensions'::text, '{postgres=X*/supabase_admin}'::text),
    ('graphql'::text, '{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}'::text),
    ('graphql_public'::text, '{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}'::text),
    ('public'::text, '{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}'::text),
    ('realtime'::text, '{postgres=X/supabase_admin,dashboard_user=X/supabase_admin}'::text)
), circles_app AS (
  SELECT namespace_catalog.oid, namespace_catalog.nspowner
  FROM pg_catalog.pg_namespace AS namespace_catalog
  WHERE namespace_catalog.nspname = 'circles_app'
  LIMIT 1
)
SELECT
  current_user AS executor_role,
  current_setting('transaction_read_only') AS transaction_read_only,
  COALESCE((SELECT rolsuper FROM target), false) AS target_is_provider_superuser,
  (
    current_user = 'supabase_admin'
    OR (SELECT is_superuser FROM executor)
    OR COALESCE(pg_catalog.pg_has_role(current_user, (SELECT oid FROM target), 'MEMBER'), false)
  ) AS executor_can_alter_target_defaults,
  COALESCE(
    pg_catalog.has_schema_privilege((SELECT oid FROM target), (SELECT oid FROM circles_app), 'CREATE'),
    false
  ) AS target_can_create_circles_app,
  COALESCE(pg_catalog.pg_get_userbyid((SELECT nspowner FROM circles_app)), '') AS circles_app_owner,
  (SELECT count(*) FROM function_default_records WHERE defaclnamespace = 0) AS global_function_override_count,
  (SELECT count(*) FROM function_default_records WHERE defaclnamespace <> 0) AS schema_function_override_count,
  NOT EXISTS (
    SELECT 1
    FROM (
      (SELECT schema_name, acl_text
       FROM function_default_records
       WHERE defaclnamespace <> 0
       EXCEPT
       SELECT schema_name, acl_text
       FROM expected_schema_function_overrides)
      UNION ALL
      (SELECT schema_name, acl_text
       FROM expected_schema_function_overrides
       EXCEPT
       SELECT schema_name, acl_text
       FROM function_default_records
       WHERE defaclnamespace <> 0)
    ) AS mismatch
  ) AS schema_function_overrides_match_expected,
  EXISTS (
    SELECT 1
    FROM target
    CROSS JOIN LATERAL pg_catalog.aclexplode(pg_catalog.acldefault('f', target.oid)) AS privilege
    WHERE privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
      AND privilege.is_grantable = false
  ) AS built_in_effective_public_execute,
  (
    COALESCE((SELECT rolsuper FROM target), false)
    AND (
      current_user = 'supabase_admin'
      OR (SELECT is_superuser FROM executor)
      OR COALESCE(pg_catalog.pg_has_role(current_user, (SELECT oid FROM target), 'MEMBER'), false)
    )
    AND COALESCE(
      pg_catalog.has_schema_privilege((SELECT oid FROM target), (SELECT oid FROM circles_app), 'CREATE'),
      false
    )
    AND (SELECT count(*) FROM function_default_records WHERE defaclnamespace = 0) = 0
    AND (SELECT count(*) FROM function_default_records WHERE defaclnamespace <> 0) = 6
    AND NOT EXISTS (
      SELECT 1
      FROM (
        (SELECT schema_name, acl_text
         FROM function_default_records
         WHERE defaclnamespace <> 0
         EXCEPT
         SELECT schema_name, acl_text
         FROM expected_schema_function_overrides)
        UNION ALL
        (SELECT schema_name, acl_text
         FROM expected_schema_function_overrides
         EXCEPT
         SELECT schema_name, acl_text
         FROM function_default_records
         WHERE defaclnamespace <> 0)
      ) AS mismatch
    )
    AND EXISTS (
      SELECT 1
      FROM target
      CROSS JOIN LATERAL pg_catalog.aclexplode(pg_catalog.acldefault('f', target.oid)) AS privilege
      WHERE privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
        AND privilege.is_grantable = false
    )
  ) AS matches_db06_current_baseline
LIMIT 1;

-- At most 128 catalog rows. A result count of 128 is a blocker: obtain the
-- complete provider inventory rather than treating a truncated result as exact.
WITH target AS (
  SELECT role_catalog.oid
  FROM pg_catalog.pg_roles AS role_catalog
  WHERE role_catalog.rolname = 'supabase_admin'
  LIMIT 1
), records AS (
  SELECT
    default_acl.oid AS default_acl_oid,
    CASE WHEN default_acl.defaclnamespace = 0 THEN 'global'
         ELSE 'schema_additive' END AS acl_scope,
    COALESCE(namespace_catalog.nspname, '') AS schema_name,
    default_acl.defaclacl::text AS acl_text
  FROM pg_catalog.pg_default_acl AS default_acl
  JOIN target ON target.oid = default_acl.defaclrole
  LEFT JOIN pg_catalog.pg_namespace AS namespace_catalog
    ON namespace_catalog.oid = default_acl.defaclnamespace
  WHERE default_acl.defaclobjtype = 'f'
)
SELECT
  count(*) OVER () AS total_function_default_records,
  default_acl_oid,
  acl_scope,
  schema_name,
  acl_text
FROM records
ORDER BY acl_scope, schema_name, default_acl_oid
LIMIT 128;

-- The target's current eligible creation path for the private schema. This is
-- intentionally one exact schema row, not a claim that the global change has
-- only a private-schema effect.
WITH target AS (
  SELECT role_catalog.oid
  FROM pg_catalog.pg_roles AS role_catalog
  WHERE role_catalog.rolname = 'supabase_admin'
  LIMIT 1
)
SELECT
  namespace_catalog.nspname AS schema_name,
  pg_catalog.pg_get_userbyid(namespace_catalog.nspowner) AS schema_owner,
  namespace_catalog.nspowner = target.oid AS target_owns_schema,
  pg_catalog.has_schema_privilege(target.oid, namespace_catalog.oid, 'CREATE') AS target_has_create,
  CASE
    WHEN namespace_catalog.nspowner = target.oid THEN 'owner'
    WHEN pg_catalog.has_schema_privilege(target.oid, namespace_catalog.oid, 'CREATE') THEN 'CREATE privilege'
    ELSE 'not eligible'
  END AS target_creation_path
FROM pg_catalog.pg_namespace AS namespace_catalog
CROSS JOIN target
WHERE namespace_catalog.nspname = 'circles_app'
LIMIT 1;

ROLLBACK;
