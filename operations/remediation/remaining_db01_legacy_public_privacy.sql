-- DB-01 candidate only. This file is intentionally inactive until a privacy owner and
-- compatibility owner explicitly select V1. It must be executed only by the parent-controlled
-- release process after a fresh, read-only catalog preflight and the synthetic PG17 drill.
--
-- This candidate changes only the three audited authenticated SELECT policy predicates on the
-- UUID-era public tables. It does not change rows, IDs, sequences, grants, roles, schemas,
-- routines, current circles_app state, the current bigint receipt, admin routines, or detached
-- NOLOGIN state. It also does not alter unrelated policies.
--
-- Catalog source pin: 2026-10-28T15:43:07.257Z catalog.json sha256
-- f0aa40c9459396918df2c0629383852436fb91e9898360bc471ce65130c0b5b6,
-- source tree 6c9339105c6544d7b7121022becc3de7942da602.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- These session settings are deliberate activation rails, not authorization boundaries. The
-- parent must retain the written owner decision and compatibility inventory separately.
DO $db01_approval_gate$
BEGIN
  IF pg_catalog.current_setting('circles.db01_legacy_public_privacy_contract', true)
       IS DISTINCT FROM 'DB01_LEGACY_PUBLIC_PRIVACY_APPROVED_V1' THEN
    RAISE EXCEPTION
      'DB-01 requires explicit owner and compatibility approval in the same controlled session';
  END IF;

  IF pg_catalog.current_setting('circles.db01_legacy_public_privacy_acknowledgment', true)
       IS DISTINCT FROM 'DB01_OWNER_AND_COMPATIBILITY_ACKNOWLEDGED_V1' THEN
    RAISE EXCEPTION
      'DB-01 requires explicit owner/compatibility-loss acknowledgment in the same controlled session';
  END IF;
END;
$db01_approval_gate$;

-- The fingerprint contains the complete policy inventory for the three relations, exact table
-- shape/RLS/owner facts, and the audited effective privilege matrix for anon, authenticated,
-- circles_app_runtime, and service_role. It deliberately excludes row contents and volatile OIDs.
DO $db01_preflight$
DECLARE
  v_expected_pre_fingerprint constant text := 'a59b8fd2807cdd6e506ed85392adeb49';
  v_observed_fingerprint text;
  v_table_name pg_catalog.name;
  v_relation_oid pg_catalog.oid;
  v_expected_columns text[];
  v_expected_select_policy pg_catalog.name;
  v_observed_columns text[];
  v_authenticated_oid pg_catalog.oid;
  v_policy pg_catalog.pg_policy%ROWTYPE;
BEGIN
  SELECT role_catalog.oid
    INTO v_authenticated_oid
    FROM pg_catalog.pg_roles AS role_catalog
   WHERE role_catalog.rolname = 'authenticated'::pg_catalog.name;

  IF v_authenticated_oid IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'circles_app_runtime')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'DB-01 prerequisite role catalog drift';
  END IF;

  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'DB-01 prerequisite missing: auth.uid()';
  END IF;

  FOR v_table_name, v_expected_columns, v_expected_select_policy IN
    SELECT *
      FROM (
        VALUES
          (
            'circles'::pg_catalog.name,
            ARRAY[
              'id:uuid:not_null:',
              'owner_id:uuid:nullable:',
              'name:text:not_null:',
              'description:text:not_null:',
              'interest:text:not_null:',
              'is_private:boolean:not_null:',
              'members_count:integer:not_null:',
              'cover_url:text:nullable:',
              'cover_color:text:not_null:',
              'created_at:timestamp with time zone:not_null:',
              'welcome_text:text:not_null:',
              'last_activity_at:timestamp with time zone:not_null:',
              'rules:text:not_null:'
            ]::text[],
            'Signed in members can discover circle listings'::pg_catalog.name
          ),
          (
            'profiles'::pg_catalog.name,
            ARRAY[
              'id:uuid:not_null:',
              'handle:text:not_null:',
              'display_name:text:not_null:',
              'avatar_url:text:nullable:',
              'bio:text:not_null:',
              'interests:text[]:not_null:',
              'created_at:timestamp with time zone:not_null:',
              'onboarding_completed_at:timestamp with time zone:nullable:'
            ]::text[],
            'Profiles are visible to signed in members'::pg_catalog.name
          ),
          (
            'follows'::pg_catalog.name,
            ARRAY[
              'follower_id:uuid:not_null:',
              'followee_id:uuid:not_null:',
              'created_at:timestamp with time zone:not_null:'
            ]::text[],
            'Members see follows'::pg_catalog.name
          )
      ) AS expected(table_name, expected_columns, select_policy)
  LOOP
    SELECT relation_catalog.oid
      INTO v_relation_oid
      FROM pg_catalog.pg_class AS relation_catalog
      INNER JOIN pg_catalog.pg_namespace AS namespace_catalog
        ON namespace_catalog.oid = relation_catalog.relnamespace
     WHERE namespace_catalog.nspname = 'public'::pg_catalog.name
       AND relation_catalog.relname = v_table_name
       AND relation_catalog.relkind = 'r'::pg_catalog."char";

    IF v_relation_oid IS NULL THEN
      RAISE EXCEPTION 'DB-01 prerequisite missing: public.%', v_table_name;
    END IF;

    SELECT pg_catalog.array_agg(
             attribute_catalog.attname::text
             || ':' || pg_catalog.format_type(
               attribute_catalog.atttypid,
               attribute_catalog.atttypmod
             )
             || ':' || CASE WHEN attribute_catalog.attnotnull THEN 'not_null' ELSE 'nullable' END
             || ':' || attribute_catalog.attidentity::text
             ORDER BY attribute_catalog.attnum
           )
      INTO v_observed_columns
      FROM pg_catalog.pg_attribute AS attribute_catalog
     WHERE attribute_catalog.attrelid = v_relation_oid
       AND attribute_catalog.attnum > 0
       AND NOT attribute_catalog.attisdropped;

    IF v_observed_columns IS DISTINCT FROM v_expected_columns THEN
      RAISE EXCEPTION 'DB-01 legacy table shape drift on public.%', v_table_name;
    END IF;

    IF NOT COALESCE((
      SELECT relation_catalog.relrowsecurity
             AND NOT relation_catalog.relforcerowsecurity
             AND pg_catalog.pg_get_userbyid(relation_catalog.relowner) = 'postgres'
             AND EXISTS (
               SELECT 1
                 FROM pg_catalog.pg_constraint AS constraint_catalog
                WHERE constraint_catalog.conrelid = relation_catalog.oid
                  AND constraint_catalog.contype = 'p'::pg_catalog."char"
             )
        FROM pg_catalog.pg_class AS relation_catalog
       WHERE relation_catalog.oid = v_relation_oid
    ), false) THEN
      RAISE EXCEPTION 'DB-01 legacy RLS/owner/primary-key precondition drift on public.%', v_table_name;
    END IF;

    SELECT policy_catalog.*
      INTO v_policy
      FROM pg_catalog.pg_policy AS policy_catalog
     WHERE policy_catalog.polrelid = v_relation_oid
       AND policy_catalog.polname = v_expected_select_policy;

    IF NOT FOUND
       OR v_policy.polcmd <> 'r'::pg_catalog."char"
       OR NOT v_policy.polpermissive
       OR v_policy.polroles IS DISTINCT FROM ARRAY[v_authenticated_oid]::pg_catalog.oid[]
       OR pg_catalog.pg_get_expr(v_policy.polqual, v_relation_oid) <> 'true'
       OR v_policy.polwithcheck IS NOT NULL THEN
      RAISE EXCEPTION
        'DB-01 expected broad authenticated SELECT policy definition drift on public.%',
        v_table_name;
    END IF;
  END LOOP;

  SELECT pg_catalog.md5(
           pg_catalog.concat_ws(
             E'\n',
             'db01-legacy-public-catalog-v2',
             'auth.uid=' || (pg_catalog.to_regprocedure('auth.uid()') IS NOT NULL)::text,
             (
               SELECT pg_catalog.string_agg(
                 'relation=' || namespace_catalog.nspname || '.' || relation_catalog.relname
                 || '|kind=' || relation_catalog.relkind::text
                 || '|owner=' || pg_catalog.pg_get_userbyid(relation_catalog.relowner)
                 || '|rls=' || relation_catalog.relrowsecurity::text
                 || '|force_rls=' || relation_catalog.relforcerowsecurity::text
                 || '|primary_key=' || EXISTS (
                   SELECT 1
                     FROM pg_catalog.pg_constraint AS constraint_catalog
                    WHERE constraint_catalog.conrelid = relation_catalog.oid
                      AND constraint_catalog.contype = 'p'::pg_catalog."char"
                 )::text
                 || '|columns=[' || COALESCE((
                   SELECT pg_catalog.string_agg(
                     attribute_catalog.attnum::text || ':' || attribute_catalog.attname::text
                     || ':' || pg_catalog.format_type(
                       attribute_catalog.atttypid,
                       attribute_catalog.atttypmod
                     )
                     || ':' || attribute_catalog.attnotnull::text
                     || ':' || attribute_catalog.attidentity::text,
                     ',' ORDER BY attribute_catalog.attnum
                   )
                     FROM pg_catalog.pg_attribute AS attribute_catalog
                    WHERE attribute_catalog.attrelid = relation_catalog.oid
                      AND attribute_catalog.attnum > 0
                      AND NOT attribute_catalog.attisdropped
                 ), '') || ']'
                 || '|policies=[' || COALESCE((
                   SELECT pg_catalog.string_agg(
                     policy_catalog.polname::text
                     || ':cmd=' || policy_catalog.polcmd::text
                     || ':permissive=' || policy_catalog.polpermissive::text
                     || ':roles=' || COALESCE((
                       SELECT pg_catalog.string_agg(
                         CASE WHEN policy_role.role_oid = 0::pg_catalog.oid
                              THEN 'PUBLIC'
                              ELSE pg_catalog.pg_get_userbyid(policy_role.role_oid)
                         END,
                         ',' ORDER BY CASE WHEN policy_role.role_oid = 0::pg_catalog.oid
                                           THEN 'PUBLIC'
                                           ELSE pg_catalog.pg_get_userbyid(policy_role.role_oid)
                                      END
                       )
                         FROM pg_catalog.unnest(policy_catalog.polroles)
                              AS policy_role(role_oid)
                     ), '')
                     || ':qual=' || COALESCE(
                       pg_catalog.pg_get_expr(policy_catalog.polqual, policy_catalog.polrelid),
                       '<null>'
                     )
                     || ':with_check=' || COALESCE(
                       pg_catalog.pg_get_expr(policy_catalog.polwithcheck, policy_catalog.polrelid),
                       '<null>'
                     ),
                     ',' ORDER BY policy_catalog.polname
                   )
                     FROM pg_catalog.pg_policy AS policy_catalog
                    WHERE policy_catalog.polrelid = relation_catalog.oid
                 ), '') || ']'
                 , E'\n' ORDER BY relation_catalog.relname
               )
                 FROM pg_catalog.pg_class AS relation_catalog
                 INNER JOIN pg_catalog.pg_namespace AS namespace_catalog
                   ON namespace_catalog.oid = relation_catalog.relnamespace
                WHERE namespace_catalog.nspname = 'public'::pg_catalog.name
                  AND relation_catalog.relname = ANY (
                    ARRAY['circles', 'follows', 'profiles']::pg_catalog.name[]
                  )
                  AND relation_catalog.relkind = 'r'::pg_catalog."char"
             ),
             (
               SELECT pg_catalog.string_agg(
                 'privilege=' || relation_catalog.relname::text || ':' || role_catalog.rolname::text
                 || ':select=' || pg_catalog.has_table_privilege(
                   role_catalog.rolname, relation_catalog.oid, 'SELECT'
                 )::text
                 || ':insert=' || pg_catalog.has_table_privilege(
                   role_catalog.rolname, relation_catalog.oid, 'INSERT'
                 )::text
                 || ':update=' || pg_catalog.has_table_privilege(
                   role_catalog.rolname, relation_catalog.oid, 'UPDATE'
                 )::text
                 || ':delete=' || pg_catalog.has_table_privilege(
                   role_catalog.rolname, relation_catalog.oid, 'DELETE'
                 )::text
                 || ':truncate=' || pg_catalog.has_table_privilege(
                   role_catalog.rolname, relation_catalog.oid, 'TRUNCATE'
                 )::text,
                 E'\n' ORDER BY relation_catalog.relname, role_catalog.rolname
               )
                 FROM pg_catalog.pg_class AS relation_catalog
                 INNER JOIN pg_catalog.pg_namespace AS namespace_catalog
                   ON namespace_catalog.oid = relation_catalog.relnamespace
                 CROSS JOIN pg_catalog.pg_roles AS role_catalog
                WHERE namespace_catalog.nspname = 'public'::pg_catalog.name
                  AND relation_catalog.relname = ANY (
                    ARRAY['circles', 'follows', 'profiles']::pg_catalog.name[]
                  )
                  AND relation_catalog.relkind = 'r'::pg_catalog."char"
                  AND role_catalog.rolname = ANY (
                    ARRAY['anon', 'authenticated', 'circles_app_runtime', 'service_role']
                      ::pg_catalog.name[]
                  )
             )
           )
         )
    INTO v_observed_fingerprint;

  IF v_observed_fingerprint IS DISTINCT FROM v_expected_pre_fingerprint THEN
    RAISE EXCEPTION
      'DB-01 strict current-catalog fingerprint drift (expected %, observed %)',
      v_expected_pre_fingerprint,
      v_observed_fingerprint;
  END IF;
END;
$db01_preflight$;

-- V1 semantics intentionally preserve public discovery while refusing non-owner private-circle,
-- cross-profile, and inbound/third-party follow-graph reads. No membership mapping is inferred.
ALTER POLICY "Signed in members can discover circle listings"
  ON public.circles
  USING ((is_private IS FALSE) OR (owner_id = (SELECT auth.uid())));

ALTER POLICY "Profiles are visible to signed in members"
  ON public.profiles
  USING (id = (SELECT auth.uid()));

ALTER POLICY "Members see follows"
  ON public.follows
  USING (follower_id = (SELECT auth.uid()));

DO $db01_postflight$
DECLARE
  v_expected_post_fingerprint constant text := '26a7a9555d07c124e6f98a30dd943a6b';
  v_observed_fingerprint text;
  v_authenticated_oid pg_catalog.oid;
BEGIN
  SELECT role_catalog.oid
    INTO v_authenticated_oid
    FROM pg_catalog.pg_roles AS role_catalog
   WHERE role_catalog.rolname = 'authenticated'::pg_catalog.name;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy_catalog
     WHERE policy_catalog.polrelid = 'public.circles'::pg_catalog.regclass
       AND policy_catalog.polname = 'Signed in members can discover circle listings'
       AND policy_catalog.polcmd = 'r'::pg_catalog."char"
       AND policy_catalog.polpermissive
       AND policy_catalog.polroles = ARRAY[v_authenticated_oid]::pg_catalog.oid[]
       AND pg_catalog.pg_get_expr(policy_catalog.polqual, policy_catalog.polrelid)
             = '((is_private IS FALSE) OR (owner_id = ( SELECT auth.uid() AS uid)))'
       AND policy_catalog.polwithcheck IS NULL
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy_catalog
     WHERE policy_catalog.polrelid = 'public.profiles'::pg_catalog.regclass
       AND policy_catalog.polname = 'Profiles are visible to signed in members'
       AND policy_catalog.polcmd = 'r'::pg_catalog."char"
       AND policy_catalog.polpermissive
       AND policy_catalog.polroles = ARRAY[v_authenticated_oid]::pg_catalog.oid[]
       AND pg_catalog.pg_get_expr(policy_catalog.polqual, policy_catalog.polrelid)
             = '(id = ( SELECT auth.uid() AS uid))'
       AND policy_catalog.polwithcheck IS NULL
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy_catalog
     WHERE policy_catalog.polrelid = 'public.follows'::pg_catalog.regclass
       AND policy_catalog.polname = 'Members see follows'
       AND policy_catalog.polcmd = 'r'::pg_catalog."char"
       AND policy_catalog.polpermissive
       AND policy_catalog.polroles = ARRAY[v_authenticated_oid]::pg_catalog.oid[]
       AND pg_catalog.pg_get_expr(policy_catalog.polqual, policy_catalog.polrelid)
             = '(follower_id = ( SELECT auth.uid() AS uid))'
       AND policy_catalog.polwithcheck IS NULL
  ) THEN
    RAISE EXCEPTION 'DB-01 narrow policy postflight definition drift';
  END IF;

  -- This is the same intentionally complete, row-free inventory as preflight. A separate block
  -- keeps the applied file standalone and lets postflight prove grants/unrelated policies stayed
  -- pinned while the three expected predicates changed.
  SELECT pg_catalog.md5(
           pg_catalog.concat_ws(
             E'\n',
             'db01-legacy-public-catalog-v2',
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

  IF v_observed_fingerprint IS DISTINCT FROM v_expected_post_fingerprint THEN
    RAISE EXCEPTION
      'DB-01 strict postflight catalog fingerprint drift (expected %, observed %)',
      v_expected_post_fingerprint,
      v_observed_fingerprint;
  END IF;
END;
$db01_postflight$;

COMMIT;
