-- DB-03 actor-scoped RLS remediation candidate.
--
-- This file is intentionally NOT a normal migration. An owner must run it only
-- in one reviewed transaction after compatible request/runtime/health/recovery
-- source is composed. It refuses to run without the explicit transaction-local
-- approval value below and does not create a schedule, grant a login, alter a
-- provider/global default, or touch application rows.
--
--   BEGIN;
--   SET LOCAL circles.db03_actor_rls_contract = 'DB03_ACTOR_RLS_APPROVED_V1';
--   \i operations/remediation/remaining_db03_actor_rls.sql
--   COMMIT;

DO $db03_gate$
DECLARE
  missing_relations text;
BEGIN
  IF pg_catalog.current_setting('circles.db03_actor_rls_contract', true)
       IS DISTINCT FROM 'DB03_ACTOR_RLS_APPROVED_V1' THEN
    RAISE EXCEPTION 'DB-03 actor RLS requires explicit owner transaction approval';
  END IF;

  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'DB-03 actor RLS must be installed by the reviewed postgres owner';
  END IF;

  SELECT string_agg(required_relation, ', ' ORDER BY required_relation)
    INTO missing_relations
  FROM unnest(ARRAY[
    'circles_app.profiles',
    'circles_app.circles',
    'circles_app.memberships',
    'circles_app.posts',
    'circles_app.reactions',
    'circles_app.bookmarks',
    'circles_app.comments',
    'circles_app.conversations',
    'circles_app."conversationParticipants"',
    'circles_app.messages',
    'circles_app.follows',
    'circles_app.reports',
    'circles_app."socialUploads"',
    'circles_app."activityItems"',
    'circles_app."activityPreferences"',
    'circles_app."activityCirclePreferences"',
    'circles_app."moderationCases"',
    'circles_app."moderationActions"',
    'circles_publish."postPublishReceipts"'
  ]) AS required_relation
  WHERE pg_catalog.to_regclass(required_relation) IS NULL;

  IF missing_relations IS NOT NULL THEN
    RAISE EXCEPTION 'DB-03 actor RLS required relation(s) missing: %', missing_relations;
  END IF;

  IF NOT pg_catalog.has_schema_privilege('circles_app_runtime', 'circles_app', 'USAGE')
     OR NOT pg_catalog.has_schema_privilege('circles_app_runtime', 'circles_publish', 'USAGE') THEN
    RAISE EXCEPTION 'DB-03 actor RLS runtime schema privileges are not ready';
  END IF;
END
$db03_gate$;

-- Missing, malformed, or session-level stale values fail closed. Only db.ts
-- creates these values and it uses SET LOCAL before service code can run.
CREATE OR REPLACE FUNCTION circles_app.db03_current_actor_id()
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path TO pg_catalog
AS $db03_actor_id$
DECLARE
  value text;
BEGIN
  IF pg_catalog.current_setting('circles.actor_kind', true) IS DISTINCT FROM 'user' THEN
    RETURN NULL;
  END IF;
  value := pg_catalog.current_setting('circles.actor_id', true);
  IF value IS NULL OR value !~ '^[1-9][0-9]{0,9}$' THEN
    RETURN NULL;
  END IF;
  BEGIN
    RETURN value::integer;
  EXCEPTION WHEN numeric_value_out_of_range THEN
    RETURN NULL;
  END;
END
$db03_actor_id$;

CREATE OR REPLACE FUNCTION circles_app.db03_is_system_actor()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO pg_catalog
AS $db03_system$
  SELECT pg_catalog.current_setting('circles.actor_kind', true) = 'system'
$db03_system$;

-- The user role is checked from the private table rather than trusting a role
-- field carried by a request. These definer helpers are narrowly search-pathed
-- and exposed only to the application runtime role.
CREATE OR REPLACE FUNCTION circles_app.db03_is_admin_actor()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, circles_app
AS $db03_admin$
DECLARE
  actor_id integer;
BEGIN
  IF circles_app.db03_is_system_actor() THEN
    RETURN true;
  END IF;
  actor_id := circles_app.db03_current_actor_id();
  IF actor_id IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM circles_app.users AS user_row
    WHERE user_row.id = actor_id
      AND user_row.role::text = 'admin'
  );
END
$db03_admin$;

CREATE OR REPLACE FUNCTION circles_app.db03_can_read_circle(p_circle_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, circles_app
AS $db03_read_circle$
DECLARE
  actor_id integer;
BEGIN
  IF circles_app.db03_is_system_actor() OR circles_app.db03_is_admin_actor() THEN
    RETURN true;
  END IF;
  actor_id := circles_app.db03_current_actor_id();
  RETURN EXISTS (
    SELECT 1
    FROM circles_app.circles AS circle_row
    WHERE circle_row.id = p_circle_id
      AND (
        circle_row.privacy::text = 'public'
        OR (
          actor_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM circles_app.memberships AS membership_row
            WHERE membership_row."circleId" = circle_row.id
              AND membership_row."userId" = actor_id
              AND membership_row.role::text IN ('owner', 'moderator', 'member')
          )
        )
      )
  );
END
$db03_read_circle$;

CREATE OR REPLACE FUNCTION circles_app.db03_can_manage_circle(p_circle_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, circles_app
AS $db03_manage_circle$
DECLARE
  actor_id integer;
BEGIN
  IF circles_app.db03_is_system_actor() OR circles_app.db03_is_admin_actor() THEN
    RETURN true;
  END IF;
  actor_id := circles_app.db03_current_actor_id();
  IF actor_id IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM circles_app.circles AS circle_row
    WHERE circle_row.id = p_circle_id
      AND (
        circle_row."ownerId" = actor_id
        OR EXISTS (
          SELECT 1
          FROM circles_app.memberships AS membership_row
          WHERE membership_row."circleId" = circle_row.id
            AND membership_row."userId" = actor_id
            AND membership_row.role::text IN ('owner', 'moderator')
        )
      )
  );
END
$db03_manage_circle$;

CREATE OR REPLACE FUNCTION circles_app.db03_can_publish_to_circle(p_circle_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, circles_app
AS $db03_publish_circle$
DECLARE
  actor_id integer;
BEGIN
  IF p_circle_id IS NULL THEN
    RETURN circles_app.db03_current_actor_id() IS NOT NULL
      OR circles_app.db03_is_system_actor();
  END IF;
  IF circles_app.db03_is_system_actor() OR circles_app.db03_is_admin_actor() THEN
    RETURN true;
  END IF;
  actor_id := circles_app.db03_current_actor_id();
  RETURN actor_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM circles_app.memberships AS membership_row
    WHERE membership_row."circleId" = p_circle_id
      AND membership_row."userId" = actor_id
      AND membership_row.role::text IN ('owner', 'moderator', 'member')
  );
END
$db03_publish_circle$;

CREATE OR REPLACE FUNCTION circles_app.db03_can_read_membership(
  p_circle_id integer,
  p_user_id integer,
  p_role text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, circles_app
AS $db03_read_membership$
  SELECT circles_app.db03_is_system_actor()
      OR circles_app.db03_is_admin_actor()
      OR circles_app.db03_current_actor_id() = p_user_id
      OR circles_app.db03_can_manage_circle(p_circle_id)
      OR (
        p_role <> 'pending'
        AND circles_app.db03_can_read_circle(p_circle_id)
      )
$db03_read_membership$;

CREATE OR REPLACE FUNCTION circles_app.db03_can_read_post_id(p_post_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, circles_app
AS $db03_read_post$
DECLARE
  circle_id integer;
BEGIN
  SELECT post_row."circleId" INTO circle_id
  FROM circles_app.posts AS post_row
  WHERE post_row.id = p_post_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  RETURN circle_id IS NULL OR circles_app.db03_can_read_circle(circle_id);
END
$db03_read_post$;

CREATE OR REPLACE FUNCTION circles_app.db03_can_edit_post_id(
  p_post_id integer,
  p_author_id integer
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, circles_app
AS $db03_edit_post$
DECLARE
  circle_id integer;
BEGIN
  IF circles_app.db03_is_system_actor() OR circles_app.db03_is_admin_actor() THEN
    RETURN true;
  END IF;
  IF circles_app.db03_current_actor_id() = p_author_id THEN
    RETURN true;
  END IF;
  SELECT post_row."circleId" INTO circle_id
  FROM circles_app.posts AS post_row
  WHERE post_row.id = p_post_id;
  RETURN FOUND AND circle_id IS NOT NULL
    AND circles_app.db03_can_manage_circle(circle_id);
END
$db03_edit_post$;

CREATE OR REPLACE FUNCTION circles_app.db03_can_access_conversation(p_conversation_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, circles_app
AS $db03_conversation$
  SELECT circles_app.db03_is_system_actor()
      OR circles_app.db03_is_admin_actor()
      OR EXISTS (
        SELECT 1
        FROM circles_app."conversationParticipants" AS participant_row
        WHERE participant_row."conversationId" = p_conversation_id
          AND participant_row."userId" = circles_app.db03_current_actor_id()
      )
$db03_conversation$;

-- A caller may materialize only its own circle-chat participant or the exact
-- counterpart encoded by a new/existing direct conversation key. This avoids
-- treating an arbitrary self-insert as proof of conversation membership.
CREATE OR REPLACE FUNCTION circles_app.db03_can_insert_conversation_participant(
  p_conversation_id integer,
  p_user_id integer
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, circles_app
AS $db03_insert_participant$
DECLARE
  actor_id integer;
  conversation_kind text;
  direct_key text;
  circle_id integer;
BEGIN
  IF circles_app.db03_is_system_actor() OR circles_app.db03_is_admin_actor() THEN
    RETURN true;
  END IF;
  actor_id := circles_app.db03_current_actor_id();
  IF actor_id IS NULL THEN
    RETURN false;
  END IF;
  SELECT kind::text, "directKey", "circleId"
    INTO conversation_kind, direct_key, circle_id
  FROM circles_app.conversations
  WHERE id = p_conversation_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF conversation_kind = 'circle' THEN
    RETURN p_user_id = actor_id
      AND circles_app.db03_can_publish_to_circle(circle_id);
  END IF;
  RETURN conversation_kind = 'direct'
    AND direct_key = concat(
      least(actor_id, p_user_id), ':', greatest(actor_id, p_user_id)
    );
END
$db03_insert_participant$;

CREATE OR REPLACE FUNCTION circles_app.db03_can_access_activity_circle(p_circle_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, circles_app
AS $db03_activity_circle$
  SELECT circles_app.db03_is_system_actor()
      OR circles_app.db03_is_admin_actor()
      OR circles_app.db03_can_read_circle(p_circle_id)
      OR EXISTS (
        SELECT 1
        FROM circles_app.memberships AS membership_row
        WHERE membership_row."circleId" = p_circle_id
          AND membership_row."userId" = circles_app.db03_current_actor_id()
      )
$db03_activity_circle$;

CREATE OR REPLACE FUNCTION circles_app.db03_can_read_report(
  p_post_id integer,
  p_reporter_id integer
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, circles_app
AS $db03_report$
DECLARE
  circle_id integer;
BEGIN
  IF circles_app.db03_is_system_actor() OR circles_app.db03_is_admin_actor()
     OR circles_app.db03_current_actor_id() = p_reporter_id THEN
    RETURN true;
  END IF;
  SELECT post_row."circleId" INTO circle_id
  FROM circles_app.posts AS post_row
  WHERE post_row.id = p_post_id;
  RETURN FOUND AND circle_id IS NOT NULL
    AND circles_app.db03_can_manage_circle(circle_id);
END
$db03_report$;

CREATE OR REPLACE FUNCTION circles_app.db03_can_manage_moderation_case(p_case_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, circles_app
AS $db03_moderation_case$
  SELECT circles_app.db03_is_system_actor()
      OR circles_app.db03_is_admin_actor()
      OR EXISTS (
        SELECT 1
        FROM circles_app."moderationCases" AS case_row
        WHERE case_row.id = p_case_id
          AND circles_app.db03_can_manage_circle(case_row."circleId")
      )
$db03_moderation_case$;

-- RLS cannot compare OLD and NEW values. These two focused triggers retain
-- the service's established hierarchy when a runtime-role statement changes
-- a Circle owner or membership role. Native/admin execution remains untouched.
CREATE OR REPLACE FUNCTION circles_app.db03_enforce_runtime_circle_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, circles_app
AS $db03_circle_owner_trigger$
BEGIN
  IF current_user = 'circles_app_runtime'
     AND OLD."ownerId" IS DISTINCT FROM NEW."ownerId"
     AND NOT circles_app.db03_is_system_actor()
     AND NOT circles_app.db03_is_admin_actor() THEN
    RAISE EXCEPTION 'DB-03 runtime actor may not transfer a Circle owner';
  END IF;
  RETURN NEW;
END
$db03_circle_owner_trigger$;

CREATE OR REPLACE FUNCTION circles_app.db03_enforce_runtime_membership_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, circles_app
AS $db03_membership_role_trigger$
DECLARE
  actor_id integer;
  actor_is_owner boolean;
BEGIN
  IF current_user <> 'circles_app_runtime'
     OR OLD.role IS NOT DISTINCT FROM NEW.role
     OR circles_app.db03_is_system_actor()
     OR circles_app.db03_is_admin_actor() THEN
    RETURN NEW;
  END IF;
  actor_id := circles_app.db03_current_actor_id();
  SELECT circle_row."ownerId" = actor_id INTO actor_is_owner
  FROM circles_app.circles AS circle_row
  WHERE circle_row.id = NEW."circleId";
  IF actor_is_owner THEN
    RETURN NEW;
  END IF;
  IF OLD.role::text = 'pending'
     AND NEW.role::text = 'member'
     AND circles_app.db03_can_manage_circle(NEW."circleId") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'DB-03 runtime actor may not change this membership role';
END
$db03_membership_role_trigger$;

REVOKE ALL ON FUNCTION circles_app.db03_current_actor_id() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION circles_app.db03_is_system_actor() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION circles_app.db03_is_admin_actor() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION circles_app.db03_can_read_circle(integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION circles_app.db03_can_manage_circle(integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION circles_app.db03_can_publish_to_circle(integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION circles_app.db03_can_read_membership(integer, integer, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION circles_app.db03_can_read_post_id(integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION circles_app.db03_can_edit_post_id(integer, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION circles_app.db03_can_access_conversation(integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION circles_app.db03_can_insert_conversation_participant(integer, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION circles_app.db03_can_access_activity_circle(integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION circles_app.db03_can_read_report(integer, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION circles_app.db03_can_manage_moderation_case(integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION circles_app.db03_enforce_runtime_circle_owner() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION circles_app.db03_enforce_runtime_membership_role() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION circles_app.db03_current_actor_id() TO circles_app_runtime;
GRANT EXECUTE ON FUNCTION circles_app.db03_is_system_actor() TO circles_app_runtime;
GRANT EXECUTE ON FUNCTION circles_app.db03_is_admin_actor() TO circles_app_runtime;
GRANT EXECUTE ON FUNCTION circles_app.db03_can_read_circle(integer) TO circles_app_runtime;
GRANT EXECUTE ON FUNCTION circles_app.db03_can_manage_circle(integer) TO circles_app_runtime;
GRANT EXECUTE ON FUNCTION circles_app.db03_can_publish_to_circle(integer) TO circles_app_runtime;
GRANT EXECUTE ON FUNCTION circles_app.db03_can_read_membership(integer, integer, text) TO circles_app_runtime;
GRANT EXECUTE ON FUNCTION circles_app.db03_can_read_post_id(integer) TO circles_app_runtime;
GRANT EXECUTE ON FUNCTION circles_app.db03_can_edit_post_id(integer, integer) TO circles_app_runtime;
GRANT EXECUTE ON FUNCTION circles_app.db03_can_access_conversation(integer) TO circles_app_runtime;
GRANT EXECUTE ON FUNCTION circles_app.db03_can_insert_conversation_participant(integer, integer) TO circles_app_runtime;
GRANT EXECUTE ON FUNCTION circles_app.db03_can_access_activity_circle(integer) TO circles_app_runtime;
GRANT EXECUTE ON FUNCTION circles_app.db03_can_read_report(integer, integer) TO circles_app_runtime;
GRANT EXECUTE ON FUNCTION circles_app.db03_can_manage_moderation_case(integer) TO circles_app_runtime;

-- Replace only the named permissive runtime policies. Native/admin policies
-- remain unchanged, and all non-covered tables remain deliberately out of this
-- candidate until their caller/action inventory is separately composed.
DROP POLICY IF EXISTS runtime_profiles_policy ON circles_app.profiles;
DROP POLICY IF EXISTS runtime_circles_policy ON circles_app.circles;
DROP POLICY IF EXISTS runtime_memberships_policy ON circles_app.memberships;
DROP POLICY IF EXISTS runtime_posts_policy ON circles_app.posts;
DROP POLICY IF EXISTS runtime_reactions_policy ON circles_app.reactions;
DROP POLICY IF EXISTS runtime_bookmarks_policy ON circles_app.bookmarks;
DROP POLICY IF EXISTS runtime_comments_policy ON circles_app.comments;
DROP POLICY IF EXISTS runtime_conversations_policy ON circles_app.conversations;
DROP POLICY IF EXISTS runtime_conversation_participants_policy ON circles_app."conversationParticipants";
DROP POLICY IF EXISTS runtime_messages_policy ON circles_app.messages;
DROP POLICY IF EXISTS runtime_follows_policy ON circles_app.follows;
DROP POLICY IF EXISTS runtime_reports_policy ON circles_app.reports;
DROP POLICY IF EXISTS runtime_social_uploads_policy ON circles_app."socialUploads";
DROP POLICY IF EXISTS runtime_activity_items_policy ON circles_app."activityItems";
DROP POLICY IF EXISTS runtime_activity_preferences_policy ON circles_app."activityPreferences";
DROP POLICY IF EXISTS runtime_activity_circle_preferences_policy ON circles_app."activityCirclePreferences";
DROP POLICY IF EXISTS runtime_moderation_cases_policy ON circles_app."moderationCases";
DROP POLICY IF EXISTS runtime_moderation_actions_policy ON circles_app."moderationActions";
DROP POLICY IF EXISTS post_publish_receipts_runtime_insert ON circles_publish."postPublishReceipts";
DROP POLICY IF EXISTS post_publish_receipts_runtime_select ON circles_publish."postPublishReceipts";
DROP POLICY IF EXISTS post_publish_receipts_runtime_update ON circles_publish."postPublishReceipts";
DROP TRIGGER IF EXISTS db03_runtime_circle_owner_guard ON circles_app.circles;
DROP TRIGGER IF EXISTS db03_runtime_membership_role_guard ON circles_app.memberships;

CREATE TRIGGER db03_runtime_circle_owner_guard
BEFORE UPDATE ON circles_app.circles
FOR EACH ROW EXECUTE FUNCTION circles_app.db03_enforce_runtime_circle_owner();
CREATE TRIGGER db03_runtime_membership_role_guard
BEFORE UPDATE ON circles_app.memberships
FOR EACH ROW EXECUTE FUNCTION circles_app.db03_enforce_runtime_membership_role();

CREATE POLICY db03_profiles_select ON circles_app.profiles FOR SELECT TO circles_app_runtime USING (true);
CREATE POLICY db03_profiles_insert ON circles_app.profiles FOR INSERT TO circles_app_runtime WITH CHECK (
  circles_app.db03_is_system_actor() OR circles_app.db03_is_admin_actor()
  OR "userId" = circles_app.db03_current_actor_id()
);
CREATE POLICY db03_profiles_update ON circles_app.profiles FOR UPDATE TO circles_app_runtime USING (
  circles_app.db03_is_system_actor() OR circles_app.db03_is_admin_actor()
  OR "userId" = circles_app.db03_current_actor_id()
) WITH CHECK (
  circles_app.db03_is_system_actor() OR circles_app.db03_is_admin_actor()
  OR "userId" = circles_app.db03_current_actor_id()
);
CREATE POLICY db03_profiles_delete ON circles_app.profiles FOR DELETE TO circles_app_runtime USING (
  circles_app.db03_is_system_actor() OR circles_app.db03_is_admin_actor()
  OR "userId" = circles_app.db03_current_actor_id()
);

-- Circle listings stay readable so approved guest discovery and private-circle
-- teaser behavior retain their service-level semantics. Writes are scoped.
CREATE POLICY db03_circles_select ON circles_app.circles FOR SELECT TO circles_app_runtime USING (true);
CREATE POLICY db03_circles_insert ON circles_app.circles FOR INSERT TO circles_app_runtime WITH CHECK (
  circles_app.db03_is_system_actor() OR circles_app.db03_is_admin_actor()
  OR "ownerId" = circles_app.db03_current_actor_id()
);
CREATE POLICY db03_circles_update ON circles_app.circles FOR UPDATE TO circles_app_runtime USING (
  circles_app.db03_can_manage_circle(id)
) WITH CHECK (
  circles_app.db03_is_system_actor() OR circles_app.db03_is_admin_actor()
  OR "ownerId" = circles_app.db03_current_actor_id()
  OR circles_app.db03_can_manage_circle(id)
);
CREATE POLICY db03_circles_delete ON circles_app.circles FOR DELETE TO circles_app_runtime USING (
  circles_app.db03_can_manage_circle(id)
);

CREATE POLICY db03_memberships_select ON circles_app.memberships FOR SELECT TO circles_app_runtime USING (
  circles_app.db03_can_read_membership("circleId", "userId", role::text)
);
CREATE POLICY db03_memberships_insert ON circles_app.memberships FOR INSERT TO circles_app_runtime WITH CHECK (
  circles_app.db03_can_manage_circle("circleId")
  OR (
    "userId" = circles_app.db03_current_actor_id()
    AND role::text IN ('member', 'pending')
  )
);
CREATE POLICY db03_memberships_update ON circles_app.memberships FOR UPDATE TO circles_app_runtime USING (
  circles_app.db03_can_manage_circle("circleId")
) WITH CHECK (
  circles_app.db03_can_manage_circle("circleId")
);
CREATE POLICY db03_memberships_delete ON circles_app.memberships FOR DELETE TO circles_app_runtime USING (
  circles_app.db03_can_manage_circle("circleId")
  OR "userId" = circles_app.db03_current_actor_id()
);

CREATE POLICY db03_posts_select ON circles_app.posts FOR SELECT TO circles_app_runtime USING (
  "circleId" IS NULL OR circles_app.db03_can_read_circle("circleId")
);
CREATE POLICY db03_posts_insert ON circles_app.posts FOR INSERT TO circles_app_runtime WITH CHECK (
  "authorId" = circles_app.db03_current_actor_id()
  AND circles_app.db03_can_publish_to_circle("circleId")
);
CREATE POLICY db03_posts_update ON circles_app.posts FOR UPDATE TO circles_app_runtime USING (
  circles_app.db03_can_edit_post_id(id, "authorId")
) WITH CHECK (
  circles_app.db03_is_system_actor() OR circles_app.db03_is_admin_actor()
  OR (
    "authorId" = circles_app.db03_current_actor_id()
    AND circles_app.db03_can_publish_to_circle("circleId")
  )
  OR circles_app.db03_can_manage_circle("circleId")
);
CREATE POLICY db03_posts_delete ON circles_app.posts FOR DELETE TO circles_app_runtime USING (
  circles_app.db03_can_edit_post_id(id, "authorId")
);

CREATE POLICY db03_reactions_select ON circles_app.reactions FOR SELECT TO circles_app_runtime USING (
  circles_app.db03_can_read_post_id("postId")
);
CREATE POLICY db03_reactions_insert ON circles_app.reactions FOR INSERT TO circles_app_runtime WITH CHECK (
  "userId" = circles_app.db03_current_actor_id()
  AND circles_app.db03_can_read_post_id("postId")
);
CREATE POLICY db03_reactions_delete ON circles_app.reactions FOR DELETE TO circles_app_runtime USING (
  "userId" = circles_app.db03_current_actor_id()
);

CREATE POLICY db03_bookmarks_select ON circles_app.bookmarks FOR SELECT TO circles_app_runtime USING (
  "userId" = circles_app.db03_current_actor_id()
  OR circles_app.db03_is_system_actor() OR circles_app.db03_is_admin_actor()
);
CREATE POLICY db03_bookmarks_insert ON circles_app.bookmarks FOR INSERT TO circles_app_runtime WITH CHECK (
  "userId" = circles_app.db03_current_actor_id()
  AND circles_app.db03_can_read_post_id("postId")
);
CREATE POLICY db03_bookmarks_delete ON circles_app.bookmarks FOR DELETE TO circles_app_runtime USING (
  "userId" = circles_app.db03_current_actor_id()
);

CREATE POLICY db03_comments_select ON circles_app.comments FOR SELECT TO circles_app_runtime USING (
  circles_app.db03_can_read_post_id("postId")
);
CREATE POLICY db03_comments_insert ON circles_app.comments FOR INSERT TO circles_app_runtime WITH CHECK (
  "authorId" = circles_app.db03_current_actor_id()
  AND circles_app.db03_can_read_post_id("postId")
);
CREATE POLICY db03_comments_update ON circles_app.comments FOR UPDATE TO circles_app_runtime USING (
  circles_app.db03_can_edit_post_id("postId", "authorId")
) WITH CHECK (
  "authorId" = circles_app.db03_current_actor_id()
  AND circles_app.db03_can_read_post_id("postId")
);
CREATE POLICY db03_comments_delete ON circles_app.comments FOR DELETE TO circles_app_runtime USING (
  circles_app.db03_can_edit_post_id("postId", "authorId")
);

CREATE POLICY db03_conversations_select ON circles_app.conversations FOR SELECT TO circles_app_runtime USING (
  circles_app.db03_can_access_conversation(id)
);
CREATE POLICY db03_conversations_insert ON circles_app.conversations FOR INSERT TO circles_app_runtime WITH CHECK (
  circles_app.db03_current_actor_id() IS NOT NULL OR circles_app.db03_is_system_actor()
);
CREATE POLICY db03_conversations_update ON circles_app.conversations FOR UPDATE TO circles_app_runtime USING (
  circles_app.db03_can_access_conversation(id)
) WITH CHECK (
  circles_app.db03_can_access_conversation(id)
);
CREATE POLICY db03_conversations_delete ON circles_app.conversations FOR DELETE TO circles_app_runtime USING (
  circles_app.db03_is_system_actor() OR circles_app.db03_is_admin_actor()
);

CREATE POLICY db03_conversation_participants_select ON circles_app."conversationParticipants" FOR SELECT TO circles_app_runtime USING (
  circles_app.db03_can_access_conversation("conversationId")
);
CREATE POLICY db03_conversation_participants_insert ON circles_app."conversationParticipants" FOR INSERT TO circles_app_runtime WITH CHECK (
  circles_app.db03_can_insert_conversation_participant("conversationId", "userId")
);
CREATE POLICY db03_conversation_participants_update ON circles_app."conversationParticipants" FOR UPDATE TO circles_app_runtime USING (
  "userId" = circles_app.db03_current_actor_id()
) WITH CHECK (
  "userId" = circles_app.db03_current_actor_id()
);
CREATE POLICY db03_conversation_participants_delete ON circles_app."conversationParticipants" FOR DELETE TO circles_app_runtime USING (
  "userId" = circles_app.db03_current_actor_id()
  OR circles_app.db03_is_system_actor() OR circles_app.db03_is_admin_actor()
);

CREATE POLICY db03_messages_select ON circles_app.messages FOR SELECT TO circles_app_runtime USING (
  circles_app.db03_can_access_conversation("conversationId")
);
CREATE POLICY db03_messages_insert ON circles_app.messages FOR INSERT TO circles_app_runtime WITH CHECK (
  "authorId" = circles_app.db03_current_actor_id()
  AND circles_app.db03_can_access_conversation("conversationId")
);
CREATE POLICY db03_messages_update ON circles_app.messages FOR UPDATE TO circles_app_runtime USING (
  "authorId" = circles_app.db03_current_actor_id()
) WITH CHECK (
  "authorId" = circles_app.db03_current_actor_id()
);
CREATE POLICY db03_messages_delete ON circles_app.messages FOR DELETE TO circles_app_runtime USING (
  "authorId" = circles_app.db03_current_actor_id()
  OR circles_app.db03_is_system_actor() OR circles_app.db03_is_admin_actor()
);

-- Follow rows remain selectable for public follower/following totals, while a
-- caller may create/delete only an edge whose follower is the trusted actor.
CREATE POLICY db03_follows_select ON circles_app.follows FOR SELECT TO circles_app_runtime USING (true);
CREATE POLICY db03_follows_insert ON circles_app.follows FOR INSERT TO circles_app_runtime WITH CHECK (
  "followerId" = circles_app.db03_current_actor_id()
);
CREATE POLICY db03_follows_delete ON circles_app.follows FOR DELETE TO circles_app_runtime USING (
  "followerId" = circles_app.db03_current_actor_id()
);

CREATE POLICY db03_reports_select ON circles_app.reports FOR SELECT TO circles_app_runtime USING (
  circles_app.db03_can_read_report("postId", "reporterId")
);
CREATE POLICY db03_reports_insert ON circles_app.reports FOR INSERT TO circles_app_runtime WITH CHECK (
  "reporterId" = circles_app.db03_current_actor_id()
  AND circles_app.db03_can_read_post_id("postId")
);
CREATE POLICY db03_reports_update ON circles_app.reports FOR UPDATE TO circles_app_runtime USING (
  circles_app.db03_can_read_report("postId", "reporterId")
) WITH CHECK (
  circles_app.db03_can_read_report("postId", "reporterId")
);
CREATE POLICY db03_reports_delete ON circles_app.reports FOR DELETE TO circles_app_runtime USING (
  circles_app.db03_can_read_report("postId", "reporterId")
);

CREATE POLICY db03_social_uploads_select ON circles_app."socialUploads" FOR SELECT TO circles_app_runtime USING (
  "userId" = circles_app.db03_current_actor_id()
  OR circles_app.db03_is_system_actor() OR circles_app.db03_is_admin_actor()
);
CREATE POLICY db03_social_uploads_insert ON circles_app."socialUploads" FOR INSERT TO circles_app_runtime WITH CHECK (
  "userId" = circles_app.db03_current_actor_id()
);
CREATE POLICY db03_social_uploads_update ON circles_app."socialUploads" FOR UPDATE TO circles_app_runtime USING (
  "userId" = circles_app.db03_current_actor_id()
) WITH CHECK (
  "userId" = circles_app.db03_current_actor_id()
);
CREATE POLICY db03_social_uploads_delete ON circles_app."socialUploads" FOR DELETE TO circles_app_runtime USING (
  "userId" = circles_app.db03_current_actor_id()
);

CREATE POLICY db03_activity_items_select ON circles_app."activityItems" FOR SELECT TO circles_app_runtime USING (
  "recipientId" = circles_app.db03_current_actor_id()
  OR circles_app.db03_is_system_actor() OR circles_app.db03_is_admin_actor()
);
CREATE POLICY db03_activity_items_insert ON circles_app."activityItems" FOR INSERT TO circles_app_runtime WITH CHECK (
  "actorId" = circles_app.db03_current_actor_id()
  OR circles_app.db03_is_system_actor() OR circles_app.db03_is_admin_actor()
);
CREATE POLICY db03_activity_items_update ON circles_app."activityItems" FOR UPDATE TO circles_app_runtime USING (
  "recipientId" = circles_app.db03_current_actor_id()
) WITH CHECK (
  "recipientId" = circles_app.db03_current_actor_id()
);
CREATE POLICY db03_activity_items_delete ON circles_app."activityItems" FOR DELETE TO circles_app_runtime USING (
  "recipientId" = circles_app.db03_current_actor_id()
);

CREATE POLICY db03_activity_preferences_select ON circles_app."activityPreferences" FOR SELECT TO circles_app_runtime USING (
  "recipientId" = circles_app.db03_current_actor_id()
  OR circles_app.db03_is_system_actor() OR circles_app.db03_is_admin_actor()
);
CREATE POLICY db03_activity_preferences_insert ON circles_app."activityPreferences" FOR INSERT TO circles_app_runtime WITH CHECK (
  "recipientId" = circles_app.db03_current_actor_id()
);
CREATE POLICY db03_activity_preferences_update ON circles_app."activityPreferences" FOR UPDATE TO circles_app_runtime USING (
  "recipientId" = circles_app.db03_current_actor_id()
) WITH CHECK (
  "recipientId" = circles_app.db03_current_actor_id()
);
CREATE POLICY db03_activity_preferences_delete ON circles_app."activityPreferences" FOR DELETE TO circles_app_runtime USING (
  "recipientId" = circles_app.db03_current_actor_id()
);

CREATE POLICY db03_activity_circle_preferences_select ON circles_app."activityCirclePreferences" FOR SELECT TO circles_app_runtime USING (
  "recipientId" = circles_app.db03_current_actor_id()
  OR circles_app.db03_is_system_actor() OR circles_app.db03_is_admin_actor()
);
CREATE POLICY db03_activity_circle_preferences_insert ON circles_app."activityCirclePreferences" FOR INSERT TO circles_app_runtime WITH CHECK (
  "recipientId" = circles_app.db03_current_actor_id()
  AND circles_app.db03_can_access_activity_circle("circleId")
);
CREATE POLICY db03_activity_circle_preferences_update ON circles_app."activityCirclePreferences" FOR UPDATE TO circles_app_runtime USING (
  "recipientId" = circles_app.db03_current_actor_id()
) WITH CHECK (
  "recipientId" = circles_app.db03_current_actor_id()
  AND circles_app.db03_can_access_activity_circle("circleId")
);
CREATE POLICY db03_activity_circle_preferences_delete ON circles_app."activityCirclePreferences" FOR DELETE TO circles_app_runtime USING (
  "recipientId" = circles_app.db03_current_actor_id()
);

CREATE POLICY db03_moderation_cases_select ON circles_app."moderationCases" FOR SELECT TO circles_app_runtime USING (
  circles_app.db03_can_manage_circle("circleId")
);
CREATE POLICY db03_moderation_cases_insert ON circles_app."moderationCases" FOR INSERT TO circles_app_runtime WITH CHECK (
  (circles_app.db03_current_actor_id() IS NOT NULL OR circles_app.db03_is_system_actor())
  AND circles_app.db03_can_read_circle("circleId")
);
CREATE POLICY db03_moderation_cases_update ON circles_app."moderationCases" FOR UPDATE TO circles_app_runtime USING (
  circles_app.db03_can_manage_circle("circleId")
) WITH CHECK (
  circles_app.db03_can_manage_circle("circleId")
);
CREATE POLICY db03_moderation_cases_delete ON circles_app."moderationCases" FOR DELETE TO circles_app_runtime USING (
  circles_app.db03_can_manage_circle("circleId")
);

CREATE POLICY db03_moderation_actions_select ON circles_app."moderationActions" FOR SELECT TO circles_app_runtime USING (
  circles_app.db03_can_manage_moderation_case("caseId")
);
CREATE POLICY db03_moderation_actions_insert ON circles_app."moderationActions" FOR INSERT TO circles_app_runtime WITH CHECK (
  "reviewerId" = circles_app.db03_current_actor_id()
  AND circles_app.db03_can_manage_moderation_case("caseId")
);
CREATE POLICY db03_moderation_actions_update ON circles_app."moderationActions" FOR UPDATE TO circles_app_runtime USING (
  circles_app.db03_can_manage_moderation_case("caseId")
) WITH CHECK (
  circles_app.db03_can_manage_moderation_case("caseId")
);
CREATE POLICY db03_moderation_actions_delete ON circles_app."moderationActions" FOR DELETE TO circles_app_runtime USING (
  circles_app.db03_can_manage_moderation_case("caseId")
);

CREATE POLICY db03_post_publish_receipts_select ON circles_publish."postPublishReceipts" FOR SELECT TO circles_app_runtime USING (
  "actorId" = circles_app.db03_current_actor_id()
  OR circles_app.db03_is_system_actor() OR circles_app.db03_is_admin_actor()
);
CREATE POLICY db03_post_publish_receipts_insert ON circles_publish."postPublishReceipts" FOR INSERT TO circles_app_runtime WITH CHECK (
  "actorId" = circles_app.db03_current_actor_id()
);
CREATE POLICY db03_post_publish_receipts_update ON circles_publish."postPublishReceipts" FOR UPDATE TO circles_app_runtime USING (
  "actorId" = circles_app.db03_current_actor_id()
) WITH CHECK (
  "actorId" = circles_app.db03_current_actor_id()
);
