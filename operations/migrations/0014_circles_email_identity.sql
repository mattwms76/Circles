-- Durable Supabase email identity mapping for Circles.
-- Apply exactly once through the parent-approved Supabase migration workflow, as postgres.
-- This migration is additive: it creates only circles_identity.provider_links and does not
-- alter existing application/auth/operations schemas, provider settings, roles, or backups.

BEGIN;

CREATE SCHEMA circles_identity AUTHORIZATION postgres;

REVOKE ALL ON SCHEMA circles_identity
  FROM PUBLIC, anon, authenticated, service_role, circles_app_runtime;
GRANT USAGE ON SCHEMA circles_identity TO circles_app_runtime;

CREATE TABLE circles_identity.provider_links (
  provider_subject uuid PRIMARY KEY,
  user_id integer NOT NULL UNIQUE
    REFERENCES circles_app.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

ALTER TABLE circles_identity.provider_links OWNER TO postgres;

REVOKE ALL ON TABLE circles_identity.provider_links
  FROM PUBLIC, anon, authenticated, service_role, circles_app_runtime;
GRANT SELECT, INSERT ON TABLE circles_identity.provider_links
  TO circles_app_runtime;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE circles_identity.provider_links FROM circles_app_runtime;

ALTER TABLE circles_identity.provider_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE circles_identity.provider_links FORCE ROW LEVEL SECURITY;

CREATE POLICY circles_identity_provider_links_runtime_select
  ON circles_identity.provider_links
  FOR SELECT
  TO circles_app_runtime
  USING (true);

CREATE POLICY circles_identity_provider_links_runtime_insert
  ON circles_identity.provider_links
  FOR INSERT
  TO circles_app_runtime
  WITH CHECK (true);

COMMIT;
