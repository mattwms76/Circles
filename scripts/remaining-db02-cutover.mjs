#!/usr/bin/env node
/**
 * DB-02 protected cutover runner. It intentionally has no CLI arguments: URLs
 * and passwords are read only from protected process input and are never
 * printed, written, or copied into a child-process environment.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  DEDICATED_APP_LOGIN_ROLE,
  LEGACY_LOGIN_ROLE,
  RUNTIME_ROLE,
  getPostgresConnectionOptionsForLogin,
} from "../server/_core/postgres-config.mjs";

const { Client } = pg;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const remediationDirectory = resolve(root, "operations/remediation");
const ACTIONS = new Set([
  "preflight",
  "activate-temporary",
  "verify-dedicated",
  "rollback-detached",
]);
const ACTION_APPROVAL = "DB02_OPERATOR_APPROVED_V1";
const PROVISION_DEDICATED_PASSWORD_SQL = `
DO $db02_provision_dedicated_password$
DECLARE
  v_password text;
BEGIN
  v_password := pg_catalog.current_setting('circles.db02_provision_password', true);
  IF v_password IS NULL OR pg_catalog.octet_length(v_password) = 0 THEN
    RAISE EXCEPTION 'DB-02 dedicated password provisioning input is absent';
  END IF;

  -- The identifier is fixed in reviewed source. PostgreSQL utility statements
  -- cannot bind a password parameter directly, so %L is the server-side,
  -- literal-safe boundary after node-postgres supplied the value as $1.
  EXECUTE pg_catalog.format('ALTER ROLE circles_app_login PASSWORD %L', v_password);
END
$db02_provision_dedicated_password$;
`;

const protectedInputs = Object.freeze({
  CIRCLES_DB02_ACTION: process.env.CIRCLES_DB02_ACTION,
  CIRCLES_DB02_APPROVAL: process.env.CIRCLES_DB02_APPROVAL,
  SUPABASE_DATABASE_URL: process.env.SUPABASE_DATABASE_URL,
  CIRCLES_APP_DATABASE_URL: process.env.CIRCLES_APP_DATABASE_URL,
});

function protectedValue(name) {
  const value = protectedInputs[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing protected ${name} input`);
  }
  return value;
}

function assertNoCliArguments() {
  if (process.argv.length !== 2) {
    throw new Error(
      "DB-02 credentials and actions are accepted only from protected environment input",
    );
  }
}

function actionInput() {
  const action = protectedValue("CIRCLES_DB02_ACTION");
  if (!ACTIONS.has(action)) throw new Error("Unsupported DB-02 action");
  if (protectedValue("CIRCLES_DB02_APPROVAL") !== ACTION_APPROVAL) {
    throw new Error("DB-02 protected approval input is invalid");
  }
  return action;
}

function operationalOptions() {
  return getPostgresConnectionOptionsForLogin(
    protectedValue("SUPABASE_DATABASE_URL"),
    LEGACY_LOGIN_ROLE,
    root,
  );
}

function dedicatedOptions() {
  return getPostgresConnectionOptionsForLogin(
    protectedValue("CIRCLES_APP_DATABASE_URL"),
    DEDICATED_APP_LOGIN_ROLE,
    root,
    { requireSessionPooler: true },
  );
}

async function withClient(options, callback) {
  const client = new Client(options);
  try {
    await client.connect();
    return await callback(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function runOperationalSql(filename, action) {
  const sql = await readFile(resolve(remediationDirectory, filename), "utf8");
  await withClient(operationalOptions(), async (client) => {
    // The SQL verifies this explicit action string; it is an intentional-action
    // guard, not authorization or a secret.
    await client.query(
      "SELECT pg_catalog.set_config('circles.db02_cutover_action', $1, false)",
      [action],
    );
    await client.query(sql);
  });
}

async function provisionDedicatedPassword() {
  // Parse both protected inputs only in this short-lived operator process. The
  // password is passed as a node-postgres parameter, kept in transaction-local
  // server memory, and is neither interpolated into client SQL nor output.
  const dedicated = dedicatedOptions();
  const operational = operationalOptions();
  if (dedicated.password === operational.password) {
    throw new Error(
      "DB-02 dedicated password must differ from the operational password",
    );
  }

  await withClient(operational, async (client) => {
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query(
        "SELECT pg_catalog.set_config('circles.db02_provision_password', $1, true)",
        [dedicated.password],
      );
      await client.query(PROVISION_DEDICATED_PASSWORD_SQL);
      await client.query("COMMIT");
      transactionOpen = false;
    } catch {
      if (transactionOpen)
        await client.query("ROLLBACK").catch(() => undefined);
      throw new Error("DB-02 dedicated password provisioning failed");
    }
  });
}

function expectSingleTrue(row, keys) {
  return (
    row &&
    keys.every((key) => row[key] === true) &&
    Object.keys(row).every((key) => keys.includes(key))
  );
}

async function verifyDedicatedConnection() {
  await withClient(dedicatedOptions(), async (client) => {
    const initial = await client.query(`
      SELECT
        session_user = 'circles_app_login' AS dedicated_session_login,
        current_user = 'circles_app_login' AS dedicated_current_login,
        current_database() = 'postgres' AS expected_database,
        pg_catalog.has_database_privilege(
          'circles_app_login', pg_catalog.current_database(), 'CONNECT'
        ) AS can_connect,
        NOT pg_catalog.has_database_privilege(
          'circles_app_login', pg_catalog.current_database(), 'CREATE'
        ) AS cannot_create_database_objects,
        NOT pg_catalog.has_schema_privilege(
          'circles_app_login', 'circles_app', 'USAGE'
        ) AS no_direct_application_schema_usage
    `);
    if (
      !expectSingleTrue(initial.rows[0], [
        "dedicated_session_login",
        "dedicated_current_login",
        "expected_database",
        "can_connect",
        "cannot_create_database_objects",
        "no_direct_application_schema_usage",
      ])
    ) {
      throw new Error(
        "Dedicated connection did not authenticate as the approved app login",
      );
    }

    await client.query(`SET ROLE ${RUNTIME_ROLE}`);
    try {
      const runtime = await client.query(`
        SELECT
          session_user = 'circles_app_login' AS dedicated_session_retained,
          current_user = 'circles_app_runtime' AS runtime_role_active,
          pg_catalog.has_schema_privilege(current_user, 'circles_app', 'USAGE')
            AS app_schema_usage,
          pg_catalog.has_schema_privilege(current_user, 'circles_auth', 'USAGE')
            AS auth_schema_usage,
          pg_catalog.has_schema_privilege(current_user, 'circles_identity', 'USAGE')
            AS identity_schema_usage,
          pg_catalog.has_schema_privilege(current_user, 'circles_publish', 'USAGE')
            AS publish_schema_usage,
          pg_catalog.has_table_privilege(current_user, 'circles_app.users', 'SELECT')
            AS users_select,
          pg_catalog.has_table_privilege(current_user, 'circles_auth.oauth_pending_states', 'INSERT')
            AS oauth_pending_insert,
          pg_catalog.has_table_privilege(current_user, 'circles_identity.provider_links', 'INSERT')
            AS provider_links_insert,
          pg_catalog.has_table_privilege(current_user, 'circles_publish."postPublishReceipts"', 'UPDATE')
            AS receipt_update,
          NOT pg_catalog.has_table_privilege(current_user, 'circles_app.users', 'TRUNCATE')
            AS users_truncate_denied
      `);
      if (
        !expectSingleTrue(runtime.rows[0], [
          "dedicated_session_retained",
          "runtime_role_active",
          "app_schema_usage",
          "auth_schema_usage",
          "identity_schema_usage",
          "publish_schema_usage",
          "users_select",
          "oauth_pending_insert",
          "provider_links_insert",
          "receipt_update",
          "users_truncate_denied",
        ])
      ) {
        throw new Error("Dedicated runtime grant verification failed");
      }
    } finally {
      await client.query("RESET ROLE");
    }
  });
}

async function main() {
  assertNoCliArguments();
  const action = actionInput();

  if (action === "preflight") {
    await runOperationalSql("remaining_db02_preflight.sql", "PREFLIGHT_V1");
    console.log("DB-02 preflight passed; no role state was changed.");
    return;
  }
  if (action === "verify-dedicated") {
    await verifyDedicatedConnection();
    console.log(
      "DB-02 dedicated connection and runtime boundary verification passed.",
    );
    return;
  }
  if (action === "rollback-detached") {
    await runOperationalSql(
      "remaining_db02_rollback_detached.sql",
      "ROLLBACK_DETACHED_V1",
    );
    console.log(
      "DB-02 dedicated login returned to the detached NOLOGIN state.",
    );
    return;
  }

  // The role change itself is atomic. If the separate dedicated connection
  // cannot prove its authenticated identity and runtime boundary immediately
  // afterward, restore NOLOGIN before returning a generic failure.
  await provisionDedicatedPassword();
  await runOperationalSql(
    "remaining_db02_activate_temporary.sql",
    "ACTIVATE_TEMPORARY_V1",
  );
  try {
    await verifyDedicatedConnection();
  } catch {
    try {
      await runOperationalSql(
        "remaining_db02_rollback_detached.sql",
        "ROLLBACK_DETACHED_V1",
      );
    } catch {
      throw new Error(
        "DB-02 dedicated verification failed and automatic detachment could not be confirmed",
      );
    }
    throw new Error(
      "DB-02 dedicated verification failed; temporary login was returned to NOLOGIN",
    );
  }
  console.log(
    "DB-02 temporary activation and dedicated connection verification passed; application secret cutover remains parent-controlled.",
  );
}

main().catch(() => {
  // Database and driver errors can include connection material. Deliberately
  // emit no nested error, SQL text, DSN, role password, or provider response.
  console.error(
    "DB-02 protected cutover action failed without emitting credential details.",
  );
  process.exitCode = 1;
});
