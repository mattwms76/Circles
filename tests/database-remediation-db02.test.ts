import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getPostgresConnectionOptions } from "../server/_core/postgres-config.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const projectRef = "vvclcsqletcxzoaayqzq";
const directHost = `db.${projectRef}.supabase.co`;
const poolerHost = "aws-0-eu-west-1.pooler.supabase.com";

function connectionFor(url: string, mode?: "legacy" | "dedicated") {
  const environment =
    mode === "dedicated"
      ? {
          CIRCLES_APP_DATABASE_URL: url,
          CIRCLES_DB_LOGIN_MODE: mode,
        }
      : { SUPABASE_DATABASE_URL: url };
  return getPostgresConnectionOptions(environment, projectRoot);
}

describe("DB-02 dedicated application login connection contract", () => {
  it("accepts only the exact dedicated principal on the pinned session pooler identity", () => {
    const options = connectionFor(
      `postgresql://circles_app_login.${projectRef}:synthetic%2Dcredential@${poolerHost}:5432/postgres?sslmode=disable`,
      "dedicated",
    );

    expect(options).toMatchObject({
      host: poolerHost,
      port: 5432,
      database: "postgres",
      user: `circles_app_login.${projectRef}`,
      password: "synthetic-credential",
    });
    expect(options.ssl).toMatchObject({
      rejectUnauthorized: true,
      servername: poolerHost,
    });
    expect(
      typeof (options.ssl as { checkServerIdentity?: unknown })
        .checkServerIdentity,
    ).toBe("function");
  });

  it("accepts only the exact dedicated pooler identity", () => {
    const options = connectionFor(
      `postgresql://circles_app_login.${projectRef}:synthetic@${poolerHost}:5432/postgres`,
      "dedicated",
    );

    expect(options.user).toBe(`circles_app_login.${projectRef}`);
    expect(options.host).toBe(poolerHost);
  });

  it("retains the existing postgres principal during the protected cutover", () => {
    expect(
      connectionFor(
        `postgresql://postgres:synthetic@${directHost}:5432/postgres`,
      ).user,
    ).toBe(`postgres.${projectRef}`);
    expect(
      connectionFor(
        `postgresql://postgres.${projectRef}:synthetic@${poolerHost}:5432/postgres`,
      ).user,
    ).toBe(`postgres.${projectRef}`);
  });

  it("rejects lookalike dedicated principals instead of accepting arbitrary database users", () => {
    expect(() =>
      connectionFor(
        `postgresql://circles_app_login:synthetic@db.other.supabase.co/postgres`,
        "dedicated",
      ),
    ).toThrow("unexpected host");
    expect(() =>
      connectionFor(
        `postgresql://circles_app_login_extra:synthetic@${directHost}/postgres`,
        "dedicated",
      ),
    ).toThrow("session pooler host");
    expect(() =>
      connectionFor(
        `postgresql://circles_app_login.other:synthetic@${poolerHost}/postgres`,
        "dedicated",
      ),
    ).toThrow("unexpected database user");
  });
});

describe("DB-02 dedicated application login migration contract", () => {
  const migration = readFileSync(
    resolve(
      projectRoot,
      "operations/migrations/0017_circles_dedicated_app_login.sql",
    ),
    "utf8",
  );

  it("creates a disabled non-privileged role and keeps credentials out of source", () => {
    expect(migration).toContain(
      "CREATE ROLE circles_app_login NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
    );
    expect(migration).not.toMatch(/\bPASSWORD\b/i);
    expect(migration).not.toMatch(/ALTER\s+ROLE\s+circles_app_login\s+LOGIN/i);
    expect(migration).toContain(
      "DB-02 refuses to reuse an existing circles_app_login role",
    );
  });

  it("permits only SET ROLE to the reviewed runtime role and verifies that postcondition", () => {
    expect(migration).toContain(
      "GRANT circles_app_runtime TO circles_app_login",
    );
    expect(migration).toContain("WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;");
    expect(migration).toContain("parent_role.rolname <> 'circles_app_runtime'");
    expect(migration).toContain("membership.admin_option = FALSE");
    expect(migration).toContain("membership.inherit_option = FALSE");
    expect(migration).toContain("membership.set_option = TRUE");
    expect(migration).toContain(
      "circles_app_runtime must not be a member of another role",
    );
  });

  it("is transaction-bounded, project-pinned, and gives the login only database CONNECT before role assumption", () => {
    expect(migration).toContain("BEGIN;");
    expect(migration).toContain("COMMIT;");
    expect(migration).toContain("current_database() <> 'postgres'");
    expect(migration).toContain(
      "REVOKE ALL PRIVILEGES ON DATABASE postgres FROM circles_app_login;",
    );
    expect(migration).toContain(
      "GRANT CONNECT ON DATABASE postgres TO circles_app_login;",
    );
  });
});
