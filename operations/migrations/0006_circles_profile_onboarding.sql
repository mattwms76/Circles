-- Approved circle-first onboarding state. This migration adds metadata only; it never rewrites
-- historical profile rows, creates no schema/table/sequence/policy, and changes no grants or jobs.
-- NOT VALID constraints enforce all future writes while deliberately avoiding historic-row scans.
BEGIN;

DO $onboarding_profiles$
BEGIN
  IF pg_catalog.to_regclass('circles_app.profiles') IS NULL THEN
    RAISE EXCEPTION 'circles_app.profiles baseline is required before 0006_circles_profile_onboarding';
  END IF;

  ALTER TABLE circles_app.profiles
    ADD COLUMN IF NOT EXISTS interests jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS "onboardingStep" varchar(16) NOT NULL DEFAULT 'interests',
    ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" timestamptz;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint
     WHERE conname = 'profiles_onboarding_interests_check'
       AND conrelid = 'circles_app.profiles'::pg_catalog.regclass
  ) THEN
    ALTER TABLE circles_app.profiles
      ADD CONSTRAINT profiles_onboarding_interests_check
      CHECK (
        CASE
          WHEN pg_catalog.jsonb_typeof(interests) = 'array' THEN
            pg_catalog.jsonb_array_length(interests) <= 6
            AND interests <@ '["lifestyle", "outdoors", "design", "photography", "fitness", "music", "food", "travel", "books", "gaming", "technology", "art"]'::jsonb
            AND interests::text !~ '"lifestyle".*"lifestyle"'
            AND interests::text !~ '"outdoors".*"outdoors"'
            AND interests::text !~ '"design".*"design"'
            AND interests::text !~ '"photography".*"photography"'
            AND interests::text !~ '"fitness".*"fitness"'
            AND interests::text !~ '"music".*"music"'
            AND interests::text !~ '"food".*"food"'
            AND interests::text !~ '"travel".*"travel"'
            AND interests::text !~ '"books".*"books"'
            AND interests::text !~ '"gaming".*"gaming"'
            AND interests::text !~ '"technology".*"technology"'
            AND interests::text !~ '"art".*"art"'
          ELSE false
        END
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint
     WHERE conname = 'profiles_onboarding_step_check'
       AND conrelid = 'circles_app.profiles'::pg_catalog.regclass
  ) THEN
    ALTER TABLE circles_app.profiles
      ADD CONSTRAINT profiles_onboarding_step_check
      CHECK ("onboardingStep" IN ('interests', 'circles', 'first-post', 'complete')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint
     WHERE conname = 'profiles_onboarding_completion_check'
       AND conrelid = 'circles_app.profiles'::pg_catalog.regclass
  ) THEN
    ALTER TABLE circles_app.profiles
      ADD CONSTRAINT profiles_onboarding_completion_check
      CHECK (("onboardingStep" = 'complete') = ("onboardingCompletedAt" IS NOT NULL)) NOT VALID;
  END IF;
END;
$onboarding_profiles$;

COMMIT;
