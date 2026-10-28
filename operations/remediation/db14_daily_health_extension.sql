-- DB-14 prepared only. This file is intentionally unapplied and must be submitted only through
-- the parent-approved private PostgreSQL workflow after the recovery gate. It changes one
-- reviewed function body in place; it does not create schemas, roles, tables, jobs, or helpers.
-- It uses two exact unique anchors: the reviewed closed policy-set reconciliation and the
-- retained critical-helper health addition.
--
-- The golden precondition is the actual 2026-10-27 metadata-only capture of
-- circles_ops.run_daily_migration_health(): 35,166 UTF-8 bytes from pg_get_functiondef(),
-- md5 a4421c8c4e64f1700f2a2771624ecfa0, body md5 e508c15fe21081e43c41810df71b5677,
-- owner postgres, SECURITY DEFINER, search_path=pg_catalog, and {postgres=X/postgres} ACL.

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('circles_ops.db14-daily-health-extension.v1', 0)
);

DO $db14_daily_health_extension$
DECLARE
  v_postgres_oid pg_catalog.oid;
  v_daily_oid pg_catalog.oid;
  v_helper_oid pg_catalog.oid;
  v_daily_count integer;
  v_helper_count integer;
  v_daily_definition text;
  v_daily_body text;
  v_daily_owner pg_catalog.oid;
  v_daily_security_definer boolean;
  v_daily_config text[];
  v_daily_acl_text text;
  v_helper_definition text;
  v_helper_body text;
  v_helper_owner pg_catalog.oid;
  v_helper_security_definer boolean;
  v_helper_config text[];
  v_helper_acl_text text;
  v_anchor_position integer;
  v_policy_anchor_position integer;
  v_policy_anchor constant text := $db14_policy_anchor$
  WITH app_relations AS (
    SELECT relation_catalog.oid, relation_catalog.relname
    FROM pg_catalog.pg_class AS relation_catalog
    WHERE relation_catalog.relnamespace = v_app_namespace_oid
      AND relation_catalog.relkind IN ('r'::pg_catalog."char", 'p'::pg_catalog."char")
      AND relation_catalog.relname = ANY (v_expected_tables)
  )
  SELECT
    v_runtime_role_oid IS NOT NULL
    AND (SELECT pg_catalog.count(*) FROM app_relations) = pg_catalog.cardinality(v_expected_tables)
    AND NOT EXISTS (
      SELECT 1
      FROM app_relations
      LEFT JOIN pg_catalog.pg_policy AS policy_catalog
        ON policy_catalog.polrelid = app_relations.oid
      GROUP BY app_relations.oid, app_relations.relname
      HAVING pg_catalog.count(policy_catalog.oid) <> 1
         OR NOT pg_catalog.bool_and(
           policy_catalog.polroles = ARRAY[v_runtime_role_oid]::pg_catalog.oid[]
           AND (
             (
               app_relations.relname = '_dataMigrations'::pg_catalog.name
               AND policy_catalog.polcmd = 'r'::pg_catalog."char"
               AND policy_catalog.polqual IS NOT NULL
               AND pg_catalog.pg_get_expr(policy_catalog.polqual, policy_catalog.polrelid) = 'true'::pg_catalog.text
             )
             OR (
               app_relations.relname <> '_dataMigrations'::pg_catalog.name
               AND policy_catalog.polcmd = '*'::pg_catalog."char"
               AND policy_catalog.polqual IS NOT NULL
               AND policy_catalog.polwithcheck IS NOT NULL
               AND pg_catalog.pg_get_expr(policy_catalog.polqual, policy_catalog.polrelid) = 'true'::pg_catalog.text
               AND pg_catalog.pg_get_expr(policy_catalog.polwithcheck, policy_catalog.polrelid) = 'true'::pg_catalog.text
             )
           )
         )
    )
    INTO v_policies_ok;

  $db14_policy_anchor$;
  v_policy_replacement constant text := $db14_policy_replacement$
  -- DB-14 reconciles the stale one-policy-per-table rule with the reviewed complete
  -- circles_app policy contract. The static values below are derived from
  -- scripts/circles-database-security-contract.mjs POLICY_CONTRACT_VARIANTS and
  -- checked against the 2026-10-27 captured 96-row current catalog. The only
  -- accepted sets are the complete current pre-DB-09 set (96 rows) and the
  -- complete post-DB-09 twelve-group consolidation set (86 app-policy rows).
  -- This is an exact catalog comparison, not a permissive policy-count threshold.
  WITH expected_policies(
    policy_state, table_name, policy_name, expected_roles, expected_command,
    expected_permissive, expected_qualification, expected_with_check
  ) AS (
    VALUES
      ('current_pre_db09'::pg_catalog.text, '_dataMigrations'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, '_dataMigrations'::pg_catalog.name, 'runtime_data_migrations_read_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'activeHostLeases'::pg_catalog.name, 'circles_admin_native_exec_activehostleases'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'activeHostLeases'::pg_catalog.name, 'circles_admin_parity_read_activehostleases'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'activeHostLeases'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'activeHostLeases'::pg_catalog.name, 'runtime_active_host_leases_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'activityCirclePreferences'::pg_catalog.name, 'circles_admin_native_exec_activitycirclepreferences'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'activityCirclePreferences'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'activityCirclePreferences'::pg_catalog.name, 'runtime_activity_circle_preferences_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'activityItems'::pg_catalog.name, 'circles_admin_native_exec_activityitems'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'activityItems'::pg_catalog.name, 'circles_admin_parity_read_activityitems'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'activityItems'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'activityItems'::pg_catalog.name, 'runtime_activity_items_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'activityPreferences'::pg_catalog.name, 'circles_admin_native_exec_activitypreferences'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'activityPreferences'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'activityPreferences'::pg_catalog.name, 'runtime_activity_preferences_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'applicationSessions'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'applicationSessions'::pg_catalog.name, 'runtime_application_sessions_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'bookmarks'::pg_catalog.name, 'circles_admin_parity_read_bookmarks'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'bookmarks'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'bookmarks'::pg_catalog.name, 'runtime_bookmarks_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'circles'::pg_catalog.name, 'circles_admin_native_exec_circles'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'circles'::pg_catalog.name, 'circles_admin_parity_read_circles'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'circles'::pg_catalog.name, 'circles_admin_read_circles'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'circles'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'circles'::pg_catalog.name, 'runtime_circles_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'comments'::pg_catalog.name, 'circles_admin_parity_read_comments'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'comments'::pg_catalog.name, 'circles_admin_read_comments'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'comments'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'comments'::pg_catalog.name, 'runtime_comments_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'conversationParticipants'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'conversationParticipants'::pg_catalog.name, 'runtime_conversation_participants_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'conversations'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'conversations'::pg_catalog.name, 'runtime_conversations_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'follows'::pg_catalog.name, 'circles_admin_parity_read_follows'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'follows'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'follows'::pg_catalog.name, 'runtime_follows_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'liveChat'::pg_catalog.name, 'circles_admin_parity_read_livechat'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'liveChat'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'liveChat'::pg_catalog.name, 'runtime_live_chat_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'liveSignals'::pg_catalog.name, 'circles_admin_native_exec_livesignals'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'liveSignals'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'liveSignals'::pg_catalog.name, 'runtime_live_signals_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'liveViewers'::pg_catalog.name, 'circles_admin_parity_read_liveviewers'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'liveViewers'::pg_catalog.name, 'circles_admin_read_liveviewers'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'liveViewers'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'liveViewers'::pg_catalog.name, 'runtime_live_viewers_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'memberships'::pg_catalog.name, 'circles_admin_native_exec_memberships'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'memberships'::pg_catalog.name, 'circles_admin_parity_read_memberships'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'memberships'::pg_catalog.name, 'circles_admin_read_memberships'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'memberships'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'memberships'::pg_catalog.name, 'runtime_memberships_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'messages'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'messages'::pg_catalog.name, 'runtime_messages_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'moderationActions'::pg_catalog.name, 'circles_admin_native_exec_moderationactions'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'moderationActions'::pg_catalog.name, 'circles_admin_parity_read_moderationactions'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'moderationActions'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'moderationActions'::pg_catalog.name, 'runtime_moderation_actions_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'moderationCases'::pg_catalog.name, 'circles_admin_native_exec_moderationcases'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'moderationCases'::pg_catalog.name, 'circles_admin_parity_read_moderationcases'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'moderationCases'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'moderationCases'::pg_catalog.name, 'runtime_moderation_cases_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'posts'::pg_catalog.name, 'circles_admin_native_exec_posts'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'posts'::pg_catalog.name, 'circles_admin_parity_read_posts'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'posts'::pg_catalog.name, 'circles_admin_read_posts'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'posts'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'posts'::pg_catalog.name, 'runtime_posts_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'profiles'::pg_catalog.name, 'circles_admin_native_exec_profiles'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'profiles'::pg_catalog.name, 'circles_admin_parity_read_profiles'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'profiles'::pg_catalog.name, 'circles_admin_read_profiles'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'profiles'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'profiles'::pg_catalog.name, 'runtime_profiles_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'reactions'::pg_catalog.name, 'circles_admin_parity_read_reactions'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'reactions'::pg_catalog.name, 'circles_admin_read_reactions'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'reactions'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'reactions'::pg_catalog.name, 'runtime_reactions_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'reports'::pg_catalog.name, 'circles_admin_parity_read_reports'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'reports'::pg_catalog.name, 'circles_admin_read_reports'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'reports'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'reports'::pg_catalog.name, 'runtime_reports_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'socialSeedMarkers'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'socialSeedMarkers'::pg_catalog.name, 'runtime_social_seed_markers_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'socialUploads'::pg_catalog.name, 'circles_admin_parity_read_socialuploads'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'socialUploads'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'socialUploads'::pg_catalog.name, 'runtime_social_uploads_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'streams'::pg_catalog.name, 'circles_admin_native_exec_streams'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'streams'::pg_catalog.name, 'circles_admin_parity_read_streams'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'streams'::pg_catalog.name, 'circles_admin_read_streams'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'streams'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'streams'::pg_catalog.name, 'runtime_streams_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'users'::pg_catalog.name, 'circles_admin_native_exec_users'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'users'::pg_catalog.name, 'circles_admin_native_users_lock_only'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], 'w'::pg_catalog."char", false, 'true'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'users'::pg_catalog.name, 'circles_admin_parity_read_users'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'users'::pg_catalog.name, 'circles_admin_read_users'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'users'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('current_pre_db09'::pg_catalog.text, 'users'::pg_catalog.name, 'runtime_users_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, '_dataMigrations'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, '_dataMigrations'::pg_catalog.name, 'runtime_data_migrations_read_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'activeHostLeases'::pg_catalog.name, 'circles_admin_native_exec_activehostleases'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'activeHostLeases'::pg_catalog.name, 'circles_admin_parity_read_activehostleases'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'activeHostLeases'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'activeHostLeases'::pg_catalog.name, 'runtime_active_host_leases_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'activityCirclePreferences'::pg_catalog.name, 'circles_admin_native_exec_activitycirclepreferences'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'activityCirclePreferences'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'activityCirclePreferences'::pg_catalog.name, 'runtime_activity_circle_preferences_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'activityItems'::pg_catalog.name, 'circles_admin_native_exec_activityitems'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'activityItems'::pg_catalog.name, 'circles_admin_parity_read_activityitems'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'activityItems'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'activityItems'::pg_catalog.name, 'runtime_activity_items_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'activityPreferences'::pg_catalog.name, 'circles_admin_native_exec_activitypreferences'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'activityPreferences'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'activityPreferences'::pg_catalog.name, 'runtime_activity_preferences_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'applicationSessions'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'applicationSessions'::pg_catalog.name, 'runtime_application_sessions_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'bookmarks'::pg_catalog.name, 'circles_admin_parity_read_bookmarks'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'bookmarks'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'bookmarks'::pg_catalog.name, 'runtime_bookmarks_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'circles'::pg_catalog.name, 'circles_admin_native_exec_circles'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'circles'::pg_catalog.name, 'circles_admin_parity_read_circles'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'circles'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'circles'::pg_catalog.name, 'runtime_circles_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'comments'::pg_catalog.name, 'circles_admin_parity_read_comments'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'comments'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'comments'::pg_catalog.name, 'runtime_comments_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'conversationParticipants'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'conversationParticipants'::pg_catalog.name, 'runtime_conversation_participants_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'conversations'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'conversations'::pg_catalog.name, 'runtime_conversations_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'follows'::pg_catalog.name, 'circles_admin_parity_read_follows'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'follows'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'follows'::pg_catalog.name, 'runtime_follows_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'liveChat'::pg_catalog.name, 'circles_admin_parity_read_livechat'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'liveChat'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'liveChat'::pg_catalog.name, 'runtime_live_chat_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'liveSignals'::pg_catalog.name, 'circles_admin_native_exec_livesignals'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'liveSignals'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'liveSignals'::pg_catalog.name, 'runtime_live_signals_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'liveViewers'::pg_catalog.name, 'circles_admin_parity_read_liveviewers'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'liveViewers'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'liveViewers'::pg_catalog.name, 'runtime_live_viewers_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'memberships'::pg_catalog.name, 'circles_admin_native_exec_memberships'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'memberships'::pg_catalog.name, 'circles_admin_parity_read_memberships'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'memberships'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'memberships'::pg_catalog.name, 'runtime_memberships_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'messages'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'messages'::pg_catalog.name, 'runtime_messages_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'moderationActions'::pg_catalog.name, 'circles_admin_native_exec_moderationactions'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'moderationActions'::pg_catalog.name, 'circles_admin_parity_read_moderationactions'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'moderationActions'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'moderationActions'::pg_catalog.name, 'runtime_moderation_actions_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'moderationCases'::pg_catalog.name, 'circles_admin_native_exec_moderationcases'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'moderationCases'::pg_catalog.name, 'circles_admin_parity_read_moderationcases'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'moderationCases'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'moderationCases'::pg_catalog.name, 'runtime_moderation_cases_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'posts'::pg_catalog.name, 'circles_admin_native_exec_posts'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'posts'::pg_catalog.name, 'circles_admin_parity_read_posts'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'posts'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'posts'::pg_catalog.name, 'runtime_posts_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'profiles'::pg_catalog.name, 'circles_admin_native_exec_profiles'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'profiles'::pg_catalog.name, 'circles_admin_parity_read_profiles'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'profiles'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'profiles'::pg_catalog.name, 'runtime_profiles_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'reactions'::pg_catalog.name, 'circles_admin_parity_read_reactions'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'reactions'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'reactions'::pg_catalog.name, 'runtime_reactions_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'reports'::pg_catalog.name, 'circles_admin_parity_read_reports'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'reports'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'reports'::pg_catalog.name, 'runtime_reports_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'socialSeedMarkers'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'socialSeedMarkers'::pg_catalog.name, 'runtime_social_seed_markers_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'socialUploads'::pg_catalog.name, 'circles_admin_parity_read_socialuploads'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'socialUploads'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'socialUploads'::pg_catalog.name, 'runtime_social_uploads_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'streams'::pg_catalog.name, 'circles_admin_native_exec_streams'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'streams'::pg_catalog.name, 'circles_admin_parity_read_streams'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'streams'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'streams'::pg_catalog.name, 'runtime_streams_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'users'::pg_catalog.name, 'circles_admin_native_exec_users'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'users'::pg_catalog.name, 'circles_admin_native_users_lock_only'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], 'w'::pg_catalog."char", false, 'true'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'users'::pg_catalog.name, 'circles_admin_parity_read_users'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'users'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'users'::pg_catalog.name, 'runtime_users_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text)
  ), normalized_expected_policies AS (
    SELECT
      expected_policies.policy_state,
      expected_policies.table_name,
      expected_policies.policy_name,
      ARRAY(
        SELECT expected_role.role_name
        FROM pg_catalog.unnest(expected_policies.expected_roles) AS expected_role(role_name)
        ORDER BY expected_role.role_name
      )::pg_catalog.name[] AS roles,
      expected_policies.expected_command AS command,
      expected_policies.expected_permissive AS permissive,
      pg_catalog.regexp_replace(expected_policies.expected_qualification, '[[:space:]]+', ' ', 'g') AS qualification,
      pg_catalog.regexp_replace(expected_policies.expected_with_check, '[[:space:]]+', ' ', 'g') AS with_check
    FROM expected_policies
  ), observed_policy_roles AS (
    SELECT
      policy_catalog.oid AS policy_oid,
      COALESCE(
        pg_catalog.array_agg(role_catalog.rolname ORDER BY role_catalog.rolname)
          FILTER (WHERE role_catalog.oid IS NOT NULL),
        ARRAY[]::pg_catalog.name[]
      ) AS roles
    FROM pg_catalog.pg_policy AS policy_catalog
    LEFT JOIN LATERAL pg_catalog.unnest(policy_catalog.polroles) AS policy_role(role_oid)
      ON true
    LEFT JOIN pg_catalog.pg_roles AS role_catalog
      ON role_catalog.oid = policy_role.role_oid
    GROUP BY policy_catalog.oid
  ), observed_policies AS (
    SELECT
      relation_catalog.relname AS table_name,
      policy_catalog.polname AS policy_name,
      observed_policy_roles.roles,
      policy_catalog.polcmd AS command,
      policy_catalog.polpermissive AS permissive,
      pg_catalog.regexp_replace(
        pg_catalog.pg_get_expr(policy_catalog.polqual, policy_catalog.polrelid),
        '[[:space:]]+', ' ', 'g'
      ) AS qualification,
      pg_catalog.regexp_replace(
        pg_catalog.pg_get_expr(policy_catalog.polwithcheck, policy_catalog.polrelid),
        '[[:space:]]+', ' ', 'g'
      ) AS with_check
    FROM pg_catalog.pg_policy AS policy_catalog
    JOIN pg_catalog.pg_class AS relation_catalog
      ON relation_catalog.oid = policy_catalog.polrelid
    JOIN pg_catalog.pg_namespace AS namespace_catalog
      ON namespace_catalog.oid = relation_catalog.relnamespace
    JOIN observed_policy_roles
      ON observed_policy_roles.policy_oid = policy_catalog.oid
    WHERE namespace_catalog.nspname = 'circles_app'::pg_catalog.name
      AND relation_catalog.relkind IN ('r'::pg_catalog."char", 'p'::pg_catalog."char")
      AND relation_catalog.relname = ANY (v_expected_tables)
  ), allowed_policy_states AS (
    SELECT DISTINCT normalized_expected_policies.policy_state
    FROM normalized_expected_policies
  ), policy_state_matches AS (
    SELECT
      allowed_policy_states.policy_state,
      (SELECT pg_catalog.count(*) FROM observed_policies) = (
        SELECT pg_catalog.count(*)
        FROM normalized_expected_policies
        WHERE normalized_expected_policies.policy_state = allowed_policy_states.policy_state
      )
      AND NOT EXISTS (
        SELECT table_name, policy_name, roles, command, permissive, qualification, with_check
        FROM observed_policies
        EXCEPT ALL
        SELECT table_name, policy_name, roles, command, permissive, qualification, with_check
        FROM normalized_expected_policies
        WHERE normalized_expected_policies.policy_state = allowed_policy_states.policy_state
      )
      AND NOT EXISTS (
        SELECT table_name, policy_name, roles, command, permissive, qualification, with_check
        FROM normalized_expected_policies
        WHERE normalized_expected_policies.policy_state = allowed_policy_states.policy_state
        EXCEPT ALL
        SELECT table_name, policy_name, roles, command, permissive, qualification, with_check
        FROM observed_policies
      ) AS exact_match
    FROM allowed_policy_states
  )
  SELECT
    v_runtime_role_oid IS NOT NULL
    AND (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_roles AS role_catalog
      WHERE role_catalog.rolname IN (
        'anon'::pg_catalog.name,
        'authenticated'::pg_catalog.name,
        'circles_app_runtime'::pg_catalog.name,
        'circles_admin_runtime'::pg_catalog.name,
        'circles_admin_native_executor'::pg_catalog.name
      )
    ) = 5
    AND (
      SELECT pg_catalog.count(DISTINCT normalized_expected_policies.table_name)
      FROM normalized_expected_policies
      WHERE normalized_expected_policies.policy_state = 'current_pre_db09'::pg_catalog.text
    ) = pg_catalog.cardinality(v_expected_tables)
    AND NOT EXISTS (
      SELECT expected_table.table_name
      FROM pg_catalog.unnest(v_expected_tables) AS expected_table(table_name)
      EXCEPT
      SELECT DISTINCT normalized_expected_policies.table_name
      FROM normalized_expected_policies
      WHERE normalized_expected_policies.policy_state = 'current_pre_db09'::pg_catalog.text
    )
    AND COALESCE(
      (SELECT pg_catalog.bool_or(policy_state_matches.exact_match) FROM policy_state_matches),
      false
    )
    INTO v_policies_ok;

  $db14_policy_replacement$;
  v_candidate text;
  v_post_daily_oid pg_catalog.oid;
  v_post_daily_definition text;
  v_post_daily_body text;
  v_post_daily_owner pg_catalog.oid;
  v_post_daily_security_definer boolean;
  v_post_daily_config text[];
  v_post_daily_acl_text text;
  v_anchor constant text := $db14_anchor$
  v_healthy := v_shape_ok
    AND v_rls_ok
    AND v_runtime_role_ok
    AND v_app_schema_usage_ok
    AND v_table_privileges_ok
    AND v_sequence_privileges_ok
    AND v_identity_sequences_ok
    AND v_policies_ok
    AND v_marker_ok
    AND v_session_indexes_ok
    AND v_ops_boundary_ok;

  v_checks := pg_catalog.jsonb_build_object(
    'expected_app_table_count', pg_catalog.cardinality(v_expected_tables),
    'observed_app_table_count', v_observed_table_count,
    'expected_identity_sequence_count', pg_catalog.cardinality(v_identity_tables),
    'observed_app_sequence_count', v_observed_sequence_count,
    'required_table_column_shape', v_shape_ok,
    'all_app_rls_enabled', v_rls_ok,
    'runtime_role_hardened', v_runtime_role_ok,
    'app_schema_usage_restricted', v_app_schema_usage_ok,
    'table_privileges_restricted', v_table_privileges_ok,
    'sequence_privileges_restricted', v_sequence_privileges_ok,
    'identity_sequences_valid', v_identity_sequences_ok,
    'backend_policies_restricted', v_policies_ok,
    'import_marker_matches_manifest', v_marker_ok,
    'durable_session_indexes_valid', v_session_indexes_ok,
    'operations_boundary_restricted', v_ops_boundary_ok
  );
$db14_anchor$;
  v_replacement constant text := $db14_replacement$
  SELECT pg_catalog.jsonb_build_object(
    'critical_feature_contract',
    COALESCE((
      SELECT critical_feature_health.healthy
      FROM circles_ops.run_daily_critical_feature_health() AS critical_feature_health
      LIMIT 1
    ), false)
  )
    INTO v_checks;

  v_healthy := v_shape_ok
    AND v_rls_ok
    AND v_runtime_role_ok
    AND v_app_schema_usage_ok
    AND v_table_privileges_ok
    AND v_sequence_privileges_ok
    AND v_identity_sequences_ok
    AND v_policies_ok
    AND v_marker_ok
    AND v_session_indexes_ok
    AND v_ops_boundary_ok
    AND COALESCE((v_checks ->> 'critical_feature_contract')::pg_catalog.bool, false);

  v_checks := v_checks || pg_catalog.jsonb_build_object(
    'expected_app_table_count', pg_catalog.cardinality(v_expected_tables),
    'observed_app_table_count', v_observed_table_count,
    'expected_identity_sequence_count', pg_catalog.cardinality(v_identity_tables),
    'observed_app_sequence_count', v_observed_sequence_count,
    'required_table_column_shape', v_shape_ok,
    'all_app_rls_enabled', v_rls_ok,
    'runtime_role_hardened', v_runtime_role_ok,
    'app_schema_usage_restricted', v_app_schema_usage_ok,
    'table_privileges_restricted', v_table_privileges_ok,
    'sequence_privileges_restricted', v_sequence_privileges_ok,
    'identity_sequences_valid', v_identity_sequences_ok,
    'backend_policies_restricted', v_policies_ok,
    'import_marker_matches_manifest', v_marker_ok,
    'durable_session_indexes_valid', v_session_indexes_ok,
    'operations_boundary_restricted', v_ops_boundary_ok
  );
$db14_replacement$;
BEGIN
  -- A parent-approved installer must use the exact reviewed owner identity, never an ambient
  -- provider/admin role. This is deliberately a refusal boundary rather than role provisioning.
  IF current_user <> 'postgres'::pg_catalog.name
     OR session_user <> 'postgres'::pg_catalog.name THEN
    RAISE EXCEPTION 'DB-14 daily health extension requires reviewed postgres session and current role';
  END IF;

  SELECT role_catalog.oid
    INTO v_postgres_oid
    FROM pg_catalog.pg_roles AS role_catalog
   WHERE role_catalog.rolname = 'postgres'::pg_catalog.name;

  IF v_postgres_oid IS NULL THEN
    RAISE EXCEPTION 'DB-14 daily health extension requires reviewed postgres owner role';
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
    RAISE EXCEPTION 'DB-14 daily health extension requires exactly one reviewed daily health signature; missing function or overload drift';
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
     OR pg_catalog.md5(v_daily_definition) <> 'a4421c8c4e64f1700f2a2771624ecfa0'::pg_catalog.text
     OR pg_catalog.md5(v_daily_body) <> 'e508c15fe21081e43c41810df71b5677'::pg_catalog.text
  THEN
    RAISE EXCEPTION 'DB-14 daily health extension golden definition or security metadata drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO v_helper_count
    FROM pg_catalog.pg_proc AS function_catalog
    JOIN pg_catalog.pg_namespace AS namespace_catalog
      ON namespace_catalog.oid = function_catalog.pronamespace
   WHERE namespace_catalog.nspname = 'circles_ops'::pg_catalog.name
     AND function_catalog.proname = 'run_daily_critical_feature_health'::pg_catalog.name;

  v_helper_oid := pg_catalog.to_regprocedure('circles_ops.run_daily_critical_feature_health()');
  IF v_helper_count <> 1 OR v_helper_oid IS NULL THEN
    RAISE EXCEPTION 'DB-14 daily health extension requires exactly one reviewed critical helper; missing helper or overload drift';
  END IF;

  SELECT
    pg_catalog.pg_get_functiondef(function_catalog.oid),
    function_catalog.prosrc,
    function_catalog.proowner,
    function_catalog.prosecdef,
    function_catalog.proconfig,
    pg_catalog.array_to_string(function_catalog.proacl, ','::pg_catalog.text, ''::pg_catalog.text)
  INTO
    v_helper_definition,
    v_helper_body,
    v_helper_owner,
    v_helper_security_definer,
    v_helper_config,
    v_helper_acl_text
  FROM pg_catalog.pg_proc AS function_catalog
  WHERE function_catalog.oid = v_helper_oid;

  IF v_helper_owner <> v_postgres_oid
     OR NOT v_helper_security_definer
     OR v_helper_config IS DISTINCT FROM ARRAY['search_path=pg_catalog'::pg_catalog.text]
     OR v_helper_acl_text IS DISTINCT FROM 'postgres=X/postgres'::pg_catalog.text
     OR pg_catalog.md5(v_helper_definition) <> 'b264e91a24358686129a2b2386b9dcdf'::pg_catalog.text
     OR pg_catalog.md5(v_helper_body) <> '4c1b09e5aca802b14389c766434d4d85'::pg_catalog.text
  THEN
    RAISE EXCEPTION 'DB-14 daily health extension critical helper metadata or body drifted';
  END IF;

  -- The golden definition is transformed only at two exact, independently unique body anchors.
  -- No independently maintained 35 KB replacement exists in this file, so any baseline text
  -- drift stops before execution. The policy reconciliation is separate from the retained
  -- critical-helper addition and neither anchor reaches history, retention, ACL, or Cron logic.
  v_policy_anchor_position := pg_catalog.strpos(v_daily_definition, v_policy_anchor);
  IF v_policy_anchor_position = 0
     OR pg_catalog.strpos(
       pg_catalog.substr(
         v_daily_definition,
         v_policy_anchor_position + pg_catalog.char_length(v_policy_anchor)
       ),
       v_policy_anchor
     ) > 0 THEN
    RAISE EXCEPTION 'DB-14 daily health extension policy anchor is absent or non-unique';
  END IF;

  v_anchor_position := pg_catalog.strpos(v_daily_definition, v_anchor);
  IF v_anchor_position = 0
     OR pg_catalog.strpos(
       pg_catalog.substr(v_daily_definition, v_anchor_position + pg_catalog.char_length(v_anchor)),
       v_anchor
     ) > 0 THEN
    RAISE EXCEPTION 'DB-14 daily health extension critical anchor is absent or non-unique';
  END IF;

  v_candidate := pg_catalog.replace(
    pg_catalog.replace(v_daily_definition, v_policy_anchor, v_policy_replacement),
    v_anchor,
    v_replacement
  );
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
    RAISE EXCEPTION 'DB-14 daily health extension postflight identity or security contract failed';
  END IF;
END;
$db14_daily_health_extension$;

COMMIT;
