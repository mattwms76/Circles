-- DB-01 rollback candidate only. Use only after the parent-controlled release process confirms an
-- actual V1 compatibility regression. It restores the original audited broad SELECT predicates,
-- but refuses to run unless the exact V1 narrow post-state fingerprint is present. It changes no
-- rows, IDs, grants, roles, schemas, routines, current circles_app state, receipts, admin
-- routines, or detached NOLOGIN state.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $db01_rollback_approval_gate$
BEGIN
  IF pg_catalog.current_setting('circles.db01_legacy_public_privacy_rollback_contract', true)
       IS DISTINCT FROM 'DB01_LEGACY_PUBLIC_PRIVACY_ROLLBACK_APPROVED_V1' THEN
    RAISE EXCEPTION 'DB-01 rollback requires explicit incident/owner approval in the same controlled session';
  END IF;

  IF pg_catalog.current_setting('circles.db01_legacy_public_privacy_rollback_acknowledgment', true)
       IS DISTINCT FROM 'DB01_ROLLBACK_COMPATIBILITY_RESTORATION_ACKNOWLEDGED_V1' THEN
    RAISE EXCEPTION 'DB-01 rollback requires explicit compatibility-restoration acknowledgment in the same controlled session';
  END IF;
END;
$db01_rollback_approval_gate$;

-- The parent-generated rollback run must use the same row-free inventory definition as the
-- forward candidate. Keeping it in this separate script avoids assuming that a later catalog
-- mutation is safe to overwrite.
DO $db01_rollback_preflight$
DECLARE
  v_expected_narrow_fingerprint constant text := '26a7a9555d07c124e6f98a30dd943a6b';
  v_observed_fingerprint text;
BEGIN
  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'circles_app_runtime')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'DB-01 rollback prerequisite catalog drift';
  END IF;

  SELECT pg_catalog.md5(
           pg_catalog.concat_ws(
             E'\n', 'db01-legacy-public-catalog-v2',
             'auth.uid=' || (pg_catalog.to_regprocedure('auth.uid()') IS NOT NULL)::text,
             (
               SELECT pg_catalog.string_agg(
                 'relation=' || namespace_catalog.nspname || '.' || relation_catalog.relname
                 || '|kind=' || relation_catalog.relkind::text
                 || '|owner=' || pg_catalog.pg_get_userbyid(relation_catalog.relowner)
                 || '|rls=' || relation_catalog.relrowsecurity::text
                 || '|force_rls=' || relation_catalog.relforcerowsecurity::text
                 || '|primary_key=' || EXISTS (
                   SELECT 1 FROM pg_catalog.pg_constraint AS constraint_catalog
                    WHERE constraint_catalog.conrelid = relation_catalog.oid
                      AND constraint_catalog.contype = 'p'::pg_catalog."char"
                 )::text
                 || '|columns=[' || COALESCE((
                   SELECT pg_catalog.string_agg(
                     attribute_catalog.attnum::text || ':' || attribute_catalog.attname::text
                     || ':' || pg_catalog.format_type(attribute_catalog.atttypid, attribute_catalog.atttypmod)
                     || ':' || attribute_catalog.attnotnull::text || ':' || attribute_catalog.attidentity::text,
                     ',' ORDER BY attribute_catalog.attnum
                   ) FROM pg_catalog.pg_attribute AS attribute_catalog
                    WHERE attribute_catalog.attrelid = relation_catalog.oid
                      AND attribute_catalog.attnum > 0 AND NOT attribute_catalog.attisdropped
                 ), '') || ']'
                 || '|policies=[' || COALESCE((
                   SELECT pg_catalog.string_agg(
                     policy_catalog.polname::text || ':cmd=' || policy_catalog.polcmd::text
                     || ':permissive=' || policy_catalog.polpermissive::text
                     || ':roles=' || COALESCE((
                       SELECT pg_catalog.string_agg(
                         CASE WHEN policy_role.role_oid = 0::pg_catalog.oid THEN 'PUBLIC'
                              ELSE pg_catalog.pg_get_userbyid(policy_role.role_oid) END,
                         ',' ORDER BY CASE WHEN policy_role.role_oid = 0::pg_catalog.oid THEN 'PUBLIC'
                                           ELSE pg_catalog.pg_get_userbyid(policy_role.role_oid) END
                       ) FROM pg_catalog.unnest(policy_catalog.polroles) AS policy_role(role_oid)
                     ), '')
                     || ':qual=' || COALESCE(pg_catalog.pg_get_expr(policy_catalog.polqual, policy_catalog.polrelid), '<null>')
                     || ':with_check=' || COALESCE(pg_catalog.pg_get_expr(policy_catalog.polwithcheck, policy_catalog.polrelid), '<null>'),
                     ',' ORDER BY policy_catalog.polname
                   ) FROM pg_catalog.pg_policy AS policy_catalog
                    WHERE policy_catalog.polrelid = relation_catalog.oid
                 ), '') || ']', E'\n' ORDER BY relation_catalog.relname
               ) FROM pg_catalog.pg_class AS relation_catalog
                 INNER JOIN pg_catalog.pg_namespace AS namespace_catalog ON namespace_catalog.oid = relation_catalog.relnamespace
                WHERE namespace_catalog.nspname = 'public'::pg_catalog.name
                  AND relation_catalog.relname = ANY (ARRAY['circles', 'follows', 'profiles']::pg_catalog.name[])
                  AND relation_catalog.relkind = 'r'::pg_catalog."char"
             ),
             (
               SELECT pg_catalog.string_agg(
                 'privilege=' || relation_catalog.relname::text || ':' || role_catalog.rolname::text
                 || ':select=' || pg_catalog.has_table_privilege(role_catalog.rolname, relation_catalog.oid, 'SELECT')::text
                 || ':insert=' || pg_catalog.has_table_privilege(role_catalog.rolname, relation_catalog.oid, 'INSERT')::text
                 || ':update=' || pg_catalog.has_table_privilege(role_catalog.rolname, relation_catalog.oid, 'UPDATE')::text
                 || ':delete=' || pg_catalog.has_table_privilege(role_catalog.rolname, relation_catalog.oid, 'DELETE')::text
                 || ':truncate=' || pg_catalog.has_table_privilege(role_catalog.rolname, relation_catalog.oid, 'TRUNCATE')::text,
                 E'\n' ORDER BY relation_catalog.relname, role_catalog.rolname
               ) FROM pg_catalog.pg_class AS relation_catalog
                 INNER JOIN pg_catalog.pg_namespace AS namespace_catalog ON namespace_catalog.oid = relation_catalog.relnamespace
                 CROSS JOIN pg_catalog.pg_roles AS role_catalog
                WHERE namespace_catalog.nspname = 'public'::pg_catalog.name
                  AND relation_catalog.relname = ANY (ARRAY['circles', 'follows', 'profiles']::pg_catalog.name[])
                  AND relation_catalog.relkind = 'r'::pg_catalog."char"
                  AND role_catalog.rolname = ANY (ARRAY['anon', 'authenticated', 'circles_app_runtime', 'service_role']::pg_catalog.name[])
             )
           )
         ) INTO v_observed_fingerprint;

  IF v_observed_fingerprint IS DISTINCT FROM v_expected_narrow_fingerprint THEN
    RAISE EXCEPTION
      'DB-01 rollback refuses non-V1 narrow catalog state (expected %, observed %)',
      v_expected_narrow_fingerprint,
      v_observed_fingerprint;
  END IF;
END;
$db01_rollback_preflight$;

ALTER POLICY "Signed in members can discover circle listings"
  ON public.circles
  USING (true);

ALTER POLICY "Profiles are visible to signed in members"
  ON public.profiles
  USING (true);

ALTER POLICY "Members see follows"
  ON public.follows
  USING (true);

-- The forward candidate's strict pre-state fingerprint is deliberately required after rollback.
-- Its value is filled from the same reviewed source pin as the forward file.
DO $db01_rollback_postflight$
DECLARE
  v_expected_broad_fingerprint constant text := 'a59b8fd2807cdd6e506ed85392adeb49';
  v_observed_fingerprint text;
BEGIN
  SELECT pg_catalog.md5(
           pg_catalog.concat_ws(
             E'\n', 'db01-legacy-public-catalog-v2',
             'auth.uid=' || (pg_catalog.to_regprocedure('auth.uid()') IS NOT NULL)::text,
             (
               SELECT pg_catalog.string_agg(
                 'relation=' || namespace_catalog.nspname || '.' || relation_catalog.relname
                 || '|kind=' || relation_catalog.relkind::text
                 || '|owner=' || pg_catalog.pg_get_userbyid(relation_catalog.relowner)
                 || '|rls=' || relation_catalog.relrowsecurity::text
                 || '|force_rls=' || relation_catalog.relforcerowsecurity::text
                 || '|primary_key=' || EXISTS (
                   SELECT 1 FROM pg_catalog.pg_constraint AS constraint_catalog
                    WHERE constraint_catalog.conrelid = relation_catalog.oid
                      AND constraint_catalog.contype = 'p'::pg_catalog."char"
                 )::text
                 || '|columns=[' || COALESCE((
                   SELECT pg_catalog.string_agg(
                     attribute_catalog.attnum::text || ':' || attribute_catalog.attname::text
                     || ':' || pg_catalog.format_type(attribute_catalog.atttypid, attribute_catalog.atttypmod)
                     || ':' || attribute_catalog.attnotnull::text || ':' || attribute_catalog.attidentity::text,
                     ',' ORDER BY attribute_catalog.attnum
                   ) FROM pg_catalog.pg_attribute AS attribute_catalog
                    WHERE attribute_catalog.attrelid = relation_catalog.oid
                      AND attribute_catalog.attnum > 0 AND NOT attribute_catalog.attisdropped
                 ), '') || ']'
                 || '|policies=[' || COALESCE((
                   SELECT pg_catalog.string_agg(
                     policy_catalog.polname::text || ':cmd=' || policy_catalog.polcmd::text
                     || ':permissive=' || policy_catalog.polpermissive::text
                     || ':roles=' || COALESCE((
                       SELECT pg_catalog.string_agg(
                         CASE WHEN policy_role.role_oid = 0::pg_catalog.oid THEN 'PUBLIC'
                              ELSE pg_catalog.pg_get_userbyid(policy_role.role_oid) END,
                         ',' ORDER BY CASE WHEN policy_role.role_oid = 0::pg_catalog.oid THEN 'PUBLIC'
                                           ELSE pg_catalog.pg_get_userbyid(policy_role.role_oid) END
                       ) FROM pg_catalog.unnest(policy_catalog.polroles) AS policy_role(role_oid)
                     ), '')
                     || ':qual=' || COALESCE(pg_catalog.pg_get_expr(policy_catalog.polqual, policy_catalog.polrelid), '<null>')
                     || ':with_check=' || COALESCE(pg_catalog.pg_get_expr(policy_catalog.polwithcheck, policy_catalog.polrelid), '<null>'),
                     ',' ORDER BY policy_catalog.polname
                   ) FROM pg_catalog.pg_policy AS policy_catalog
                    WHERE policy_catalog.polrelid = relation_catalog.oid
                 ), '') || ']', E'\n' ORDER BY relation_catalog.relname
               ) FROM pg_catalog.pg_class AS relation_catalog
                 INNER JOIN pg_catalog.pg_namespace AS namespace_catalog ON namespace_catalog.oid = relation_catalog.relnamespace
                WHERE namespace_catalog.nspname = 'public'::pg_catalog.name
                  AND relation_catalog.relname = ANY (ARRAY['circles', 'follows', 'profiles']::pg_catalog.name[])
                  AND relation_catalog.relkind = 'r'::pg_catalog."char"
             ),
             (
               SELECT pg_catalog.string_agg(
                 'privilege=' || relation_catalog.relname::text || ':' || role_catalog.rolname::text
                 || ':select=' || pg_catalog.has_table_privilege(role_catalog.rolname, relation_catalog.oid, 'SELECT')::text
                 || ':insert=' || pg_catalog.has_table_privilege(role_catalog.rolname, relation_catalog.oid, 'INSERT')::text
                 || ':update=' || pg_catalog.has_table_privilege(role_catalog.rolname, relation_catalog.oid, 'UPDATE')::text
                 || ':delete=' || pg_catalog.has_table_privilege(role_catalog.rolname, relation_catalog.oid, 'DELETE')::text
                 || ':truncate=' || pg_catalog.has_table_privilege(role_catalog.rolname, relation_catalog.oid, 'TRUNCATE')::text,
                 E'\n' ORDER BY relation_catalog.relname, role_catalog.rolname
               ) FROM pg_catalog.pg_class AS relation_catalog
                 INNER JOIN pg_catalog.pg_namespace AS namespace_catalog ON namespace_catalog.oid = relation_catalog.relnamespace
                 CROSS JOIN pg_catalog.pg_roles AS role_catalog
                WHERE namespace_catalog.nspname = 'public'::pg_catalog.name
                  AND relation_catalog.relname = ANY (ARRAY['circles', 'follows', 'profiles']::pg_catalog.name[])
                  AND relation_catalog.relkind = 'r'::pg_catalog."char"
                  AND role_catalog.rolname = ANY (ARRAY['anon', 'authenticated', 'circles_app_runtime', 'service_role']::pg_catalog.name[])
             )
           )
         ) INTO v_observed_fingerprint;

  IF v_observed_fingerprint IS DISTINCT FROM v_expected_broad_fingerprint THEN
    RAISE EXCEPTION
      'DB-01 rollback broad catalog postflight fingerprint drift (expected %, observed %)',
      v_expected_broad_fingerprint,
      v_observed_fingerprint;
  END IF;
END;
$db01_rollback_postflight$;

COMMIT;
