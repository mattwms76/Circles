#!/usr/bin/env node
/**
 * DB-03 opt-in actor-scoped RLS drill.
 *
 * This starts a fresh PG17 cluster on loopback, creates only synthetic roles
 * and rows, applies the gated candidate SQL in one local transaction, and
 * removes the entire cluster in finally. It accepts no DSN and does not load
 * .env or inherited provider credentials.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pg from "pg";
import { tsImport } from "tsx/esm/api";

if (process.env.CIRCLES_REMAINING_DB03_LOCAL_PG17 !== "1") {
  console.log(
    "SKIP: set CIRCLES_REMAINING_DB03_LOCAL_PG17=1 for the isolated PG17 DB-03 actor/RLS drill",
  );
  process.exit(0);
}

const postgresBin = "/usr/lib/postgresql/17/bin";
const initdb = join(postgresBin, "initdb");
const pgCtl = join(postgresBin, "pg_ctl");
const runtimeRole = "circles_app_runtime";
const loginRole = "db03_actor_synthetic_login";
const childEnvironment = {
  PATH: "/usr/lib/postgresql/17/bin:/usr/bin:/bin",
  LANG: "C",
  LC_ALL: "C",
};
const migration = await readFile(
  resolve("operations/remediation/remaining_db03_actor_rls.sql"),
  "utf8",
);
const runtimePoolModule = await tsImport("../../server/runtime-role-pool.ts", {
  parentURL: import.meta.url,
});
const { RuntimeRolePool } = runtimePoolModule.default ?? runtimePoolModule;

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(output);
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

function adminClient(port) {
  return new pg.Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    database: "postgres",
  });
}

function runtimePool(port) {
  return new RuntimeRolePool({
    host: "127.0.0.1",
    port,
    user: loginRole,
    database: "postgres",
    max: 2,
    idleTimeoutMillis: 0,
    connectionTimeoutMillis: 5_000,
  });
}

async function withActor(pool, actor, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL circles.actor_id TO '${actor.id ?? 0}'`);
    await client.query(`SET LOCAL circles.actor_kind TO '${actor.kind}'`);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function tableRows(client, query, values = []) {
  return (await client.query(query, values)).rows;
}

const baseTables = [
  ["circles_app.profiles", '"userId" integer primary key'],
  [
    "circles_app.circles",
    'id integer primary key, "ownerId" integer not null, privacy text not null',
  ],
  [
    "circles_app.memberships",
    'id integer primary key, "circleId" integer not null, "userId" integer not null, role text not null',
  ],
  [
    "circles_app.posts",
    'id integer primary key, "authorId" integer not null, "circleId" integer',
  ],
  [
    "circles_app.reactions",
    'id integer primary key, "postId" integer not null, "userId" integer not null',
  ],
  [
    "circles_app.bookmarks",
    'id integer primary key, "postId" integer not null, "userId" integer not null',
  ],
  [
    "circles_app.comments",
    'id integer primary key, "postId" integer not null, "authorId" integer not null',
  ],
  [
    "circles_app.conversations",
    'id integer primary key, kind text not null, "directKey" text, "circleId" integer',
  ],
  [
    'circles_app."conversationParticipants"',
    'id integer primary key, "conversationId" integer not null, "userId" integer not null',
  ],
  [
    "circles_app.messages",
    'id integer primary key, "conversationId" integer not null, "authorId" integer not null',
  ],
  [
    "circles_app.follows",
    'id integer primary key, "followerId" integer not null, "followingId" integer not null',
  ],
  [
    "circles_app.reports",
    'id integer primary key, "postId" integer not null, "reporterId" integer not null',
  ],
  [
    'circles_app."socialUploads"',
    'id integer primary key, "userId" integer not null',
  ],
  [
    'circles_app."activityItems"',
    'id integer primary key, "recipientId" integer not null, "actorId" integer, "circleId" integer, "postId" integer, "readAt" timestamptz',
  ],
  ['circles_app."activityPreferences"', '"recipientId" integer primary key'],
  [
    'circles_app."activityCirclePreferences"',
    '"recipientId" integer not null, "circleId" integer not null, primary key ("recipientId", "circleId")',
  ],
  [
    'circles_app."moderationCases"',
    'id integer primary key, "circleId" integer not null',
  ],
  [
    'circles_app."moderationActions"',
    'id integer primary key, "caseId" integer not null, "reviewerId" integer',
  ],
  [
    'circles_publish."postPublishReceipts"',
    'id bigint primary key, "actorId" integer not null',
  ],
];

const directory = await mkdtemp(join(tmpdir(), "circles-remaining-db03-pg17-"));
const dataDirectory = join(directory, "data");
const port = await unusedLoopbackPort();
let admin;
let pool;
let started = false;

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
  started = true;
  admin = adminClient(port);
  await admin.connect();
  await admin.query(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE ROLE ${runtimeRole} NOLOGIN NOINHERIT NOBYPASSRLS;
    CREATE ROLE ${loginRole} LOGIN;
    GRANT ${runtimeRole} TO ${loginRole};
    CREATE SCHEMA circles_app;
    CREATE SCHEMA circles_publish;
    GRANT USAGE ON SCHEMA circles_app, circles_publish TO ${runtimeRole};
    CREATE TABLE circles_app.users (id integer primary key, role text not null);
  `);
  for (const [relation, columns] of baseTables) {
    await admin.query(`CREATE TABLE ${relation} (${columns});`);
  }
  await admin.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA circles_app TO ${runtimeRole};`,
  );
  await admin.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA circles_publish TO ${runtimeRole};`,
  );
  for (const [relation] of baseTables) {
    const shortName = relation
      .split(".")
      .slice(1)
      .join(".")
      .replaceAll('"', "");
    await admin.query(`ALTER TABLE ${relation} ENABLE ROW LEVEL SECURITY;`);
    if (relation === 'circles_publish."postPublishReceipts"') {
      await admin.query(
        `CREATE POLICY post_publish_receipts_runtime_insert ON ${relation} FOR INSERT TO ${runtimeRole} WITH CHECK (true);`,
      );
      await admin.query(
        `CREATE POLICY post_publish_receipts_runtime_select ON ${relation} FOR SELECT TO ${runtimeRole} USING (true);`,
      );
      await admin.query(
        `CREATE POLICY post_publish_receipts_runtime_update ON ${relation} FOR UPDATE TO ${runtimeRole} USING (true) WITH CHECK (true);`,
      );
    } else {
      const expectedName =
        {
          'circles_app."activityItems"': "runtime_activity_items_policy",
          'circles_app."activityPreferences"':
            "runtime_activity_preferences_policy",
          'circles_app."activityCirclePreferences"':
            "runtime_activity_circle_preferences_policy",
          'circles_app."moderationCases"': "runtime_moderation_cases_policy",
          'circles_app."moderationActions"':
            "runtime_moderation_actions_policy",
        }[relation] ?? `runtime_${shortName}_policy`;
      await admin.query(
        `CREATE POLICY ${expectedName} ON ${relation} FOR ALL TO ${runtimeRole} USING (true) WITH CHECK (true);`,
      );
    }
  }
  // The policy names for quoted social tables are source names rather than the fixture shorthand.
  await admin.query(
    `DROP POLICY runtime_socialUploads_policy ON circles_app."socialUploads"; CREATE POLICY runtime_social_uploads_policy ON circles_app."socialUploads" FOR ALL TO ${runtimeRole} USING (true) WITH CHECK (true);`,
  );
  await admin.query(
    `DROP POLICY runtime_conversationParticipants_policy ON circles_app."conversationParticipants"; CREATE POLICY runtime_conversation_participants_policy ON circles_app."conversationParticipants" FOR ALL TO ${runtimeRole} USING (true) WITH CHECK (true);`,
  );

  await admin.query(`
    INSERT INTO circles_app.users (id, role) VALUES (1, 'user'), (2, 'user'), (3, 'user'), (99, 'admin');
    INSERT INTO circles_app.profiles ("userId") VALUES (1), (2), (3);
    INSERT INTO circles_app.circles (id, "ownerId", privacy) VALUES (10, 1, 'public'), (20, 1, 'private');
    INSERT INTO circles_app.memberships (id, "circleId", "userId", role) VALUES
      (1, 10, 1, 'owner'), (2, 10, 2, 'member'), (3, 20, 1, 'owner'), (4, 20, 2, 'moderator');
    INSERT INTO circles_app.posts (id, "authorId", "circleId") VALUES (100, 1, NULL), (101, 1, 10), (102, 1, 20);
    INSERT INTO circles_app.reactions (id, "postId", "userId") VALUES (1, 102, 1);
    INSERT INTO circles_app.bookmarks (id, "postId", "userId") VALUES (1, 102, 1);
    INSERT INTO circles_app.comments (id, "postId", "authorId") VALUES (1, 102, 1);
    INSERT INTO circles_app.conversations (id, kind, "directKey", "circleId") VALUES
      (500, 'direct', '1:2', NULL), (501, 'direct', '1:3', NULL);
    INSERT INTO circles_app."conversationParticipants" (id, "conversationId", "userId") VALUES (1, 500, 1), (2, 500, 2), (3, 501, 3);
    INSERT INTO circles_app.messages (id, "conversationId", "authorId") VALUES (1, 500, 1);
    INSERT INTO circles_app.follows (id, "followerId", "followingId") VALUES (1, 1, 2);
    INSERT INTO circles_app.reports (id, "postId", "reporterId") VALUES (1, 102, 2);
    INSERT INTO circles_app."socialUploads" (id, "userId") VALUES (1, 1);
    INSERT INTO circles_app."activityItems" (id, "recipientId", "actorId", "circleId", "postId") VALUES (1, 1, 2, 20, 102);
    INSERT INTO circles_app."activityPreferences" ("recipientId") VALUES (1);
    INSERT INTO circles_app."activityCirclePreferences" ("recipientId", "circleId") VALUES (1, 20);
    INSERT INTO circles_app."moderationCases" (id, "circleId") VALUES (1, 20);
    INSERT INTO circles_app."moderationActions" (id, "caseId", "reviewerId") VALUES (1, 1, 1);
    INSERT INTO circles_publish."postPublishReceipts" (id, "actorId") VALUES (1, 1);
  `);

  await assert.rejects(
    () => admin.query(migration),
    /requires explicit owner transaction approval/,
  );
  await admin.query("BEGIN");
  await admin.query(
    "SELECT pg_catalog.set_config('circles.db03_actor_rls_contract', 'DB03_ACTOR_RLS_APPROVED_V1', true)",
  );
  await admin.query(migration);
  await admin.query("COMMIT");
  console.log(
    "PASS: explicit gate rejects unapproved execution and installs concrete scoped policies only when locally approved",
  );

  pool = runtimePool(port);
  pool.on("error", () => undefined);

  const noContext = await pool.query(
    'SELECT count(*)::int AS count FROM circles_app."socialUploads"',
  );
  assert.equal(noContext.rows[0].count, 0);

  const guestPosts = await withActor(pool, { kind: "guest" }, (client) =>
    tableRows(client, "SELECT id FROM circles_app.posts ORDER BY id"),
  );
  assert.deepEqual(
    guestPosts.map((row) => row.id),
    [100, 101],
  );

  const memberPrivatePosts = await withActor(
    pool,
    { kind: "user", id: 2 },
    (client) =>
      tableRows(client, "SELECT id FROM circles_app.posts WHERE id = 102"),
  );
  assert.equal(memberPrivatePosts.length, 1);
  const outsiderPrivatePosts = await withActor(
    pool,
    { kind: "user", id: 3 },
    (client) =>
      tableRows(client, "SELECT id FROM circles_app.posts WHERE id = 102"),
  );
  assert.equal(outsiderPrivatePosts.length, 0);
  console.log(
    "PASS: guest public discovery remains available; non-member private post access is refused",
  );

  const outsiderMessages = await withActor(
    pool,
    { kind: "user", id: 3 },
    (client) =>
      tableRows(
        client,
        'SELECT id FROM circles_app.messages WHERE "conversationId" = 500',
      ),
  );
  assert.equal(outsiderMessages.length, 0);
  await assert.rejects(
    () =>
      withActor(pool, { kind: "user", id: 3 }, (client) =>
        client.query(
          'INSERT INTO circles_app.messages (id, "conversationId", "authorId") VALUES (2, 500, 1)',
        ),
      ),
    /row-level security policy/,
  );
  await assert.rejects(
    () =>
      withActor(pool, { kind: "user", id: 3 }, (client) =>
        client.query(
          'INSERT INTO circles_app."conversationParticipants" (id, "conversationId", "userId") VALUES (4, 500, 3)',
        ),
      ),
    /row-level security policy/,
  );
  await assert.rejects(
    () =>
      withActor(pool, { kind: "user", id: 2 }, (client) =>
        client.query(
          "UPDATE circles_app.memberships SET role = 'owner' WHERE id = 4",
        ),
      ),
    /DB-03 runtime actor may not change this membership role/,
  );

  const foreignUploadDelete = await withActor(
    pool,
    { kind: "user", id: 2 },
    (client) =>
      tableRows(
        client,
        'DELETE FROM circles_app."socialUploads" WHERE "userId" = 1 RETURNING id',
      ),
  );
  assert.equal(foreignUploadDelete.length, 0);
  const foreignActivityUpdate = await withActor(
    pool,
    { kind: "user", id: 2 },
    (client) =>
      tableRows(
        client,
        'UPDATE circles_app."activityItems" SET "readAt" = now() WHERE "recipientId" = 1 RETURNING id',
      ),
  );
  assert.equal(foreignActivityUpdate.length, 0);
  const ownerReceipt = await withActor(
    pool,
    { kind: "user", id: 1 },
    (client) =>
      tableRows(client, 'SELECT id FROM circles_publish."postPublishReceipts"'),
  );
  assert.equal(ownerReceipt.length, 1);
  const foreignReceipt = await withActor(
    pool,
    { kind: "user", id: 2 },
    (client) =>
      tableRows(client, 'SELECT id FROM circles_publish."postPublishReceipts"'),
  );
  assert.equal(foreignReceipt.length, 0);
  console.log(
    "PASS: cross-actor message, upload, activity, and bigint receipt access is refused by RLS",
  );

  const concurrent = await Promise.all([
    withActor(pool, { kind: "user", id: 1 }, async (client) => {
      const before = await tableRows(
        client,
        "SELECT current_setting('circles.actor_id') AS actor",
      );
      await client.query("SELECT pg_sleep(0.04)");
      const after = await tableRows(
        client,
        "SELECT current_setting('circles.actor_id') AS actor",
      );
      return [before[0].actor, after[0].actor];
    }),
    withActor(pool, { kind: "user", id: 2 }, async (client) => {
      const before = await tableRows(
        client,
        "SELECT current_setting('circles.actor_id') AS actor",
      );
      await client.query("SELECT pg_sleep(0.02)");
      const after = await tableRows(
        client,
        "SELECT current_setting('circles.actor_id') AS actor",
      );
      return [before[0].actor, after[0].actor];
    }),
  ]);
  assert.deepEqual(concurrent, [
    ["1", "1"],
    ["2", "2"],
  ]);
  const afterRelease = await pool.query(
    "SELECT current_setting('circles.actor_id', true) AS actor, current_setting('circles.actor_kind', true) AS kind",
  );
  // PostgreSQL may retain a custom-GUC placeholder as an empty string after
  // SET LOCAL. Neither prior user value may survive, and the policy's earlier
  // no-context query proves that the empty/null state is fail-closed.
  assert.notEqual(afterRelease.rows[0].actor, "1");
  assert.notEqual(afterRelease.rows[0].actor, "2");
  assert.notEqual(afterRelease.rows[0].kind, "user");
  console.log(
    "PASS: concurrent transaction-local actors stay isolated and pool cleanup leaves no usable actor setting",
  );
} finally {
  if (pool) await pool.end().catch(() => undefined);
  if (admin) await admin.end().catch(() => undefined);
  if (started) {
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
