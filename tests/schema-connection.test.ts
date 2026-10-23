import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { dataMigrations, users } from "../drizzle/schema";
import {
  RuntimeRoleInitializationError,
  RuntimeRolePool,
  SET_RUNTIME_ROLE_SQL,
  initializeRuntimeRole,
} from "../server/runtime-role-pool";
import {
  PRIVATE_SCHEMA,
  RUNTIME_ROLE,
  getPostgresConnectionOptions,
} from "../server/_core/postgres-config.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const directSyntheticUrl =
  "postgresql://postgres:synthetic%2Donly%2Dpassword@db.vvclcsqletcxzoaayqzq.supabase.co:5432/postgres";

describe("private Supabase PostgreSQL configuration", () => {
  it("normalizes only the authorized direct target to the verified session pooler with TLS verification", () => {
    const options = getPostgresConnectionOptions(
      { SUPABASE_DATABASE_URL: directSyntheticUrl },
      projectRoot,
    );

    expect(options.host).toBe("aws-0-eu-west-1.pooler.supabase.com");
    expect(options.port).toBe(5432);
    expect(options.database).toBe("postgres");
    expect(options.user).toBe("postgres.vvclcsqletcxzoaayqzq");
    expect(options.password).toBe("synthetic-only-password");
    expect(options.ssl).toMatchObject({
      rejectUnauthorized: true,
      servername: "aws-0-eu-west-1.pooler.supabase.com",
    });
    expect(options).toMatchObject({
      connectionTimeoutMillis: expect.any(Number),
      query_timeout: expect.any(Number),
      statement_timeout: expect.any(Number),
      lock_timeout: expect.any(Number),
      idle_in_transaction_session_timeout: expect.any(Number),
    });
    expect(options.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(options.query_timeout).toBeGreaterThan(0);
    expect(options.statement_timeout).toBeGreaterThan(0);
    expect(
      typeof (options.ssl as { checkServerIdentity?: unknown })
        .checkServerIdentity,
    ).toBe("function");
  });

  it("rejects wrong host, database, user, or missing SUPABASE_DATABASE_URL without falling back to MySQL", () => {
    expect(() => getPostgresConnectionOptions({}, projectRoot)).toThrow(
      "SUPABASE_DATABASE_URL",
    );
    expect(() =>
      getPostgresConnectionOptions(
        {
          SUPABASE_DATABASE_URL:
            "postgresql://postgres:synthetic@db.other.supabase.co/postgres",
        },
        projectRoot,
      ),
    ).toThrow("unexpected host");
    expect(() =>
      getPostgresConnectionOptions(
        {
          SUPABASE_DATABASE_URL:
            "postgresql://postgres:synthetic@db.vvclcsqletcxzoaayqzq.supabase.co/notpostgres",
        },
        projectRoot,
      ),
    ).toThrow("unexpected database");
    expect(() =>
      getPostgresConnectionOptions(
        {
          SUPABASE_DATABASE_URL:
            "postgresql://unexpected:synthetic@db.vvclcsqletcxzoaayqzq.supabase.co/postgres",
        },
        projectRoot,
      ),
    ).toThrow("unexpected database user");
  });
});

describe("runtime-role Pool guard", () => {
  it("initializes every supplied client before use", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({}),
      release: vi.fn(),
    };

    await expect(initializeRuntimeRole(client as never)).resolves.toBe(client);
    expect(client.query).toHaveBeenCalledWith(SET_RUNTIME_ROLE_SQL);
    expect(client.release).not.toHaveBeenCalled();
    expect(SET_RUNTIME_ROLE_SQL).toBe(`SET ROLE ${RUNTIME_ROLE}`);
    expect(new RuntimeRolePool()).toBeInstanceOf(RuntimeRolePool);
  });

  it("destroys a client and returns a generic error when SET ROLE fails", async () => {
    const client = {
      query: vi.fn().mockRejectedValue(new Error("synthetic failure")),
      release: vi.fn(),
    };

    await expect(initializeRuntimeRole(client as never)).rejects.toBeInstanceOf(
      RuntimeRoleInitializationError,
    );
    expect(client.release).toHaveBeenCalledWith(true);
  });
});

describe("private PostgreSQL schema artifact", () => {
  it("keeps application tables in circles_app, including read-only import markers", () => {
    expect(getTableConfig(users).schema).toBe(PRIVATE_SCHEMA);
    const marker = getTableConfig(dataMigrations);
    expect(marker.schema).toBe(PRIVATE_SCHEMA);
    expect(marker.columns.map((column) => column.name)).toEqual([
      "key",
      "sourceTree",
      "completedAt",
      "summary",
    ]);
  });

  it("contains role isolation, RLS, no runtime marker mutation, and no public-schema DDL", () => {
    const migration = readFileSync(
      resolve(projectRoot, "drizzle/postgres/0000_circles_app.sql"),
      "utf8",
    );
    expect(migration).toContain(
      "CREATE ROLE circles_app_runtime NOLOGIN NOINHERIT NOBYPASSRLS",
    );
    expect(migration).toContain(
      "REVOKE ALL ON SCHEMA circles_app FROM PUBLIC, anon, authenticated, service_role",
    );
    expect(migration).toContain(
      'GRANT SELECT ON TABLE circles_app."_dataMigrations" TO circles_app_runtime',
    );
    expect(migration).not.toContain(
      'GRANT INSERT ON TABLE circles_app."_dataMigrations"',
    );
    expect(migration).toContain(
      'ALTER TABLE circles_app."_dataMigrations" ENABLE ROW LEVEL SECURITY',
    );
    expect(migration).toContain(
      'CREATE POLICY runtime_data_migrations_read_policy ON circles_app."_dataMigrations" FOR SELECT TO circles_app_runtime',
    );
    expect(migration).toContain(
      "CREATE UNIQUE INDEX profiles_handle_ci_unique ON circles_app.profiles (lower(handle))",
    );
    expect(migration).not.toContain(
      "CONSTRAINT profiles_handle_unique UNIQUE (handle)",
    );
    expect(migration).not.toMatch(/CREATE\s+(?:TABLE|SCHEMA)\s+public\./i);
  });
});
