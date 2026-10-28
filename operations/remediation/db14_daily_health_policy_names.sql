-- DB-14 prepared only. This additive follow-up corrects the ten post-DB-09 expected
-- policy names inside the already-extended daily-health function. It does not alter
-- policies, roles, table data, history, schedules, grants, schemas, or prior SQL history.
--
-- The sole accepted baseline is the metadata-only 2026-10-27 capture of
-- circles_ops.run_daily_migration_health() after db14_daily_health_extension.sql:
-- definition md5 232d11447e666955f89eff147c1aee29,
-- body md5 e43b8272264d14e1db96506bbac74d9a,
-- owner postgres, SECURITY DEFINER, search_path=pg_catalog, and postgres-only ACL.
-- A parent-approved private PostgreSQL workflow owns any application of this file.

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('circles_ops.db14-daily-health-policy-names.v1', 0)
);

DO $db14_daily_health_policy_names$
DECLARE
  v_postgres_oid pg_catalog.oid;
  v_daily_oid pg_catalog.oid;
  v_daily_count integer;
  v_daily_definition text;
  v_daily_body text;
  v_daily_owner pg_catalog.oid;
  v_daily_security_definer boolean;
  v_daily_config text[];
  v_daily_acl_text text;
  v_pair_count integer;
  v_distinct_table_count integer;
  v_distinct_survivor_count integer;
  v_distinct_duplicate_count integer;
  v_schema_names pg_catalog.name[];
  v_table_names pg_catalog.name[];
  v_survivor_names pg_catalog.name[];
  v_duplicate_names pg_catalog.name[];
  v_pair_index integer;
  v_old_literal text;
  v_new_literal text;
  v_old_literals text[] := ARRAY[]::text[];
  v_new_literals text[] := ARRAY[]::text[];
  v_old_count integer;
  v_new_count integer;
  v_candidate text;
  v_post_daily_oid pg_catalog.oid;
  v_post_daily_definition text;
  v_post_daily_body text;
  v_post_daily_owner pg_catalog.oid;
  v_post_daily_security_definer boolean;
  v_post_daily_config text[];
  v_post_daily_acl_text text;
BEGIN
  -- Never use an ambient provider or administrative role to replace this SECURITY DEFINER body.
  IF current_user <> 'postgres'::pg_catalog.name
     OR session_user <> 'postgres'::pg_catalog.name THEN
    RAISE EXCEPTION 'DB-14 daily health policy-name correction requires reviewed postgres session and current role';
  END IF;

  SELECT role_catalog.oid
    INTO v_postgres_oid
    FROM pg_catalog.pg_roles AS role_catalog
   WHERE role_catalog.rolname = 'postgres'::pg_catalog.name;

  IF v_postgres_oid IS NULL THEN
    RAISE EXCEPTION 'DB-14 daily health policy-name correction requires reviewed postgres owner role';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO v_daily_count
    FROM pg_catalog.pg_proc AS function_catalog
    JOIN pg_catalog.pg_namespace AS namespace_catalog
      ON namespace_catalog.oid = function_catalog.pronamespace
   WHERE namespace_catalog.nspname = 'circles_ops'::pg_catalog.name
     AND function_catalog.proname = 'run_daily_migration_health'::pg_catalog.name;

  v_daily_oid := pg_catalog.to_regprocedure('circles_ops.run_daily_migration_health()');
  IF v_daily_count <> 1 OR v_daily_oid IS NULL THEN
    RAISE EXCEPTION 'DB-14 daily health policy-name correction requires exactly one reviewed daily health signature; missing function or overload drift';
  END IF;

  SELECT
    pg_catalog.pg_get_functiondef(function_catalog.oid),
    function_catalog.prosrc,
    function_catalog.proowner,
    function_catalog.prosecdef,
    function_catalog.proconfig,
    pg_catalog.array_to_string(function_catalog.proacl, ','::pg_catalog.text, ''::pg_catalog.text)
  INTO
    v_daily_definition,
    v_daily_body,
    v_daily_owner,
    v_daily_security_definer,
    v_daily_config,
    v_daily_acl_text
  FROM pg_catalog.pg_proc AS function_catalog
  WHERE function_catalog.oid = v_daily_oid;

  IF v_daily_owner <> v_postgres_oid
     OR NOT v_daily_security_definer
     OR v_daily_config IS DISTINCT FROM ARRAY['search_path=pg_catalog'::pg_catalog.text]
     OR v_daily_acl_text IS DISTINCT FROM 'postgres=X/postgres'::pg_catalog.text
     OR pg_catalog.md5(v_daily_definition) <> '232d11447e666955f89eff147c1aee29'::pg_catalog.text
     OR pg_catalog.md5(v_daily_body) <> 'e43b8272264d14e1db96506bbac74d9a'::pg_catalog.text
  THEN
    RAISE EXCEPTION 'DB-14 daily health policy-name correction golden definition or security metadata drifted';
  END IF;

  -- This is the app-only subset of the actual DB09 expected_pairs VALUES constant. The two
  -- circles_admin.audit pairs are intentionally absent: the daily health function tracks only
  -- the circles_app policy rows, while DB09 itself remains the authority for all twelve groups.
  WITH expected_pairs(schema_name, table_name, survivor_name, duplicate_name) AS (
    VALUES
      ('circles_app'::pg_catalog.name, 'circles'::pg_catalog.name, 'circles_admin_read_circles'::pg_catalog.name, 'circles_admin_parity_read_circles'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'comments'::pg_catalog.name, 'circles_admin_read_comments'::pg_catalog.name, 'circles_admin_parity_read_comments'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'liveViewers'::pg_catalog.name, 'circles_admin_read_liveviewers'::pg_catalog.name, 'circles_admin_parity_read_liveviewers'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'memberships'::pg_catalog.name, 'circles_admin_read_memberships'::pg_catalog.name, 'circles_admin_parity_read_memberships'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'posts'::pg_catalog.name, 'circles_admin_read_posts'::pg_catalog.name, 'circles_admin_parity_read_posts'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'profiles'::pg_catalog.name, 'circles_admin_read_profiles'::pg_catalog.name, 'circles_admin_parity_read_profiles'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'reactions'::pg_catalog.name, 'circles_admin_read_reactions'::pg_catalog.name, 'circles_admin_parity_read_reactions'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'reports'::pg_catalog.name, 'circles_admin_read_reports'::pg_catalog.name, 'circles_admin_parity_read_reports'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'streams'::pg_catalog.name, 'circles_admin_read_streams'::pg_catalog.name, 'circles_admin_parity_read_streams'::pg_catalog.name),
      ('circles_app'::pg_catalog.name, 'users'::pg_catalog.name, 'circles_admin_read_users'::pg_catalog.name, 'circles_admin_parity_read_users'::pg_catalog.name)
  )
  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.count(DISTINCT expected_pairs.table_name)::integer,
    pg_catalog.count(DISTINCT expected_pairs.survivor_name)::integer,
    pg_catalog.count(DISTINCT expected_pairs.duplicate_name)::integer,
    pg_catalog.array_agg(expected_pairs.schema_name ORDER BY expected_pairs.table_name),
    pg_catalog.array_agg(expected_pairs.table_name ORDER BY expected_pairs.table_name),
    pg_catalog.array_agg(expected_pairs.survivor_name ORDER BY expected_pairs.table_name),
    pg_catalog.array_agg(expected_pairs.duplicate_name ORDER BY expected_pairs.table_name)
  INTO
    v_pair_count,
    v_distinct_table_count,
    v_distinct_survivor_count,
    v_distinct_duplicate_count,
    v_schema_names,
    v_table_names,
    v_survivor_names,
    v_duplicate_names
  FROM expected_pairs;

  IF v_pair_count <> 10
     OR v_distinct_table_count <> 10
     OR v_distinct_survivor_count <> 10
     OR v_distinct_duplicate_count <> 10
     OR pg_catalog.cardinality(v_schema_names) <> 10
     OR pg_catalog.cardinality(v_table_names) <> 10
     OR pg_catalog.cardinality(v_survivor_names) <> 10
     OR pg_catalog.cardinality(v_duplicate_names) <> 10
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.unnest(v_schema_names) AS expected_schema(schema_name)
       WHERE expected_schema.schema_name <> 'circles_app'::pg_catalog.name
     )
  THEN
    RAISE EXCEPTION 'DB-14 daily health policy-name correction fixed app-pair contract drifted';
  END IF;

  -- Form an exact state-scoped prefix. It can match only the post-DB09 VALUES rows; the
  -- separate 96-row current-state literals never share this prefix.
  FOR v_pair_index IN 1..v_pair_count LOOP
    v_old_literal := pg_catalog.format(
      $db14_old_literal$('post_db09_12_group_consolidation'::pg_catalog.text, '%s'::pg_catalog.name, '%s'::pg_catalog.name$db14_old_literal$,
      v_table_names[v_pair_index],
      v_duplicate_names[v_pair_index]
    );
    v_new_literal := pg_catalog.format(
      $db14_new_literal$('post_db09_12_group_consolidation'::pg_catalog.text, '%s'::pg_catalog.name, '%s'::pg_catalog.name$db14_new_literal$,
      v_table_names[v_pair_index],
      v_survivor_names[v_pair_index]
    );
    v_old_count := (
      pg_catalog.char_length(v_daily_definition)
      - pg_catalog.char_length(pg_catalog.replace(v_daily_definition, v_old_literal, ''::pg_catalog.text))
    ) / pg_catalog.char_length(v_old_literal);
    v_new_count := (
      pg_catalog.char_length(v_daily_definition)
      - pg_catalog.char_length(pg_catalog.replace(v_daily_definition, v_new_literal, ''::pg_catalog.text))
    ) / pg_catalog.char_length(v_new_literal);

    IF v_old_count <> 1 OR v_new_count <> 0 THEN
      RAISE EXCEPTION 'DB-14 daily health policy-name correction replacement % is absent, non-unique, or already applied', v_pair_index;
    END IF;

    v_old_literals := v_old_literals || v_old_literal;
    v_new_literals := v_new_literals || v_new_literal;
  END LOOP;

  IF pg_catalog.cardinality(v_old_literals) <> 10
     OR pg_catalog.cardinality(v_new_literals) <> 10 THEN
    RAISE EXCEPTION 'DB-14 daily health policy-name correction did not precheck exactly ten replacements';
  END IF;

  v_candidate := v_daily_definition;
  FOR v_pair_index IN 1..v_pair_count LOOP
    v_candidate := pg_catalog.replace(
      v_candidate,
      v_old_literals[v_pair_index],
      v_new_literals[v_pair_index]
    );
  END LOOP;

  FOR v_pair_index IN 1..v_pair_count LOOP
    IF (
      pg_catalog.char_length(v_candidate)
      - pg_catalog.char_length(pg_catalog.replace(v_candidate, v_old_literals[v_pair_index], ''::pg_catalog.text))
    ) / pg_catalog.char_length(v_old_literals[v_pair_index]) <> 0
    OR (
      pg_catalog.char_length(v_candidate)
      - pg_catalog.char_length(pg_catalog.replace(v_candidate, v_new_literals[v_pair_index], ''::pg_catalog.text))
    ) / pg_catalog.char_length(v_new_literals[v_pair_index]) <> 1
    THEN
      RAISE EXCEPTION 'DB-14 daily health policy-name correction candidate did not contain exactly ten state-scoped substitutions';
    END IF;
  END LOOP;

  EXECUTE v_candidate || ';'::pg_catalog.text;

  SELECT
    function_catalog.oid,
    pg_catalog.pg_get_functiondef(function_catalog.oid),
    function_catalog.prosrc,
    function_catalog.proowner,
    function_catalog.prosecdef,
    function_catalog.proconfig,
    pg_catalog.array_to_string(function_catalog.proacl, ','::pg_catalog.text, ''::pg_catalog.text)
  INTO
    v_post_daily_oid,
    v_post_daily_definition,
    v_post_daily_body,
    v_post_daily_owner,
    v_post_daily_security_definer,
    v_post_daily_config,
    v_post_daily_acl_text
  FROM pg_catalog.pg_proc AS function_catalog
  WHERE function_catalog.oid = v_daily_oid;

  IF v_post_daily_oid IS DISTINCT FROM v_daily_oid
     OR v_post_daily_definition IS DISTINCT FROM v_candidate
     OR v_post_daily_body IS NULL
     OR v_post_daily_owner IS DISTINCT FROM v_daily_owner
     OR v_post_daily_security_definer IS DISTINCT FROM v_daily_security_definer
     OR v_post_daily_config IS DISTINCT FROM v_daily_config
     OR v_post_daily_acl_text IS DISTINCT FROM v_daily_acl_text
  THEN
    RAISE EXCEPTION 'DB-14 daily health policy-name correction postflight identity or security contract failed';
  END IF;
END;
$db14_daily_health_policy_names$;

COMMIT;
