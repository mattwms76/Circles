-- DB-16 proposed owner-gated activation and pg_cron schedule (UNAPPLIED).
--
-- This is not an installation migration and is deliberately not invoked by the
-- inactive lifecycle candidate. It mutates policy state and registers one
-- pg_cron job only when a PostgreSQL owner has separately selected an exact
-- approval record and supplies all exact GUC values described in DB-16.md.
-- No repository value, test value, or fixture value is an approval.
--
-- Proposed cadence only: 03:45 UTC daily (`45 3 * * *`) with batch size 25.
-- The command calls the existing helper with p_dry_run => false, but reads its
-- exact private confirmation from the protected policy row rather than placing
-- it in cron.job.command. This file does not create the pg_cron extension.

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('circles_ops.remaining_db16_security_state_retention.activation.v1', 0)
);

DO $remaining_db16_activation_schedule$
DECLARE
  v_activation_ack text := pg_catalog.current_setting(
    'circles.db16.retention_activation_ack',
    true
  );
  v_owner_approval_reference text := pg_catalog.current_setting(
    'circles.db16.retention_owner_approval_reference',
    true
  );
  v_policy_version text := pg_catalog.current_setting(
    'circles.db16.retention_policy_version',
    true
  );
  v_confirmation_setting text := pg_catalog.current_setting(
    'circles.db16.retention_confirmation',
    true
  );
  v_confirmation jsonb;
  v_policy circles_ops.remaining_db16_security_state_retention_policy%ROWTYPE;
  v_cron7_before jsonb;
  v_cron7_after jsonb;
  v_job_id bigint;
  v_job_name constant text := 'circles-remaining-db16-security-state-retention';
  v_cadence constant text := '45 3 * * *';
  v_command constant text := $scheduled_command$
SELECT state_kind, candidate_count, deleted_count, hold_active
FROM circles_ops.run_remaining_db16_security_state_retention(
  p_dry_run => false,
  p_batch_size => 25,
  p_execution_source => 'scheduled',
  p_confirmation => (
    SELECT policy.destructive_confirmation
    FROM circles_ops.remaining_db16_security_state_retention_policy AS policy
    WHERE policy.policy_id = true
  )
);
$scheduled_command$;
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres' THEN
    RAISE EXCEPTION 'remaining DB-16 activation/schedule candidate must run directly as postgres';
  END IF;

  -- A schema/table lookalike is insufficient: refuse unless pg_cron is an
  -- installed extension and exposes the real three-argument schedule API.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_extension AS extension_catalog
    JOIN pg_catalog.pg_namespace AS namespace_catalog
      ON namespace_catalog.oid = extension_catalog.extnamespace
    WHERE extension_catalog.extname = 'pg_cron'
      AND namespace_catalog.nspname = 'cron'
  ) OR pg_catalog.to_regclass('cron.job') IS NULL
      OR pg_catalog.to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'remaining DB-16 activation/schedule requires installed pg_cron with cron.schedule(text,text,text)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('jobid'::pg_catalog.name),
      ('jobname'::pg_catalog.name),
      ('schedule'::pg_catalog.name),
      ('command'::pg_catalog.name),
      ('database'::pg_catalog.name),
      ('username'::pg_catalog.name),
      ('active'::pg_catalog.name)
    ) AS expected(attname)
    LEFT JOIN pg_catalog.pg_attribute AS attribute_catalog
      ON attribute_catalog.attrelid = pg_catalog.to_regclass('cron.job')
     AND attribute_catalog.attname = expected.attname
     AND attribute_catalog.attnum > 0
     AND NOT attribute_catalog.attisdropped
    WHERE attribute_catalog.attnum IS NULL
  ) THEN
    RAISE EXCEPTION 'remaining DB-16 activation/schedule requires the reviewed pg_cron job catalog shape';
  END IF;

  SELECT pg_catalog.to_jsonb(job_catalog)
    INTO v_cron7_before
    FROM cron.job AS job_catalog
   WHERE job_catalog.jobid = 7;
  IF v_cron7_before IS NULL
     OR v_cron7_before ->> 'jobname' IS DISTINCT FROM 'circles-app-daily-migration-health'
     OR v_cron7_before ->> 'schedule' IS DISTINCT FROM '15 3 * * *'
     OR v_cron7_before ->> 'command' IS DISTINCT FROM 'SELECT circles_ops.run_daily_migration_health()'
     OR v_cron7_before ->> 'database' IS DISTINCT FROM pg_catalog.current_database()
     OR v_cron7_before ->> 'username' IS DISTINCT FROM 'postgres'
     OR v_cron7_before ->> 'active' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'remaining DB-16 activation/schedule refuses an absent or changed Cron 7 migration-health sentinel';
  END IF;

  IF v_activation_ack IS NULL
     OR pg_catalog.length(v_activation_ack) NOT BETWEEN 1 AND 512
     OR v_owner_approval_reference IS NULL
     OR pg_catalog.length(pg_catalog.btrim(v_owner_approval_reference)) NOT BETWEEN 1 AND 160
     OR v_policy_version IS NULL
     OR pg_catalog.length(pg_catalog.btrim(v_policy_version)) NOT BETWEEN 1 AND 64
     OR v_policy_version = 'proposed-unapproved-v1'
     OR v_confirmation_setting IS NULL THEN
    RAISE EXCEPTION 'remaining DB-16 activation/schedule requires exact non-placeholder owner-selected GUC values';
  END IF;

  BEGIN
    v_confirmation := v_confirmation_setting::jsonb;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'remaining DB-16 activation/schedule confirmation GUC must contain a JSON object';
  END;
  IF pg_catalog.jsonb_typeof(v_confirmation) <> 'object'
     OR v_confirmation ->> 'activation_ack' IS DISTINCT FROM v_activation_ack THEN
    RAISE EXCEPTION 'remaining DB-16 activation/schedule requires the exact circles.db16.retention_activation_ack in confirmation.activation_ack';
  END IF;

  SELECT *
    INTO v_policy
    FROM circles_ops.remaining_db16_security_state_retention_policy
   WHERE policy_id = true
   FOR UPDATE;
  IF NOT FOUND
     OR v_policy.activation_state <> 'inactive'
     OR v_policy.policy_version <> 'proposed-unapproved-v1'
     OR v_policy.oauth_expiry_delay_days <> 0
     OR v_policy.session_expiry_delay_days <> 90
     OR v_policy.revoked_session_delay_days <> 180
     OR v_policy.destructive_deletion_enabled
     OR v_policy.schedule_enabled
     OR v_policy.schedule_cadence IS NOT NULL
     OR v_policy.owner_approval_reference IS NOT NULL
     OR v_policy.destructive_confirmation IS NOT NULL THEN
    RAISE EXCEPTION 'remaining DB-16 activation/schedule requires the exact untouched inactive policy';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM cron.job AS job_catalog
    WHERE job_catalog.jobname = v_job_name
       OR pg_catalog.strpos(
            job_catalog.command,
            'circles_ops.run_remaining_db16_security_state_retention'::pg_catalog.text
          ) > 0
  ) THEN
    RAISE EXCEPTION 'remaining DB-16 activation/schedule refuses an existing lifecycle job or helper reference';
  END IF;

  UPDATE circles_ops.remaining_db16_security_state_retention_policy
     SET policy_version = v_policy_version,
         activation_state = 'active',
         destructive_deletion_enabled = true,
         schedule_enabled = true,
         schedule_cadence = v_cadence,
         owner_approval_reference = v_owner_approval_reference,
         destructive_confirmation = v_confirmation,
         updated_at = pg_catalog.clock_timestamp()
   WHERE policy_id = true;

  -- `cron.schedule` runs in the current database as the current scheduler
  -- owner. The direct-postgres guard above makes the job's username postgres,
  -- which is required by the helper's session_user check.
  SELECT cron.schedule(v_job_name, v_cadence, v_command)
    INTO v_job_id;

  IF v_job_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM cron.job AS job_catalog
    WHERE job_catalog.jobid = v_job_id
      AND job_catalog.jobname = v_job_name
      AND job_catalog.schedule = v_cadence
      AND job_catalog.command = v_command
      AND job_catalog.database = pg_catalog.current_database()
      AND job_catalog.username = 'postgres'::pg_catalog.name
      AND job_catalog.active
  ) THEN
    RAISE EXCEPTION 'remaining DB-16 activation/schedule pg_cron postflight did not create the exact guarded daily job';
  END IF;

  SELECT pg_catalog.to_jsonb(job_catalog)
    INTO v_cron7_after
    FROM cron.job AS job_catalog
   WHERE job_catalog.jobid = 7;
  IF v_cron7_after IS DISTINCT FROM v_cron7_before THEN
    RAISE EXCEPTION 'remaining DB-16 activation/schedule changed Cron 7 migration-health sentinel';
  END IF;
END
$remaining_db16_activation_schedule$;

COMMIT;
