-- Durable retry-safe social publication receipts.
-- Prepared only: apply once through the parent-approved private PostgreSQL migration workflow.
-- This is additive and intentionally keeps the exact circles_app table inventory unchanged.

BEGIN;

CREATE SCHEMA circles_publish AUTHORIZATION postgres;

REVOKE ALL ON SCHEMA circles_publish
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA circles_publish TO circles_app_runtime;

CREATE TABLE circles_publish."postPublishReceipts" (
  "actorId" integer NOT NULL
    REFERENCES circles_app.users(id) ON DELETE CASCADE,
  "operationId" varchar(96) NOT NULL,
  "payloadHash" varchar(64) NOT NULL,
  -- A referenced post deletion intentionally clears only this pointer. The surviving receipt is
  -- the durable tombstone that prevents a retry from creating another post with this operation ID.
  "postId" integer
    REFERENCES circles_app.posts(id) ON DELETE SET NULL,
  "createdAt" timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT post_publish_receipts_actor_operation_unique
    UNIQUE ("actorId", "operationId"),
  CONSTRAINT post_publish_receipts_operation_id_check
    CHECK ("operationId" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$'),
  CONSTRAINT post_publish_receipts_payload_hash_check
    CHECK ("payloadHash" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX post_publish_receipts_post_idx
  ON circles_publish."postPublishReceipts" ("postId");

ALTER TABLE circles_publish."postPublishReceipts" OWNER TO postgres;

REVOKE ALL ON TABLE circles_publish."postPublishReceipts"
  FROM PUBLIC, anon, authenticated, service_role, circles_app_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE circles_publish."postPublishReceipts"
  TO circles_app_runtime;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE circles_publish."postPublishReceipts" FROM circles_app_runtime;

ALTER TABLE circles_publish."postPublishReceipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE circles_publish."postPublishReceipts" FORCE ROW LEVEL SECURITY;

CREATE POLICY post_publish_receipts_runtime_select
  ON circles_publish."postPublishReceipts"
  FOR SELECT
  TO circles_app_runtime
  USING (true);

CREATE POLICY post_publish_receipts_runtime_insert
  ON circles_publish."postPublishReceipts"
  FOR INSERT
  TO circles_app_runtime
  WITH CHECK (true);

CREATE POLICY post_publish_receipts_runtime_update
  ON circles_publish."postPublishReceipts"
  FOR UPDATE
  TO circles_app_runtime
  USING (true)
  WITH CHECK (true);

COMMIT;
