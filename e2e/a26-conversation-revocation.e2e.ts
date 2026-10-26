#!/usr/bin/env node
/**
 * Opt-in, source-equivalent PostgreSQL 17 drill for A26-001.
 *
 * It proves the parent-circle lock ordering used by the conversation preview/message-page repair:
 * a concurrent membership removal cannot acquire its parent lock until the authorized read has
 * rechecked membership and selected its output. It never reads app credentials or contacts a
 * network service. Run with CIRCLES_A26_LOCAL_PG17=1 using tsx from the repository root.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

if (process.env.CIRCLES_A26_LOCAL_PG17 !== "1") {
  console.log(
    "SKIP: set CIRCLES_A26_LOCAL_PG17=1 for the disposable PostgreSQL 17 A26-001 drill",
  );
  process.exit(0);
}

const binDirectory = process.env.POSTGRES17_BIN ?? "/usr/lib/postgresql/17/bin";
const initdb = join(binDirectory, "initdb");
const pgCtl = join(binDirectory, "pg_ctl");

function run(command: string, argumentsList: string[]): Promise<string> {
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

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function expectPgError(
  operation: () => Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === code
    );
  });
}

function localClient(port: number): pg.Client {
  return new pg.Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    database: "postgres",
  });
}

async function main(): Promise<void> {
  const directory = await mkdtemp(
    join(tmpdir(), "circles-a26-conversation-pg17-"),
  );
  const dataDirectory = join(directory, "data");
  const port = await unusedPort();
  let admin: pg.Client | undefined;
  let reader: pg.Client | undefined;
  let remover: pg.Client | undefined;

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

    admin = localClient(port);
    await admin.connect();
    await admin.query(`
    CREATE SCHEMA circles_app;
    CREATE TABLE circles_app.circles (
      id integer PRIMARY KEY,
      name text NOT NULL
    );
    CREATE TABLE circles_app.memberships (
      circle_id integer NOT NULL,
      user_id integer NOT NULL,
      role text NOT NULL,
      PRIMARY KEY (circle_id, user_id)
    );
    CREATE TABLE circles_app.conversations (
      id integer PRIMARY KEY,
      circle_id integer NOT NULL
    );
    CREATE TABLE circles_app.messages (
      id integer PRIMARY KEY,
      conversation_id integer NOT NULL,
      text text NOT NULL
    );
    INSERT INTO circles_app.circles (id, name) VALUES (41, 'Lock-protected circle');
    INSERT INTO circles_app.memberships (circle_id, user_id, role) VALUES (41, 99, 'member');
    INSERT INTO circles_app.conversations (id, circle_id) VALUES (701, 41);
    INSERT INTO circles_app.messages (id, conversation_id, text) VALUES (9001, 701, 'private');
  `);

    reader = localClient(port);
    remover = localClient(port);
    await reader.connect();
    await remover.connect();

    // Equivalent to listConversations/listMessages: lock the parent, recheck current approval,
    // then select all viewer-facing preview/page fields without releasing that serialization point.
    await reader.query("BEGIN");
    await reader.query(
      "SELECT id FROM circles_app.circles WHERE id = 41 FOR UPDATE",
    );
    const membership = await reader.query(
      "SELECT role FROM circles_app.memberships WHERE circle_id = 41 AND user_id = 99",
    );
    assert.deepEqual(membership.rows, [{ role: "member" }]);

    // Equivalent to removeMember: it takes the same parent lock before deleting membership. The
    // timeout proves it cannot commit a revocation between the recheck and output selections.
    await remover.query("BEGIN");
    await remover.query("SET LOCAL lock_timeout = '100ms'");
    await expectPgError(
      () =>
        remover!.query(
          "SELECT id FROM circles_app.circles WHERE id = 41 FOR UPDATE",
        ),
      "55P03",
    );
    await remover.query("ROLLBACK");

    const preview = await reader.query(`
    SELECT circle.name, message.text
    FROM circles_app.conversations AS conversation
    JOIN circles_app.circles AS circle ON circle.id = conversation.circle_id
    JOIN circles_app.messages AS message ON message.conversation_id = conversation.id
    WHERE conversation.id = 701
  `);
    assert.deepEqual(preview.rows, [
      { name: "Lock-protected circle", text: "private" },
    ]);
    await reader.query("COMMIT");

    // Once the protected read releases its lock, removal may complete. A new membership-predicated
    // candidate query cannot return the circle conversation after revocation.
    await remover.query("BEGIN");
    await remover.query(
      "SELECT id FROM circles_app.circles WHERE id = 41 FOR UPDATE",
    );
    await remover.query(
      "DELETE FROM circles_app.memberships WHERE circle_id = 41 AND user_id = 99",
    );
    await remover.query("COMMIT");
    const visibleAfterRemoval = await admin.query(`
    SELECT conversation.id
    FROM circles_app.conversations AS conversation
    WHERE conversation.id = 701
      AND EXISTS (
        SELECT 1
        FROM circles_app.memberships AS membership
        WHERE membership.circle_id = conversation.circle_id
          AND membership.user_id = 99
          AND membership.role IN ('owner', 'moderator', 'member')
      )
  `);
    assert.deepEqual(visibleAfterRemoval.rows, []);
    console.log(
      "PASS: A26-001 PostgreSQL 17 parent-circle lock blocks in-flight removal until authorized preview/page selection, then excludes the revoked conversation",
    );
  } finally {
    if (reader) await reader.end().catch(() => undefined);
    if (remover) await remover.end().catch(() => undefined);
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
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
