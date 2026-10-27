-- DB-16 — proposed security-state retention helper (UNAPPLIED).
--
-- Run only through the parent-approved PostgreSQL workflow as the `postgres`
-- operational role after a disposable PostgreSQL 17 drill. This file creates no
-- schedule, does not change existing roles, and does not delete rows until an
-- explicit administrator calls the helper with p_dry_run => false.
--
-- Proposed operational horizons, pending product/legal/incident-response
-- approval (they are not an approved retention policy):
--   * OAuth pending state: eligible immediately when expires_at has passed.
--   * Application session: eligible 90 days after expiresAt, or 180 days after
--     revokedAt only once expiresAt has also passed. The latter condition keeps
--     every not-yet-expired session record, including revoked records.
--
-- The function returns only aggregate candidate/deletion counts. It never
-- returns a fingerprint, OAuth value, user identifier, application ID, or row.

BEGIN;

DO $guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION
      'DB-16 retention helper must be installed as postgres, got %', current_user;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(ARRAY[
      'postgres',
      'anon',
      'authenticated',
      'service_role',
      'circles_app_runtime',
      'circles_admin_runtime',
      'circles_admin_native_executor'
    ]) AS expected(role_name)
    WHERE pg_catalog.to_regrole(expected.role_name) IS NULL
  ) THEN
    RAISE EXCEPTION 'DB-16 expected Circles roles are missing';
  END IF;

  IF pg_catalog.to_regnamespace('circles_ops') IS NULL
     OR pg_catalog.to_regclass('circles_app."applicationSessions"') IS NULL
     OR pg_catalog.to_regclass('circles_auth.oauth_pending_states') IS NULL THEN
    RAISE EXCEPTION 'DB-16 requires installed circles_ops, applicationSessions, and oauth_pending_states';
  END IF;

  IF pg_catalog.to_regclass('circles_app.application_sessions_expiry_idx') IS NULL
     OR pg_catalog.to_regclass('circles_auth.circles_auth_oauth_pending_states_expires_at_idx') IS NULL THEN
    RAISE EXCEPTION 'DB-16 requires the existing expiry indexes before retention cleanup';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'circles_app."applicationSessions"'::pg_catalog.regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attname = ANY (ARRAY[
        'sessionFingerprint'::pg_catalog.name,
        'expiresAt'::pg_catalog.name,
        'revokedAt'::pg_catalog.name
      ])
  ) <> 3 THEN
    RAISE EXCEPTION 'DB-16 applicationSessions columns do not match the reviewed contract';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'circles_auth.oauth_pending_states'::pg_catalog.regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attname = ANY (ARRAY[
        'state_fingerprint'::pg_catalog.name,
        'expires_at'::pg_catalog.name
      ])
  ) <> 2 THEN
    RAISE EXCEPTION 'DB-16 oauth_pending_states columns do not match the reviewed contract';
  END IF;

  IF pg_catalog.to_regprocedure(
    'circles_ops.run_security_state_retention(boolean,integer)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'DB-16 retention helper already exists; inspect it instead of replacing it';
  END IF;
END
$guard$;

-- p_dry_run defaults to true. The strict cap and SKIP LOCKED selection make a
-- single operator invocation bounded even if a stale backlog exists. The short
-- function settings prevent it from waiting behind a contended relation/DDL.
CREATE FUNCTION circles_ops.run_security_state_retention(
  p_dry_run boolean DEFAULT true,
  p_batch_size integer DEFAULT 25
)
RETURNS TABLE (
  state_kind text,
  candidate_count integer,
  deleted_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
SET lock_timeout = '500ms'
SET statement_timeout = '5s'
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_dry_run IS NULL
     OR p_batch_size IS NULL
     OR p_batch_size < 1
     OR p_batch_size > 100 THEN
    RAISE EXCEPTION 'DB-16 requires p_dry_run and p_batch_size from 1 through 100';
  END IF;

  RETURN QUERY
  WITH oauth_candidates AS MATERIALIZED (
    SELECT pending.state_fingerprint
    FROM circles_auth.oauth_pending_states AS pending
    WHERE pending.expires_at <= v_now
    ORDER BY pending.expires_at ASC, pending.state_fingerprint ASC
    LIMIT p_batch_size
    FOR UPDATE OF pending SKIP LOCKED
  ),
  oauth_deleted AS (
    DELETE FROM circles_auth.oauth_pending_states AS pending
    USING oauth_candidates AS candidate
    WHERE NOT p_dry_run
      AND pending.state_fingerprint = candidate.state_fingerprint
    RETURNING 1
  )
  SELECT
    'expired_oauth_pending_states'::text,
    (SELECT count(*)::integer FROM oauth_candidates),
    (SELECT count(*)::integer FROM oauth_deleted);

  RETURN QUERY
  WITH session_candidates AS MATERIALIZED (
    SELECT session."sessionFingerprint"
    FROM circles_app."applicationSessions" AS session
    WHERE session."expiresAt" <= v_now
      AND (
        session."expiresAt" <= v_now - pg_catalog.make_interval(days => 90)
        OR (
          session."revokedAt" IS NOT NULL
          AND session."revokedAt" <= v_now - pg_catalog.make_interval(days => 180)
        )
      )
    ORDER BY session."expiresAt" ASC, session."sessionFingerprint" ASC
    LIMIT p_batch_size
    FOR UPDATE OF session SKIP LOCKED
  ),
  session_deleted AS (
    DELETE FROM circles_app."applicationSessions" AS session
    USING session_candidates AS candidate
    WHERE NOT p_dry_run
      AND session."sessionFingerprint" = candidate."sessionFingerprint"
    RETURNING 1
  )
  SELECT
    'expired_or_long_revoked_application_sessions'::text,
    (SELECT count(*)::integer FROM session_candidates),
    (SELECT count(*)::integer FROM session_deleted);
END
$function$;

ALTER FUNCTION circles_ops.run_security_state_retention(boolean, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION circles_ops.run_security_state_retention(boolean, integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION circles_ops.run_security_state_retention(boolean, integer)
  FROM anon, authenticated, service_role, circles_app_runtime,
    circles_admin_runtime, circles_admin_native_executor;
GRANT EXECUTE ON FUNCTION circles_ops.run_security_state_retention(boolean, integer)
  TO postgres;

COMMIT;
