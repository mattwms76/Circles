-- The trigger is created by postgres, not by the non-login application role.
-- PostgreSQL17 checks EXECUTE for trigger creation. The restricted role has no
-- TRIGGER privilege and needs no direct callable function grant. The disposable
-- PG17 fixture verifies that invoker trigger enforcement still fires for its
-- inserts after this exact revoke. No table, row, trigger body, other role,
-- provider-global default privilege, or Cron job is modified.
BEGIN;
REVOKE ALL ON FUNCTION circles_app.enforce_message_author_authorized()
  FROM circles_app_runtime;
COMMIT;
