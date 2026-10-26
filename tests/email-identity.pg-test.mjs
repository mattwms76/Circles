#!/usr/bin/env node
/**
 * Opt-in, disposable PostgreSQL 17 drill for 0014_circles_email_identity.sql.
 * It never reads app/provider credentials and never contacts a network service.
 * Run only with CIRCLES_EMAIL_AUTH_LOCAL_PG17=1 from the repository root.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import pg from "pg";

if (process.env.CIRCLES_EMAIL_AUTH_LOCAL_PG17 !== "1") {
  console.log(
    "SKIP: set CIRCLES_EMAIL_AUTH_LOCAL_PG17=1 for disposable local PostgreSQL 17 drill",
  );
  process.exit(0);
}

const binDirectory = process.env.POSTGRES17_BIN ?? "/usr/lib/postgresql/17/bin";
const initdb = join(binDirectory, "initdb");
const pgCtl = join(binDirectory, "pg_ctl");
const migrationPath = "operations/migrations/0014_circles_email_identity.sql";

function run(command, argumentsList) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(output);
      else
        reject(
          new Error(
            `${command} exited ${code ?? "unknown"}: ${output.slice(-500)}`,
          ),
        );
    });
  });
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const { port } = address;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function expectPgError(operation, code) {
  await assert.rejects(operation, (error) => error && error.code === code);
}

function localClient(port) {
  return new pg.Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    database: "postgres",
  });
}

const directory = await mkdtemp(join(tmpdir(), "circles-email-identity-pg17-"));
const dataDirectory = join(directory, "data");
const port = await unusedPort();
let admin;
let lockHolder;
let lockContender;
try {
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
  // Keep the UNIX socket and its lock file in the disposable test directory.
  await run(pgCtl, [
    "-D",
    dataDirectory,
    "-o",
    `-h 127.0.0.1 -p ${port} -k ${directory}`,
    "-w",
    "start",
  ]);
  admin = localClient(port);
  await admin.connect();

  await admin.query(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE ROLE circles_app_runtime NOLOGIN NOINHERIT NOBYPASSRLS;
    CREATE SCHEMA circles_app AUTHORIZATION postgres;
    CREATE TABLE circles_app.users (id integer PRIMARY KEY, "openId" text NOT NULL, name text, email text);
    INSERT INTO circles_app.users (id, "openId", name, email) VALUES
      (1, 'legacy:one', 'One', 'one@example.test'),
      (2, 'legacy:two', 'Two', 'two@example.test');
    GRANT USAGE ON SCHEMA circles_app TO circles_app_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON circles_app.users TO circles_app_runtime;
  `);
  await admin.query(await readFile(migrationPath, "utf8"));

  const tables = await admin.query(`
    SELECT relation_catalog.relname
    FROM pg_catalog.pg_class AS relation_catalog
    JOIN pg_catalog.pg_namespace AS namespace_catalog ON namespace_catalog.oid = relation_catalog.relnamespace
    WHERE namespace_catalog.nspname = 'circles_identity'
      AND relation_catalog.relkind = 'r'
    ORDER BY relation_catalog.relname
  `);
  assert.deepEqual(tables.rows, [{ relname: "provider_links" }]);

  const catalog = await admin.query(`
    SELECT
      owner_catalog.rolname AS owner,
      table_catalog.relrowsecurity AS rls,
      table_catalog.relforcerowsecurity AS force_rls
    FROM pg_catalog.pg_class AS table_catalog
    JOIN pg_catalog.pg_namespace AS namespace_catalog ON namespace_catalog.oid = table_catalog.relnamespace
    JOIN pg_catalog.pg_roles AS owner_catalog ON owner_catalog.oid = table_catalog.relowner
    WHERE namespace_catalog.nspname = 'circles_identity'
      AND table_catalog.relname = 'provider_links'
    LIMIT 1
  `);
  assert.deepEqual(catalog.rows[0], {
    owner: "postgres",
    rls: true,
    force_rls: true,
  });

  const constraints = await admin.query(`
    SELECT constraint_catalog.contype, relation_catalog.relname AS referenced_table
    FROM pg_catalog.pg_constraint AS constraint_catalog
    LEFT JOIN pg_catalog.pg_class AS relation_catalog ON relation_catalog.oid = constraint_catalog.confrelid
    WHERE constraint_catalog.conrelid = 'circles_identity.provider_links'::pg_catalog.regclass
    ORDER BY constraint_catalog.contype
  `);
  assert.equal(constraints.rows.filter((row) => row.contype === "f").length, 1);
  assert.deepEqual(
    constraints.rows.find((row) => row.contype === "f"),
    { contype: "f", referenced_table: "users" },
  );

  const policies = await admin.query(`
    SELECT policy_catalog.polcmd, role_catalog.rolname
    FROM pg_catalog.pg_policy AS policy_catalog
    JOIN pg_catalog.pg_roles AS role_catalog ON role_catalog.oid = ANY(policy_catalog.polroles)
    WHERE policy_catalog.polrelid = 'circles_identity.provider_links'::pg_catalog.regclass
    ORDER BY policy_catalog.polcmd
  `);
  assert.deepEqual(policies.rows, [
    { polcmd: "a", rolname: "circles_app_runtime" },
    { polcmd: "r", rolname: "circles_app_runtime" },
  ]);

  // Source-user row locks are possible under the existing restricted runtime role.
  // The contender proves the lock is real rather than a source-code-only assertion.
  lockHolder = localClient(port);
  lockContender = localClient(port);
  await lockHolder.connect();
  await lockContender.connect();
  await lockHolder.query("SET ROLE circles_app_runtime");
  await lockContender.query("SET ROLE circles_app_runtime");
  await lockHolder.query("BEGIN");
  await lockHolder.query(
    "SELECT id FROM circles_app.users WHERE id = 2 FOR UPDATE",
  );
  await lockContender.query("SET lock_timeout = '100ms'");
  await expectPgError(
    () =>
      lockContender.query(
        "SELECT id FROM circles_app.users WHERE id = 2 FOR UPDATE",
      ),
    "55P03",
  );
  await lockHolder.query("ROLLBACK");
  await lockHolder.query("RESET ROLE");
  await lockContender.query("RESET ROLE");
  await lockHolder.end();
  await lockContender.end();
  lockHolder = undefined;
  lockContender = undefined;

  await admin.query("SET ROLE circles_app_runtime");
  await admin.query(`INSERT INTO circles_identity.provider_links (provider_subject, user_id)
    VALUES ('11111111-1111-4111-8111-111111111111', 1)`);
  const readable = await admin.query(
    "SELECT provider_subject::text, user_id FROM circles_identity.provider_links",
  );
  assert.deepEqual(readable.rows, [
    { provider_subject: "11111111-1111-4111-8111-111111111111", user_id: 1 },
  ]);
  await expectPgError(
    () =>
      admin.query(
        "UPDATE circles_identity.provider_links SET user_id = 2 WHERE user_id = 1",
      ),
    "42501",
  );
  await expectPgError(
    () =>
      admin.query(
        "DELETE FROM circles_identity.provider_links WHERE user_id = 1",
      ),
    "42501",
  );
  // The unique subject and unique user constraints prevent an ABA rebinding/replacement.
  await expectPgError(
    () =>
      admin.query(`INSERT INTO circles_identity.provider_links (provider_subject, user_id)
      VALUES ('22222222-2222-4222-8222-222222222222', 1)`),
    "23505",
  );
  await expectPgError(
    () =>
      admin.query(`INSERT INTO circles_identity.provider_links (provider_subject, user_id)
      VALUES ('11111111-1111-4111-8111-111111111111', 2)`),
    "23505",
  );
  await admin.query("RESET ROLE");

  await admin.query("SET ROLE authenticated");
  await expectPgError(
    () => admin.query("SELECT * FROM circles_identity.provider_links"),
    "42501",
  );
  await admin.query("RESET ROLE");

  const functions = await admin.query(`
    SELECT routine_name FROM information_schema.routines
    WHERE routine_schema = 'circles_identity'
    LIMIT 1
  `);
  assert.equal(functions.rowCount, 0);
  console.log(
    "PASS: PostgreSQL 17 identity table inventory, RLS, privileges, source-row lock, uniqueness, and rebinding/ABA drill",
  );
} finally {
  if (lockHolder) await lockHolder.end().catch(() => undefined);
  if (lockContender) await lockContender.end().catch(() => undefined);
  if (admin) await admin.end().catch(() => undefined);
  await run(pgCtl, [
    "-D",
    dataDirectory,
    "-m",
    "immediate",
    "-w",
    "stop",
  ]).catch(() => undefined);
  await rm(directory, { recursive: true, force: true });
}
