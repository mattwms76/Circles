-- Catalog remediation for the 27 October 2026 database audit.
-- Additive where it adds a fence, and limited where it removes a duplicate.
--
-- Left unchanged on purpose:
-- - circles_app USING (true) runtime policies stay server-trust (SEC-019).
-- - Legacy public and private grants stay until a privacy contract exists (SEC-032).
-- - Schema-defined indexes stay. Planner stats on this database are cold.
-- - The database credential is not rotated here (SEC-033). The backup consumer
--   cannot be updated from this change.
-- - supabase_admin's global PUBLIC EXECUTE default on future functions stays.
--   The postgres role is not a member of supabase_admin, so
--   ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
--   REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC
--   is permission denied. Existing function grants are already revoked from
--   anon, authenticated, service_role, PUBLIC, and circles_app_runtime.

BEGIN;

-- The source unique constraint already covers (actorId, operationId).
-- The extra primary key is the same index and is not referenced.
ALTER TABLE circles_publish."postPublishReceipts"
  DROP CONSTRAINT post_publish_receipts_pkey;

-- One covering index for circles_pinned_post_same_circle_db17_fkey
-- ("pinnedPostId", id). Keep an existing identical index, and do not add a
-- second copy beside circles_pinned_post_same_circle_db17_idx.
DO $pinned_post_index$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class AS index_relation
    JOIN pg_namespace AS namespace ON namespace.oid = index_relation.relnamespace
    WHERE namespace.nspname = 'circles_app'
      AND index_relation.relname = 'circles_pinned_post_same_circle_db17_idx'
  ) AND EXISTS (
    SELECT 1
    FROM pg_class AS index_relation
    JOIN pg_namespace AS namespace ON namespace.oid = index_relation.relnamespace
    WHERE namespace.nspname = 'circles_app'
      AND index_relation.relname = 'circles_pinned_post_same_circle_idx'
  ) THEN
    EXECUTE 'DROP INDEX circles_app.circles_pinned_post_same_circle_idx';
  ELSIF NOT EXISTS (
    SELECT 1
    FROM pg_class AS index_relation
    JOIN pg_namespace AS namespace ON namespace.oid = index_relation.relnamespace
    WHERE namespace.nspname = 'circles_app'
      AND index_relation.relname IN (
        'circles_pinned_post_same_circle_idx',
        'circles_pinned_post_same_circle_db17_idx'
      )
  ) THEN
    EXECUTE 'CREATE INDEX circles_pinned_post_same_circle_idx ON circles_app.circles ("pinnedPostId", id)';
  END IF;
END
$pinned_post_index$;

-- circles_app_login owns no objects. postgres and supabase_admin remain the
-- only trusted holders of circles_app_runtime.
REVOKE circles_app_runtime FROM circles_app_login;

-- These tables already have row-level security and no policy. A restrictive
-- deny does not grant a privilege and does not open a row to API roles.
DO $closed_tables$
DECLARE
  target_schema text;
  target_table text;
BEGIN
  FOR target_schema, target_table IN
    SELECT *
    FROM (VALUES
      ('circles_admin', 'auth_subjects'),
      ('circles_admin', 'supabase_sessions'),
      ('private', 'moderation_actions'),
      ('private', 'prompt_runs'),
      ('private', 'runtime_settings'),
      ('private', 'store_transactions'),
      ('private', 'write_budgets'),
      ('public', 'community_media_cleanup'),
      ('public', 'notification_deliveries'),
      ('public', 'post_media_cleanup'),
      ('public', 'story_media_cleanup')
    ) AS closed(schema_name, table_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policy AS policy
      JOIN pg_class AS relation ON relation.oid = policy.polrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE policy.polname = 'closed_table_deny_all'
        AND namespace.nspname = target_schema
        AND relation.relname = target_table
    ) THEN
      EXECUTE format(
        'CREATE POLICY closed_table_deny_all ON %I.%I AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false)',
        target_schema,
        target_table
      );
    END IF;
  END LOOP;
END
$closed_tables$;

COMMIT;
