#!/usr/bin/env node
/**
 * DB-04 opt-in disposable PostgreSQL 17 drill.
 *
 * It creates only a temporary loopback cluster and synthetic rows. It accepts no DSN, reads no
 * .env file, and has no provider or production connection path.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

if (process.env.CIRCLES_DB04_LOCAL_PG17 !== "1") {
  console.log(
    "SKIP: set CIRCLES_DB04_LOCAL_PG17=1 for the disposable local PostgreSQL 17 DB-04 drill",
  );
  process.exit(0);
}

const binDirectory = process.env.POSTGRES17_BIN ?? "/usr/lib/postgresql/17/bin";
const initdb = join(binDirectory, "initdb");
const pgCtl = join(binDirectory, "pg_ctl");
const sourceMigrations = [
  "operations/migrations/0004_circles_app_integrity.sql",
  "operations/migrations/0006_circles_profile_onboarding.sql",
  "operations/migrations/0008_circles_home.sql",
];
const validationMigrationPath =
  "operations/migrations/0016_circles_validate_constraints.sql";

const targetConstraints = [
  "circles_home_pinned_post_id_fkey",
  "circles_home_pinned_post_id_positive_check",
  "circles_home_rules_check",
  "circles_home_welcome_message_check",
  "conversations_kind_target_check",
  "follows_not_self_check",
  "messages_client_message_id_check",
  "messages_content_check",
  "profiles_onboarding_completion_check",
  "profiles_onboarding_interests_check",
  "profiles_onboarding_step_check",
];

const failingFixtures = [
  {
    name: "pinned_post_missing_target",
    code: "23503",
    sql: `INSERT INTO circles_app.circles
      (id, "welcomeMessage", rules, "pinnedPostId")
      VALUES (101, 'Valid', '[]'::jsonb, 999)`,
    retained: "SELECT 1 FROM circles_app.circles WHERE id = 101",
  },
  {
    name: "pinned_post_non_positive",
    code: "23514",
    sql: `INSERT INTO circles_app.circles
      (id, "welcomeMessage", rules, "pinnedPostId")
      VALUES (102, 'Valid', '[]'::jsonb, -1)`,
    retained: "SELECT 1 FROM circles_app.circles WHERE id = 102",
  },
  {
    name: "rules_duplicate_after_ascii_fold",
    code: "23514",
    sql: `INSERT INTO circles_app.circles
      (id, "welcomeMessage", rules, "pinnedPostId")
      VALUES (103, 'Valid', '["Rule", " rule "]'::jsonb, NULL)`,
    retained: "SELECT 1 FROM circles_app.circles WHERE id = 103",
  },
  {
    name: "welcome_message_over_limit",
    code: "23514",
    sql: `INSERT INTO circles_app.circles
      (id, "welcomeMessage", rules, "pinnedPostId")
      VALUES (104, repeat('x', 2001), '[]'::jsonb, NULL)`,
    retained: "SELECT 1 FROM circles_app.circles WHERE id = 104",
  },
  {
    name: "conversation_kind_target_mismatch",
    code: "23514",
    sql: `INSERT INTO circles_app.conversations (id, kind, "directKey", "circleId")
      VALUES (201, 'direct', NULL, NULL)`,
    retained: "SELECT 1 FROM circles_app.conversations WHERE id = 201",
  },
  {
    name: "follow_self",
    code: "23514",
    sql: `INSERT INTO circles_app.follows ("followerId", "followingId") VALUES (11, 11)`,
    retained: "SELECT 1 FROM circles_app.follows WHERE " + '"followerId" = 11 AND "followingId" = 11',
  },
  {
    name: "client_message_id_too_short",
    code: "23514",
    sql: `INSERT INTO circles_app.messages
      (id, "conversationId", "authorId", text, media, "clientMessageId")
      VALUES (301, 1, 1, 'Valid message', NULL, 'too-short')`,
    retained: "SELECT 1 FROM circles_app.messages WHERE id = 301",
  },
  {
    name: "message_without_text_or_media",
    code: "23514",
    sql: `INSERT INTO circles_app.messages
      (id, "conversationId", "authorId", text, media, "clientMessageId")
      VALUES (302, 1, 1, '   ', NULL, NULL)`,
    retained: "SELECT 1 FROM circles_app.messages WHERE id = 302",
  },
  {
    name: "onboarding_complete_without_timestamp",
    code: "23514",
    sql: `INSERT INTO circles_app.profiles
      (id, interests, "onboardingStep", "onboardingCompletedAt")
      VALUES (401, '["music"]'::jsonb, 'complete', NULL)`,
    retained: "SELECT 1 FROM circles_app.profiles WHERE id = 401",
  },
  {
    name: "onboarding_interest_not_allowlisted",
    code: "23514",
    sql: `INSERT INTO circles_app.profiles
      (id, interests, "onboardingStep", "onboardingCompletedAt")
      VALUES (402, '["unreviewed-interest"]'::jsonb, 'interests', NULL)`,
    retained: "SELECT 1 FROM circles_app.profiles WHERE id = 402",
  },
  {
    name: "onboarding_step_outside_enum",
    code: "23514",
    sql: `INSERT INTO circles_app.profiles
      (id, interests, "onboardingStep", "onboardingCompletedAt")
      VALUES (403, '["music"]'::jsonb, 'unknown-step', NULL)`,
    retained: "SELECT 1 FROM circles_app.profiles WHERE id = 403",
  },
];

function run(command, argumentsList) {
  const childEnvironment = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    LC_ALL: "C",
  };
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

function localClient(port) {
  return new pg.Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    database: "postgres",
  });
}

async function createBaseline(client, syntheticViolation = undefined) {
  await client.query("DROP SCHEMA IF EXISTS circles_app CASCADE");
  await client.query(`
    CREATE SCHEMA circles_app AUTHORIZATION postgres;
    CREATE TYPE circles_app.conversation_kind AS ENUM ('direct', 'circle');
    CREATE TYPE circles_app.membership_role AS ENUM ('owner', 'moderator', 'member');

    CREATE TABLE circles_app.users (id integer PRIMARY KEY);
    CREATE TABLE circles_app.posts (id integer PRIMARY KEY);
    CREATE TABLE circles_app.circles (
      id integer PRIMARY KEY,
      "welcomeMessage" text NOT NULL DEFAULT ''::text,
      rules jsonb NOT NULL DEFAULT '[]'::jsonb,
      "pinnedPostId" integer
    );
    CREATE TABLE circles_app.conversations (
      id integer PRIMARY KEY,
      kind circles_app.conversation_kind NOT NULL,
      "directKey" text,
      "circleId" integer
    );
    CREATE TABLE circles_app."conversationParticipants" (
      "conversationId" integer NOT NULL,
      "userId" integer NOT NULL
    );
    CREATE TABLE circles_app.memberships (
      "circleId" integer NOT NULL,
      "userId" integer NOT NULL,
      role circles_app.membership_role NOT NULL
    );
    CREATE TABLE circles_app.follows (
      "followerId" integer NOT NULL,
      "followingId" integer NOT NULL
    );
    CREATE TABLE circles_app.messages (
      id integer PRIMARY KEY,
      "conversationId" integer NOT NULL,
      "authorId" integer NOT NULL,
      text text NOT NULL,
      media jsonb,
      "clientMessageId" varchar(96)
    );
    CREATE TABLE circles_app."socialUploads" (id integer PRIMARY KEY);
    CREATE TABLE circles_app.profiles (
      id integer PRIMARY KEY,
      interests jsonb NOT NULL DEFAULT '[]'::jsonb,
      "onboardingStep" varchar(16) NOT NULL DEFAULT 'interests',
      "onboardingCompletedAt" timestamptz
    );
  `);

  // These rows predate the source migrations below and are therefore synthetic historical rows.
  await client.query(`
    INSERT INTO circles_app.users (id) VALUES (1), (2), (11), (12);
    INSERT INTO circles_app.posts (id) VALUES (-1), (1);
    INSERT INTO circles_app.circles (id, "welcomeMessage", rules, "pinnedPostId")
      VALUES (1, 'Welcome', '["Be kind", "Be curious"]'::jsonb, 1);
    INSERT INTO circles_app.conversations (id, kind, "directKey", "circleId")
      VALUES (1, 'direct', '1:2', NULL);
    INSERT INTO circles_app.follows ("followerId", "followingId") VALUES (11, 12);
    INSERT INTO circles_app.messages
      (id, "conversationId", "authorId", text, media, "clientMessageId")
      VALUES (1, 1, 1, 'Hello', NULL, NULL);
    INSERT INTO circles_app.profiles
      (id, interests, "onboardingStep", "onboardingCompletedAt")
      VALUES (1, '["music", "travel"]'::jsonb, 'interests', NULL);
  `);
  if (syntheticViolation) await client.query(syntheticViolation.sql);

  for (const migrationPath of sourceMigrations) {
    await client.query(await readFile(migrationPath, "utf8"));
  }
}

async function targetValidationStates(client) {
  const result = await client.query(`
    SELECT constraint_catalog.conname, constraint_catalog.convalidated
    FROM pg_catalog.pg_constraint AS constraint_catalog
    JOIN pg_catalog.pg_class AS relation_catalog
      ON relation_catalog.oid = constraint_catalog.conrelid
    JOIN pg_catalog.pg_namespace AS namespace_catalog
      ON namespace_catalog.oid = relation_catalog.relnamespace
    WHERE namespace_catalog.nspname = 'circles_app'
      AND constraint_catalog.conname = ANY($1::text[])
    ORDER BY constraint_catalog.conname
  `, [targetConstraints]);
  assert.equal(result.rowCount, targetConstraints.length);
  return result.rows;
}

async function expectErrorCode(operation, expectedCode) {
  await assert.rejects(operation, (error) => error?.code === expectedCode);
}

const directory = await mkdtemp(join(tmpdir(), "circles-db04-pg17-"));
const dataDirectory = join(directory, "data");
const port = await unusedLoopbackPort();
let admin;
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
  admin = localClient(port);
  await admin.connect();
  await admin.query(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE ROLE circles_app_runtime NOLOGIN NOINHERIT NOBYPASSRLS;
  `);

  const validationMigration = await readFile(validationMigrationPath, "utf8");

  await createBaseline(admin);
  await admin.query(validationMigration);
  const validated = await targetValidationStates(admin);
  assert.equal(validated.every((row) => row.convalidated === true), true);
  await admin.query(validationMigration);
  const validatedRerun = await targetValidationStates(admin);
  assert.equal(validatedRerun.every((row) => row.convalidated === true), true);
  console.log("PASS: valid historical fixture validates all eleven constraints and approved rerun is idempotent");

  for (const fixture of failingFixtures) {
    await createBaseline(admin, fixture);
    await expectErrorCode(() => admin.query(validationMigration), fixture.code);
    await admin.query("ROLLBACK");

    const states = await targetValidationStates(admin);
    assert.equal(
      states.every((row) => row.convalidated === false),
      true,
      `${fixture.name} must roll back every target validation`,
    );
    const retained = await admin.query(fixture.retained);
    assert.equal(retained.rowCount, 1, `${fixture.name} row must not be repaired`);
  }
  console.log("PASS: failing historical fixture leaves every target unvalidated and preserves the synthetic row");
} finally {
  if (admin) await admin.end().catch(() => undefined);
  if (serverStarted) {
    await run(pgCtl, ["-D", dataDirectory, "-m", "immediate", "-w", "stop"]).catch(
      () => undefined,
    );
  }
  await rm(directory, { recursive: true, force: true });
}
