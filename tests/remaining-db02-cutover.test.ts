import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEDICATED_APP_LOGIN_ROLE,
  getPostgresConnectionOptions,
} from "../server/_core/postgres-config.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const projectRef = "vvclcsqletcxzoaayqzq";
const poolerHost = "aws-0-eu-west-1.pooler.supabase.com";
const appPoolerUrl = `postgresql://circles_app_login.${projectRef}:synthetic-app-password@${poolerHost}:5432/postgres`;

function source(relativePath: string) {
  return readFileSync(resolve(projectRoot, relativePath), "utf8");
}

describe("remaining DB-02 protected application-login cutover", () => {
  it("requires the dedicated app URI, exact pooler principal, and no co-resident operational URI in dedicated mode", () => {
    const options = getPostgresConnectionOptions(
      {
        CIRCLES_APP_DATABASE_URL: appPoolerUrl,
        CIRCLES_DB_LOGIN_MODE: "dedicated",
      },
      projectRoot,
    );
    expect(options).toMatchObject({
      host: poolerHost,
      database: "postgres",
      user: `circles_app_login.${projectRef}`,
      password: "synthetic-app-password",
    });

    expect(() =>
      getPostgresConnectionOptions(
        { CIRCLES_DB_LOGIN_MODE: "dedicated" },
        projectRoot,
      ),
    ).toThrow("CIRCLES_APP_DATABASE_URL");
    expect(() =>
      getPostgresConnectionOptions(
        {
          CIRCLES_APP_DATABASE_URL: `postgresql://${DEDICATED_APP_LOGIN_ROLE}:synthetic@db.${projectRef}.supabase.co:5432/postgres`,
          CIRCLES_DB_LOGIN_MODE: "dedicated",
        },
        projectRoot,
      ),
    ).toThrow("session pooler");
    expect(() =>
      getPostgresConnectionOptions(
        {
          CIRCLES_APP_DATABASE_URL: appPoolerUrl,
          CIRCLES_DB_LOGIN_MODE: "dedicated",
          SUPABASE_DATABASE_URL: `postgresql://postgres.${projectRef}:operational@${poolerHost}:5432/postgres`,
        },
        projectRoot,
      ),
    ).toThrow("not permitted in dedicated application mode");
  });

  it("retains the current operational URL only in explicit legacy mode and rejects an ambiguous app URL there", () => {
    const legacyUrl = `postgresql://postgres.${projectRef}:synthetic-operational@${poolerHost}:5432/postgres`;
    expect(
      getPostgresConnectionOptions(
        { SUPABASE_DATABASE_URL: legacyUrl },
        projectRoot,
      ).user,
    ).toBe(`postgres.${projectRef}`);
    expect(() =>
      getPostgresConnectionOptions(
        {
          SUPABASE_DATABASE_URL: legacyUrl,
          CIRCLES_APP_DATABASE_URL: appPoolerUrl,
        },
        projectRoot,
      ),
    ).toThrow("requires dedicated application mode");
  });

  it("keeps remediation SQL secret-free, enforces read-only preflight, and provisions only the dedicated URI password in memory", () => {
    const preflight = source(
      "operations/remediation/remaining_db02_preflight.sql",
    );
    const activate = source(
      "operations/remediation/remaining_db02_activate_temporary.sql",
    );
    const rollback = source(
      "operations/remediation/remaining_db02_rollback_detached.sql",
    );
    const runner = source("scripts/remaining-db02-cutover.mjs");

    for (const artifact of [preflight, activate, rollback]) {
      expect(artifact).not.toMatch(/postgres(?:ql)?:\/\/[^\s"']+/i);
      expect(artifact).not.toMatch(
        /ALTER\s+ROLE\s+circles_app_login\s+PASSWORD/i,
      );
    }
    expect(preflight).toContain("BEGIN;\nSET TRANSACTION READ ONLY;");
    expect(preflight).toContain("SET LOCAL lock_timeout = '5s';");
    expect(preflight).toContain("pg_advisory_xact_lock");
    expect(preflight).toContain("approved 43-table private inventory");
    expect(preflight).toContain("required runtime application/helper grants");
    expect(preflight).toContain(
      "runtime role has unexpected TRUNCATE authority",
    );
    expect(activate).toContain("ACTIVATE_TEMPORARY_V1");
    expect(activate).toContain("ALTER ROLE circles_app_login LOGIN");
    expect(rollback).toContain("ROLLBACK_DETACHED_V1");
    expect(rollback).toContain("dedicated application sessions remain");
    expect(runner).toContain("CIRCLES_APP_DATABASE_URL");
    expect(runner).toContain("SUPABASE_DATABASE_URL");
    expect(runner).toContain("PROVISION_DEDICATED_PASSWORD_SQL");
    expect(runner).toContain("circles.db02_provision_password");
    expect(runner).toContain("[dedicated.password]");
    expect(runner).toContain("ALTER ROLE circles_app_login PASSWORD %L");
    expect(runner).toContain("dedicated.password === operational.password");
    expect(runner).toContain("await provisionDedicatedPassword();");
    expect(runner).toContain("temporary login was returned to NOLOGIN");
    expect(runner).toContain("process.argv.length !== 2");
  });

  it("keeps the isolated PG17 drill outside default Vitest discovery, proves read-only locks, and retains the exact final provider edge", () => {
    const drill = source("operations/tests/remaining-db02.pg17.mjs");
    expect(drill).toContain("fresh-loopback-pg17-scram");
    expect(drill).toContain("scram-sha-256");
    expect(drill).toContain("SET ROLE postgres");
    expect(drill).toContain("TRUNCATE circles_app.users");
    expect(drill).toContain("CREATE TABLE circles_app.db02_forbidden_create");
    expect(drill).toContain("SET TRANSACTION READ ONLY");
    expect(drill).toContain("55P03");
    expect(drill).toContain("WITH ADMIN TRUE, INHERIT FALSE, SET TRUE");
    expect(drill).toContain("GRANT supabase_admin TO postgres");
    expect(drill).toContain('"SET ROLE supabase_admin"');
    expect(drill).toContain("GRANTED BY supabase_admin");
    expect(drill).toContain("roleid = 'circles_app_login'::pg_catalog.regrole");
    expect(drill).not.toMatch(
      /SUPABASE_DATABASE_URL|DATABASE_URL|CIRCLES_APP_DATABASE_URL/,
    );
  });
});
