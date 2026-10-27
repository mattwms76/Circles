-- Member features that stay outside the 27-table circles_app inventory:
-- private media bytes, device push tokens, and one active circle prompt.
-- Prepared for the parent-approved migration workflow. No circles_app column
-- or grant is changed.

BEGIN;

CREATE TABLE circles_publish."mediaObjects" (
  key varchar(512) PRIMARY KEY,
  bytes bytea NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT media_objects_key_check
    CHECK (key ~ '^[A-Za-z0-9][A-Za-z0-9_./-]{0,511}$' AND key !~ '\.\.'),
  CONSTRAINT media_objects_size_check
    CHECK (octet_length(bytes) BETWEEN 1 AND 20971600)
);

CREATE TABLE circles_publish."devicePushTokens" (
  "userId" integer NOT NULL
    REFERENCES circles_app.users(id) ON DELETE CASCADE,
  token varchar(200) NOT NULL,
  platform varchar(16) NOT NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY ("userId", token),
  CONSTRAINT device_push_tokens_token_check
    CHECK (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,160}\]$'),
  CONSTRAINT device_push_tokens_platform_check
    CHECK (platform IN ('ios', 'android'))
);

CREATE TABLE circles_publish."circlePrompts" (
  "circleId" integer PRIMARY KEY
    REFERENCES circles_app.circles(id) ON DELETE CASCADE,
  body varchar(180) NOT NULL,
  "updatedBy" integer NOT NULL
    REFERENCES circles_app.users(id) ON DELETE RESTRICT,
  "updatedAt" timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT circle_prompts_body_check
    CHECK (char_length(btrim(body)) BETWEEN 1 AND 180)
);

CREATE TABLE circles_publish."promptPosts" (
  "postId" integer PRIMARY KEY
    REFERENCES circles_app.posts(id) ON DELETE CASCADE,
  "circleId" integer NOT NULL
    REFERENCES circles_app.circles(id) ON DELETE CASCADE,
  "promptBody" varchar(180) NOT NULL
);

ALTER TABLE circles_publish."mediaObjects" OWNER TO postgres;
ALTER TABLE circles_publish."devicePushTokens" OWNER TO postgres;
ALTER TABLE circles_publish."circlePrompts" OWNER TO postgres;
ALTER TABLE circles_publish."promptPosts" OWNER TO postgres;

REVOKE ALL ON TABLE circles_publish."mediaObjects",
  circles_publish."devicePushTokens",
  circles_publish."circlePrompts",
  circles_publish."promptPosts"
  FROM PUBLIC, anon, authenticated, service_role, circles_app_runtime;

GRANT SELECT, INSERT ON TABLE circles_publish."mediaObjects"
  TO circles_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE circles_publish."devicePushTokens"
  TO circles_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE circles_publish."circlePrompts"
  TO circles_app_runtime;
GRANT SELECT, INSERT ON TABLE circles_publish."promptPosts"
  TO circles_app_runtime;

ALTER TABLE circles_publish."mediaObjects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE circles_publish."mediaObjects" FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_publish."devicePushTokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE circles_publish."devicePushTokens" FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_publish."circlePrompts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE circles_publish."circlePrompts" FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_publish."promptPosts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE circles_publish."promptPosts" FORCE ROW LEVEL SECURITY;

CREATE POLICY media_objects_runtime_select
  ON circles_publish."mediaObjects"
  FOR SELECT TO circles_app_runtime USING (true);
CREATE POLICY media_objects_runtime_insert
  ON circles_publish."mediaObjects"
  FOR INSERT TO circles_app_runtime WITH CHECK (true);

CREATE POLICY device_push_tokens_runtime_all
  ON circles_publish."devicePushTokens"
  FOR ALL TO circles_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY circle_prompts_runtime_all
  ON circles_publish."circlePrompts"
  FOR ALL TO circles_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY prompt_posts_runtime_select
  ON circles_publish."promptPosts"
  FOR SELECT TO circles_app_runtime USING (true);
CREATE POLICY prompt_posts_runtime_insert
  ON circles_publish."promptPosts"
  FOR INSERT TO circles_app_runtime WITH CHECK (true);

COMMIT;
