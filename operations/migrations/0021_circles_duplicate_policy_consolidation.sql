-- DB-09: consolidate only the catalog-confirmed duplicate permissive policies.
-- Apply only through the reviewed private PostgreSQL migration process after a disposable PG17 drill.
-- This migration changes no table ACL, role membership, RLS setting, function, trigger, row, or schema grant.
-- It accepts only the reviewed twelve-policy pre-state or the exact consolidated post-state.
BEGIN;

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('circles.db09.duplicate-policy-consolidation.v1'::text, 0)
);

DO $db09_duplicate_policy_preflight$
DECLARE
  v_required_role_count integer;
  v_duplicate_count integer;
  v_invalid_target_count integer;
  v_invalid_native_count integer;
  v_invalid_browser_policy_count integer;
  v_browser_access_violation_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO v_required_role_count
    FROM pg_catalog.pg_roles AS role_catalog
   WHERE role_catalog.rolname IN (
     'circles_admin_runtime'::pg_catalog.name,
     'circles_admin_native_executor'::pg_catalog.name,
     'anon'::pg_catalog.name,
     'authenticated'::pg_catalog.name
   );

  IF v_required_role_count <> 4 THEN
    RAISE EXCEPTION 'DB-09 requires circles_admin_runtime, circles_admin_native_executor, anon, and authenticated roles';
  END IF;

  -- The exact pair comparison is on the catalog role OID array, command, permissive flag,
  -- and raw expression node trees. The expected expressions also prevent two identically
  -- misconfigured policies from being treated as an approved duplicate.
  WITH expected_pairs(
    schema_name,
    table_name,
    survivor_name,
    duplicate_name,
    expected_cmd,
    expected_qual,
    expected_check
  ) AS (
    VALUES
      ('circles_app'::pg_catalog.name, 'circles'::pg_catalog.name, 'circles_admin_read_circles'::pg_catalog.name, 'circles_admin_parity_read_circles'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::text, NULL::text),
      ('circles_app'::pg_catalog.name, 'comments'::pg_catalog.name, 'circles_admin_read_comments'::pg_catalog.name, 'circles_admin_parity_read_comments'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::text, NULL::text),
      ('circles_app'::pg_catalog.name, 'liveViewers'::pg_catalog.name, 'circles_admin_read_liveviewers'::pg_catalog.name, 'circles_admin_parity_read_liveviewers'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::text, NULL::text),
      ('circles_app'::pg_catalog.name, 'memberships'::pg_catalog.name, 'circles_admin_read_memberships'::pg_catalog.name, 'circles_admin_parity_read_memberships'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::text, NULL::text),
      ('circles_app'::pg_catalog.name, 'posts'::pg_catalog.name, 'circles_admin_read_posts'::pg_catalog.name, 'circles_admin_parity_read_posts'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::text, NULL::text),
      ('circles_app'::pg_catalog.name, 'profiles'::pg_catalog.name, 'circles_admin_read_profiles'::pg_catalog.name, 'circles_admin_parity_read_profiles'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::text, NULL::text),
      ('circles_app'::pg_catalog.name, 'reactions'::pg_catalog.name, 'circles_admin_read_reactions'::pg_catalog.name, 'circles_admin_parity_read_reactions'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::text, NULL::text),
      ('circles_app'::pg_catalog.name, 'reports'::pg_catalog.name, 'circles_admin_read_reports'::pg_catalog.name, 'circles_admin_parity_read_reports'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::text, NULL::text),
      ('circles_app'::pg_catalog.name, 'streams'::pg_catalog.name, 'circles_admin_read_streams'::pg_catalog.name, 'circles_admin_parity_read_streams'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::text, NULL::text),
      ('circles_app'::pg_catalog.name, 'users'::pg_catalog.name, 'circles_admin_read_users'::pg_catalog.name, 'circles_admin_parity_read_users'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::text, NULL::text),
      ('circles_admin'::pg_catalog.name, 'audit'::pg_catalog.name, 'circles_admin_runtime_audit_select'::pg_catalog.name, 'circles_admin_parity_audit_read'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::text, NULL::text),
      ('circles_admin'::pg_catalog.name, 'audit'::pg_catalog.name, 'circles_admin_runtime_audit_insert'::pg_catalog.name, 'circles_admin_parity_audit_append'::pg_catalog.name, 'a'::pg_catalog."char", NULL::text, '(EXISTS ( SELECT 1 FROM circles_admin.operators o WHERE ((o.id = audit.actor_operator_id) AND ((o.status)::text = ''active''::text) AND ((o.role)::text = (audit.actor_role)::text))))'::text)
  ), role_oids AS (
    SELECT role_catalog.oid AS runtime_oid
    FROM pg_catalog.pg_roles AS role_catalog
    WHERE role_catalog.rolname = 'circles_admin_runtime'::pg_catalog.name
  ), observed AS (
    SELECT
      expected_pairs.*,
      role_oids.runtime_oid,
      relation_catalog.oid AS relation_oid,
      relation_catalog.relkind AS relation_kind,
      relation_catalog.relrowsecurity AS rls_enabled,
      survivor.oid AS survivor_oid,
      survivor.polroles AS survivor_roles,
      survivor.polcmd AS survivor_cmd,
      survivor.polpermissive AS survivor_permissive,
      survivor.polqual::text AS survivor_qual_tree,
      survivor.polwithcheck::text AS survivor_check_tree,
      pg_catalog.regexp_replace(
        pg_catalog.pg_get_expr(survivor.polqual, relation_catalog.oid),
        '[[:space:]]+',
        ' ',
        'g'
      ) AS survivor_qual,
      pg_catalog.regexp_replace(
        pg_catalog.pg_get_expr(survivor.polwithcheck, relation_catalog.oid),
        '[[:space:]]+',
        ' ',
        'g'
      ) AS survivor_check,
      duplicate.oid AS duplicate_oid,
      duplicate.polroles AS duplicate_roles,
      duplicate.polcmd AS duplicate_cmd,
      duplicate.polpermissive AS duplicate_permissive,
      duplicate.polqual::text AS duplicate_qual_tree,
      duplicate.polwithcheck::text AS duplicate_check_tree,
      pg_catalog.regexp_replace(
        pg_catalog.pg_get_expr(duplicate.polqual, relation_catalog.oid),
        '[[:space:]]+',
        ' ',
        'g'
      ) AS duplicate_qual,
      pg_catalog.regexp_replace(
        pg_catalog.pg_get_expr(duplicate.polwithcheck, relation_catalog.oid),
        '[[:space:]]+',
        ' ',
        'g'
      ) AS duplicate_check
    FROM expected_pairs
    CROSS JOIN role_oids
    LEFT JOIN pg_catalog.pg_namespace AS namespace_catalog
      ON namespace_catalog.nspname = expected_pairs.schema_name
    LEFT JOIN pg_catalog.pg_class AS relation_catalog
      ON relation_catalog.relnamespace = namespace_catalog.oid
     AND relation_catalog.relname = expected_pairs.table_name
    LEFT JOIN pg_catalog.pg_policy AS survivor
      ON survivor.polrelid = relation_catalog.oid
     AND survivor.polname = expected_pairs.survivor_name
    LEFT JOIN pg_catalog.pg_policy AS duplicate
      ON duplicate.polrelid = relation_catalog.oid
     AND duplicate.polname = expected_pairs.duplicate_name
  )
  SELECT
    pg_catalog.count(*) FILTER (WHERE duplicate_oid IS NOT NULL)::integer,
    pg_catalog.count(*) FILTER (
      WHERE relation_oid IS NULL
         OR relation_kind IS DISTINCT FROM 'r'::pg_catalog."char"
         OR rls_enabled IS NOT TRUE
         OR survivor_oid IS NULL
         OR survivor_roles IS DISTINCT FROM ARRAY[runtime_oid]::pg_catalog.oid[]
         OR survivor_cmd IS DISTINCT FROM expected_cmd
         OR survivor_permissive IS NOT TRUE
         OR survivor_qual IS DISTINCT FROM expected_qual
         OR survivor_check IS DISTINCT FROM expected_check
         OR (
           duplicate_oid IS NOT NULL
           AND (
             duplicate_roles IS DISTINCT FROM survivor_roles
             OR duplicate_cmd IS DISTINCT FROM survivor_cmd
             OR duplicate_permissive IS DISTINCT FROM survivor_permissive
             OR duplicate_qual_tree IS DISTINCT FROM survivor_qual_tree
             OR duplicate_check_tree IS DISTINCT FROM survivor_check_tree
             OR duplicate_roles IS DISTINCT FROM ARRAY[runtime_oid]::pg_catalog.oid[]
             OR duplicate_cmd IS DISTINCT FROM expected_cmd
             OR duplicate_permissive IS NOT TRUE
             OR duplicate_qual IS DISTINCT FROM expected_qual
             OR duplicate_check IS DISTINCT FROM expected_check
           )
         )
    )::integer
  INTO v_duplicate_count, v_invalid_target_count
  FROM observed;

  IF v_invalid_target_count <> 0 THEN
    RAISE EXCEPTION 'DB-09 refused: a selected survivor or duplicate policy is missing, unexpected, or not an exact reviewed definition';
  END IF;

  IF v_duplicate_count NOT IN (0, 12) THEN
    RAISE EXCEPTION 'DB-09 refused: expected either all 12 duplicate policies or the exact zero-duplicate post-state, found %', v_duplicate_count;
  END IF;

  -- Preserve the reviewed native-executor paths. These are policy checks only; this migration does
  -- not modify any table ACL or native-executor role membership.
  WITH expected_native_policies(
    schema_name,
    table_name,
    policy_name,
    expected_permissive,
    expected_cmd,
    expected_qual,
    expected_check
  ) AS (
    VALUES
      ('circles_admin'::pg_catalog.name, 'audit'::pg_catalog.name, 'circles_admin_native_audit_read'::pg_catalog.name, true, 'r'::pg_catalog."char", 'true'::text, NULL::text),
      ('circles_admin'::pg_catalog.name, 'audit'::pg_catalog.name, 'circles_admin_native_audit_append'::pg_catalog.name, true, 'a'::pg_catalog."char", NULL::text, 'true'::text),
      ('circles_app'::pg_catalog.name, 'circles'::pg_catalog.name, 'circles_admin_native_exec_circles'::pg_catalog.name, true, '*'::pg_catalog."char", 'true'::text, 'true'::text),
      ('circles_app'::pg_catalog.name, 'memberships'::pg_catalog.name, 'circles_admin_native_exec_memberships'::pg_catalog.name, true, '*'::pg_catalog."char", 'true'::text, 'true'::text),
      ('circles_app'::pg_catalog.name, 'posts'::pg_catalog.name, 'circles_admin_native_exec_posts'::pg_catalog.name, true, '*'::pg_catalog."char", 'true'::text, 'true'::text),
      ('circles_app'::pg_catalog.name, 'profiles'::pg_catalog.name, 'circles_admin_native_exec_profiles'::pg_catalog.name, true, '*'::pg_catalog."char", 'true'::text, 'true'::text),
      ('circles_app'::pg_catalog.name, 'streams'::pg_catalog.name, 'circles_admin_native_exec_streams'::pg_catalog.name, true, '*'::pg_catalog."char", 'true'::text, 'true'::text),
      ('circles_app'::pg_catalog.name, 'users'::pg_catalog.name, 'circles_admin_native_exec_users'::pg_catalog.name, true, '*'::pg_catalog."char", 'true'::text, 'true'::text),
      ('circles_app'::pg_catalog.name, 'users'::pg_catalog.name, 'circles_admin_native_users_lock_only'::pg_catalog.name, false, 'w'::pg_catalog."char", 'true'::text, 'false'::text)
  ), role_oids AS (
    SELECT role_catalog.oid AS native_executor_oid
    FROM pg_catalog.pg_roles AS role_catalog
   WHERE role_catalog.rolname = 'circles_admin_native_executor'::pg_catalog.name
  )
  SELECT pg_catalog.count(*)::integer
    INTO v_invalid_native_count
    FROM expected_native_policies
    CROSS JOIN role_oids
    LEFT JOIN pg_catalog.pg_namespace AS namespace_catalog
      ON namespace_catalog.nspname = expected_native_policies.schema_name
    LEFT JOIN pg_catalog.pg_class AS relation_catalog
      ON relation_catalog.relnamespace = namespace_catalog.oid
     AND relation_catalog.relname = expected_native_policies.table_name
    LEFT JOIN pg_catalog.pg_policy AS policy_catalog
      ON policy_catalog.polrelid = relation_catalog.oid
     AND policy_catalog.polname = expected_native_policies.policy_name
   WHERE relation_catalog.oid IS NULL
      OR policy_catalog.oid IS NULL
      OR policy_catalog.polroles IS DISTINCT FROM ARRAY[role_oids.native_executor_oid]::pg_catalog.oid[]
      OR policy_catalog.polpermissive IS DISTINCT FROM expected_native_policies.expected_permissive
      OR policy_catalog.polcmd IS DISTINCT FROM expected_native_policies.expected_cmd
      OR pg_catalog.regexp_replace(
           pg_catalog.pg_get_expr(policy_catalog.polqual, relation_catalog.oid),
           '[[:space:]]+',
           ' ',
           'g'
         ) IS DISTINCT FROM expected_native_policies.expected_qual
      OR pg_catalog.regexp_replace(
           pg_catalog.pg_get_expr(policy_catalog.polwithcheck, relation_catalog.oid),
           '[[:space:]]+',
           ' ',
           'g'
         ) IS DISTINCT FROM expected_native_policies.expected_check;

  IF v_invalid_native_count <> 0 THEN
    RAISE EXCEPTION 'DB-09 refused: a reviewed native-executor policy is missing or has an unexpected definition';
  END IF;

  -- The selected circles_app relations keep their explicit restrictive browser denial. The audit
  -- relation is separately included in the ACL check below because it intentionally has no browser policy.
  WITH expected_browser_denials(schema_name, table_name) AS (
    VALUES
      ('circles_app'::pg_catalog.name, 'circles'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'comments'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'liveViewers'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'memberships'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'posts'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'profiles'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'reactions'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'reports'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'streams'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'users'::pg_catalog.name)
  ), role_oids AS (
    SELECT
      (
        SELECT role_catalog.oid
        FROM pg_catalog.pg_roles AS role_catalog
        WHERE role_catalog.rolname = 'anon'::pg_catalog.name
      ) AS anon_oid,
      (
        SELECT role_catalog.oid
        FROM pg_catalog.pg_roles AS role_catalog
        WHERE role_catalog.rolname = 'authenticated'::pg_catalog.name
      ) AS authenticated_oid
  )
  SELECT pg_catalog.count(*)::integer
    INTO v_invalid_browser_policy_count
    FROM expected_browser_denials
    CROSS JOIN role_oids
    LEFT JOIN pg_catalog.pg_namespace AS namespace_catalog
      ON namespace_catalog.nspname = expected_browser_denials.schema_name
    LEFT JOIN pg_catalog.pg_class AS relation_catalog
      ON relation_catalog.relnamespace = namespace_catalog.oid
     AND relation_catalog.relname = expected_browser_denials.table_name
    LEFT JOIN pg_catalog.pg_policy AS policy_catalog
      ON policy_catalog.polrelid = relation_catalog.oid
     AND policy_catalog.polname = 'circles_app_deny_anon_authenticated'::pg_catalog.name
   WHERE relation_catalog.oid IS NULL
      OR policy_catalog.oid IS NULL
      OR policy_catalog.polpermissive IS NOT FALSE
      OR policy_catalog.polcmd IS DISTINCT FROM '*'::pg_catalog."char"
      OR policy_catalog.polroles IS DISTINCT FROM ARRAY[role_oids.anon_oid, role_oids.authenticated_oid]::pg_catalog.oid[]
      OR pg_catalog.regexp_replace(
           pg_catalog.pg_get_expr(policy_catalog.polqual, relation_catalog.oid),
           '[[:space:]]+',
           ' ',
           'g'
         ) IS DISTINCT FROM 'false'::text
      OR pg_catalog.regexp_replace(
           pg_catalog.pg_get_expr(policy_catalog.polwithcheck, relation_catalog.oid),
           '[[:space:]]+',
           ' ',
           'g'
         ) IS DISTINCT FROM 'false'::text;

  IF v_invalid_browser_policy_count <> 0 THEN
    RAISE EXCEPTION 'DB-09 refused: a reviewed circles_app browser-denial policy is missing or has an unexpected definition';
  END IF;

  WITH expected_external_tables(schema_name, table_name) AS (
    VALUES
      ('circles_app'::pg_catalog.name, 'circles'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'comments'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'liveViewers'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'memberships'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'posts'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'profiles'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'reactions'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'reports'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'streams'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'users'::pg_catalog.name),
      ('circles_admin'::pg_catalog.name, 'audit'::pg_catalog.name)
  ), browser_roles AS (
    SELECT role_catalog.oid
    FROM pg_catalog.pg_roles AS role_catalog
    WHERE role_catalog.rolname IN ('anon'::pg_catalog.name, 'authenticated'::pg_catalog.name)
  ), observed_tables AS (
    SELECT expected_external_tables.*, relation_catalog.oid AS relation_oid
    FROM expected_external_tables
    LEFT JOIN pg_catalog.pg_namespace AS namespace_catalog
      ON namespace_catalog.nspname = expected_external_tables.schema_name
    LEFT JOIN pg_catalog.pg_class AS relation_catalog
      ON relation_catalog.relnamespace = namespace_catalog.oid
     AND relation_catalog.relname = expected_external_tables.table_name
  )
  SELECT pg_catalog.count(*)::integer
    INTO v_browser_access_violation_count
    FROM observed_tables
    CROSS JOIN browser_roles
   WHERE relation_oid IS NULL
      OR pg_catalog.has_table_privilege(browser_roles.oid, relation_oid, 'SELECT'::text)
      OR pg_catalog.has_table_privilege(browser_roles.oid, relation_oid, 'INSERT'::text)
      OR pg_catalog.has_table_privilege(browser_roles.oid, relation_oid, 'UPDATE'::text)
      OR pg_catalog.has_table_privilege(browser_roles.oid, relation_oid, 'DELETE'::text)
      OR pg_catalog.has_table_privilege(browser_roles.oid, relation_oid, 'TRUNCATE'::text);

  IF v_browser_access_violation_count <> 0
     OR pg_catalog.has_schema_privilege('anon'::pg_catalog.name, 'circles_app'::pg_catalog.name, 'USAGE'::text)
     OR pg_catalog.has_schema_privilege('authenticated'::pg_catalog.name, 'circles_app'::pg_catalog.name, 'USAGE'::text)
     OR pg_catalog.has_schema_privilege('anon'::pg_catalog.name, 'circles_admin'::pg_catalog.name, 'USAGE'::text)
     OR pg_catalog.has_schema_privilege('authenticated'::pg_catalog.name, 'circles_admin'::pg_catalog.name, 'USAGE'::text) THEN
    RAISE EXCEPTION 'DB-09 refused: browser role access to a selected private relation or schema is not denied';
  END IF;
END;
$db09_duplicate_policy_preflight$;

-- Explicit names are intentional: do not replace these statements with a generic DROP POLICY loop.
DROP POLICY IF EXISTS "circles_admin_parity_read_circles" ON circles_app.circles;
DROP POLICY IF EXISTS "circles_admin_parity_read_comments" ON circles_app.comments;
DROP POLICY IF EXISTS "circles_admin_parity_read_liveviewers" ON circles_app."liveViewers";
DROP POLICY IF EXISTS "circles_admin_parity_read_memberships" ON circles_app.memberships;
DROP POLICY IF EXISTS "circles_admin_parity_read_posts" ON circles_app.posts;
DROP POLICY IF EXISTS "circles_admin_parity_read_profiles" ON circles_app.profiles;
DROP POLICY IF EXISTS "circles_admin_parity_read_reactions" ON circles_app.reactions;
DROP POLICY IF EXISTS "circles_admin_parity_read_reports" ON circles_app.reports;
DROP POLICY IF EXISTS "circles_admin_parity_read_streams" ON circles_app.streams;
DROP POLICY IF EXISTS "circles_admin_parity_read_users" ON circles_app.users;
DROP POLICY IF EXISTS "circles_admin_parity_audit_read" ON circles_admin.audit;
DROP POLICY IF EXISTS "circles_admin_parity_audit_append" ON circles_admin.audit;

DO $db09_duplicate_policy_poststate$
DECLARE
  v_poststate_failure_count integer;
BEGIN
  WITH expected_pairs(
    schema_name,
    table_name,
    survivor_name,
    duplicate_name,
    expected_cmd,
    expected_qual,
    expected_check
  ) AS (
    VALUES
      ('circles_app'::pg_catalog.name, 'circles'::pg_catalog.name, 'circles_admin_read_circles'::pg_catalog.name, 'circles_admin_parity_read_circles'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::text, NULL::text),
      ('circles_app'::pg_catalog.name, 'comments'::pg_catalog.name, 'circles_admin_read_comments'::pg_catalog.name, 'circles_admin_parity_read_comments'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::text, NULL::text),
      ('circles_app'::pg_catalog.name, 'liveViewers'::pg_catalog.name, 'circles_admin_read_liveviewers'::pg_catalog.name, 'circles_admin_parity_read_liveviewers'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::text, NULL::text),
      ('circles_app'::pg_catalog.name, 'memberships'::pg_catalog.name, 'circles_admin_read_memberships'::pg_catalog.name, 'circles_admin_parity_read_memberships'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::text, NULL::text),
      ('circles_app'::pg_catalog.name, 'posts'::pg_catalog.name, 'circles_admin_read_posts'::pg_catalog.name, 'circles_admin_parity_read_posts'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::text, NULL::text),
      ('circles_app'::pg_catalog.name, 'profiles'::pg_catalog.name, 'circles_admin_read_profiles'::pg_catalog.name, 'circles_admin_parity_read_profiles'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::text, NULL::text),
      ('circles_app'::pg_catalog.name, 'reactions'::pg_catalog.name, 'circles_admin_read_reactions'::pg_catalog.name, 'circles_admin_parity_read_reactions'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::text, NULL::text),
      ('circles_app'::pg_catalog.name, 'reports'::pg_catalog.name, 'circles_admin_read_reports'::pg_catalog.name, 'circles_admin_parity_read_reports'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::text, NULL::text),
      ('circles_app'::pg_catalog.name, 'streams'::pg_catalog.name, 'circles_admin_read_streams'::pg_catalog.name, 'circles_admin_parity_read_streams'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::text, NULL::text),
      ('circles_app'::pg_catalog.name, 'users'::pg_catalog.name, 'circles_admin_read_users'::pg_catalog.name, 'circles_admin_parity_read_users'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::text, NULL::text),
      ('circles_admin'::pg_catalog.name, 'audit'::pg_catalog.name, 'circles_admin_runtime_audit_select'::pg_catalog.name, 'circles_admin_parity_audit_read'::pg_catalog.name, 'r'::pg_catalog."char", 'true'::text, NULL::text),
      ('circles_admin'::pg_catalog.name, 'audit'::pg_catalog.name, 'circles_admin_runtime_audit_insert'::pg_catalog.name, 'circles_admin_parity_audit_append'::pg_catalog.name, 'a'::pg_catalog."char", NULL::text, '(EXISTS ( SELECT 1 FROM circles_admin.operators o WHERE ((o.id = audit.actor_operator_id) AND ((o.status)::text = ''active''::text) AND ((o.role)::text = (audit.actor_role)::text))))'::text)
  ), role_oids AS (
    SELECT role_catalog.oid AS runtime_oid
    FROM pg_catalog.pg_roles AS role_catalog
   WHERE role_catalog.rolname = 'circles_admin_runtime'::pg_catalog.name
  )
  SELECT pg_catalog.count(*)::integer
    INTO v_poststate_failure_count
    FROM expected_pairs
    CROSS JOIN role_oids
    LEFT JOIN pg_catalog.pg_namespace AS namespace_catalog
      ON namespace_catalog.nspname = expected_pairs.schema_name
    LEFT JOIN pg_catalog.pg_class AS relation_catalog
      ON relation_catalog.relnamespace = namespace_catalog.oid
     AND relation_catalog.relname = expected_pairs.table_name
    LEFT JOIN pg_catalog.pg_policy AS survivor
      ON survivor.polrelid = relation_catalog.oid
     AND survivor.polname = expected_pairs.survivor_name
    LEFT JOIN pg_catalog.pg_policy AS duplicate
      ON duplicate.polrelid = relation_catalog.oid
     AND duplicate.polname = expected_pairs.duplicate_name
   WHERE relation_catalog.oid IS NULL
      OR relation_catalog.relkind IS DISTINCT FROM 'r'::pg_catalog."char"
      OR relation_catalog.relrowsecurity IS NOT TRUE
      OR survivor.oid IS NULL
      OR survivor.polroles IS DISTINCT FROM ARRAY[role_oids.runtime_oid]::pg_catalog.oid[]
      OR survivor.polcmd IS DISTINCT FROM expected_pairs.expected_cmd
      OR survivor.polpermissive IS NOT TRUE
      OR pg_catalog.regexp_replace(
           pg_catalog.pg_get_expr(survivor.polqual, relation_catalog.oid),
           '[[:space:]]+',
           ' ',
           'g'
         ) IS DISTINCT FROM expected_pairs.expected_qual
      OR pg_catalog.regexp_replace(
           pg_catalog.pg_get_expr(survivor.polwithcheck, relation_catalog.oid),
           '[[:space:]]+',
           ' ',
           'g'
         ) IS DISTINCT FROM expected_pairs.expected_check
      OR duplicate.oid IS NOT NULL;

  IF v_poststate_failure_count <> 0 THEN
    RAISE EXCEPTION 'DB-09 post-state check failed: selected duplicate policies remain or survivor definitions changed';
  END IF;
END;
$db09_duplicate_policy_poststate$;

COMMIT;
