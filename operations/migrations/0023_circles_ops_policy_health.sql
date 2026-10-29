-- CBA-10: reconcile the daily policy-health predicate with the reviewed closed policy inventories.
--
-- This additive, guarded migration changes only the stale one-runtime-policy-per-table
-- predicate inside circles_ops.run_daily_migration_health(). It accepts exactly the reviewed
-- 96-row pre-DB09 policy state or the reviewed 86-row DB09-consolidated state. It does not
-- create or change policies, roles, grants, schemas, tables, health history, schedules, or
-- application rows. The known receipt-compatible daily wrapper is recognized as an already
-- conforming preserved baseline and is not replaced.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('circles.cba10.policy-health.v1'::pg_catalog.text, 0)
);

DO $cba10_policy_health$
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
  v_anchor_position integer;
  v_candidate text;
  v_post_daily_oid pg_catalog.oid;
  v_post_daily_definition text;
  v_post_daily_body text;
  v_post_daily_owner pg_catalog.oid;
  v_post_daily_security_definer boolean;
  v_post_daily_config text[];
  v_post_daily_acl_text text;
  v_policy_anchor constant text := $cba10_policy_anchor$
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

$cba10_policy_anchor$;
  v_policy_replacement constant text := $cba10_policy_replacement$
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
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'circles'::pg_catalog.name, 'circles_admin_read_circles'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'circles'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'circles'::pg_catalog.name, 'runtime_circles_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'comments'::pg_catalog.name, 'circles_admin_read_comments'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
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
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'liveViewers'::pg_catalog.name, 'circles_admin_read_liveviewers'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'liveViewers'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'liveViewers'::pg_catalog.name, 'runtime_live_viewers_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'memberships'::pg_catalog.name, 'circles_admin_native_exec_memberships'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'memberships'::pg_catalog.name, 'circles_admin_read_memberships'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
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
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'posts'::pg_catalog.name, 'circles_admin_read_posts'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'posts'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'posts'::pg_catalog.name, 'runtime_posts_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'profiles'::pg_catalog.name, 'circles_admin_native_exec_profiles'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'profiles'::pg_catalog.name, 'circles_admin_read_profiles'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'profiles'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'profiles'::pg_catalog.name, 'runtime_profiles_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'reactions'::pg_catalog.name, 'circles_admin_read_reactions'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'reactions'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'reactions'::pg_catalog.name, 'runtime_reactions_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'reports'::pg_catalog.name, 'circles_admin_read_reports'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'reports'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'reports'::pg_catalog.name, 'runtime_reports_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'socialSeedMarkers'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'socialSeedMarkers'::pg_catalog.name, 'runtime_social_seed_markers_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'socialUploads'::pg_catalog.name, 'circles_admin_parity_read_socialuploads'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'socialUploads'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'socialUploads'::pg_catalog.name, 'runtime_social_uploads_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'streams'::pg_catalog.name, 'circles_admin_native_exec_streams'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'streams'::pg_catalog.name, 'circles_admin_read_streams'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'streams'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, ARRAY['anon'::pg_catalog.name, 'authenticated'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", false, 'false'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'streams'::pg_catalog.name, 'runtime_streams_policy'::pg_catalog.name, ARRAY['circles_app_runtime'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'users'::pg_catalog.name, 'circles_admin_native_exec_users'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], '*'::pg_catalog."char", true, 'true'::pg_catalog.text, 'true'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'users'::pg_catalog.name, 'circles_admin_native_users_lock_only'::pg_catalog.name, ARRAY['circles_admin_native_executor'::pg_catalog.name]::pg_catalog.name[], 'w'::pg_catalog."char", false, 'true'::pg_catalog.text, 'false'::pg_catalog.text),
      ('post_db09_12_group_consolidation'::pg_catalog.text, 'users'::pg_catalog.name, 'circles_admin_read_users'::pg_catalog.name, ARRAY['circles_admin_runtime'::pg_catalog.name]::pg_catalog.name[], 'r'::pg_catalog."char", true, 'true'::pg_catalog.text, NULL::pg_catalog.text),
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

$cba10_policy_replacement$;
BEGIN
  -- Never use an ambient provider or administrator role to replace this SECURITY DEFINER body.
  IF current_user <> 'postgres'::pg_catalog.name
     OR session_user <> 'postgres'::pg_catalog.name THEN
    RAISE EXCEPTION 'CBA-10 policy health requires reviewed postgres session and current role';
  END IF;

  SELECT role_catalog.oid
    INTO v_postgres_oid
    FROM pg_catalog.pg_roles AS role_catalog
   WHERE role_catalog.rolname = 'postgres'::pg_catalog.name;

  IF v_postgres_oid IS NULL THEN
    RAISE EXCEPTION 'CBA-10 policy health requires reviewed postgres owner role';
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
    RAISE EXCEPTION 'CBA-10 policy health requires exactly one reviewed daily health signature; missing function or overload drift';
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
  THEN
    RAISE EXCEPTION 'CBA-10 policy health baseline security metadata drifted';
  END IF;

  -- Preserve the exact reviewed current receipt wrapper, which already includes the closed
  -- policy comparison and its receipt compatibility predicate. Its exact definition/body pair
  -- is a no-op state, not a wildcard or an authorization bypass.
  IF pg_catalog.md5(v_daily_definition) = '02c6415bd9f2715b4bae502b1ed934bb'::pg_catalog.text
     AND pg_catalog.md5(v_daily_body) = 'c9042815f6e02dcfbfe958a30eb7afae'::pg_catalog.text THEN
    RETURN;
  END IF;

  -- This exact reviewed post-policy wrapper has the closed policy comparison but predates the
  -- separate receipt-wrapper compatibility operation. It is likewise already CBA-10-conforming;
  -- do not replace it or infer that the receipt operation has run.
  IF pg_catalog.md5(v_daily_definition) = '8a2551dee9f2ea3216d61f82fef70fa1'::pg_catalog.text
     AND pg_catalog.md5(v_daily_body) = '57fab8e62c7c01e34d393b78b972bd11'::pg_catalog.text THEN
    RETURN;
  END IF;

  IF pg_catalog.md5(v_daily_definition) <> 'a4421c8c4e64f1700f2a2771624ecfa0'::pg_catalog.text
     OR pg_catalog.md5(v_daily_body) <> 'e508c15fe21081e43c41810df71b5677'::pg_catalog.text THEN
    RAISE EXCEPTION 'CBA-10 policy health requires the exact reviewed source, post-policy, or current receipt daily-health wrapper';
  END IF;

  v_anchor_position := pg_catalog.strpos(v_daily_definition, v_policy_anchor);
  IF v_anchor_position = 0
     OR pg_catalog.strpos(
       pg_catalog.substr(
         v_daily_definition,
         v_anchor_position + pg_catalog.char_length(v_policy_anchor)
       ),
       v_policy_anchor
     ) > 0 THEN
    RAISE EXCEPTION 'CBA-10 policy health predicate anchor is absent or non-unique';
  END IF;

  v_candidate := pg_catalog.replace(v_daily_definition, v_policy_anchor, v_policy_replacement);
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
    RAISE EXCEPTION 'CBA-10 policy health postflight identity or security contract failed';
  END IF;
END;
$cba10_policy_health$;

COMMIT;
