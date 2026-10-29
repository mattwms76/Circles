#!/usr/bin/env node
/**
 * CBA-06-only disposable PostgreSQL 17 runner.
 *
 * It accepts no target, DSN, port, migration, or test-file argument. The runner creates a fresh
 * loopback cluster, applies only the CBA-06 prerequisites, seeds synthetic rows, and always
 * attempts cleanup. The CBA-06 migration itself is deliberately applied inside the regression test
 * after its absent-schema assertion.
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import net from "node:net";
import { Pool } from "pg";

const PROJECT_ROOT = resolve(new URL("..", import.meta.url).pathname);
const NODE = "/home/ubuntu/.nvm/versions/node/v22.23.4/bin/node";
const PG_BIN = "/usr/lib/postgresql/17/bin";
const INITDB = `${PG_BIN}/initdb`;
const PG_CTL = `${PG_BIN}/pg_ctl`;
const VITEST = resolve(PROJECT_ROOT, "node_modules/vitest/vitest.mjs");
const FIXTURE_DATABASE = `cba06_media_budget_${randomBytes(12).toString("hex")}`;
const FIXTURE_TOKEN = randomBytes(32).toString("hex");
const MIGRATIONS = [
  "drizzle/postgres/0000_circles_app.sql",
  "operations/migrations/0004_circles_app_integrity.sql",
  "operations/migrations/0005_circles_message_trigger_least_privilege.sql",
  "operations/migrations/0006_circles_profile_onboarding.sql",
];

function fail(message) {
  throw new Error(message);
}

function run(command, args, environment, timeout = 30_000) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    env: environment,
    stdio: "pipe",
    encoding: "utf8",
    timeout,
  });
  if (result.error || result.status !== 0) {
    fail("CBA-06 disposable fixture command failed");
  }
  return result;
}

async function reserveLoopbackPort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error || !Number.isInteger(port) || [3000, 8081].includes(port)) {
          reject(error ?? new Error("CBA-06 fixture port is unsafe"));
          return;
        }
        resolvePort(port);
      });
    });
  });
}

function fixtureEnvironment(home) {
  return {
    HOME: home,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: "/home/ubuntu/.nvm/versions/node/v22.23.4/bin:/usr/lib/postgresql/17/bin:/usr/bin:/bin",
    NODE_ENV: "test",
    CI: "1",
    NO_COLOR: "1",
    VITE_CONFIG_NATIVE_IGNORE_WARNING: "true",
  };
}

async function applyFixtureSchema(port) {
  const bootstrap = new Pool({
    host: "127.0.0.1",
    port,
    database: "postgres",
    user: "postgres",
    max: 1,
    connectionTimeoutMillis: 4_000,
    query_timeout: 4_000,
  });
  try {
    await bootstrap.query(`CREATE DATABASE ${FIXTURE_DATABASE}`);
  } catch {
    fail("CBA-06 fixture setup failed at create_database");
  } finally {
    await bootstrap.end();
  }

  const database = new Pool({
    host: "127.0.0.1",
    port,
    database: FIXTURE_DATABASE,
    user: "postgres",
    max: 1,
    connectionTimeoutMillis: 4_000,
    query_timeout: 4_000,
  });
  let fixtureStep = "create_guard";
  try {
    await database.query("CREATE SCHEMA e2e_fixture");
    await database.query(
      "CREATE TABLE e2e_fixture.guard (token text PRIMARY KEY)",
    );
    await database.query("INSERT INTO e2e_fixture.guard(token) VALUES ($1)", [
      FIXTURE_TOKEN,
    ]);
    for (const role of ["anon", "authenticated", "service_role"]) {
      await database.query(
        `CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`,
      );
    }
    for (const migration of MIGRATIONS) {
      fixtureStep = `apply_${migration.replaceAll("/", "_").replaceAll(".", "_")}`;
      await database.query(
        await readFile(resolve(PROJECT_ROOT, migration), "utf8"),
      );
    }
    fixtureStep = "seed_synthetic_rows";
    await database.query(
      `INSERT INTO circles_app.users(id, "openId", name)
       VALUES
         (1, 'cba06-concurrent', 'CBA-06 concurrent'),
         (2, 'cba06-metadata-failure', 'CBA-06 metadata failure'),
         (3, 'cba06-legacy', 'CBA-06 legacy')`,
    );
  } catch {
    fail(`CBA-06 fixture setup failed at ${fixtureStep}`);
  } finally {
    await database.end();
  }
}

async function main() {
  let temporary;
  let started = false;
  let phase = "preflight";
  const evidence = {
    suite: "cba06-media-upload-budget",
    fixture: "fresh-loopback-postgresql-17",
    production_access: false,
    production_write: false,
    provider_access: false,
    migration_activation: "synthetic-fixture-only",
    passed: false,
  };
  try {
    if (process.execPath !== NODE) fail("CBA-06 requires Node 22.23.4");
    if (
      !run(INITDB, ["--version"], fixtureEnvironment(PROJECT_ROOT))
        .stdout.trim()
        .includes("(PostgreSQL) 17.")
    ) {
      fail("CBA-06 requires PostgreSQL major 17");
    }
    const require = createRequire(import.meta.url);
    require.resolve("pg/package.json");
    require.resolve("vitest/package.json");
    temporary = await mkdtemp(`${tmpdir()}/circles-cba06-pg17-`);
    const environment = fixtureEnvironment(temporary);
    const port = await reserveLoopbackPort();
    phase = "initdb";
    run(
      INITDB,
      ["-D", `${temporary}/data`, "-U", "postgres", "-A", "trust"],
      environment,
    );
    phase = "start-local-postgres";
    run(
      PG_CTL,
      [
        "-D",
        `${temporary}/data`,
        "-l",
        `${temporary}/postgres.log`,
        "-o",
        `-h 127.0.0.1 -p ${port} -k ${temporary}`,
        "-w",
        "start",
      ],
      environment,
    );
    started = true;
    phase = "migrate-and-seed";
    await applyFixtureSchema(port);
    phase = "cba06-real-postgresql-lifecycle";
    const testResult = spawnSync(
      NODE,
      [
        VITEST,
        "run",
        "--config",
        "e2e/cba06-media-upload-budget.e2e.config.ts",
        "--reporter=default",
        "--maxWorkers=1",
        "--fileParallelism=false",
      ],
      {
        cwd: PROJECT_ROOT,
        env: {
          ...environment,
          CBA06_E2E_PG_PORT: String(port),
          CBA06_E2E_DB: FIXTURE_DATABASE,
          CBA06_E2E_TOKEN: FIXTURE_TOKEN,
        },
        stdio: "inherit",
        timeout: 120_000,
      },
    );
    if (testResult.error || testResult.status !== 0) {
      fail("CBA-06 real PostgreSQL lifecycle suite failed");
    }
    evidence.passed = true;
    evidence.postgres_major = 17;
    evidence.migrations_before_cba06 = MIGRATIONS.length;
    evidence.concurrent_reservation_attempts = 65;
  } catch (error) {
    evidence.failed_phase = phase;
    evidence.failure =
      error instanceof Error && error.message.startsWith("CBA-06 ")
        ? error.message
        : "CBA-06 local fixture failed";
  } finally {
    let cleanupOk = true;
    if (temporary && started) {
      try {
        run(
          PG_CTL,
          ["-D", `${temporary}/data`, "-m", "fast", "-w", "stop"],
          fixtureEnvironment(temporary),
        );
      } catch {
        cleanupOk = false;
        evidence.cleanup_error = "local_postgresql_stop_failed";
      }
    }
    if (temporary && cleanupOk) {
      try {
        await rm(temporary, { recursive: true, force: true });
        evidence.disposable_fixture_removed = true;
      } catch {
        evidence.passed = false;
        evidence.cleanup_error = "local_fixture_removal_failed";
      }
    } else if (temporary) {
      evidence.disposable_fixture_removed = false;
    }
  }
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  process.exitCode =
    evidence.passed && evidence.disposable_fixture_removed !== false ? 0 : 1;
}

await main();
