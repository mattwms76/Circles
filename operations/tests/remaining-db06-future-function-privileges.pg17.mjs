#!/usr/bin/env node
/**
 * DB-06 opt-in disposable PostgreSQL 17 drill.
 *
 * Uses only a fresh loopback cluster and synthetic roles. It does not accept a
 * DSN, read .env, or connect to a provider/production database.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

if (process.env.CIRCLES_REMAINING_DB06_LOCAL_PG17 !== "1") {
  console.log(
    "SKIP: set CIRCLES_REMAINING_DB06_LOCAL_PG17=1 for the disposable local PostgreSQL 17 DB-06 drill",
  );
  process.exit(0);
}

const root = resolve(pathFromModule(import.meta.url), "../..");
const sqlPath = join(
  root,
  "operations/remediation/remaining_db06_future_function_default_acl.sql",
);
const preflightPath = join(
  root,
  "operations/remediation/remaining_db06_provider_preflight.sql",
);
const binDirectory = process.env.POSTGRES17_BIN ?? "/usr/lib/postgresql/17/bin";
const initdb = join(binDirectory, "initdb");
const pgCtl = join(binDirectory, "pg_ctl");
const commandTimeoutMs = 20_000;

function pathFromModule(moduleUrl) {
  return resolve(join(fileURLToPath(moduleUrl), ".."));
}

function run(command, argumentsList, timeoutMs = commandTimeoutMs) {
  const childEnvironment = {
    HOME: process.env.HOME ?? "/tmp",
    LANG: "C",
    LC_ALL: "C",
    PATH: process.env.PATH ?? "",
  };
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, argumentsList, {
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(output);
      else {
        reject(
          new Error(
            `${command} exited ${code ?? "unknown"}: ${output.slice(-800)}`,
          ),
        );
      }
    });
  });
}

async function unusedLoopbackPort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  await new Promise((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise())),
  );
  return address.port;
}

function client(port, user) {
  return new pg.Client({
    host: "127.0.0.1",
    port,
    user,
    database: "postgres",
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
  });
}

const expectedSchemaFunctionAclRecords = [
  { schema_name: "cron", acl_text: "{postgres=X*/supabase_admin}" },
  { schema_name: "extensions", acl_text: "{postgres=X*/supabase_admin}" },
  {
    schema_name: "graphql",
    acl_text:
      "{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}",
  },
  {
    schema_name: "graphql_public",
    acl_text:
      "{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}",
  },
  {
    schema_name: "public",
    acl_text:
      "{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}",
  },
  {
    schema_name: "realtime",
    acl_text: "{postgres=X/supabase_admin,dashboard_user=X/supabase_admin}",
  },
];

async function schemaFunctionAclRecords(databaseClient) {
  const result = await databaseClient.query(`
    SELECT namespace_catalog.nspname AS schema_name,
           default_acl.defaclacl::text AS acl_text
    FROM pg_catalog.pg_default_acl AS default_acl
    JOIN pg_catalog.pg_namespace AS namespace_catalog
      ON namespace_catalog.oid = default_acl.defaclnamespace
    WHERE default_acl.defaclrole = 'supabase_admin'::regrole
      AND default_acl.defaclnamespace <> 0
      AND default_acl.defaclobjtype = 'f'
    ORDER BY namespace_catalog.nspname
  `);
  return result.rows;
}

async function expectPermissionDenied(operation, marker) {
  await assert.rejects(operation, (error) => {
    assert.equal(error?.code, "42501");
    assert.match(String(error?.message), marker);
    return true;
  });
}

async function rollbackQuietly(databaseClient) {
  await databaseClient.query("ROLLBACK").catch(() => undefined);
}

async function aclSnapshot(admin) {
  const result = await admin.query(`
    SELECT pg_get_userbyid(default_acl.defaclrole) AS defining_role,
           COALESCE(namespace_catalog.nspname, '') AS schema_name,
           default_acl.defaclobjtype AS object_type,
           default_acl.defaclacl::text AS acl_text
    FROM pg_catalog.pg_default_acl AS default_acl
    LEFT JOIN pg_catalog.pg_namespace AS namespace_catalog
      ON namespace_catalog.oid = default_acl.defaclnamespace
    WHERE NOT (
      default_acl.defaclrole = 'supabase_admin'::regrole
      AND default_acl.defaclnamespace = 0
      AND default_acl.defaclobjtype = 'f'
    )
    ORDER BY defining_role, schema_name, object_type, acl_text
  `);
  return result.rows;
}

let directory;
let admin;
let providerAdmin;
let visitor;
let runtime;
let unrelatedCreator;
let serverStarted = false;
try {
  directory = await mkdtemp(join(tmpdir(), "circles-remaining-db06-pg17-"));
  const dataDirectory = join(directory, "data");
  const port = await unusedLoopbackPort();

  await run(initdb, [
    "-D",
    dataDirectory,
    "-A",
    "trust",
    "-U",
    "postgres",
    "--no-locale",
    "-E",
    "UTF8",
  ]);
  await run(pgCtl, [
    "-D",
    dataDirectory,
    "-o",
    `-h 127.0.0.1 -p ${port} -k ${directory}`,
    "-w",
    "start",
  ]);
  serverStarted = true;

  admin = client(port, "postgres");
  await admin.connect();
  await admin.query(`
    CREATE ROLE supabase_admin SUPERUSER LOGIN;
    CREATE ROLE db06_unauthorized LOGIN;
    CREATE ROLE circles_app_runtime LOGIN;
    CREATE ROLE db06_visitor LOGIN;
    CREATE ROLE db06_schema_recipient NOLOGIN;
    CREATE ROLE db06_unrelated_creator LOGIN;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE ROLE dashboard_user NOLOGIN;

    CREATE SCHEMA circles_app AUTHORIZATION postgres;
    CREATE SCHEMA cron AUTHORIZATION supabase_admin;
    CREATE SCHEMA extensions AUTHORIZATION supabase_admin;
    CREATE SCHEMA graphql AUTHORIZATION supabase_admin;
    CREATE SCHEMA graphql_public AUTHORIZATION supabase_admin;
    CREATE SCHEMA realtime AUTHORIZATION supabase_admin;
    CREATE SCHEMA db06_unrelated AUTHORIZATION db06_unrelated_creator;
    GRANT USAGE ON SCHEMA circles_app TO db06_visitor, circles_app_runtime, db06_schema_recipient;
    GRANT USAGE ON SCHEMA db06_unrelated TO db06_visitor;

    -- The authoritative provider baseline has six schema-additive FUNCTION
    -- records. DB-06 must preserve them all exactly while changing only the
    -- absent global FUNCTION override.
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA cron
      GRANT EXECUTE ON FUNCTIONS TO postgres WITH GRANT OPTION;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA extensions
      GRANT EXECUTE ON FUNCTIONS TO postgres WITH GRANT OPTION;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql
      GRANT EXECUTE ON FUNCTIONS TO postgres, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public
      GRANT EXECUTE ON FUNCTIONS TO postgres, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
      GRANT EXECUTE ON FUNCTIONS TO postgres, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime
      GRANT EXECUTE ON FUNCTIONS TO postgres, dashboard_user;

    -- An unrelated creator's explicit function default and the provider role's
    -- separate type default must be preserved by the DB-06 transaction.
    ALTER DEFAULT PRIVILEGES FOR ROLE db06_unrelated_creator
      GRANT EXECUTE ON FUNCTIONS TO db06_visitor;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
      REVOKE USAGE ON TYPES FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
      GRANT USAGE ON TYPES TO PUBLIC;
  `);

  providerAdmin = client(port, "supabase_admin");
  visitor = client(port, "db06_visitor");
  runtime = client(port, "circles_app_runtime");
  unrelatedCreator = client(port, "db06_unrelated_creator");
  await Promise.all([
    providerAdmin.connect(),
    visitor.connect(),
    runtime.connect(),
    unrelatedCreator.connect(),
  ]);

  const remediation = await readFile(sqlPath, "utf8");
  const preflight = await readFile(preflightPath, "utf8");

  // Parse and execute the read-only operator preflight against the exact
  // synthetic baseline. The six schema records are authoritative, not drift.
  await providerAdmin.query(preflight);
  assert.deepEqual(
    await schemaFunctionAclRecords(admin),
    expectedSchemaFunctionAclRecords,
  );

  // A missing legitimate schema record is a fail-closed precondition failure.
  await providerAdmin.query(`
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA cron
      REVOKE EXECUTE ON FUNCTIONS FROM postgres;
  `);
  await assert.rejects(
    () => providerAdmin.query(remediation),
    /DB06_PRECONDITION_FAILED expected exactly six provider schema-additive FUNCTION default-ACL records, found 5/,
  );
  await rollbackQuietly(providerAdmin);
  await providerAdmin.query(`
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA cron
      GRANT EXECUTE ON FUNCTIONS TO postgres WITH GRANT OPTION;
  `);
  assert.deepEqual(
    await schemaFunctionAclRecords(admin),
    expectedSchemaFunctionAclRecords,
  );

  // An added schema record is equally outside DB-06's authority and is refused.
  await providerAdmin.query(`
    CREATE SCHEMA db06_unexpected AUTHORIZATION supabase_admin;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA db06_unexpected
      GRANT EXECUTE ON FUNCTIONS TO db06_visitor;
  `);
  await assert.rejects(
    () => providerAdmin.query(remediation),
    /DB06_PRECONDITION_FAILED expected exactly six provider schema-additive FUNCTION default-ACL records, found 7/,
  );
  await rollbackQuietly(providerAdmin);
  await providerAdmin.query(`
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA db06_unexpected
      REVOKE EXECUTE ON FUNCTIONS FROM db06_visitor;
    DROP SCHEMA db06_unexpected;
    CREATE FUNCTION circles_app.db06_before(integer)
    RETURNS integer LANGUAGE sql AS $$ SELECT $1 + 1 $$;
  `);
  assert.deepEqual(
    await schemaFunctionAclRecords(admin),
    expectedSchemaFunctionAclRecords,
  );

  // An ordinary login neither becomes a member nor receives an escalation from
  // the candidate; it is refused before the ALTER DEFAULT PRIVILEGES statement.
  const unauthorized = client(port, "db06_unauthorized");
  await unauthorized.connect();
  await expectPermissionDenied(
    () => unauthorized.query(remediation),
    /DB06_AUTHORITY_REQUIRED/,
  );
  await rollbackQuietly(unauthorized);
  await unauthorized.end();

  const unrelatedBefore = await aclSnapshot(admin);
  await providerAdmin.query(remediation);
  const unrelatedAfter = await aclSnapshot(admin);
  assert.deepEqual(unrelatedAfter, unrelatedBefore);

  const targetGlobalDefault = await admin.query(`
    SELECT count(*)::integer AS count,
           bool_or(privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE') AS has_public_execute
    FROM pg_catalog.pg_default_acl AS default_acl
    CROSS JOIN LATERAL pg_catalog.aclexplode(default_acl.defaclacl) AS privilege
    WHERE default_acl.defaclrole = 'supabase_admin'::regrole
      AND default_acl.defaclnamespace = 0
      AND default_acl.defaclobjtype = 'f'
  `);
  assert.deepEqual(targetGlobalDefault.rows[0], {
    count: 1,
    has_public_execute: false,
  });

  // Existing functions retain their historical PUBLIC ACL. Newly created
  // functions inherit the hardened global default and become callable only
  // after a deliberate explicit runtime grant.
  assert.equal(
    (
      await admin.query(`
      SELECT has_function_privilege('db06_visitor', 'circles_app.db06_before(integer)', 'EXECUTE') AS allowed
    `)
    ).rows[0].allowed,
    true,
  );
  assert.equal(
    (await visitor.query("SELECT circles_app.db06_before(4) AS value")).rows[0]
      .value,
    5,
  );

  await providerAdmin.query(`
    CREATE FUNCTION circles_app.db06_after(integer)
    RETURNS integer LANGUAGE sql AS $$ SELECT $1 + 3 $$;
  `);
  assert.equal(
    (
      await admin.query(`
      SELECT has_function_privilege('db06_visitor', 'circles_app.db06_after(integer)', 'EXECUTE') AS allowed
    `)
    ).rows[0].allowed,
    false,
  );
  await expectPermissionDenied(
    () => visitor.query("SELECT circles_app.db06_after(4)"),
    /permission denied for function db06_after/,
  );

  await providerAdmin.query(
    "GRANT EXECUTE ON FUNCTION circles_app.db06_after(integer) TO circles_app_runtime",
  );
  assert.equal(
    (
      await admin.query(`
      SELECT has_function_privilege('circles_app_runtime', 'circles_app.db06_after(integer)', 'EXECUTE') AS allowed
    `)
    ).rows[0].allowed,
    true,
  );
  assert.equal(
    (await runtime.query("SELECT circles_app.db06_after(4) AS value")).rows[0]
      .value,
    7,
  );
  assert.equal(
    (
      await admin.query(`
      SELECT has_function_privilege('db06_visitor', 'circles_app.db06_after(integer)', 'EXECUTE') AS allowed
    `)
    ).rows[0].allowed,
    false,
  );

  await unrelatedCreator.query(`
    CREATE FUNCTION db06_unrelated.unrelated_after(integer)
    RETURNS integer LANGUAGE sql AS $$ SELECT $1 + 4 $$;
  `);
  assert.equal(
    (
      await admin.query(`
      SELECT has_function_privilege('db06_visitor', 'db06_unrelated.unrelated_after(integer)', 'EXECUTE') AS allowed
    `)
    ).rows[0].allowed,
    true,
  );
  assert.equal(
    (await visitor.query("SELECT db06_unrelated.unrelated_after(4) AS value"))
      .rows[0].value,
    8,
  );

  console.log(
    "PASS: DB-06 PG17 drill verified all six schema ACLs, missing-and-added-record refusals, one global revoke, explicit runtime grants, and unrelated ACL preservation",
  );
} finally {
  await Promise.all(
    [unrelatedCreator, runtime, visitor, providerAdmin, admin]
      .filter(Boolean)
      .map((databaseClient) => databaseClient.end().catch(() => undefined)),
  );
  if (serverStarted && directory) {
    await run(pgCtl, [
      "-D",
      join(directory, "data"),
      "-m",
      "immediate",
      "-w",
      "stop",
    ]).catch(() => undefined);
  }
  if (directory) await rm(directory, { recursive: true, force: true });
}
