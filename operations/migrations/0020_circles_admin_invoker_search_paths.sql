-- DB-08: Pin fixed pg_catalog-only paths for the two existing admin SECURITY INVOKER trigger helpers.
--
-- Pending reviewed migration-runner approval. This file does not create, replace, grant, revoke,
-- or otherwise alter either function body, ACL, owner, or SECURITY INVOKER property.
BEGIN;

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('circles_admin.invoker_search_paths_v1'::pg_catalog.text, 0)
);

-- The source/catalog contract is deliberately exact. A missing, overloaded-by-signature, changed-owner,
-- SECURITY DEFINER, changed-return-type, or already-configured helper is drift, not a condition to repair
-- implicitly in this migration.
DO $db08_preconditions$
DECLARE
  v_target pg_catalog.text;
  v_function record;
BEGIN
  FOREACH v_target IN ARRAY ARRAY[
    'circles_admin.touch_updated_at()'::pg_catalog.text,
    'circles_admin.reject_audit_mutation()'::pg_catalog.text
  ]
  LOOP
    SELECT
      procedure_catalog.oid,
      namespace_catalog.nspname,
      procedure_catalog.proname,
      pg_catalog.pg_get_function_identity_arguments(procedure_catalog.oid) AS identity_arguments,
      procedure_catalog.prokind,
      procedure_catalog.prorettype,
      procedure_catalog.prosecdef,
      owner_role.rolname AS owner_name,
      procedure_catalog.proconfig
    INTO v_function
    FROM pg_catalog.pg_proc AS procedure_catalog
    INNER JOIN pg_catalog.pg_namespace AS namespace_catalog
      ON namespace_catalog.oid = procedure_catalog.pronamespace
    INNER JOIN pg_catalog.pg_roles AS owner_role
      ON owner_role.oid = procedure_catalog.proowner
    WHERE procedure_catalog.oid = pg_catalog.to_regprocedure(v_target)::pg_catalog.oid;

    IF NOT FOUND
       OR v_function.nspname <> 'circles_admin'::pg_catalog.name
       OR v_function.identity_arguments <> ''::pg_catalog.text
       OR v_function.prokind <> 'f'::"char"
       OR v_function.prorettype <> 'pg_catalog.trigger'::pg_catalog.regtype
       OR v_function.prosecdef IS DISTINCT FROM false
       OR v_function.owner_name <> 'postgres'::pg_catalog.name THEN
      RAISE EXCEPTION
        'DB-08 prerequisite failed for %: expected postgres-owned SECURITY INVOKER circles_admin trigger function with no arguments',
        v_target;
    END IF;

    IF v_function.proconfig IS NOT NULL THEN
      RAISE EXCEPTION
        'DB-08 prerequisite failed for %: expected no existing ALTER FUNCTION settings',
        v_target;
    END IF;
  END LOOP;
END;
$db08_preconditions$;

ALTER FUNCTION circles_admin.touch_updated_at() SET search_path TO pg_catalog;
ALTER FUNCTION circles_admin.reject_audit_mutation() SET search_path TO pg_catalog;

DO $db08_postconditions$
DECLARE
  v_pinned_count integer;
BEGIN
  SELECT pg_catalog.count(*)
  INTO v_pinned_count
  FROM pg_catalog.pg_proc AS procedure_catalog
  INNER JOIN pg_catalog.pg_namespace AS namespace_catalog
    ON namespace_catalog.oid = procedure_catalog.pronamespace
  INNER JOIN pg_catalog.pg_roles AS owner_role
    ON owner_role.oid = procedure_catalog.proowner
  WHERE procedure_catalog.oid IN (
      'circles_admin.touch_updated_at()'::pg_catalog.regprocedure::pg_catalog.oid,
      'circles_admin.reject_audit_mutation()'::pg_catalog.regprocedure::pg_catalog.oid
    )
    AND namespace_catalog.nspname = 'circles_admin'::pg_catalog.name
    AND pg_catalog.pg_get_function_identity_arguments(procedure_catalog.oid) = ''::pg_catalog.text
    AND procedure_catalog.prokind = 'f'::"char"
    AND procedure_catalog.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
    AND procedure_catalog.prosecdef IS FALSE
    AND owner_role.rolname = 'postgres'::pg_catalog.name
    AND procedure_catalog.proconfig = ARRAY['search_path=pg_catalog'::pg_catalog.text];

  IF v_pinned_count <> 2 THEN
    RAISE EXCEPTION
      'DB-08 postcondition failed: both audited admin SECURITY INVOKER helper paths must equal pg_catalog';
  END IF;
END;
$db08_postconditions$;

COMMIT;
