-- DB-16 proposed security-state lifecycle policy (UNAPPLIED).
--
-- This candidate is deliberately inert at installation. It creates no pg_cron
-- job, enables neither deletion nor a cadence, and the helper defaults to a
-- bounded dry run. Exact owner/legal/security approval of horizons, holds,
-- destructive execution, and cadence is required in a separately reviewed
-- operation before the singleton policy may leave `inactive`.
--
-- It preserves OAuth/session keys and revocation fields. It never alters those
-- source relations; the helper can only delete selected synthetic/live rows in
-- a future explicitly enabled invocation, and that path remains blocked here.

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('circles_ops.remaining_db16_security_state_lifecycle.v1', 0)
);

DO $remaining_db16_preflight$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'remaining DB-16 lifecycle candidate must be installed as postgres';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(ARRAY[
      'postgres',
      'anon',
      'authenticated',
      'service_role',
      'circles_app_runtime',
      'circles_app_login',
      'circles_admin_runtime',
      'circles_admin_native_executor'
    ]::pg_catalog.name[]) AS expected(role_name)
    WHERE pg_catalog.to_regrole(expected.role_name) IS NULL
  ) THEN
    RAISE EXCEPTION 'remaining DB-16 expected private/runtime roles are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS role_catalog
    WHERE role_catalog.rolname = 'circles_app_login'::pg_catalog.name
      AND NOT role_catalog.rolcanlogin
  ) THEN
    RAISE EXCEPTION 'remaining DB-16 refuses to change the approved detached NOLOGIN app role';
  END IF;

  IF pg_catalog.to_regnamespace('circles_ops') IS NULL
     OR pg_catalog.to_regnamespace('circles_auth') IS NULL
     OR pg_catalog.to_regclass('circles_app."applicationSessions"') IS NULL
     OR pg_catalog.to_regclass('circles_auth.oauth_pending_states') IS NULL THEN
    RAISE EXCEPTION 'remaining DB-16 requires current circles_ops/circles_auth/applicationSessions relations';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation_catalog
    WHERE relation_catalog.oid = pg_catalog.to_regclass('circles_app."applicationSessions"')
      AND relation_catalog.relrowsecurity
      AND relation_catalog.relforcerowsecurity
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation_catalog
    WHERE relation_catalog.oid = pg_catalog.to_regclass('circles_auth.oauth_pending_states')
      AND relation_catalog.relrowsecurity
      AND relation_catalog.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'remaining DB-16 requires the existing forced-RLS state tables';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_attribute AS attribute_catalog
    WHERE attribute_catalog.attrelid = pg_catalog.to_regclass('circles_app."applicationSessions"')
      AND attribute_catalog.attnum > 0
      AND NOT attribute_catalog.attisdropped
  ) <> 6 OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('sessionFingerprint'::pg_catalog.name, 1::pg_catalog.int2, 'character varying(64)'::pg_catalog.text, true),
      ('userOpenId'::pg_catalog.name, 2::pg_catalog.int2, 'character varying(64)'::pg_catalog.text, true),
      ('appId'::pg_catalog.name, 3::pg_catalog.int2, 'character varying(128)'::pg_catalog.text, true),
      ('expiresAt'::pg_catalog.name, 4::pg_catalog.int2, 'timestamp with time zone'::pg_catalog.text, true),
      ('revokedAt'::pg_catalog.name, 5::pg_catalog.int2, 'timestamp with time zone'::pg_catalog.text, false),
      ('createdAt'::pg_catalog.name, 6::pg_catalog.int2, 'timestamp with time zone'::pg_catalog.text, true)
    ) AS expected(name, ordinal, data_type, not_null)
    LEFT JOIN pg_catalog.pg_attribute AS attribute_catalog
      ON attribute_catalog.attrelid = pg_catalog.to_regclass('circles_app."applicationSessions"')
     AND attribute_catalog.attname = expected.name
     AND attribute_catalog.attnum = expected.ordinal
     AND attribute_catalog.attnum > 0
     AND NOT attribute_catalog.attisdropped
    WHERE attribute_catalog.attnum IS NULL
       OR pg_catalog.format_type(attribute_catalog.atttypid, attribute_catalog.atttypmod) <> expected.data_type
       OR attribute_catalog.attnotnull IS DISTINCT FROM expected.not_null
  ) THEN
    RAISE EXCEPTION 'remaining DB-16 applicationSessions shape differs from the reviewed six-column contract';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_attribute AS attribute_catalog
    WHERE attribute_catalog.attrelid = pg_catalog.to_regclass('circles_auth.oauth_pending_states')
      AND attribute_catalog.attnum > 0
      AND NOT attribute_catalog.attisdropped
  ) <> 9 OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('state_fingerprint'::pg_catalog.name, 1::pg_catalog.int2, 'text'::pg_catalog.text, true),
      ('flow_kind'::pg_catalog.name, 2::pg_catalog.int2, 'text'::pg_catalog.text, true),
      ('cookie_binding_fingerprint'::pg_catalog.name, 3::pg_catalog.int2, 'text'::pg_catalog.text, false),
      ('flow_token_fingerprint'::pg_catalog.name, 4::pg_catalog.int2, 'text'::pg_catalog.text, false),
      ('redirect_uri'::pg_catalog.name, 5::pg_catalog.int2, 'text'::pg_catalog.text, true),
      ('nonce'::pg_catalog.name, 6::pg_catalog.int2, 'text'::pg_catalog.text, true),
      ('frontend_origin'::pg_catalog.name, 7::pg_catalog.int2, 'text'::pg_catalog.text, false),
      ('expires_at'::pg_catalog.name, 8::pg_catalog.int2, 'timestamp with time zone'::pg_catalog.text, true),
      ('created_at'::pg_catalog.name, 9::pg_catalog.int2, 'timestamp with time zone'::pg_catalog.text, true)
    ) AS expected(name, ordinal, data_type, not_null)
    LEFT JOIN pg_catalog.pg_attribute AS attribute_catalog
      ON attribute_catalog.attrelid = pg_catalog.to_regclass('circles_auth.oauth_pending_states')
     AND attribute_catalog.attname = expected.name
     AND attribute_catalog.attnum = expected.ordinal
     AND attribute_catalog.attnum > 0
     AND NOT attribute_catalog.attisdropped
    WHERE attribute_catalog.attnum IS NULL
       OR pg_catalog.format_type(attribute_catalog.atttypid, attribute_catalog.atttypmod) <> expected.data_type
       OR attribute_catalog.attnotnull IS DISTINCT FROM expected.not_null
  ) THEN
    RAISE EXCEPTION 'remaining DB-16 oauth_pending_states shape differs from the reviewed nine-column contract';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_catalog
    WHERE index_catalog.indexrelid = pg_catalog.to_regclass('circles_app.application_sessions_expiry_idx')
      AND index_catalog.indrelid = pg_catalog.to_regclass('circles_app."applicationSessions"')
      AND index_catalog.indisvalid AND index_catalog.indisready AND index_catalog.indislive
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_catalog
    WHERE index_catalog.indexrelid = pg_catalog.to_regclass('circles_auth.circles_auth_oauth_pending_states_expires_at_idx')
      AND index_catalog.indrelid = pg_catalog.to_regclass('circles_auth.oauth_pending_states')
      AND index_catalog.indisvalid AND index_catalog.indisready AND index_catalog.indislive
  ) THEN
    RAISE EXCEPTION 'remaining DB-16 requires valid current expiry indexes';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      (pg_catalog.to_regclass('circles_ops.remaining_db16_security_state_retention_policy')),
      (pg_catalog.to_regclass('circles_ops.remaining_db16_security_state_retention_holds')),
      (pg_catalog.to_regclass('circles_ops.remaining_db16_security_state_retention_runs')),
      (pg_catalog.to_regclass('circles_ops.remaining_db16_security_state_retention_status'))
    ) AS existing(object_oid)
    WHERE object_oid IS NOT NULL
  ) OR pg_catalog.to_regprocedure(
    'circles_ops.run_remaining_db16_security_state_retention(boolean,integer,text,jsonb)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'remaining DB-16 lifecycle objects already exist; inspect instead of replacing them';
  END IF;

  -- A schedule is deliberately absent. Preserve current jobs such as job 7, but
  -- refuse to install over an already-created DB-16 schedule or helper reference.
  IF pg_catalog.to_regclass('cron.job') IS NOT NULL AND EXISTS (
    SELECT 1
    FROM cron.job AS job_catalog
    WHERE job_catalog.jobname = 'circles-remaining-db16-security-state-retention'
       OR pg_catalog.strpos(
            job_catalog.command,
            'circles_ops.run_remaining_db16_security_state_retention'::pg_catalog.text
          ) > 0
  ) THEN
    RAISE EXCEPTION 'remaining DB-16 schedule already exists; schedule activation is separately controlled';
  END IF;
END
$remaining_db16_preflight$;

CREATE TABLE circles_ops.remaining_db16_security_state_retention_policy (
  policy_id boolean PRIMARY KEY DEFAULT true,
  policy_version character varying(64) NOT NULL UNIQUE,
  activation_state text NOT NULL DEFAULT 'inactive',
  oauth_expiry_delay_days integer NOT NULL DEFAULT 0,
  session_expiry_delay_days integer NOT NULL DEFAULT 90,
  revoked_session_delay_days integer NOT NULL DEFAULT 180,
  destructive_deletion_enabled boolean NOT NULL DEFAULT false,
  schedule_enabled boolean NOT NULL DEFAULT false,
  schedule_cadence text,
  owner_approval_reference text,
  destructive_confirmation jsonb,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT remaining_db16_retention_policy_singleton_check CHECK (policy_id),
  CONSTRAINT remaining_db16_retention_policy_state_check CHECK (
    activation_state IN ('inactive', 'dry_run_only', 'active')
  ),
  CONSTRAINT remaining_db16_retention_policy_horizon_check CHECK (
    oauth_expiry_delay_days = 0
    AND session_expiry_delay_days BETWEEN 1 AND 36500
    AND revoked_session_delay_days BETWEEN 1 AND 36500
  ),
  CONSTRAINT remaining_db16_retention_policy_inactive_guard CHECK (
    activation_state <> 'inactive'
    OR (
      NOT destructive_deletion_enabled
      AND NOT schedule_enabled
      AND schedule_cadence IS NULL
      AND owner_approval_reference IS NULL
      AND destructive_confirmation IS NULL
    )
  ),
  CONSTRAINT remaining_db16_retention_policy_dry_run_guard CHECK (
    activation_state <> 'dry_run_only'
    OR (
      NOT destructive_deletion_enabled
      AND NOT schedule_enabled
      AND schedule_cadence IS NULL
      AND destructive_confirmation IS NULL
    )
  ),
  CONSTRAINT remaining_db16_retention_policy_active_guard CHECK (
    activation_state <> 'active'
    OR (
      destructive_deletion_enabled
      AND owner_approval_reference IS NOT NULL
      AND pg_catalog.length(owner_approval_reference) BETWEEN 1 AND 160
      AND destructive_confirmation IS NOT NULL
      AND pg_catalog.jsonb_typeof(destructive_confirmation) = 'object'
      AND (
        NOT schedule_enabled
        OR (schedule_cadence IS NOT NULL AND pg_catalog.length(schedule_cadence) BETWEEN 1 AND 80)
      )
    )
  )
);

CREATE TABLE circles_ops.remaining_db16_security_state_retention_holds (
  hold_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hold_scope text NOT NULL,
  hold_reason text NOT NULL,
  external_reference character varying(160) NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  expires_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT remaining_db16_retention_hold_scope_check CHECK (
    hold_scope IN ('all', 'oauth_pending_states', 'application_sessions')
  ),
  CONSTRAINT remaining_db16_retention_hold_reason_check CHECK (
    hold_reason IN ('incident', 'legal', 'support', 'user_deletion', 'jurisdictional', 'other')
  ),
  CONSTRAINT remaining_db16_retention_hold_reference_check CHECK (
    pg_catalog.length(pg_catalog.btrim(external_reference)) BETWEEN 1 AND 160
  ),
  CONSTRAINT remaining_db16_retention_hold_window_check CHECK (
    expires_at IS NULL OR expires_at > starts_at
  ),
  CONSTRAINT remaining_db16_retention_hold_release_check CHECK (
    released_at IS NULL OR released_at >= starts_at
  )
);

CREATE INDEX remaining_db16_retention_holds_active_scope_idx
  ON circles_ops.remaining_db16_security_state_retention_holds (hold_scope, starts_at)
  WHERE released_at IS NULL;

CREATE TABLE circles_ops.remaining_db16_security_state_retention_runs (
  run_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ran_at timestamptz NOT NULL,
  policy_version character varying(64) NOT NULL,
  activation_state text NOT NULL,
  dry_run boolean NOT NULL,
  execution_source text NOT NULL,
  batch_size integer NOT NULL,
  oauth_expiry_delay_days integer NOT NULL,
  session_expiry_delay_days integer NOT NULL,
  revoked_session_delay_days integer NOT NULL,
  oauth_hold_active boolean NOT NULL,
  session_hold_active boolean NOT NULL,
  oauth_candidate_count integer NOT NULL,
  oauth_deleted_count integer NOT NULL,
  session_candidate_count integer NOT NULL,
  session_deleted_count integer NOT NULL,
  result_status text NOT NULL,
  CONSTRAINT remaining_db16_retention_run_state_check CHECK (
    activation_state IN ('inactive', 'dry_run_only', 'active')
  ),
  CONSTRAINT remaining_db16_retention_run_source_check CHECK (
    execution_source IN ('manual', 'scheduled')
  ),
  CONSTRAINT remaining_db16_retention_run_batch_check CHECK (batch_size BETWEEN 1 AND 100),
  CONSTRAINT remaining_db16_retention_run_horizon_check CHECK (
    oauth_expiry_delay_days = 0
    AND session_expiry_delay_days BETWEEN 1 AND 36500
    AND revoked_session_delay_days BETWEEN 1 AND 36500
  ),
  CONSTRAINT remaining_db16_retention_run_counts_check CHECK (
    oauth_candidate_count BETWEEN 0 AND batch_size
    AND oauth_deleted_count BETWEEN 0 AND oauth_candidate_count
    AND session_candidate_count BETWEEN 0 AND batch_size
    AND session_deleted_count BETWEEN 0 AND session_candidate_count
  ),
  CONSTRAINT remaining_db16_retention_run_hold_check CHECK (
    (NOT oauth_hold_active OR (oauth_candidate_count = 0 AND oauth_deleted_count = 0))
    AND (NOT session_hold_active OR (session_candidate_count = 0 AND session_deleted_count = 0))
  ),
  CONSTRAINT remaining_db16_retention_run_status_check CHECK (
    (dry_run AND result_status = 'dry_run_complete')
    OR (NOT dry_run AND result_status = 'deletion_complete')
  )
);

CREATE INDEX remaining_db16_retention_runs_ran_at_idx
  ON circles_ops.remaining_db16_security_state_retention_runs (ran_at DESC, run_id DESC);

ALTER TABLE circles_ops.remaining_db16_security_state_retention_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE circles_ops.remaining_db16_security_state_retention_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_ops.remaining_db16_security_state_retention_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE circles_ops.remaining_db16_security_state_retention_holds FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_ops.remaining_db16_security_state_retention_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE circles_ops.remaining_db16_security_state_retention_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY remaining_db16_retention_policy_postgres_only
  ON circles_ops.remaining_db16_security_state_retention_policy
  FOR ALL TO postgres USING (true) WITH CHECK (true);
CREATE POLICY remaining_db16_retention_holds_postgres_only
  ON circles_ops.remaining_db16_security_state_retention_holds
  FOR ALL TO postgres USING (true) WITH CHECK (true);
CREATE POLICY remaining_db16_retention_runs_postgres_only
  ON circles_ops.remaining_db16_security_state_retention_runs
  FOR ALL TO postgres USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE circles_ops.remaining_db16_security_state_retention_policy,
  circles_ops.remaining_db16_security_state_retention_holds,
  circles_ops.remaining_db16_security_state_retention_runs
  FROM PUBLIC, anon, authenticated, service_role, circles_app_runtime,
    circles_app_login, circles_admin_runtime, circles_admin_native_executor;
REVOKE ALL ON SEQUENCE circles_ops.remaining_db16_security_state_retention_holds_hold_id_seq,
  circles_ops.remaining_db16_security_state_retention_runs_run_id_seq
  FROM PUBLIC, anon, authenticated, service_role, circles_app_runtime,
    circles_app_login, circles_admin_runtime, circles_admin_native_executor;

INSERT INTO circles_ops.remaining_db16_security_state_retention_policy (
  policy_id,
  policy_version
) VALUES (
  true,
  'proposed-unapproved-v1'
);

CREATE FUNCTION circles_ops.run_remaining_db16_security_state_retention(
  p_dry_run boolean DEFAULT true,
  p_batch_size integer DEFAULT 25,
  p_execution_source text DEFAULT 'manual',
  p_confirmation jsonb DEFAULT NULL
)
RETURNS TABLE (
  state_kind text,
  candidate_count integer,
  deleted_count integer,
  hold_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
SET lock_timeout = '500ms'
SET statement_timeout = '5s'
AS $remaining_db16_function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_policy circles_ops.remaining_db16_security_state_retention_policy%ROWTYPE;
  v_oauth_hold_active boolean := false;
  v_session_hold_active boolean := false;
  v_oauth_candidate_count integer := 0;
  v_oauth_deleted_count integer := 0;
  v_session_candidate_count integer := 0;
  v_session_deleted_count integer := 0;
BEGIN
  IF session_user <> 'postgres' THEN
    RAISE EXCEPTION 'remaining DB-16 lifecycle helper is executable only by postgres';
  END IF;
  IF p_dry_run IS NULL
     OR p_batch_size IS NULL
     OR p_batch_size < 1
     OR p_batch_size > 100
     OR p_execution_source IS NULL
     OR p_execution_source NOT IN ('manual', 'scheduled') THEN
    RAISE EXCEPTION 'remaining DB-16 requires dry-run, batch size 1 through 100, and manual or scheduled source';
  END IF;

  SELECT *
    INTO v_policy
    FROM circles_ops.remaining_db16_security_state_retention_policy
   WHERE policy_id = true
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'remaining DB-16 singleton policy is unavailable';
  END IF;

  -- Serialize a run with hold changes. A newly recorded incident/legal hold
  -- cannot race between an eligibility check and the bounded selection below.
  LOCK TABLE circles_ops.remaining_db16_security_state_retention_holds IN SHARE ROW EXCLUSIVE MODE;

  IF p_execution_source = 'scheduled'
     AND (
       v_policy.activation_state <> 'active'
       OR NOT v_policy.schedule_enabled
       OR v_policy.schedule_cadence IS NULL
     ) THEN
    RAISE EXCEPTION 'remaining DB-16 schedule invocation is not enabled by the selected policy';
  END IF;

  IF NOT p_dry_run AND (
    v_policy.activation_state <> 'active'
    OR NOT v_policy.destructive_deletion_enabled
    OR v_policy.owner_approval_reference IS NULL
    OR v_policy.destructive_confirmation IS NULL
    OR p_confirmation IS NULL
    OR v_policy.destructive_confirmation IS DISTINCT FROM p_confirmation
  ) THEN
    RAISE EXCEPTION 'remaining DB-16 destructive deletion is inactive pending exact approved policy and private confirmation';
  END IF;

  SELECT
    EXISTS (
      SELECT 1
      FROM circles_ops.remaining_db16_security_state_retention_holds AS retention_hold
      WHERE retention_hold.hold_scope IN ('all', 'oauth_pending_states')
        AND retention_hold.released_at IS NULL
        AND (retention_hold.expires_at IS NULL OR retention_hold.expires_at > v_now)
    ),
    EXISTS (
      SELECT 1
      FROM circles_ops.remaining_db16_security_state_retention_holds AS retention_hold
      WHERE retention_hold.hold_scope IN ('all', 'application_sessions')
        AND retention_hold.released_at IS NULL
        AND (retention_hold.expires_at IS NULL OR retention_hold.expires_at > v_now)
    )
  INTO v_oauth_hold_active, v_session_hold_active;

  WITH oauth_candidates AS MATERIALIZED (
    SELECT pending.state_fingerprint
    FROM circles_auth.oauth_pending_states AS pending
    WHERE NOT v_oauth_hold_active
      -- OAuth eligibility is exactly expiry at or before this one captured now.
      AND pending.expires_at <= v_now
    ORDER BY pending.expires_at ASC, pending.state_fingerprint ASC
    LIMIT p_batch_size
    FOR UPDATE OF pending SKIP LOCKED
  ), oauth_deleted AS (
    DELETE FROM circles_auth.oauth_pending_states AS pending
    USING oauth_candidates AS candidate
    WHERE NOT p_dry_run
      AND pending.state_fingerprint = candidate.state_fingerprint
    RETURNING 1
  )
  SELECT
    (SELECT pg_catalog.count(*)::integer FROM oauth_candidates),
    (SELECT pg_catalog.count(*)::integer FROM oauth_deleted)
  INTO v_oauth_candidate_count, v_oauth_deleted_count;

  WITH session_candidates AS MATERIALIZED (
    SELECT session."sessionFingerprint"
    FROM circles_app."applicationSessions" AS session
    WHERE NOT v_session_hold_active
      -- An active session is never eligible, including a long-revoked one.
      AND session."expiresAt" <= v_now
      AND (
        session."expiresAt" <= v_now - pg_catalog.make_interval(days => v_policy.session_expiry_delay_days)
        OR (
          session."revokedAt" IS NOT NULL
          AND session."revokedAt" <= v_now - pg_catalog.make_interval(days => v_policy.revoked_session_delay_days)
        )
      )
    ORDER BY session."expiresAt" ASC, session."sessionFingerprint" ASC
    LIMIT p_batch_size
    FOR UPDATE OF session SKIP LOCKED
  ), session_deleted AS (
    DELETE FROM circles_app."applicationSessions" AS session
    USING session_candidates AS candidate
    WHERE NOT p_dry_run
      AND session."sessionFingerprint" = candidate."sessionFingerprint"
    RETURNING 1
  )
  SELECT
    (SELECT pg_catalog.count(*)::integer FROM session_candidates),
    (SELECT pg_catalog.count(*)::integer FROM session_deleted)
  INTO v_session_candidate_count, v_session_deleted_count;

  INSERT INTO circles_ops.remaining_db16_security_state_retention_runs (
    ran_at,
    policy_version,
    activation_state,
    dry_run,
    execution_source,
    batch_size,
    oauth_expiry_delay_days,
    session_expiry_delay_days,
    revoked_session_delay_days,
    oauth_hold_active,
    session_hold_active,
    oauth_candidate_count,
    oauth_deleted_count,
    session_candidate_count,
    session_deleted_count,
    result_status
  ) VALUES (
    v_now,
    v_policy.policy_version,
    v_policy.activation_state,
    p_dry_run,
    p_execution_source,
    p_batch_size,
    v_policy.oauth_expiry_delay_days,
    v_policy.session_expiry_delay_days,
    v_policy.revoked_session_delay_days,
    v_oauth_hold_active,
    v_session_hold_active,
    v_oauth_candidate_count,
    v_oauth_deleted_count,
    v_session_candidate_count,
    v_session_deleted_count,
    CASE WHEN p_dry_run THEN 'dry_run_complete' ELSE 'deletion_complete' END
  );

  state_kind := 'expired_oauth_pending_states';
  candidate_count := v_oauth_candidate_count;
  deleted_count := v_oauth_deleted_count;
  hold_active := v_oauth_hold_active;
  RETURN NEXT;

  state_kind := 'expired_or_long_revoked_application_sessions';
  candidate_count := v_session_candidate_count;
  deleted_count := v_session_deleted_count;
  hold_active := v_session_hold_active;
  RETURN NEXT;
END
$remaining_db16_function$;

ALTER FUNCTION circles_ops.run_remaining_db16_security_state_retention(boolean, integer, text, jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION circles_ops.run_remaining_db16_security_state_retention(boolean, integer, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role, circles_app_runtime,
    circles_app_login, circles_admin_runtime, circles_admin_native_executor;
GRANT EXECUTE ON FUNCTION circles_ops.run_remaining_db16_security_state_retention(boolean, integer, text, jsonb)
  TO postgres;

CREATE VIEW circles_ops.remaining_db16_security_state_retention_status
WITH (security_barrier = true)
AS
SELECT
  policy.policy_version,
  policy.activation_state,
  policy.oauth_expiry_delay_days,
  policy.session_expiry_delay_days,
  policy.revoked_session_delay_days,
  policy.destructive_deletion_enabled,
  policy.schedule_enabled,
  policy.schedule_cadence,
  COALESCE(hold_summary.all_hold_count, 0)::integer AS all_hold_count,
  COALESCE(hold_summary.oauth_hold_count, 0)::integer AS oauth_hold_count,
  COALESCE(hold_summary.session_hold_count, 0)::integer AS session_hold_count,
  latest_run.ran_at AS last_ran_at,
  latest_run.dry_run AS last_dry_run,
  latest_run.execution_source AS last_execution_source,
  latest_run.batch_size AS last_batch_size,
  latest_run.oauth_hold_active AS last_oauth_hold_active,
  latest_run.session_hold_active AS last_session_hold_active,
  latest_run.oauth_candidate_count AS last_oauth_candidate_count,
  latest_run.oauth_deleted_count AS last_oauth_deleted_count,
  latest_run.session_candidate_count AS last_session_candidate_count,
  latest_run.session_deleted_count AS last_session_deleted_count,
  latest_run.result_status AS last_result_status
FROM circles_ops.remaining_db16_security_state_retention_policy AS policy
CROSS JOIN LATERAL (
  SELECT
    pg_catalog.count(*) FILTER (WHERE hold_scope = 'all') AS all_hold_count,
    pg_catalog.count(*) FILTER (WHERE hold_scope = 'oauth_pending_states') AS oauth_hold_count,
    pg_catalog.count(*) FILTER (WHERE hold_scope = 'application_sessions') AS session_hold_count
  FROM circles_ops.remaining_db16_security_state_retention_holds AS retention_hold
  WHERE retention_hold.released_at IS NULL
    AND (retention_hold.expires_at IS NULL OR retention_hold.expires_at > pg_catalog.clock_timestamp())
) AS hold_summary
LEFT JOIN LATERAL (
  SELECT *
  FROM circles_ops.remaining_db16_security_state_retention_runs AS retention_run
  ORDER BY retention_run.run_id DESC
  LIMIT 1
) AS latest_run ON true
WHERE policy.policy_id = true;

ALTER VIEW circles_ops.remaining_db16_security_state_retention_status OWNER TO postgres;
REVOKE ALL ON TABLE circles_ops.remaining_db16_security_state_retention_status
  FROM PUBLIC, anon, authenticated, service_role, circles_app_runtime,
    circles_app_login, circles_admin_runtime, circles_admin_native_executor;
GRANT SELECT ON TABLE circles_ops.remaining_db16_security_state_retention_status TO postgres;

DO $remaining_db16_postflight$
DECLARE
  v_policy_state text;
  v_deletion_enabled boolean;
  v_schedule_enabled boolean;
  v_cadence text;
BEGIN
  SELECT activation_state, destructive_deletion_enabled, schedule_enabled, schedule_cadence
    INTO v_policy_state, v_deletion_enabled, v_schedule_enabled, v_cadence
    FROM circles_ops.remaining_db16_security_state_retention_policy
   WHERE policy_id = true;
  IF v_policy_state IS DISTINCT FROM 'inactive'
     OR v_deletion_enabled IS DISTINCT FROM false
     OR v_schedule_enabled IS DISTINCT FROM false
     OR v_cadence IS NOT NULL THEN
    RAISE EXCEPTION 'remaining DB-16 installation must remain inactive with no deletion or schedule';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function_catalog
    WHERE function_catalog.oid = pg_catalog.to_regprocedure(
      'circles_ops.run_remaining_db16_security_state_retention(boolean,integer,text,jsonb)'
    )
      AND (
        NOT function_catalog.prosecdef
        OR function_catalog.proowner <> (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'postgres')
        OR NOT pg_catalog.has_function_privilege('postgres', function_catalog.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('anon', function_catalog.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('authenticated', function_catalog.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('service_role', function_catalog.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('circles_app_runtime', function_catalog.oid, 'EXECUTE')
        OR EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              function_catalog.proacl,
              pg_catalog.acldefault('f'::pg_catalog."char", function_catalog.proowner)
            )
          ) AS acl_entry
          WHERE acl_entry.grantee = 0
            AND acl_entry.privilege_type = 'EXECUTE'::pg_catalog.text
        )
      )
  ) THEN
    RAISE EXCEPTION 'remaining DB-16 helper ACL/owner/definer postflight failed';
  END IF;

  IF pg_catalog.to_regclass('cron.job') IS NOT NULL AND EXISTS (
    SELECT 1
    FROM cron.job AS job_catalog
    WHERE job_catalog.jobname = 'circles-remaining-db16-security-state-retention'
       OR pg_catalog.strpos(
            job_catalog.command,
            'circles_ops.run_remaining_db16_security_state_retention'::pg_catalog.text
          ) > 0
  ) THEN
    RAISE EXCEPTION 'remaining DB-16 installation must not create or retain a lifecycle schedule';
  END IF;
END
$remaining_db16_postflight$;

COMMIT;
