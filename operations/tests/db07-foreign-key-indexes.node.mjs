import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const SQL_PATH = join(
  ROOT,
  "operations/remediation/db07_foreign_key_indexes.sql",
);
const SQL = readFileSync(SQL_PATH, "utf8");

const TARGETS = [
  [
    "circles_admin",
    "entity_state",
    "entity_state_updated_by_fkey",
    "updated_by",
    "circles_admin",
    "operators",
    "id",
    "circles_admin_entity_state_updated_by_fk_idx",
  ],
  [
    "circles_admin",
    "report_reviews",
    "report_reviews_reviewer_operator_id_fkey",
    "reviewer_operator_id",
    "circles_admin",
    "operators",
    "id",
    "circles_admin_report_reviews_reviewer_operator_id_fk_idx",
  ],
  [
    "circles_admin",
    "settings",
    "settings_updated_by_fkey",
    "updated_by",
    "circles_admin",
    "operators",
    "id",
    "circles_admin_settings_updated_by_fk_idx",
  ],
  [
    "circles_app",
    "circles",
    "circles_home_pinned_post_id_fkey",
    "pinnedPostId",
    "circles_app",
    "posts",
    "id",
    "circles_app_circles_pinned_post_id_fk_idx",
  ],
  [
    "circles_app",
    "comments",
    "comments_authorId_fkey",
    "authorId",
    "circles_app",
    "users",
    "id",
    "circles_app_comments_author_id_fk_idx",
  ],
  [
    "circles_app",
    "messages",
    "messages_authorId_fkey",
    "authorId",
    "circles_app",
    "users",
    "id",
    "circles_app_messages_author_id_fk_idx",
  ],
  [
    "circles_app",
    "moderationCases",
    "moderationCases_subjectUserId_fkey",
    "subjectUserId",
    "circles_app",
    "users",
    "id",
    "circles_app_moderation_cases_subject_user_id_fk_idx",
  ],
  [
    "circles_app",
    "reports",
    "reports_reporterId_fkey",
    "reporterId",
    "circles_app",
    "users",
    "id",
    "circles_app_reports_reporter_id_fk_idx",
  ],
  [
    "private",
    "store_transactions",
    "store_transactions_user_id_fkey",
    "user_id",
    "public",
    "profiles",
    "id",
    "private_store_transactions_user_id_fk_idx",
  ],
  [
    "public",
    "direct_messages",
    "direct_messages_recipient_id_fkey",
    "recipient_id",
    "public",
    "profiles",
    "id",
    "public_direct_messages_recipient_id_fk_idx",
  ],
  [
    "public",
    "posts",
    "posts_circle_id_fkey",
    "circle_id",
    "public",
    "circles",
    "id",
    "public_posts_circle_id_fk_idx",
  ],
  [
    "public",
    "posts",
    "posts_topic_id_fkey",
    "topic_id",
    "public",
    "circle_topics",
    "id",
    "public_posts_topic_id_fk_idx",
  ],
];

const SYNTHETIC_PG17_OPT_IN = process.env.DB07_RUN_SYNTHETIC_PG17 === "1";

function commandAvailable(command) {
  return (
    spawnSync(command, ["--version"], {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      encoding: "utf8",
    }).status === 0
  );
}

function syntheticPostgresAvailable() {
  return ["initdb", "pg_ctl", "psql"].every(commandAvailable);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      LANG: "C",
      LC_ALL: "C",
    },
    encoding: "utf8",
    timeout: options.timeout ?? 120_000,
  });

  if (!options.allowFailure && result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}):\n${result.stderr}\n${result.stdout}`,
    );
  }
  return result;
}

function q(identifier) {
  return /^[a-z_][a-z0-9_$]*$/.test(identifier)
    ? identifier
    : `"${identifier.replaceAll('"', '""')}"`;
}

function expectedDefinition([schema, table, , column, , , , index]) {
  return `CREATE INDEX ${index} ON ${schema}.${q(table)} USING btree (${q(column)})`;
}

async function unusedLoopbackPort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function psqlArgs(port, ...args) {
  return [
    "-X",
    "-h",
    "127.0.0.1",
    "-p",
    String(port),
    "-U",
    "postgres",
    "-d",
    "postgres",
    ...args,
  ];
}

const SYNTHETIC_BASELINE_SQL = `
CREATE SCHEMA circles_admin;
CREATE SCHEMA circles_app;
CREATE SCHEMA private;

CREATE TABLE circles_admin.operators (id bigint PRIMARY KEY);
CREATE TABLE circles_admin.entity_state (
  entity_kind text NOT NULL,
  entity_id text NOT NULL,
  updated_by bigint NOT NULL,
  PRIMARY KEY (entity_kind, entity_id),
  CONSTRAINT entity_state_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES circles_admin.operators(id) ON DELETE RESTRICT
);
CREATE TABLE circles_admin.report_reviews (
  id bigint PRIMARY KEY,
  reviewer_operator_id bigint NOT NULL,
  CONSTRAINT report_reviews_reviewer_operator_id_fkey FOREIGN KEY (reviewer_operator_id) REFERENCES circles_admin.operators(id) ON DELETE RESTRICT
);
CREATE TABLE circles_admin.settings (
  singleton boolean PRIMARY KEY,
  updated_by bigint,
  CONSTRAINT settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES circles_admin.operators(id) ON DELETE SET NULL
);

CREATE TABLE circles_app.users (id bigint PRIMARY KEY);
CREATE TABLE circles_app.posts (id bigint PRIMARY KEY);
CREATE TABLE circles_app.circles (
  id bigint PRIMARY KEY,
  "pinnedPostId" bigint,
  CONSTRAINT circles_home_pinned_post_id_fkey FOREIGN KEY ("pinnedPostId") REFERENCES circles_app.posts(id) ON DELETE SET NULL NOT VALID
);
CREATE TABLE circles_app.comments (
  id bigint PRIMARY KEY,
  "authorId" bigint NOT NULL,
  CONSTRAINT "comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES circles_app.users(id) ON DELETE CASCADE
);
CREATE TABLE circles_app.messages (
  id bigint PRIMARY KEY,
  "authorId" bigint NOT NULL,
  CONSTRAINT "messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES circles_app.users(id) ON DELETE CASCADE
);
CREATE TABLE circles_app."moderationCases" (
  id bigint PRIMARY KEY,
  "subjectUserId" bigint,
  CONSTRAINT "moderationCases_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES circles_app.users(id) ON DELETE SET NULL
);
CREATE TABLE circles_app.reports (
  id bigint PRIMARY KEY,
  "reporterId" bigint NOT NULL,
  CONSTRAINT "reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES circles_app.users(id) ON DELETE CASCADE
);

CREATE TABLE public.profiles (id bigint PRIMARY KEY);
CREATE TABLE private.store_transactions (
  store text NOT NULL,
  transaction_id text NOT NULL,
  user_id bigint NOT NULL,
  PRIMARY KEY (store, transaction_id),
  CONSTRAINT store_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);
CREATE TABLE public.direct_messages (
  id bigint PRIMARY KEY,
  recipient_id bigint NOT NULL,
  CONSTRAINT direct_messages_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);
CREATE TABLE public.circles (id bigint PRIMARY KEY);
CREATE TABLE public.circle_topics (id bigint PRIMARY KEY);
CREATE TABLE public.posts (
  id bigint PRIMARY KEY,
  circle_id bigint NOT NULL,
  topic_id bigint,
  CONSTRAINT posts_circle_id_fkey FOREIGN KEY (circle_id) REFERENCES public.circles(id) ON DELETE CASCADE,
  CONSTRAINT posts_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.circle_topics(id) ON DELETE SET NULL
);
`;

test("DB-07 static contract enumerates exactly the twelve audited child columns", () => {
  assert.equal(TARGETS.length, 12);
  assert.match(SQL, /psql-only, autocommit script/i);
  assert.match(SQL, /db07_confirm_no_transaction/);
  assert.match(SQL, /SET lock_timeout = '5s';/);
  assert.match(SQL, /SET statement_timeout = '30min';/);
  assert.match(SQL, /pg_try_advisory_lock/);
  assert.match(SQL, /pg_get_indexdef/);
  assert.match(SQL, /indisvalid/);
  assert.match(SQL, /indisready/);
  assert.match(SQL, /indislive/);
  assert.doesNotMatch(SQL, /^\s*(BEGIN|COMMIT)\s*;/im);
  assert.equal(
    (SQL.match(/CREATE INDEX CONCURRENTLY IF NOT EXISTS/g) ?? []).length,
    12,
  );

  for (const target of TARGETS) {
    const [
      schema,
      table,
      constraint,
      column,
      parentSchema,
      parentTable,
      parentColumn,
      index,
    ] = target;
    assert.match(
      SQL,
      new RegExp(
        `db07_assert_fk_index\\('${schema}', '${table}', '${constraint}', '${column}', '${parentSchema}', '${parentTable}', '${parentColumn}', '${index}', false\\)`,
      ),
    );
    assert.match(
      SQL,
      new RegExp(
        `db07_assert_fk_index\\('${schema}', '${table}', '${constraint}', '${column}', '${parentSchema}', '${parentTable}', '${parentColumn}', '${index}', true\\)`,
      ),
    );
    assert.match(
      SQL,
      new RegExp(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${index} ON`),
    );
    assert.ok(
      index.length <= 63,
      `${index} exceeds PostgreSQL's identifier limit`,
    );
  }
});

test(
  "DB-07 isolated PostgreSQL 17 drill validates mismatch rejection, no-transaction contract, exact definitions, and idempotence",
  {
    skip: SYNTHETIC_PG17_OPT_IN
      ? !syntheticPostgresAvailable() &&
        "PG17 initdb, pg_ctl, and psql are required for the explicitly requested drill"
      : "set DB07_RUN_SYNTHETIC_PG17=1 only in an authorized disposable-PG17 environment; no DSN is accepted",
  },
  async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "circles-db07-pg17-"));
    const dataDirectory = join(fixtureRoot, "data");
    const setupPath = join(fixtureRoot, "baseline.sql");
    const port = await unusedLoopbackPort();
    let started = false;

    try {
      writeFileSync(setupPath, SYNTHETIC_BASELINE_SQL, "utf8");
      run("initdb", [
        "-D",
        dataDirectory,
        "-U",
        "postgres",
        "--no-locale",
        "--encoding=UTF8",
        "--auth-local=trust",
        "--auth-host=trust",
      ]);
      run("pg_ctl", [
        "-D",
        dataDirectory,
        "-l",
        join(fixtureRoot, "postgres.log"),
        "-o",
        `-h 127.0.0.1 -p ${port} -k ${fixtureRoot}`,
        "-w",
        "start",
      ]);
      started = true;
      run("psql", psqlArgs(port, "-v", "ON_ERROR_STOP=1", "-f", setupPath));

      run(
        "psql",
        psqlArgs(
          port,
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          "CREATE INDEX circles_admin_entity_state_updated_by_fk_idx ON circles_admin.entity_state USING btree (entity_kind)",
        ),
      );
      const mismatch = run(
        "psql",
        psqlArgs(
          port,
          "-v",
          "ON_ERROR_STOP=1",
          "-v",
          "db07_confirm_no_transaction=1",
          "-f",
          SQL_PATH,
        ),
        { allowFailure: true },
      );
      assert.notEqual(mismatch.status, 0);
      assert.match(
        `${mismatch.stdout}\n${mismatch.stderr}`,
        /DB-07 index definition drift/,
      );
      run(
        "psql",
        psqlArgs(
          port,
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          "DROP INDEX circles_admin.circles_admin_entity_state_updated_by_fk_idx",
        ),
      );

      const transactional = run(
        "psql",
        psqlArgs(
          port,
          "-1",
          "-v",
          "ON_ERROR_STOP=1",
          "-v",
          "db07_confirm_no_transaction=1",
          "-f",
          SQL_PATH,
        ),
        { allowFailure: true },
      );
      assert.notEqual(transactional.status, 0);
      assert.match(
        `${transactional.stdout}\n${transactional.stderr}`,
        /cannot run inside a transaction block/,
      );

      run(
        "psql",
        psqlArgs(
          port,
          "-v",
          "ON_ERROR_STOP=1",
          "-v",
          "db07_confirm_no_transaction=1",
          "-f",
          SQL_PATH,
        ),
      );
      run(
        "psql",
        psqlArgs(
          port,
          "-v",
          "ON_ERROR_STOP=1",
          "-v",
          "db07_confirm_no_transaction=1",
          "-f",
          SQL_PATH,
        ),
      );

      const definitions = run(
        "psql",
        psqlArgs(
          port,
          "-A",
          "-F",
          "\t",
          "-t",
          "-c",
          `SELECT namespace.nspname, relation.relname, pg_get_indexdef(metadata.indexrelid)
             FROM pg_index AS metadata
             JOIN pg_class AS relation ON relation.oid = metadata.indexrelid
             JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
            WHERE (namespace.nspname, relation.relname) IN (${TARGETS.map(([schema, , , , , , , index]) => `('${schema}', '${index}')`).join(", ")})
            ORDER BY namespace.nspname, relation.relname`,
        ),
      )
        .stdout.trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("\t"));

      assert.equal(definitions.length, 12);
      const expected = new Map(
        TARGETS.map((target) => [
          `${target[0]}\t${target[7]}`,
          expectedDefinition(target),
        ]),
      );
      for (const [schema, index, definition] of definitions) {
        assert.equal(definition, expected.get(`${schema}\t${index}`));
      }
    } finally {
      if (started) {
        run("pg_ctl", ["-D", dataDirectory, "-m", "fast", "-w", "stop"], {
          allowFailure: true,
        });
      }
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  },
);
