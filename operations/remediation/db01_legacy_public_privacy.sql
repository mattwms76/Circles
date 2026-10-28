-- DB-01 candidate only. Do not apply without the parent-approved legacy compatibility
-- and privacy-contract review described in docs/database-remediation/DB-01.md.
--
-- This is a new, guarded remediation file rather than an edit to historical migrations.
-- It alters exactly the three audited authenticated SELECT policies on the UUID-era
-- public tables. It does not grant/revoke table privileges, alter DML policies, create
-- a compatibility view, change auth identity mapping, or touch current circles_app data.
--
-- The approval setting is an accidental-activation rail, not an authorization boundary:
-- the reviewed operator must set it on the same controlled session before this file runs.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $db01_approval_gate$
BEGIN
  IF pg_catalog.current_setting('circles.db01_legacy_public_privacy_contract', true)
       IS DISTINCT FROM 'DB01_LEGACY_PUBLIC_PRIVACY_APPROVED_V1' THEN
    RAISE EXCEPTION
      'DB-01 requires explicit legacy compatibility/privacy approval in the same session';
  END IF;
END;
$db01_approval_gate$;

-- Fail closed unless the audited legacy relations, table shape, ownership/RLS flags,
-- direct grants, and the exact broad SELECT policies still match the 2026-10-27 catalog.
DO $db01_preflight$
DECLARE
  v_authenticated_oid pg_catalog.oid;
  v_relation_oid pg_catalog.oid;
  v_table_name pg_catalog.name;
  v_expected_columns text[];
  v_expected_policy_name text;
  v_observed_columns text[];
  v_policy pg_catalog.pg_policy%ROWTYPE;
BEGIN
  SELECT role_catalog.oid
    INTO v_authenticated_oid
    FROM pg_catalog.pg_roles AS role_catalog
   WHERE role_catalog.rolname = 'authenticated'::pg_catalog.name;

  IF v_authenticated_oid IS NULL THEN
    RAISE EXCEPTION 'DB-01 prerequisite missing: role authenticated';
  END IF;

  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'DB-01 prerequisite missing: auth.uid()';
  END IF;

  FOR v_table_name, v_expected_columns, v_expected_policy_name IN
    SELECT *
    FROM (
      VALUES
        (
          'circles'::pg_catalog.name,
          ARRAY[
            'id:uuid:not_null',
            'owner_id:uuid:nullable',
            'name:text:not_null',
            'description:text:not_null',
            'interest:text:not_null',
            'is_private:boolean:not_null',
            'members_count:integer:not_null',
            'cover_url:text:nullable',
            'cover_color:text:not_null',
            'created_at:timestamp with time zone:not_null',
            'welcome_text:text:not_null',
            'last_activity_at:timestamp with time zone:not_null',
            'rules:text:not_null'
          ]::text[],
          'Signed in members can discover circle listings'::text
        ),
        (
          'profiles'::pg_catalog.name,
          ARRAY[
            'id:uuid:not_null',
            'handle:text:not_null',
            'display_name:text:not_null',
            'avatar_url:text:nullable',
            'bio:text:not_null',
            'interests:text[]:not_null',
            'created_at:timestamp with time zone:not_null',
            'onboarding_completed_at:timestamp with time zone:nullable'
          ]::text[],
          'Profiles are visible to signed in members'::text
        ),
        (
          'follows'::pg_catalog.name,
          ARRAY[
            'follower_id:uuid:not_null',
            'followee_id:uuid:not_null',
            'created_at:timestamp with time zone:not_null'
          ]::text[],
          'Members see follows'::text
        )
    ) AS expected(table_name, expected_columns, policy_name)
  LOOP
    SELECT relation_catalog.oid
      INTO v_relation_oid
      FROM pg_catalog.pg_class AS relation_catalog
      INNER JOIN pg_catalog.pg_namespace AS namespace_catalog
        ON namespace_catalog.oid = relation_catalog.relnamespace
     WHERE namespace_catalog.nspname = 'public'::pg_catalog.name
       AND relation_catalog.relname = v_table_name
       AND relation_catalog.relkind IN ('r'::pg_catalog."char", 'p'::pg_catalog."char");

    IF v_relation_oid IS NULL THEN
      RAISE EXCEPTION 'DB-01 prerequisite missing: public.%', v_table_name;
    END IF;

    SELECT pg_catalog.array_agg(
             attribute_catalog.attname::text
             || ':' || pg_catalog.format_type(
               attribute_catalog.atttypid,
               attribute_catalog.atttypmod
             )
             || ':' || CASE
               WHEN attribute_catalog.attnotnull THEN 'not_null'
               ELSE 'nullable'
             END
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
        FROM pg_catalog.pg_class AS relation_catalog
       WHERE relation_catalog.oid = v_relation_oid
    ), false) THEN
      RAISE EXCEPTION 'DB-01 legacy RLS/owner precondition drift on public.%', v_table_name;
    END IF;

    IF NOT pg_catalog.has_table_privilege(
      'authenticated',
      v_relation_oid,
      'SELECT'
    )
    OR pg_catalog.has_table_privilege('anon', v_relation_oid, 'SELECT')
    OR pg_catalog.has_table_privilege(
      'circles_app_runtime',
      v_relation_oid,
      'SELECT'
    ) THEN
      RAISE EXCEPTION 'DB-01 legacy direct SELECT grant precondition drift on public.%', v_table_name;
    END IF;

    IF (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_policy AS policy_catalog
      WHERE policy_catalog.polrelid = v_relation_oid
        AND policy_catalog.polcmd IN ('r'::pg_catalog."char", '*'::pg_catalog."char")
        AND (
          policy_catalog.polroles = ARRAY[v_authenticated_oid]::pg_catalog.oid[]
          OR policy_catalog.polroles = ARRAY[0::pg_catalog.oid]::pg_catalog.oid[]
        )
    ) <> 1 THEN
      RAISE EXCEPTION 'DB-01 expected exactly one authenticated SELECT policy on public.%', v_table_name;
    END IF;

    SELECT policy_catalog.*
      INTO v_policy
      FROM pg_catalog.pg_policy AS policy_catalog
     WHERE policy_catalog.polrelid = v_relation_oid
       AND policy_catalog.polname = v_expected_policy_name::pg_catalog.name;

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
END;
$db01_preflight$;

-- Restrict only the audit-confirmed broad reads. The predicates deliberately reuse the
-- legacy UUID/auth.uid() relationship already present in adjacent write policies; no new
-- user or membership mapping is inferred. A private circle is visible only to its owner,
-- profile onboarding/interests remain visible only to the profile subject, and a follow
-- edge is visible only to its follower.
ALTER POLICY "Signed in members can discover circle listings"
  ON public.circles
  USING ((is_private IS FALSE) OR (owner_id = (SELECT auth.uid())));

ALTER POLICY "Profiles are visible to signed in members"
  ON public.profiles
  USING (id = (SELECT auth.uid()));

ALTER POLICY "Members see follows"
  ON public.follows
  USING (follower_id = (SELECT auth.uid()));

-- Verify the narrow post-state and retain the audited direct-grant boundary. This does
-- not certify application compatibility or end-user/provider behavior; it only proves
-- the installed catalog matches this candidate's precise policy contract.
DO $db01_postflight$
DECLARE
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
      AND pg_catalog.pg_get_expr(
        policy_catalog.polqual,
        policy_catalog.polrelid
      ) = '((is_private IS FALSE) OR (owner_id = ( SELECT auth.uid() AS uid)))'
      AND policy_catalog.polwithcheck IS NULL
  ) OR (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_policy AS policy_catalog
    WHERE policy_catalog.polrelid = 'public.circles'::pg_catalog.regclass
      AND policy_catalog.polcmd IN ('r'::pg_catalog."char", '*'::pg_catalog."char")
      AND (
        policy_catalog.polroles = ARRAY[v_authenticated_oid]::pg_catalog.oid[]
        OR policy_catalog.polroles = ARRAY[0::pg_catalog.oid]::pg_catalog.oid[]
      )
  ) <> 1 THEN
    RAISE EXCEPTION 'DB-01 postflight failed for public.circles SELECT policy';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy_catalog
    WHERE policy_catalog.polrelid = 'public.profiles'::pg_catalog.regclass
      AND policy_catalog.polname = 'Profiles are visible to signed in members'
      AND policy_catalog.polcmd = 'r'::pg_catalog."char"
      AND policy_catalog.polpermissive
      AND policy_catalog.polroles = ARRAY[v_authenticated_oid]::pg_catalog.oid[]
      AND pg_catalog.pg_get_expr(
        policy_catalog.polqual,
        policy_catalog.polrelid
      ) = '(id = ( SELECT auth.uid() AS uid))'
      AND policy_catalog.polwithcheck IS NULL
  ) OR (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_policy AS policy_catalog
    WHERE policy_catalog.polrelid = 'public.profiles'::pg_catalog.regclass
      AND policy_catalog.polcmd IN ('r'::pg_catalog."char", '*'::pg_catalog."char")
      AND (
        policy_catalog.polroles = ARRAY[v_authenticated_oid]::pg_catalog.oid[]
        OR policy_catalog.polroles = ARRAY[0::pg_catalog.oid]::pg_catalog.oid[]
      )
  ) <> 1 THEN
    RAISE EXCEPTION 'DB-01 postflight failed for public.profiles SELECT policy';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy_catalog
    WHERE policy_catalog.polrelid = 'public.follows'::pg_catalog.regclass
      AND policy_catalog.polname = 'Members see follows'
      AND policy_catalog.polcmd = 'r'::pg_catalog."char"
      AND policy_catalog.polpermissive
      AND policy_catalog.polroles = ARRAY[v_authenticated_oid]::pg_catalog.oid[]
      AND pg_catalog.pg_get_expr(
        policy_catalog.polqual,
        policy_catalog.polrelid
      ) = '(follower_id = ( SELECT auth.uid() AS uid))'
      AND policy_catalog.polwithcheck IS NULL
  ) OR (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_policy AS policy_catalog
    WHERE policy_catalog.polrelid = 'public.follows'::pg_catalog.regclass
    AND policy_catalog.polcmd IN ('r'::pg_catalog."char", '*'::pg_catalog."char")
      AND (
        policy_catalog.polroles = ARRAY[v_authenticated_oid]::pg_catalog.oid[]
        OR policy_catalog.polroles = ARRAY[0::pg_catalog.oid]::pg_catalog.oid[]
      )
  ) <> 1 THEN
    RAISE EXCEPTION 'DB-01 postflight failed for public.follows SELECT policy';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
    'authenticated',
    'public.circles'::pg_catalog.regclass,
    'SELECT'
  )
  OR NOT pg_catalog.has_table_privilege(
    'authenticated',
    'public.profiles'::pg_catalog.regclass,
    'SELECT'
  )
  OR NOT pg_catalog.has_table_privilege(
    'authenticated',
    'public.follows'::pg_catalog.regclass,
    'SELECT'
  )
  OR pg_catalog.has_table_privilege(
    'anon',
    'public.circles'::pg_catalog.regclass,
    'SELECT'
  )
  OR pg_catalog.has_table_privilege(
    'anon',
    'public.profiles'::pg_catalog.regclass,
    'SELECT'
  )
  OR pg_catalog.has_table_privilege(
    'anon',
    'public.follows'::pg_catalog.regclass,
    'SELECT'
  )
  OR pg_catalog.has_table_privilege(
    'circles_app_runtime',
    'public.circles'::pg_catalog.regclass,
    'SELECT'
  )
  OR pg_catalog.has_table_privilege(
    'circles_app_runtime',
    'public.profiles'::pg_catalog.regclass,
    'SELECT'
  )
  OR pg_catalog.has_table_privilege(
    'circles_app_runtime',
    'public.follows'::pg_catalog.regclass,
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'DB-01 postflight direct SELECT grant boundary drift';
  END IF;
END;
$db01_postflight$;

COMMIT;
