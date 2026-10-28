-- SEC-020 proposal only — DO NOT add this file to a migration journal or apply it
--
-- Purpose: replace the current privileged postgres connection trust boundary with
-- one exact, non-superuser LOGIN principal that may SET ROLE only to
-- circles_app_runtime. This proposal does not configure a password, DSN, pooler
-- username, provider secret, grant, or runtime environment value.
--
-- Preconditions outside this file:
--   1. The owner has protected secret-write access for BOTH the API and encrypted
--      backup consumer, and has reviewed the provider's custom-role/pooler path.
--   2. A disposable PostgreSQL 17 rehearsal has passed with the exact provider
--      connection form. Do not infer pooler username syntax from this proposal.
--   3. Parent-approved runtime/config wiring can require the readiness query
--      below before serving traffic. The active privileged DSN remains unchanged
--      until that coordinated change is approved.
--   4. Confirm this role name is absent. Never alter an existing role in place.

BEGIN;

CREATE ROLE circles_app_bootstrap
  LOGIN
  NOINHERIT
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS;

-- The bootstrap principal gets no direct circles_app privileges. It may enter
-- exactly the already reviewed NOLOGIN runtime role; it cannot administer that
-- membership or inherit its privileges without SET ROLE.
GRANT circles_app_runtime TO circles_app_bootstrap
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;

REVOKE ALL PRIVILEGES ON DATABASE postgres FROM circles_app_bootstrap;
GRANT CONNECT ON DATABASE postgres TO circles_app_bootstrap;
REVOKE ALL PRIVILEGES ON SCHEMA circles_app FROM circles_app_bootstrap;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA circles_app FROM circles_app_bootstrap;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA circles_app FROM circles_app_bootstrap;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA circles_app FROM circles_app_bootstrap;

COMMIT;

-- Owner-run, value-free readiness proof, after connecting with the exact new
-- provider-approved principal and after SET ROLE circles_app_runtime:
--
-- SELECT session_user::text AS session_principal,
--   current_user::text AS runtime_role,
--   pg_catalog.pg_has_role(session_user, current_user, 'SET ROLE') AS may_set_runtime_role
-- LIMIT 1;
--
-- Expected only: session_principal=circles_app_bootstrap,
-- runtime_role=circles_app_runtime, may_set_runtime_role=true. Any other
-- result fails closed. Then RESET ROLE must restore circles_app_bootstrap.
-- Verify catalog role attributes/membership and API plus backup secret-consumer
-- readiness before revoking the retired privileged path. No row reads are part
-- of this proposal.
