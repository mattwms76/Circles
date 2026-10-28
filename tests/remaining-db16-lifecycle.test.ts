import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const candidatePath =
  "operations/remediation/remaining_db16_security_state_lifecycle.sql";
const activationSchedulePath =
  "operations/remediation/remaining_db16_security_state_retention_activation_schedule.sql";
const cliPath = "scripts/remaining-db16-lifecycle.mjs";
const drillPath = "operations/tests/remaining-db16-lifecycle.pg17.py";
const guidePath = "docs/database-remaining/DB-16.md";
const durableDefinitionRegionSha256 =
  "a8b7e532f547b867fdbb18236c3335e874330085e783ae7b0b92d2ee0ec4d9cb";

function durableDefinitionRegion(sql: string) {
  const start = sql.indexOf(
    "CREATE TABLE circles_ops.remaining_db16_security_state_retention_policy",
  );
  const end = sql.indexOf(
    "CREATE FUNCTION circles_ops.run_remaining_db16_security_state_retention",
  );
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("DB-16 durable table definition region is unavailable");
  }
  return sql.slice(start, end);
}

describe("remaining DB-16 inactive lifecycle candidate", () => {
  it("keeps proposed horizons, deletion, and scheduling inactive at installation", () => {
    const sql = readFileSync(candidatePath, "utf8");

    expect(sql).toContain("DEFAULT 'inactive'");
    expect(sql).toContain("oauth_expiry_delay_days integer NOT NULL DEFAULT 0");
    expect(sql).toContain(
      "session_expiry_delay_days integer NOT NULL DEFAULT 90",
    );
    expect(sql).toContain(
      "revoked_session_delay_days integer NOT NULL DEFAULT 180",
    );
    expect(sql).toContain(
      "destructive_deletion_enabled boolean NOT NULL DEFAULT false",
    );
    expect(sql).toContain("schedule_enabled boolean NOT NULL DEFAULT false");
    expect(sql).toContain("schedule_cadence IS NULL");
    expect(sql).toContain("'proposed-unapproved-v1'");
    expect(sql).toContain(
      "installation must remain inactive with no deletion or schedule",
    );
    expect(sql).not.toMatch(/cron\.schedule|CREATE\s+EXTENSION/i);
  });

  it("keeps all three durable DB-16 table definitions byte-stable for DB-12 recovery reconciliation", () => {
    const sql = readFileSync(candidatePath, "utf8");
    const digest = createHash("sha256")
      .update(durableDefinitionRegion(sql), "utf8")
      .digest("hex");

    expect(digest).toBe(durableDefinitionRegionSha256);
    expect(durableDefinitionRegion(sql)).toContain(
      "CREATE TABLE circles_ops.remaining_db16_security_state_retention_policy",
    );
    expect(durableDefinitionRegion(sql)).toContain(
      "CREATE TABLE circles_ops.remaining_db16_security_state_retention_holds",
    );
    expect(durableDefinitionRegion(sql)).toContain(
      "CREATE TABLE circles_ops.remaining_db16_security_state_retention_runs",
    );
  });

  it("uses one captured clock and the exact bounded state predicates", () => {
    const sql = readFileSync(candidatePath, "utf8");

    expect(sql).toContain("v_now timestamptz := pg_catalog.clock_timestamp()");
    expect(sql).toContain("pending.expires_at <= v_now");
    expect(sql).toContain('session."expiresAt" <= v_now');
    expect(sql).toContain(
      "pg_catalog.make_interval(days => v_policy.session_expiry_delay_days)",
    );
    expect(sql).toContain(
      "pg_catalog.make_interval(days => v_policy.revoked_session_delay_days)",
    );
    expect(sql).toContain('session."revokedAt" IS NOT NULL');
    expect(sql).toContain("FOR UPDATE OF pending SKIP LOCKED");
    expect(sql).toContain("FOR UPDATE OF session SKIP LOCKED");
    expect(sql).toContain("p_batch_size > 100");
    expect(sql).toContain(
      "LOCK TABLE circles_ops.remaining_db16_security_state_retention_holds",
    );
  });

  it("makes explicit holds, sanitized audit results, and last result observable without keys", () => {
    const sql = readFileSync(candidatePath, "utf8");

    expect(sql).toContain("remaining_db16_security_state_retention_holds");
    expect(sql).toContain(
      "hold_scope IN ('all', 'oauth_pending_states', 'application_sessions')",
    );
    expect(sql).toContain(
      "hold_reason IN ('incident', 'legal', 'support', 'user_deletion', 'jurisdictional', 'other')",
    );
    expect(sql).toContain("remaining_db16_security_state_retention_runs");
    expect(sql).toContain("remaining_db16_security_state_retention_status");
    expect(sql).toContain("last_oauth_candidate_count");
    expect(sql).toContain("last_session_deleted_count");
    expect(sql).not.toContain("state_fingerprint AS last_");
    expect(sql).not.toContain('"sessionFingerprint" AS last_');
    expect(sql).not.toContain("destructive_confirmation AS");
  });

  it("keeps the helper PostgreSQL-admin-only and rejects inactive deletion/scheduling", () => {
    const sql = readFileSync(candidatePath, "utf8");

    expect(sql).toContain(
      "CREATE FUNCTION circles_ops.run_remaining_db16_security_state_retention(",
    );
    expect(sql).toContain("p_dry_run boolean DEFAULT true");
    expect(sql).toContain("p_batch_size integer DEFAULT 25");
    expect(sql).toContain("p_execution_source text DEFAULT 'manual'");
    expect(sql).toContain("p_confirmation jsonb DEFAULT NULL");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = pg_catalog");
    expect(sql).toContain("SET lock_timeout = '500ms'");
    expect(sql).toContain("SET statement_timeout = '5s'");
    expect(sql).toContain("session_user <> 'postgres'");
    expect(sql).toContain(
      "schedule invocation is not enabled by the selected policy",
    );
    expect(sql).toContain(
      "destructive deletion is inactive pending exact approved policy and private confirmation",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION circles_ops.run_remaining_db16_security_state_retention(boolean, integer, text, jsonb)\n  TO postgres;",
    );
    expect(sql).toContain(
      "FROM PUBLIC, anon, authenticated, service_role, circles_app_runtime,",
    );
  });

  it("keeps the separate proposed 03:45 UTC schedule owner-gated and tied to actual pg_cron semantics", () => {
    const sql = readFileSync(activationSchedulePath, "utf8");

    expect(sql).toContain("UNAPPLIED");
    expect(sql).toContain("'45 3 * * *'");
    expect(sql).toContain("p_batch_size => 25");
    expect(sql).toContain("p_dry_run => false");
    expect(sql).toContain(
      "current_setting(\n    'circles.db16.retention_activation_ack',",
    );
    expect(sql).toContain("confirmation.activation_ack");
    expect(sql).toContain("pg_extension AS extension_catalog");
    expect(sql).toContain("extension_catalog.extname = 'pg_cron'");
    expect(sql).toContain("to_regprocedure('cron.schedule(text,text,text)')");
    expect(sql).toContain(
      "SELECT cron.schedule(v_job_name, v_cadence, v_command)",
    );
    expect(sql).toContain("Cron 7 migration-health sentinel");
    expect(sql).toContain("job_catalog.username = 'postgres'::pg_catalog.name");
    expect(sql).not.toMatch(/CREATE\s+EXTENSION/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+cron\.job/i);
    expect(sql).toContain(
      "No repository value, test value, or fixture value is an approval.",
    );
  });

  it("makes the CLI dry-run by default, uses an explicit private file, and will not load inherited DSNs", () => {
    const source = readFileSync(cliPath, "utf8");
    const printed = execFileSync(
      process.execPath,
      [cliPath, "--print-sql", "--batch-size", "17"],
      {
        encoding: "utf8",
        env: { NODE_ENV: "test", PATH: process.env.PATH ?? "" },
      },
    );
    const rejected = spawnSync(process.execPath, [cliPath, "--delete"], {
      encoding: "utf8",
      env: { NODE_ENV: "test", PATH: process.env.PATH ?? "" },
    });

    expect(printed).toContain("p_dry_run => true");
    expect(printed).toContain("p_batch_size => 17");
    expect(printed).not.toContain("p_dry_run => false");
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain(
      "--delete requires --acknowledge-db16-destructive-operation and --confirm-private-payload",
    );
    expect(source).toContain("--database-url-file");
    expect(source).toContain("chmod 600");
    expect(source).toContain("circles.db16.retention-confirmation.v1");
    expect(source).toContain("refusing inherited PostgreSQL configuration");
    expect(source).not.toContain("process.env.DATABASE_URL");
    expect(source).not.toContain("process.env.SUPABASE_DATABASE_URL");
    expect(source).toContain("reads no .env");
  });

  it("retains an opt-in loopback-only PG17 destructive proof with no remote DSN path", () => {
    const drill = readFileSync(drillPath, "utf8");

    expect(drill).toContain("--local-pg17");
    expect(drill).toContain('"127.0.0.1"');
    expect(drill).toContain("/usr/lib/postgresql/17/bin");
    expect(drill).toContain("p_dry_run => false");
    expect(drill).toContain("synthetic-only active deletion");
    expect(drill).toContain(
      "all, OAuth-only, and application-session-only holds",
    );
    expect(drill).toContain("max 25 per state kind");
    expect(drill).toContain("max 100 and rejects 101");
    expect(drill).toContain("SKIP LOCKED");
    expect(drill).toContain("no state identifiers or approval payloads");
    expect(drill).toContain("actual-pg_cron guard leave Cron 7 unchanged");
    expect(drill).not.toContain("DATABASE_URL");
    expect(drill).not.toContain("SUPABASE_DATABASE_URL");
  });

  it("documents unapproved activation and the synthetic-only destructive proof honestly", () => {
    const guide = readFileSync(guidePath, "utf8");

    expect(guide).toContain("INACTIVE");
    expect(guide).toContain("not approval");
    expect(guide).toContain("No schedule is created");
    expect(guide).toContain("No production DDL/DML");
    expect(guide).toContain("not been run against production");
    expect(guide).toContain("synthetic-only");
    expect(guide).toContain("p_dry_run => false");
    expect(guide).toContain("not a real owner approval");
  });
});
