import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const candidatePath = resolve(
  process.cwd(),
  "operations/remediation/remaining_db17_live_relationships.sql",
);
const drillPath = resolve(
  process.cwd(),
  "operations/tests/remaining-db17-live-relationships.pg17.py",
);
const fixturePath = resolve(
  process.cwd(),
  "operations/tests/fixtures/remaining-db17-schema.sql",
);
const documentationPath = resolve(
  process.cwd(),
  "docs/database-remaining/DB-17.md",
);

const candidateSha256 =
  "25aebff6f84f5cf5d24ffde3115677c5c7dac406ce279373281a7ec165f61c63";
const fixtureSha256 =
  "05c26af00bcb539288a38f4713f798e6a6955f6632d24befefdb191667ec5a02";

const relationships = [
  [
    "streams_host_id_db17_fkey",
    'circles_app.streams ADD CONSTRAINT streams_host_id_db17_fkey\n      FOREIGN KEY ("hostId") REFERENCES circles_app.users(id) ON DELETE RESTRICT NOT VALID;',
    "streams_host_id_db17_fk_idx",
  ],
  [
    "streams_circle_id_db17_fkey",
    'circles_app.streams ADD CONSTRAINT streams_circle_id_db17_fkey\n      FOREIGN KEY ("circleId") REFERENCES circles_app.circles(id) ON DELETE SET NULL NOT VALID;',
    "streams_circle_id_db17_fk_idx",
  ],
  [
    "active_host_leases_host_id_db17_fkey",
    'circles_app."activeHostLeases" ADD CONSTRAINT active_host_leases_host_id_db17_fkey\n      FOREIGN KEY ("hostId") REFERENCES circles_app.users(id) ON DELETE CASCADE NOT VALID;',
    "activeHostLeases_pkey",
  ],
  [
    "active_host_leases_stream_id_db17_fkey",
    'circles_app."activeHostLeases" ADD CONSTRAINT active_host_leases_stream_id_db17_fkey\n      FOREIGN KEY ("streamId") REFERENCES circles_app.streams(id) ON DELETE SET NULL NOT VALID;',
    "active_host_leases_stream_id_db17_fk_idx",
  ],
  [
    "live_viewers_stream_id_db17_fkey",
    'circles_app."liveViewers" ADD CONSTRAINT live_viewers_stream_id_db17_fkey\n      FOREIGN KEY ("streamId") REFERENCES circles_app.streams(id) ON DELETE RESTRICT NOT VALID;',
    "liveViewers_pkey",
  ],
  [
    "live_signals_stream_id_db17_fkey",
    'circles_app."liveSignals" ADD CONSTRAINT live_signals_stream_id_db17_fkey\n      FOREIGN KEY ("streamId") REFERENCES circles_app.streams(id) ON DELETE CASCADE NOT VALID;',
    "live_signals_stream_id_db17_fk_idx",
  ],
  [
    "live_chat_stream_id_db17_fkey",
    'circles_app."liveChat" ADD CONSTRAINT live_chat_stream_id_db17_fkey\n      FOREIGN KEY ("streamId") REFERENCES circles_app.streams(id) ON DELETE RESTRICT NOT VALID;',
    "live_chat_stream_id_db17_fk_idx",
  ],
] as const;

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

describe("remaining DB-17 live relationship candidate", () => {
  it("keeps the reviewed five-index and seven-FK policy guard byte-for-byte inactive and autocommit-only", async () => {
    const sql = await readFile(candidatePath, "utf8");

    expect(sha256(sql)).toBe(candidateSha256);
    expect(sql).toContain("db17_live_relationships_adopted_v1");
    expect(sql).toContain(
      "circles.db17_live_relationships_contract=DB17_LIVE_RELATIONSHIPS_ADOPTED_V1",
    );
    expect(sql).toContain(
      "current_setting('circles.db17_live_relationships_contract', true)",
    );
    expect(sql).toContain("CREATE INDEX CONCURRENTLY");
    expect(sql).toContain("SET lock_timeout = '5s'");
    expect(sql).toContain("SET statement_timeout = '10min'");
    expect(sql).not.toMatch(/^BEGIN;$/m);
    expect(sql).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?POLICY/i);
    expect(sql).not.toMatch(/^\s*(?:GRANT|REVOKE|CREATE ROLE|ALTER ROLE)\b/im);
    expect(sql).not.toMatch(
      /\bINSERT\s+INTO\b|\bUPDATE\s+circles_app\.|\bDELETE\s+FROM\s+circles_app\./i,
    );
    expect(sql).not.toContain("circles_pinned_post_same_circle_db17_fkey");
  });

  it("adds all seven selected actions with exact FK definitions and validates every one", async () => {
    const sql = await readFile(candidatePath, "utf8");

    for (const [constraint, definition, index] of relationships) {
      expect(sql).toContain(definition);
      expect(sql).toContain(`VALIDATE CONSTRAINT ${constraint};`);
      expect(sql).toContain(index);
      expect(sql).toContain(`'${constraint}'`);
    }

    expect(sql).toContain("historical orphan aggregate check failed");
    expect(sql).toContain("v_lease_host_orphans");
    expect(sql).toContain("v_chat_stream_orphans");
    expect(sql).toContain("p_must_be_valid");
    expect(sql).toContain("AND NOT v_constraint.convalidated");
  });

  it("checks captured local type, owner, RLS, grant, detached-login, policy and index state before DDL", async () => {
    const sql = await readFile(candidatePath, "utf8");

    expect(sql).toContain("type/nullability drift");
    expect(sql).toContain("relowner = 'postgres'");
    expect(sql).toContain("relrowsecurity");
    expect(sql).toContain("relforcerowsecurity");
    expect(sql).toContain("runtime grant drift");
    expect(sql).toContain("external table-grant drift");
    expect(sql).toContain("circles_app_login membership");
    expect(sql).toContain("RLS policy inventory drift");
    expect(sql).toContain("index definition drift");
    expect(sql).toContain("unexpected FK on");
    expect(sql).toContain("activeHostLeases_pkey");
    expect(sql).toContain("liveViewers_pkey");
  });

  it("ships an immutable project-relative schema-only fixture for the opt-in disposable PG17 rehearsal", async () => {
    const [fixture, drill] = await Promise.all([
      readFile(fixturePath, "utf8"),
      readFile(drillPath, "utf8"),
    ]);

    expect(sha256(fixture)).toBe(fixtureSha256);
    expect(fixture).toContain(
      "35cc5c0d8d01777d13b6b2bc08cae906e26c82c628fecdc49d18676c7d04320f",
    );
    expect((fixture.match(/CREATE TYPE circles_app\./g) ?? []).length).toBe(4);
    expect((fixture.match(/CREATE TABLE circles_app\./g) ?? []).length).toBe(7);
    expect(
      (fixture.match(/ADD GENERATED BY DEFAULT AS IDENTITY/g) ?? []).length,
    ).toBe(5);
    expect(fixture).not.toMatch(/^(?:COPY|INSERT\s+INTO)\b/im);
    expect(fixture).not.toMatch(
      /\b(?:CREATE ROLE|GRANT|CREATE POLICY|FOREIGN KEY|CREATE INDEX)\b/i,
    );

    expect(drill).toContain("CIRCLES_DB17_LOCAL_PG17");
    expect(drill).toContain("FIXTURE_RELATIVE_PATH");
    expect(drill).toContain(fixtureSha256);
    expect(drill).toContain(
      "fixture SHA-256 mismatch; refuse modified fixture",
    );
    expect(drill).toContain("fresh-loopback-postgresql-17");
    expect(drill).toContain("DB17_LIVE_RELATIONSHIPS_ADOPTED_V1");
    expect(drill).toContain(
      "wrong named child index and wrong named FK fail closed",
    );
    expect(drill).toContain("source-visible stream-end sequence");
    expect(drill).toContain("liveViewers and liveChat each RESTRICT");
    expect(drill).toContain("post-DB-03 runtime_circles_policy replacement");
    expect(drill).toContain("disposable_fixtures_removed");
    expect(drill).not.toMatch(/DATABASE_URL|SUPABASE|postgresql:\/\//i);
    expect(drill).not.toContain("CIRCLES_DB17_SCHEMA_CAPTURE");
    expect(drill).not.toContain("/home/ubuntu/");
  });

  it("documents the decision, fixture, DB-17-before-DB-03 ordering, maintenance, validation, rollback and external activation boundaries", async () => {
    const documentation = await readFile(documentationPath, "utf8");

    expect(documentation).toContain("INACTIVE");
    expect(documentation).toContain("DB17_LIVE_RELATIONSHIPS_ADOPTED_V1");
    expect(documentation).toContain("maintenance");
    expect(documentation).toContain("SHA-256");
    expect(documentation).toContain("VALIDATE CONSTRAINT");
    expect(documentation).toContain("not production activation");
    expect(documentation).toContain("no live database query");
    expect(documentation).toContain("DB-17 must be activated before DB-03");
    expect(documentation).toContain("runtime_circles_policy");
    expect(documentation).toContain("REFUSE");
  });
});
