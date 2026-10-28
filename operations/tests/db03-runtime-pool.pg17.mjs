#!/usr/bin/env node
/**
 * DB-03 opt-in disposable PostgreSQL 17 drill.
 *
 * It starts only a unique loopback cluster with synthetic roles. It accepts no
 * DSN, reads no .env file, and has no provider or production connection path.
 * Run with: pnpm tsx operations/tests/db03-runtime-pool.pg17.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { tsImport } from "tsx/esm/api";

const runtimePoolModule = await tsImport("../../server/runtime-role-pool.ts", {
  parentURL: import.meta.url,
});
const {
  RuntimeRoleClientReleasedError,
  RuntimeRolePool,
  RuntimeRoleSessionControlError,
} = runtimePoolModule.default ?? runtimePoolModule;

if (process.env.CIRCLES_DB03_LOCAL_PG17 !== "1") {
  console.log(
    "SKIP: set CIRCLES_DB03_LOCAL_PG17=1 for the disposable local PostgreSQL 17 DB-03 runtime-pool drill",
  );
  process.exit(0);
}

const postgresBin = "/usr/lib/postgresql/17/bin";
const initdb = join(postgresBin, "initdb");
const pgCtl = join(postgresBin, "pg_ctl");
const runtimeRole = "circles_app_runtime";
const loginRole = "db03_synthetic_login";
const childEnvironment = {
  PATH: "/usr/lib/postgresql/17/bin:/usr/bin:/bin",
  LC_ALL: "C",
  LANG: "C",
};

function run(command, argumentsList) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, {
      env: childEnvironment,
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

function localAdmin(port) {
  return new pg.Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    database: "postgres",
  });
}

function localRuntimePool(port) {
  return new RuntimeRolePool({
    host: "127.0.0.1",
    port,
    user: loginRole,
    database: "postgres",
    max: 1,
    idleTimeoutMillis: 0,
    connectionTimeoutMillis: 5_000,
  });
}

async function checkout(pool) {
  let timeout;
  try {
    return await Promise.race([
      pool.connect(),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("DB-03 checkout did not complete")),
          5_000,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function runtimeIdentity(client) {
  const result = await client.query(
    "SELECT current_user AS current_user, session_user AS session_user, pg_backend_pid() AS backend_pid",
  );
  assert.equal(result.rowCount, 1);
  assert.equal(result.rows[0].current_user, runtimeRole);
  assert.equal(result.rows[0].session_user, loginRole);
  return Number(result.rows[0].backend_pid);
}

function queryWithPoolCallback(pool, config) {
  return new Promise((resolve, reject) => {
    pool.query(config, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

function queryWithConnectCallback(pool, config) {
  return new Promise((resolve, reject) => {
    pool.connect((connectError, client, done) => {
      if (connectError || !client) {
        reject(
          connectError ?? new Error("DB-03 callback checkout omitted client"),
        );
        return;
      }
      client.query(config, (queryError, result) => {
        if (queryError) {
          done(queryError);
          reject(queryError);
          return;
        }
        done();
        resolve(result);
      });
    });
  });
}

const directory = await mkdtemp(join(tmpdir(), "circles-db03-pg17-"));
const dataDirectory = join(directory, "data");
const port = await unusedLoopbackPort();
let admin;
let pool;
let serverStarted = false;

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
  await run(pgCtl, [
    "-D",
    dataDirectory,
    "-o",
    `-h 127.0.0.1 -p ${port} -k ${directory}`,
    "-w",
    "start",
  ]);
  serverStarted = true;

  admin = localAdmin(port);
  await admin.connect();
  await admin.query(`
    CREATE ROLE ${runtimeRole} NOLOGIN NOINHERIT NOBYPASSRLS;
    CREATE ROLE ${loginRole} LOGIN;
    GRANT ${runtimeRole} TO ${loginRole};
  `);

  pool = localRuntimePool(port);
  // The termination fixture intentionally makes one checked-out socket fail.
  pool.on("error", () => undefined);

  const promiseResult = await pool.query("SELECT current_user AS current_user");
  assert.equal(promiseResult.rows[0].current_user, runtimeRole);

  const configResult = await pool.query({
    text: "SELECT $1::int AS value",
    values: [17],
  });
  assert.equal(configResult.rows[0].value, 17);

  const poolCallbackResult = await queryWithPoolCallback(pool, {
    text: "SELECT $1::text AS value",
    values: ["pool-callback"],
  });
  assert.equal(poolCallbackResult.rows[0].value, "pool-callback");

  const connectCallbackResult = await queryWithConnectCallback(pool, {
    text: "SELECT $1::text AS value",
    values: ["connect-callback"],
  });
  assert.equal(connectCallbackResult.rows[0].value, "connect-callback");
  console.log(
    "PASS: promise, config, pool callback, and connect callback paths use the verified runtime role",
  );

  let client = await checkout(pool);
  const initialApplicationName = (
    await client.query("SELECT current_setting('application_name') AS value")
  ).rows[0].value;
  const firstBackendPid = await runtimeIdentity(client);

  await assert.rejects(
    () => client.query("SET ROLE postgres"),
    RuntimeRoleSessionControlError,
  );
  await runtimeIdentity(client);

  const literalResult = await client.query(
    String.raw`/* outer /* nested SET ROLE postgres */ comment */
      SELECT
        '; SET ROLE postgres' AS ordinary_note,
        E'escaped \' SET ROLE postgres' AS escape_note,
        $$DISCARD ALL; SET SESSION AUTHORIZATION postgres$$ AS dollar_note,
        1 AS "RESET ALL"`,
  );
  assert.equal(literalResult.rows[0].ordinary_note, "; SET ROLE postgres");
  assert.equal(literalResult.rows[0]["RESET ALL"], 1);

  await client.query("BEGIN");
  await client.query("SELECT 1 AS transaction_ok");
  await client.query("COMMIT");
  await client.query("SET application_name = 'db03-dirty'");
  await client.query({
    name: "db03_runtime_pool_prepared",
    text: "SELECT $1::int AS prepared_value",
    values: [42],
  });
  client.release();
  await assert.rejects(
    () => client.query("SELECT 1"),
    RuntimeRoleClientReleasedError,
  );

  client = await checkout(pool);
  const secondBackendPid = await runtimeIdentity(client);
  assert.equal(secondBackendPid, firstBackendPid);
  const cleanedApplicationName = (
    await client.query("SELECT current_setting('application_name') AS value")
  ).rows[0].value;
  assert.equal(cleanedApplicationName, initialApplicationName);
  const preparedStatements = await client.query({
    text: "SELECT count(*)::int AS count FROM pg_prepared_statements WHERE name = $1",
    values: ["db03_runtime_pool_prepared"],
  });
  assert.equal(Number(preparedStatements.rows[0].count), 0);
  client.release();
  console.log(
    "PASS: harmless literals execute; SET ROLE is blocked; DISCARD ALL clears GUCs and prepared statements before reuse",
  );

  client = await checkout(pool);
  const leakedTransactionBackendPid = await runtimeIdentity(client);
  await client.query("BEGIN");
  await client.query("SELECT 1 AS leak_fixture");
  client.release();
  await assert.rejects(
    () => client.query("SELECT 1"),
    RuntimeRoleClientReleasedError,
  );

  client = await checkout(pool);
  const replacementAfterLeakPid = await runtimeIdentity(client);
  assert.notEqual(replacementAfterLeakPid, leakedTransactionBackendPid);
  client.release();
  console.log(
    "PASS: a leaked transaction makes cleanup fail closed and destroys the backend",
  );

  client = await checkout(pool);
  const terminatedBackendPid = await runtimeIdentity(client);
  const termination = await admin.query(
    "SELECT pg_terminate_backend($1) AS terminated",
    [terminatedBackendPid],
  );
  assert.equal(termination.rows[0].terminated, true);
  client.release();

  client = await checkout(pool);
  const replacementAfterFailurePid = await runtimeIdentity(client);
  assert.notEqual(replacementAfterFailurePid, terminatedBackendPid);
  client.release();
  console.log(
    "PASS: an out-of-transaction cleanup driver failure destroys the backend and the next checkout is safe",
  );
} finally {
  if (pool) await pool.end().catch(() => undefined);
  if (admin) await admin.end().catch(() => undefined);
  if (serverStarted) {
    await run(pgCtl, [
      "-D",
      dataDirectory,
      "-m",
      "immediate",
      "-w",
      "stop",
    ]).catch(() => undefined);
  }
  await rm(directory, { recursive: true, force: true });
}
