import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const migration = read(
  "operations/remediation/db17_relationship_integrity.sql",
);
const documentation = read("docs/database-remediation/DB-17.md");
const circleHomeService = read("server/social-service.ts");
const liveRouter = read("server/live-router.ts");

test("DB-17 adds an exact guarded same-Circle composite pin contract", () => {
  assert.match(
    migration,
    /CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS circles_posts_id_circle_id_db17_key\s+ON circles_app\.posts \(id, "circleId"\);/,
  );
  assert.match(
    migration,
    /ADD CONSTRAINT circles_posts_id_circle_id_db17_key\s+UNIQUE USING INDEX circles_posts_id_circle_id_db17_key;/,
  );
  assert.match(
    migration,
    /ADD CONSTRAINT circles_pinned_post_same_circle_db17_fkey\s+FOREIGN KEY \("pinnedPostId", id\)\s+REFERENCES circles_app\.posts \(id, "circleId"\)\s+ON DELETE SET NULL \("pinnedPostId"\)\s+NOT VALID;/,
  );
  assert.match(migration, /pg_catalog\.to_regclass\('circles_app\.circles'\)/);
  assert.match(migration, /circles_home_pinned_post_id_fkey/);
  assert.match(migration, /pg_catalog\.pg_constraint/);
  assert.match(
    migration,
    /v_attnames IS DISTINCT FROM ARRAY\['id'::pg_catalog\.name, 'circleId'::pg_catalog\.name\]/,
  );
});

test("DB-17 preserves nullable clear-on-delete pins without an unreviewed destructive action", () => {
  assert.match(
    migration,
    /attname = 'pinnedPostId'::pg_catalog\.name[\s\S]*?AND NOT attnotnull/,
  );
  assert.match(migration, /c\.confdeltype = 'n'/);
  assert.doesNotMatch(migration, /ON DELETE CASCADE/i);
  assert.doesNotMatch(migration, /ON DELETE RESTRICT/i);
  assert.doesNotMatch(migration, /^BEGIN;$/m);
  assert.doesNotMatch(
    migration,
    /\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+circles_app\.)/i,
  );
  assert.match(
    migration,
    /CREATE INDEX CONCURRENTLY cannot run inside a\s+--\s*transaction block/i,
  );
});

test("DB-17 retains source-side pin guards and documents live relationship decisions as open", () => {
  assert.match(
    circleHomeService,
    /eq\(posts\.id, normalized\.postId\), eq\(posts\.circleId, circle\.id\)/,
  );
  assert.match(circleHomeService, /lockCircleAccessForProtectedMutation/);
  assert.match(
    liveRouter,
    /set\(\{ status: "ended", endedAt: new Date\(\) \}\)/,
  );
  assert.match(
    liveRouter,
    /tx\.delete\(liveSignals\)\.where\(eq\(liveSignals\.streamId, stream\.id\)\)/,
  );

  for (const relationship of [
    "streams.hostId → users.id",
    "streams.circleId → circles.id",
    "activeHostLeases.streamId → streams.id",
    "liveViewers.streamId → streams.id",
    "liveSignals.streamId → streams.id",
    "liveChat.streamId → streams.id",
  ]) {
    assert.ok(documentation.includes(relationship), `missing ${relationship}`);
  }
  assert.match(documentation, /not executable DB-17 SQL/i);
  assert.match(documentation, /approval-required/i);
  assert.match(
    documentation,
    /No production connection, DDL, DML, data normalization, or migration activation occurred/i,
  );
});

test("DB-17 distinguishes source contracts and disposable SQL proof from live deployment", () => {
  assert.match(documentation, /credential-free source-contract test/i);
  assert.match(documentation, /fresh loopback PostgreSQL17\.11 fixture/i);
  assert.match(documentation, /not a live deployment/i);
  assert.match(documentation, /zero cross-Circle pins/i);
  assert.match(
    documentation,
    /zero checked live host\/Circle\/stream orphans/i,
  );
});
