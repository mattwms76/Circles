#!/usr/bin/env node
/**
 * Opt-in local PostgreSQL 17 connection-error drill.
 *
 * It creates a unique loopback cluster with synthetic roles and accepts no DSN
 * or environment configuration. Run only with:
 *   CIRCLES_RUNTIME_POOL_CONNECTION_ERRORS_PG17=1 pnpm tsx operations/tests/runtime-pool-connection-errors.pg17.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { tsImport } from "tsx/esm/api";

if (process.env.CIRCLES_RUNTIME_POOL_CONNECTION_ERRORS_PG17 !== "1") {
  console.log(
    "SKIP: set CIRCLES_RUNTIME_POOL_CONNECTION_ERRORS_PG17=1 for the disposable local PostgreSQL 17 connection-error drill",
  );
  process.exit(0);
}

const runtimePoolModule = await tsImport("../../server/runtime-role-pool.ts", {
  parentURL: import.meta.url,
});
const { RuntimeRoleClientReleasedError, RuntimeRolePool } =
  runtimePoolModule.default ?? runtimePoolModule;
const postgresBin = "/usr/lib/postgresql/17/bin";
const initdb = join(postgresBin, "initdb");
const pgCtl = join(postgresBin, "pg_ctl");
const runtimeRole = "circles_app_runtime";
const loginRole = "runtime_pool_drill_login";
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
      else
        reject(
          new Error(
            `${command} exited ${code ?? "unknown"}: ${output.slice(-800)}`,
          ),
        );
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
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function waitFor(check, description) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${description}`);
}

async function runtimeIdentity(client) {
  const result = await client.query(
    "SELECT current_user AS current_user, session_user AS session_user, pg_backend_pid() AS backend_pid",
  );
  assert.equal(result.rows[0].current_user, runtimeRole);
  assert.equal(result.rows[0].session_user, loginRole);
  return Number(result.rows[0].backend_pid);
}

const directory = await mkdtemp(
  join(tmpdir(), "circles-runtime-pool-errors-pg17-"),
);
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

  admin = new pg.Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    database: "postgres",
  });
  await admin.connect();
  await admin.query(`
    CREATE ROLE ${runtimeRole} NOLOGIN NOINHERIT NOBYPASSRLS;
    CREATE ROLE ${loginRole} LOGIN;
    GRANT ${runtimeRole} TO ${loginRole};
  `);

  pool = new RuntimeRolePool({
    host: "127.0.0.1",
    port,
    user: loginRole,
    database: "postgres",
    max: 1,
    idleTimeoutMillis: 0,
    connectionTimeoutMillis: 5_000,
  });

  let client = await pool.connect();
  const checkedOutPid = await runtimeIdentity(client);
  const checkedOutTermination = await admin.query(
    "SELECT pg_terminate_backend($1) AS terminated",
    [checkedOutPid],
  );
  assert.equal(checkedOutTermination.rows[0].terminated, true);
  await waitFor(() => pool.totalCount === 0, "checked-out client retirement");
  await assert.rejects(
    () => client.query("SELECT 1"),
    RuntimeRoleClientReleasedError,
  );

  client = await pool.connect();
  const replacementAfterCheckoutPid = await runtimeIdentity(client);
  assert.notEqual(replacementAfterCheckoutPid, checkedOutPid);
  client.release();
  await waitFor(() => pool.idleCount === 1, "idle runtime client");
  console.log(
    "PASS: local checked-out termination is retired and replaced with a verified runtime checkout",
  );

  const idleTermination = await admin.query(
    "SELECT pg_terminate_backend($1) AS terminated",
    [replacementAfterCheckoutPid],
  );
  assert.equal(idleTermination.rows[0].terminated, true);
  await waitFor(() => pool.totalCount === 0, "idle client retirement");

  client = await pool.connect();
  const replacementAfterIdlePid = await runtimeIdentity(client);
  assert.notEqual(replacementAfterIdlePid, replacementAfterCheckoutPid);
  client.release();
  console.log(
    "PASS: local idle termination is absorbed by the generic pool handler and replaced safely",
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
