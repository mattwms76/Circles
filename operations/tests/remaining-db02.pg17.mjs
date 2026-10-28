#!/usr/bin/env node
/**
 * Finite DB-02 PostgreSQL 17 rehearsal. It accepts no DSN or account input,
 * starts a fresh loopback-only cluster, and removes all generated state.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { accessSync, constants, existsSync } from "node:fs";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const remediationDirectory = resolve(root, "operations/remediation");
const checks = [];

function record(name) {
  checks.push(name);
  console.log(`PASS: ${name}`);
}

function quotedIdentifier(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

function pgBinDirectory() {
  const configured = process.env.PG17_BIN;
  const directory =
    typeof configured === "string" && configured.length > 0
      ? configured
      : "/usr/lib/postgresql/17/bin";
  for (const binary of ["initdb", "pg_ctl"]) {
    accessSync(resolve(directory, binary), constants.X_OK);
  }
  return directory;
}

function sanitizedFixtureEnvironment(home) {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    LANG: "C",
    LC_ALL: "C",
  };
}

async function run(binary, args, { cwd, env }) {
  const child = spawn(binary, args, {
    cwd,
    env,
    stdio: ["ignore", "ignore", "ignore"],
  });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`fixture command failed: ${binary}`);
}

async function reserveLoopbackPort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const { port } = address;
  server.close();
  await once(server, "close");
  return port;
}

function fixturePassword() {
  // A random test-only value is never logged, returned, committed, or reused.
  return randomBytes(32).toString("hex");
}

function fixtureClient(port, user, password) {
  return new Client({
    host: "127.0.0.1",
    port,
    database: "postgres",
    user,
    password,
    connectionTimeoutMillis: 5_000,
    query_timeout: 8_000,
    statement_timeout: 8_000,
  });
}

async function apply(admin, filename, action) {
  const sql = await readFile(resolve(remediationDirectory, filename), "utf8");
  if (action) {
    await admin.query(
      "SELECT pg_catalog.set_config('circles.db02_cutover_action', $1, false)",
      [action],
    );
  }
  try {
    await admin.query(sql);
  } catch (error) {
    // Guarded SQL opens its own transaction. A deliberate preflight refusal
    // leaves that fixture session aborted until cleanup; never let that state
    // make a later assertion look like an independent privilege result.
    await admin.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function expectFailure(callback) {
  try {
    await callback();
  } catch {
    return;
  }
  throw new Error("expected PostgreSQL operation to be denied");
}

async function expectSqlState(callback, sqlState) {
  try {
    await callback();
  } catch (error) {
    assert.equal(error?.code, sqlState);
    return;
  }
  throw new Error(`expected PostgreSQL SQLSTATE ${sqlState}`);
}

function fixturePasswordProvisioningSql(roleName) {
  if (roleName === "postgres") {
    return "'ALTER ROLE postgres PASSWORD %L'";
  }
  if (roleName === "circles_app_login") {
    return "'ALTER ROLE circles_app_login PASSWORD %L'";
  }
  throw new Error("fixture password role is not approved");
}

async function setFixtureRolePassword(admin, roleName, password) {
  let transactionOpen = false;
  try {
    await admin.query("BEGIN");
    transactionOpen = true;
    await admin.query(
      "SELECT pg_catalog.set_config('circles.db02.fixture_app_password', $1, true)",
      [password],
    );
    await admin.query(`
      DO $db02_fixture_password$
      DECLARE
        v_password text;
      BEGIN
        v_password := pg_catalog.current_setting('circles.db02.fixture_app_password', true);
        IF v_password IS NULL OR pg_catalog.octet_length(v_password) = 0 THEN
          RAISE EXCEPTION 'fixture app password is absent';
        END IF;
        EXECUTE pg_catalog.format(${fixturePasswordProvisioningSql(roleName)}, v_password);
      END
      $db02_fixture_password$;
    `);
    await admin.query("COMMIT");
    transactionOpen = false;
  } finally {
    if (transactionOpen) await admin.query("ROLLBACK").catch(() => undefined);
  }
}

const DB02_ADVISORY_LOCK_SQL = `
  SELECT pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('circles.remaining-db02.app-login.v1', 0)
  )
`;

async function proveReadOnlyPreflightBoundary(port, adminPassword) {
  const holder = fixtureClient(port, "postgres", adminPassword);
  const contender = fixtureClient(port, "postgres", adminPassword);
  let holderTransactionOpen = false;
  let contenderTransactionOpen = false;
  try {
    await holder.connect();
    await contender.connect();

    await holder.query("BEGIN");
    holderTransactionOpen = true;
    await holder.query("SET TRANSACTION READ ONLY");
    await holder.query("SET LOCAL lock_timeout = '100ms'");
    await holder.query("SET LOCAL statement_timeout = '1s'");
    await holder.query(DB02_ADVISORY_LOCK_SQL);
    await expectFailure(() =>
      holder.query(
        "CREATE TABLE public.db02_read_only_write_denied (id bigint)",
      ),
    );
    await holder.query("ROLLBACK");
    holderTransactionOpen = false;

    await holder.query("BEGIN");
    holderTransactionOpen = true;
    await holder.query("SET TRANSACTION READ ONLY");
    await holder.query("SET LOCAL statement_timeout = '1s'");
    await holder.query(DB02_ADVISORY_LOCK_SQL);

    await contender.query("BEGIN");
    contenderTransactionOpen = true;
    await contender.query("SET TRANSACTION READ ONLY");
    await contender.query("SET LOCAL lock_timeout = '100ms'");
    await contender.query("SET LOCAL statement_timeout = '1s'");
    await expectSqlState(
      () => contender.query(DB02_ADVISORY_LOCK_SQL),
      "55P03",
    );
    await contender.query("ROLLBACK");
    contenderTransactionOpen = false;
  } finally {
    if (contenderTransactionOpen)
      await contender.query("ROLLBACK").catch(() => undefined);
    if (holderTransactionOpen)
      await holder.query("ROLLBACK").catch(() => undefined);
    await contender.end().catch(() => undefined);
    await holder.end().catch(() => undefined);
  }
}

async function createTable(admin, schema, table) {
  await admin.query(
    `CREATE TABLE ${quotedIdentifier(schema)}.${quotedIdentifier(table)} (id bigint PRIMARY KEY)`,
  );
}

async function createApprovedPrivateFixture(admin) {
  const appTables = [
    "_dataMigrations",
    "activeHostLeases",
    "activityCirclePreferences",
    "activityItems",
    "activityPreferences",
    "applicationSessions",
    "bookmarks",
    "circles",
    "comments",
    "conversationParticipants",
    "conversations",
    "follows",
    "liveChat",
    "liveSignals",
    "liveViewers",
    "memberships",
    "messages",
    "moderationActions",
    "moderationCases",
    "posts",
    "profiles",
    "reactions",
    "reports",
    "socialSeedMarkers",
    "socialUploads",
    "streams",
    "users",
  ];
  const adminTables = [
    "audit",
    "auth_subjects",
    "entity_state",
    "operators",
    "report_reviews",
    "review_handoffs",
    "sessions",
    "settings",
    "supabase_sessions",
  ];
  const publishTables = [
    "circlePrompts",
    "devicePushTokens",
    "mediaObjects",
    "postPublishReceipts",
    "promptPosts",
  ];

  await admin.query(`
    CREATE ROLE postgres LOGIN SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS;
    CREATE ROLE circles_app_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    CREATE ROLE circles_app_login NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    CREATE ROLE db02_fixture_other NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    CREATE SCHEMA circles_admin;
    CREATE SCHEMA circles_app;
    CREATE SCHEMA circles_auth;
    CREATE SCHEMA circles_identity;
    CREATE SCHEMA circles_ops;
    CREATE SCHEMA circles_publish;
    REVOKE ALL ON SCHEMA circles_admin, circles_app, circles_auth, circles_identity, circles_ops, circles_publish FROM PUBLIC;
    GRANT USAGE ON SCHEMA circles_admin, circles_app, circles_auth, circles_identity, circles_publish TO circles_app_runtime;
  `);
  for (const table of appTables) await createTable(admin, "circles_app", table);
  await createTable(admin, "circles_auth", "oauth_pending_states");
  await createTable(admin, "circles_identity", "provider_links");
  for (const table of publishTables)
    await createTable(admin, "circles_publish", table);
  for (const table of adminTables)
    await createTable(admin, "circles_admin", table);
  await admin.query(`
    CREATE FUNCTION circles_admin.read_mobile_feature_settings()
      RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    GRANT EXECUTE ON FUNCTION circles_admin.read_mobile_feature_settings() TO circles_app_runtime;
    GRANT SELECT ON TABLE circles_app."_dataMigrations" TO circles_app_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA circles_app TO circles_app_runtime;
    REVOKE INSERT, UPDATE, DELETE ON TABLE circles_app."_dataMigrations" FROM circles_app_runtime;
    GRANT SELECT, INSERT, DELETE ON TABLE circles_auth.oauth_pending_states TO circles_app_runtime;
    GRANT SELECT, INSERT ON TABLE circles_identity.provider_links TO circles_app_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE circles_publish."circlePrompts", circles_publish."devicePushTokens" TO circles_app_runtime;
    GRANT SELECT, INSERT ON TABLE circles_publish."mediaObjects", circles_publish."promptPosts" TO circles_app_runtime;
    GRANT SELECT, INSERT, UPDATE ON TABLE circles_publish."postPublishReceipts" TO circles_app_runtime;
  `);
}

async function main() {
  const pgBin = pgBinDirectory();
  const fixtureDirectory = resolve(
    process.cwd(),
    `.remaining-db02-pg17-${process.pid}-${randomBytes(8).toString("hex")}`,
  );
  const dataDirectory = resolve(fixtureDirectory, "data");
  const passwordFile = resolve(fixtureDirectory, "postgres-password");
  const adminPassword = fixturePassword();
  const appPassword = fixturePassword();
  const port = await reserveLoopbackPort();
  const fixtureEnv = sanitizedFixtureEnvironment(fixtureDirectory);
  let started = false;
  let cleanupFailure;

  try {
    await mkdir(fixtureDirectory, { mode: 0o700 });
    await writeFile(passwordFile, `${adminPassword}\n`, { mode: 0o600 });
    await run(
      resolve(pgBin, "initdb"),
      [
        "-D",
        dataDirectory,
        "-U",
        "supabase_admin",
        "-A",
        "scram-sha-256",
        "--no-locale",
        "--encoding=UTF8",
        `--pwfile=${passwordFile}`,
      ],
      { cwd: root, env: fixtureEnv },
    );
    await rm(passwordFile, { force: true });
    await run(
      resolve(pgBin, "pg_ctl"),
      [
        "-D",
        dataDirectory,
        "-o",
        `-h 127.0.0.1 -p ${port} -k ${fixtureDirectory}`,
        "-w",
        "-t",
        "30",
        "start",
      ],
      { cwd: root, env: fixtureEnv },
    );
    started = true;

    const admin = fixtureClient(port, "supabase_admin", adminPassword);
    await admin.connect();
    try {
      await createApprovedPrivateFixture(admin);
      await setFixtureRolePassword(admin, "postgres", adminPassword);
      await setFixtureRolePassword(admin, "circles_app_login", appPassword);

      // The provider-rooted fixture gives the synthetic postgres operator both
      // ADMIN and SET authority for supabase_admin. PostgreSQL 17 then permits
      // the operator to SET ROLE to the provider and record that provider as
      // the exact grantor, without adding a second app-login membership edge.
      await admin.query(`
        GRANT supabase_admin TO postgres
          WITH ADMIN TRUE, INHERIT FALSE, SET TRUE;
      `);
      const operator = fixtureClient(port, "postgres", adminPassword);
      await operator.connect();
      try {
        await operator.query("SET ROLE supabase_admin");
        await operator.query(
          "GRANT circles_app_login TO postgres WITH ADMIN TRUE, INHERIT FALSE, SET FALSE GRANTED BY supabase_admin",
        );
        await operator.query("RESET ROLE");
      } finally {
        await operator.end().catch(() => undefined);
      }

      const finalProviderEdge = await admin.query(`
        SELECT member_role.rolname AS member, grantor_role.rolname AS grantor,
               membership.admin_option, membership.inherit_option, membership.set_option
        FROM pg_catalog.pg_auth_members AS membership
        JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
        JOIN pg_catalog.pg_roles AS grantor_role ON grantor_role.oid = membership.grantor
        WHERE membership.roleid = 'circles_app_login'::pg_catalog.regrole
      `);
      assert.deepEqual(finalProviderEdge.rows, [
        {
          member: "postgres",
          grantor: "supabase_admin",
          admin_option: true,
          inherit_option: false,
          set_option: false,
        },
      ]);
      record(
        "synthetic provider ADMIN and SET authority records the exact final supabase_admin-granted incoming edge",
      );

      await proveReadOnlyPreflightBoundary(port, adminPassword);
      record(
        "read-only preflight boundary rejects writes while its transaction advisory lock remains available and bounded",
      );

      await apply(admin, "remaining_db02_preflight.sql");
      record(
        "detached catalog preflight preserves exact role flags, 43-table inventory, direct-ACL denial, and runtime helper grants",
      );

      await expectFailure(async () => {
        const detached = fixtureClient(port, "circles_app_login", appPassword);
        try {
          await detached.connect();
        } finally {
          await detached.end().catch(() => undefined);
        }
      });
      record("detached NOLOGIN principal cannot open a TCP SCRAM connection");

      await admin.query("GRANT db02_fixture_other TO circles_app_login");
      await expectFailure(() =>
        apply(
          admin,
          "remaining_db02_activate_temporary.sql",
          "ACTIVATE_TEMPORARY_V1",
        ),
      );
      const failedActivation = await admin.query(
        "SELECT rolcanlogin FROM pg_catalog.pg_roles WHERE rolname = 'circles_app_login'",
      );
      assert.equal(failedActivation.rows[0]?.rolcanlogin, false);
      await admin.query("REVOKE db02_fixture_other FROM circles_app_login");
      record(
        "atomic activation rejects an unexpected membership without enabling LOGIN",
      );

      await apply(
        admin,
        "remaining_db02_activate_temporary.sql",
        "ACTIVATE_TEMPORARY_V1",
      );
      const activeRole = await admin.query(`
        SELECT rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
               rolreplication, rolbypassrls
        FROM pg_catalog.pg_roles
        WHERE rolname = 'circles_app_login'
      `);
      assert.deepEqual(activeRole.rows[0], {
        rolcanlogin: true,
        rolinherit: false,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: false,
      });
      record(
        "temporary activation changes only the dedicated login flag after atomic preflight",
      );

      const app = fixtureClient(port, "circles_app_login", appPassword);
      await app.connect();
      try {
        const initial = await app.query(
          "SELECT session_user, current_user, current_database()",
        );
        assert.deepEqual(initial.rows[0], {
          session_user: "circles_app_login",
          current_user: "circles_app_login",
          current_database: "postgres",
        });
        await expectFailure(() => app.query("SELECT * FROM circles_app.users"));
        await expectFailure(() => app.query("SET ROLE postgres"));
        await expectFailure(() => app.query("SET ROLE db02_fixture_other"));

        await app.query("SET ROLE circles_app_runtime");
        assert.deepEqual((await app.query("SELECT current_user")).rows[0], {
          current_user: "circles_app_runtime",
        });
        await app.query("SELECT * FROM circles_app.users");
        await app.query("SELECT * FROM circles_auth.oauth_pending_states");
        await app.query("SELECT * FROM circles_identity.provider_links");
        await app.query('SELECT * FROM circles_publish."postPublishReceipts"');
        await expectFailure(() =>
          app.query(
            "CREATE TABLE circles_app.db02_forbidden_create (id bigint)",
          ),
        );
        await expectFailure(() => app.query("TRUNCATE circles_app.users"));
        await app.query("RESET ROLE");
        await expectFailure(() => app.query("SELECT * FROM circles_app.users"));
      } finally {
        await app.end().catch(() => undefined);
      }
      record(
        "real dedicated TCP login has no direct private authority, only SET ROLE runtime access, and cannot SET ROLE/create/truncate",
      );

      await apply(
        admin,
        "remaining_db02_rollback_detached.sql",
        "ROLLBACK_DETACHED_V1",
      );
      const detachedAgain = await admin.query(
        "SELECT rolcanlogin FROM pg_catalog.pg_roles WHERE rolname = 'circles_app_login'",
      );
      assert.equal(detachedAgain.rows[0]?.rolcanlogin, false);
      await expectFailure(async () => {
        const client = fixtureClient(port, "circles_app_login", appPassword);
        try {
          await client.connect();
        } finally {
          await client.end().catch(() => undefined);
        }
      });
      record(
        "reversal drains the fixture and returns the dedicated login to NOLOGIN without changing grants or credentials",
      );
    } finally {
      await admin.end().catch(() => undefined);
    }
  } finally {
    try {
      if (started) {
        await run(
          resolve(pgBin, "pg_ctl"),
          ["-D", dataDirectory, "-m", "immediate", "-w", "-t", "30", "stop"],
          { cwd: root, env: fixtureEnv },
        );
      }
    } catch {
      cleanupFailure = new Error("DB-02 fixture PostgreSQL shutdown failed");
    }
    try {
      if (existsSync(fixtureDirectory)) {
        await rm(fixtureDirectory, { recursive: true, force: true });
      }
    } catch {
      cleanupFailure ??= new Error("DB-02 fixture directory removal failed");
    }
    console.log(
      JSON.stringify({
        production_access: false,
        production_write: false,
        fixture: "fresh-loopback-pg17-scram",
        passed_checks: checks.length,
        disposable_fixture_removed: !existsSync(fixtureDirectory),
      }),
    );
    if (cleanupFailure) throw cleanupFailure;
  }
}

main().catch((error) => {
  // This fixture never receives a real DSN; keep diagnostics terse regardless.
  console.error(
    error instanceof Error ? error.message : "DB-02 fixture failed",
  );
  process.exitCode = 1;
});
