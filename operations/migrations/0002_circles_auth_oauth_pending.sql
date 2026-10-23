-- Durable, single-use OAuth pending state for Circles.
-- Apply exactly once through the parent-approved Supabase migration workflow, as postgres.
-- This creates only circles_auth objects. It does not alter circles_app, circles_ops,
-- roles, login attributes, external configuration, backups, or pg_cron jobs.

BEGIN;

CREATE SCHEMA circles_auth AUTHORIZATION postgres;

REVOKE ALL ON SCHEMA circles_auth FROM PUBLIC, anon, authenticated, service_role, circles_app_runtime;
GRANT USAGE ON SCHEMA circles_auth TO circles_app_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA circles_auth
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role, circles_app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA circles_auth
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role, circles_app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA circles_auth
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role, circles_app_runtime;

CREATE TABLE circles_auth.oauth_pending_states (
  state_fingerprint text PRIMARY KEY,
  flow_kind text NOT NULL,
  cookie_binding_fingerprint text,
  flow_token_fingerprint text,
  redirect_uri text NOT NULL,
  nonce text NOT NULL,
  frontend_origin text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT circles_auth_oauth_pending_states_state_fingerprint_check CHECK (
    state_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT circles_auth_oauth_pending_states_flow_kind_check CHECK (
    flow_kind IN ('web', 'native')
  ),
  CONSTRAINT circles_auth_oauth_pending_states_cookie_fingerprint_check CHECK (
    cookie_binding_fingerprint IS NULL
    OR cookie_binding_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT circles_auth_oauth_pending_states_flow_fingerprint_check CHECK (
    flow_token_fingerprint IS NULL
    OR flow_token_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT circles_auth_oauth_pending_states_nonce_check CHECK (
    nonce ~ '^[A-Za-z0-9_-]{32,128}$'
  ),
  CONSTRAINT circles_auth_oauth_pending_states_expiry_check CHECK (
    expires_at > created_at
  ),
  CONSTRAINT circles_auth_oauth_pending_states_flow_binding_check CHECK (
    (
      flow_kind = 'web'
      AND cookie_binding_fingerprint IS NOT NULL
      AND flow_token_fingerprint IS NULL
      AND frontend_origin IS NOT NULL
      AND length(frontend_origin) > 0
    )
    OR (
      flow_kind = 'native'
      AND cookie_binding_fingerprint IS NULL
      AND flow_token_fingerprint IS NOT NULL
      AND frontend_origin IS NULL
    )
  )
);

CREATE UNIQUE INDEX circles_auth_oauth_pending_states_native_flow_token_idx
  ON circles_auth.oauth_pending_states (flow_token_fingerprint)
  WHERE flow_kind = 'native';
CREATE INDEX circles_auth_oauth_pending_states_expires_at_idx
  ON circles_auth.oauth_pending_states (expires_at);

REVOKE ALL ON TABLE circles_auth.oauth_pending_states
  FROM PUBLIC, anon, authenticated, service_role, circles_app_runtime;
GRANT SELECT, INSERT, DELETE ON TABLE circles_auth.oauth_pending_states
  TO circles_app_runtime;

ALTER TABLE circles_auth.oauth_pending_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE circles_auth.oauth_pending_states FORCE ROW LEVEL SECURITY;
CREATE POLICY circles_auth_oauth_pending_states_runtime_backend_policy
  ON circles_auth.oauth_pending_states
  FOR ALL
  TO circles_app_runtime
  USING (true)
  WITH CHECK (true);

COMMIT;
