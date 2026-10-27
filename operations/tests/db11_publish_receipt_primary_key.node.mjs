import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../migrations/0022_circles_publish_receipt_primary_key.sql",
    import.meta.url,
  ),
  "utf8",
);
const schema = readFileSync(
  new URL("../../drizzle/post-publish-receipt-schema.ts", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../../server/social-service.ts", import.meta.url),
  "utf8",
);

test("DB-11 guards the established receipt contract before adding a separate composite primary key", () => {
  assert.match(migration, /BEGIN;[\s\S]*SET LOCAL lock_timeout = '5s';/);
  assert.match(migration, /SET LOCAL statement_timeout = '30s';/);
  assert.match(
    migration,
    /post_publish_receipts_actor_operation_unique[\s\S]*contype = 'u'[\s\S]*convalidated/,
  );
  assert.match(
    migration,
    /postPublishReceipts_actorId_fkey[\s\S]*confrelid = 'circles_app\.users'::pg_catalog\.regclass[\s\S]*confdeltype = 'c'/,
  );
  assert.match(
    migration,
    /postPublishReceipts_postId_fkey[\s\S]*confrelid = 'circles_app\.posts'::pg_catalog\.regclass[\s\S]*confdeltype = 'n'/,
  );
  assert.match(migration, /post_publish_receipts_operation_id_check/);
  assert.match(migration, /post_publish_receipts_payload_hash_check/);
  assert.match(
    migration,
    /ADD CONSTRAINT post_publish_receipts_pkey[\s\S]*PRIMARY KEY \("actorId", "operationId"\)/,
  );
  assert.match(migration, /primary_key_index = unique_constraint_index/);
});

test("DB-11 never replaces the named unique constraint or tries to promote its owned index", () => {
  assert.doesNotMatch(migration, /DROP\s+CONSTRAINT|DROP\s+INDEX/i);
  assert.doesNotMatch(
    migration,
    /USING\s+INDEX\s+post_publish_receipts_actor_operation_unique/i,
  );
  assert.match(
    migration,
    /ADD PRIMARY KEY intentionally creates a separate PK-owned index/,
  );
});

test("DB-11 represents both compatible arbiters in the discovered Drizzle receipt schema", () => {
  assert.match(schema, /primaryKey,/);
  assert.match(
    schema,
    /primaryKey\(\{[\s\S]*name: "post_publish_receipts_pkey",[\s\S]*columns: \[table\.actorId, table\.operationId\]/,
  );
  assert.match(
    schema,
    /unique\("post_publish_receipts_actor_operation_unique"\)\.on\([\s\S]*table\.actorId,[\s\S]*table\.operationId/,
  );
  assert.doesNotMatch(
    schema,
    /uniqueIndex\("post_publish_receipts_actor_operation_unique"/,
  );
});

test("DB-11 preserves the application's explicit actor-operation ON CONFLICT contract", () => {
  assert.match(
    service,
    /\.onConflictDoNothing\(\{[\s\S]*target: \[[\s\S]*postPublishReceipts\.actorId,[\s\S]*postPublishReceipts\.operationId/,
  );
});
