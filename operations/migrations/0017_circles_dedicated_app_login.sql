-- DB-02: dedicated Circles application connection principal.
-- Prepared only. Apply once through the parent-approved operational PostgreSQL workflow
-- after a disposable PostgreSQL 17 rehearsal. This file neither activates the role nor
-- contains credential material.
--
-- The application principal is deliberately created NOLOGIN. Protected provider-side
-- credential provisioning and the explicit LOGIN activation are a later, separately
-- approved cutover step. The current postgres connection remains supported by source
-- until that cutover is verified and all authorized consumers are inventoried.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

DO $bootstrap$
DECLARE
  v_runtime pg_catalog.pg_roles%ROWTYPE;
BEGIN
  IF pg_catalog.current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'DB-02 expected database postgres, found %', pg_catalog.current_database();
  END IF;

  SELECT *
    INTO v_runtime
    FROM pg_catalog.pg_roles
   WHERE rolname = 'circles_app_runtime';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DB-02 requires circles_app_runtime before creating circles_app_login';
  END IF;

  IF v_runtime.rolcanlogin
     OR v_runtime.rolsuper
     OR v_runtime.rolcreatedb
     OR v_runtime.rolcreaterole
     OR v_runtime.rolreplication
     OR v_runtime.rolbypassrls
     OR v_runtime.rolinherit THEN
    RAISE EXCEPTION 'DB-02 found an unexpected circles_app_runtime role definition';
  END IF;

  -- Do not adapt an existing role of this name. A pre-existing principal could
  -- carry unreviewed grants or membership paths, so protected operators must
  -- inspect it rather than having this migration normalize it implicitly.
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles
     WHERE rolname = 'circles_app_login'
  ) THEN
    RAISE EXCEPTION 'DB-02 refuses to reuse an existing circles_app_login role';
  END IF;

  EXECUTE 'CREATE ROLE circles_app_login NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
END
$bootstrap$;

-- Remove any database-level defaults that might have been assigned by a role
-- creation wrapper, then grant only the connection required to begin a session.
REVOKE ALL PRIVILEGES ON DATABASE postgres FROM circles_app_login;
GRANT CONNECT ON DATABASE postgres TO circles_app_login;

-- PostgreSQL 17 membership options make the only application path explicit:
-- the login cannot inherit runtime privileges, can SET ROLE to the established
-- non-login runtime role, and cannot administer that role.
GRANT circles_app_runtime TO circles_app_login
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;

DO $postcondition$
DECLARE
  v_runtime_oid oid;
  v_app_login pg_catalog.pg_roles%ROWTYPE;
BEGIN
  SELECT oid
    INTO v_runtime_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = 'circles_app_runtime';

  SELECT *
    INTO v_app_login
    FROM pg_catalog.pg_roles
   WHERE rolname = 'circles_app_login';

  IF NOT FOUND
     OR v_app_login.rolcanlogin
     OR v_app_login.rolsuper
     OR v_app_login.rolcreatedb
     OR v_app_login.rolcreaterole
     OR v_app_login.rolreplication
     OR v_app_login.rolbypassrls
     OR v_app_login.rolinherit
     OR v_app_login.rolconfig IS NOT NULL THEN
    RAISE EXCEPTION 'DB-02 dedicated application role postcondition failed';
  END IF;

  -- The role may have an operational administrator as a member when the
  -- provider creates roles with CREATEROLE. This assertion intentionally checks
  -- only privileges that circles_app_login itself can assume.
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS parent_role ON parent_role.oid = membership.roleid
     WHERE membership.member = v_app_login.oid
       AND parent_role.rolname <> 'circles_app_runtime'
  ) THEN
    RAISE EXCEPTION 'DB-02 found an unreviewed membership granted to circles_app_login';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
     WHERE membership.roleid = v_runtime_oid
       AND membership.member = v_app_login.oid
       AND membership.admin_option = FALSE
       AND membership.inherit_option = FALSE
       AND membership.set_option = TRUE
  ) THEN
    RAISE EXCEPTION 'DB-02 runtime membership must be SET-only and non-administrative';
  END IF;

  -- A runtime role that itself can assume another role would defeat the bounded
  -- authority path above. Existing catalog evidence shows no such membership.
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members
     WHERE member = v_runtime_oid
  ) THEN
    RAISE EXCEPTION 'DB-02 circles_app_runtime must not be a member of another role';
  END IF;

  IF NOT pg_catalog.has_database_privilege(
    v_app_login.oid,
    pg_catalog.current_database(),
    'CONNECT'
  ) THEN
    RAISE EXCEPTION 'DB-02 dedicated application role lacks database CONNECT';
  END IF;
END
$postcondition$;

COMMIT;
