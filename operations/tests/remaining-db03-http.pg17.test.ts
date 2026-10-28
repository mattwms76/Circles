import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * This opt-in drill is the only place that substitutes a loopback PG17
 * connection or creates synthetic signed sessions. No shipped module accepts a
 * test actor, a context flag, or a local connection escape hatch.
 */
const runtime = vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.MANUS_PROJECT_ID = "db03-http-pg17-synthetic";
  process.env.MANUS_JWT_SECRET =
    "db03-http-pg17-synthetic-session-signing-secret";
  process.env.MANUS_OAUTH_API_URL = "https://oauth.synthetic.invalid";
  process.env.MANUS_OAUTH_PORTAL_URL = "https://oauth.synthetic.invalid";
  return { port: 0 };
});

vi.mock("../../server/_core/postgres-config.mjs", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../server/_core/postgres-config.mjs")
    >();
  return {
    ...actual,
    getPostgresConnectionOptions: () => ({
      host: "127.0.0.1",
      port: runtime.port,
      user: "db03_actor_synthetic_login",
      database: "postgres",
      max: 2,
      idleTimeoutMillis: 0,
      connectionTimeoutMillis: 5_000,
    }),
  };
});

const enabled = process.env.CIRCLES_REMAINING_DB03_HTTP_PG17 === "1";
const describePg17 = enabled ? describe : describe.skip;
const postgresBin = "/usr/lib/postgresql/17/bin";
const initdb = join(postgresBin, "initdb");
const pgCtl = join(postgresBin, "pg_ctl");
const childEnvironment = {
  PATH: "/usr/lib/postgresql/17/bin:/usr/bin:/bin",
  LANG: "C",
  LC_ALL: "C",
  NODE_ENV: "test" as const,
};

type RunningHttp = {
  close: () => Promise<void>;
  origin: string;
};

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: childEnvironment,
      stdio: "pipe",
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => (output += String(chunk)));
    child.stderr?.on("data", (chunk: Buffer) => (output += String(chunk)));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(output);
      else
        reject(
          new Error(
            `${command} exited ${code ?? "unknown"}: ${output.slice(-1_200)}`,
          ),
        );
    });
  });
}

async function unusedLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  assert(address && typeof address === "object");
  await new Promise<void>((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise())),
  );
  return address.port;
}

async function startHttp(app: express.Express): Promise<RunningHttp> {
  const server = await new Promise<ReturnType<express.Express["listen"]>>(
    (resolvePromise) => {
      const listener = app.listen(0, "127.0.0.1", () =>
        resolvePromise(listener),
      );
    },
  );
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolvePromise, reject) =>
        server.close((error) => (error ? reject(error) : resolvePromise())),
      ),
  };
}

async function httpQuery(
  origin: string,
  procedure: string,
  input: unknown,
  bearer?: string,
): Promise<Response> {
  return fetch(
    `${origin}/api/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
    {
      headers: bearer ? { authorization: `Bearer ${bearer}` } : undefined,
    },
  );
}

async function httpMutation(
  origin: string,
  procedure: string,
  input: unknown,
  bearer: string,
): Promise<Response> {
  return fetch(`${origin}/api/trpc/${procedure}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ json: input }),
  });
}

const coveredTables: [string, string][] = [
  [
    "circles_app.profiles",
    `id integer primary key, "userId" integer not null, name text not null, handle text not null, bio text not null default '', avatar text not null default '', cover text, "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now(), interests jsonb not null default '[]'::jsonb, "onboardingStep" text not null default 'interests', "onboardingCompletedAt" timestamptz`,
  ],
  [
    "circles_app.circles",
    `id integer primary key, "ownerId" integer not null, name text not null default '', description text not null default '', category text not null default '', privacy text not null, image text not null default '', color text not null default '#ED604A', "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now(), "welcomeMessage" text not null default '', rules jsonb not null default '[]'::jsonb, "pinnedPostId" integer`,
  ],
  [
    "circles_app.memberships",
    `id integer primary key, "circleId" integer not null, "userId" integer not null, role text not null, "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now()`,
  ],
  [
    "circles_app.posts",
    `id integer primary key, "authorId" integer not null, "circleId" integer, text text not null default '', media text, "mediaType" text not null default 'text', "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now()`,
  ],
  [
    "circles_app.reactions",
    `id integer primary key, "postId" integer not null, "userId" integer not null`,
  ],
  [
    "circles_app.bookmarks",
    `id integer primary key, "postId" integer not null, "userId" integer not null`,
  ],
  [
    "circles_app.comments",
    `id integer primary key, "postId" integer not null, "authorId" integer not null`,
  ],
  [
    "circles_app.conversations",
    `id integer primary key, kind text not null, "directKey" text, "circleId" integer, "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now()`,
  ],
  [
    'circles_app."conversationParticipants"',
    `id integer primary key, "conversationId" integer not null, "userId" integer not null, "lastReadMessageId" integer not null default 0, "lastReadAt" timestamptz, "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now()`,
  ],
  [
    "circles_app.messages",
    `id integer primary key, "conversationId" integer not null, "authorId" integer not null, text text not null default '', media text, "createdAt" timestamptz not null default now(), "clientMessageId" text`,
  ],
  [
    "circles_app.follows",
    `id integer primary key, "followerId" integer not null, "followingId" integer not null`,
  ],
  [
    "circles_app.reports",
    `id integer primary key, "postId" integer not null, "reporterId" integer not null`,
  ],
  [
    'circles_app."socialUploads"',
    `id integer primary key, "userId" integer not null`,
  ],
  [
    'circles_app."activityItems"',
    `id integer primary key, "recipientId" integer not null, "actorId" integer, "circleId" integer, "postId" integer, "readAt" timestamptz`,
  ],
  ['circles_app."activityPreferences"', `"recipientId" integer primary key`],
  [
    'circles_app."activityCirclePreferences"',
    `"recipientId" integer not null, "circleId" integer not null, primary key ("recipientId", "circleId")`,
  ],
  [
    'circles_app."moderationCases"',
    `id integer primary key, "circleId" integer not null`,
  ],
  [
    'circles_app."moderationActions"',
    `id integer primary key, "caseId" integer not null, "reviewerId" integer`,
  ],
  [
    'circles_publish."postPublishReceipts"',
    `id bigint primary key, "actorId" integer not null`,
  ],
];

async function installSyntheticSchema(admin: pg.Client): Promise<void> {
  await admin.query(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE ROLE circles_app_runtime NOLOGIN NOINHERIT NOBYPASSRLS;
    CREATE ROLE db03_actor_synthetic_login LOGIN;
    GRANT circles_app_runtime TO db03_actor_synthetic_login;
    CREATE SCHEMA circles_app;
    CREATE SCHEMA circles_publish;
    CREATE SCHEMA circles_auth;
    GRANT USAGE ON SCHEMA circles_app, circles_publish, circles_auth TO circles_app_runtime;
    CREATE TABLE circles_app.users (
      id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      "openId" varchar(64) not null unique,
      name text,
      email text,
      "loginMethod" text,
      role text not null default 'user',
      "createdAt" timestamptz not null default now(),
      "updatedAt" timestamptz not null default now(),
      "lastSignedIn" timestamptz not null default now()
    );
    CREATE TABLE circles_app."applicationSessions" (
      "sessionFingerprint" varchar(64) primary key,
      "userOpenId" varchar(64) not null,
      "appId" varchar(128) not null,
      "expiresAt" timestamptz not null,
      "revokedAt" timestamptz,
      "createdAt" timestamptz not null default now()
    );
  `);
  for (const [relation, columns] of coveredTables) {
    await admin.query(`CREATE TABLE ${relation} (${columns});`);
  }
  await admin.query(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA circles_app TO circles_app_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA circles_publish TO circles_app_runtime;
  `);
  for (const [relation] of coveredTables) {
    const shortName = relation
      .split(".")
      .slice(1)
      .join(".")
      .replaceAll('"', "");
    const expectedName =
      {
        'circles_app."activityItems"': "runtime_activity_items_policy",
        'circles_app."activityPreferences"':
          "runtime_activity_preferences_policy",
        'circles_app."activityCirclePreferences"':
          "runtime_activity_circle_preferences_policy",
        'circles_app."moderationCases"': "runtime_moderation_cases_policy",
        'circles_app."moderationActions"': "runtime_moderation_actions_policy",
      }[relation] ?? `runtime_${shortName}_policy`;
    await admin.query(`ALTER TABLE ${relation} ENABLE ROW LEVEL SECURITY;`);
    if (relation === 'circles_publish."postPublishReceipts"') {
      await admin.query(`
        CREATE POLICY post_publish_receipts_runtime_insert ON ${relation} FOR INSERT TO circles_app_runtime WITH CHECK (true);
        CREATE POLICY post_publish_receipts_runtime_select ON ${relation} FOR SELECT TO circles_app_runtime USING (true);
        CREATE POLICY post_publish_receipts_runtime_update ON ${relation} FOR UPDATE TO circles_app_runtime USING (true) WITH CHECK (true);
      `);
    } else {
      await admin.query(
        `CREATE POLICY ${expectedName} ON ${relation} FOR ALL TO circles_app_runtime USING (true) WITH CHECK (true);`,
      );
    }
  }
  await admin.query(`
    DROP POLICY runtime_socialUploads_policy ON circles_app."socialUploads";
    CREATE POLICY runtime_social_uploads_policy ON circles_app."socialUploads" FOR ALL TO circles_app_runtime USING (true) WITH CHECK (true);
    DROP POLICY runtime_conversationParticipants_policy ON circles_app."conversationParticipants";
    CREATE POLICY runtime_conversation_participants_policy ON circles_app."conversationParticipants" FOR ALL TO circles_app_runtime USING (true) WITH CHECK (true);
    ALTER TABLE circles_app.users ENABLE ROW LEVEL SECURITY;
    CREATE POLICY runtime_users_policy ON circles_app.users FOR ALL TO circles_app_runtime USING (true) WITH CHECK (true);
    ALTER TABLE circles_app."applicationSessions" ENABLE ROW LEVEL SECURITY;
    CREATE POLICY runtime_application_sessions_policy ON circles_app."applicationSessions" FOR ALL TO circles_app_runtime USING (true) WITH CHECK (true);
  `);
  await admin.query(`
    INSERT INTO circles_app.users (id, "openId", name, role) VALUES
      (1, 'db03-owner', 'Owner', 'user'),
      (2, 'db03-member', 'Member', 'user'),
      (3, 'db03-outsider', 'Outsider', 'user');
    INSERT INTO circles_app.profiles (id, "userId", name, handle, bio, avatar) VALUES
      (1, 1, 'Owner', 'owner', '', ''),
      (2, 2, 'Member', 'member', '', ''),
      (3, 3, 'Outsider', 'outsider', '', '');
    INSERT INTO circles_app.circles (id, "ownerId", name, description, category, privacy) VALUES
      (10, 1, 'Public discovery', 'Public test circle', 'test', 'public'),
      (20, 1, 'Private member circle', 'Private test circle', 'test', 'private');
    INSERT INTO circles_app.memberships (id, "circleId", "userId", role) VALUES
      (1, 10, 1, 'owner'), (2, 20, 1, 'owner'), (3, 20, 2, 'member');
    INSERT INTO circles_app.conversations (id, kind, "directKey") VALUES (500, 'direct', '1:2');
    INSERT INTO circles_app."conversationParticipants" (id, "conversationId", "userId") VALUES
      (1, 500, 1), (2, 500, 2);
    INSERT INTO circles_app.messages (id, "conversationId", "authorId", text) VALUES
      (1, 500, 1, 'owner to member');
  `);
  const migration = await readFile(
    resolve("operations/remediation/remaining_db03_actor_rls.sql"),
    "utf8",
  );
  await admin.query("BEGIN");
  await admin.query(
    "SELECT pg_catalog.set_config('circles.db03_actor_rls_contract', 'DB03_ACTOR_RLS_APPROVED_V1', true)",
  );
  await admin.query(migration);
  await admin.query("COMMIT");
}

describePg17(
  "DB-03 real HTTP -> tRPC -> service -> PG17 actor rehearsal",
  () => {
    let directory = "";
    let admin: pg.Client | undefined;
    let http: RunningHttp | undefined;
    let started = false;
    let ownerToken = "";
    let memberToken = "";
    let outsiderToken = "";

    beforeAll(async () => {
      const { closePostgresPool, getDb } = await import("../../server/db");
      const { createContext } = await import("../../server/_core/context");
      const { sdk } = await import("../../server/_core/sdk");
      const { protectedProcedure, router } =
        await import("../../server/_core/trpc");
      const { socialRouter } = await import("../../server/social-router");

      directory = await mkdtemp(join(tmpdir(), "circles-db03-http-pg17-"));
      const dataDirectory = join(directory, "data");
      runtime.port = await unusedLoopbackPort();
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
        `-h 127.0.0.1 -p ${runtime.port} -k ${directory}`,
        "-w",
        "start",
      ]);
      started = true;
      admin = new pg.Client({
        host: "127.0.0.1",
        port: runtime.port,
        user: "postgres",
        database: "postgres",
      });
      await admin.connect();
      await installSyntheticSchema(admin);

      ownerToken = await sdk.createSessionToken("db03-owner", {
        name: "Owner",
        userId: 1,
      });
      memberToken = await sdk.createSessionToken("db03-member", {
        name: "Member",
        userId: 2,
      });
      outsiderToken = await sdk.createSessionToken("db03-outsider", {
        name: "Outsider",
        userId: 3,
      });
      await expect(sdk.verifySession(ownerToken)).resolves.toMatchObject({
        openId: "db03-owner",
        userId: 1,
      });
      await expect(sdk.verifySession(memberToken)).resolves.toMatchObject({
        openId: "db03-member",
        userId: 2,
      });
      await expect(sdk.verifySession(outsiderToken)).resolves.toMatchObject({
        openId: "db03-outsider",
        userId: 3,
      });

      const testRouter = router({
        social: socialRouter,
        db03: router({
          actorProbe: protectedProcedure.query(async () => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED" });
            const result = await db.execute(
              sql.raw(
                "SELECT current_setting('circles.actor_id', true) AS actor, current_setting('circles.actor_kind', true) AS kind",
              ),
            );
            return result.rows[0];
          }),
          failAfterInsert: protectedProcedure.mutation(async ({ ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED" });
            await db
              .insert((await import("../../drizzle/schema")).messages)
              .values({
                id: 2,
                conversationId: 500,
                authorId: ctx.user.id,
                text: "must roll back",
              });
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "synthetic rollback",
            });
          }),
        }),
      });
      const app = express();
      app.use(express.json());
      app.use(
        "/api/trpc",
        createExpressMiddleware({ router: testRouter, createContext }),
      );
      http = await startHttp(app);

      // The initial session bootstrap must be durable before the first HTTP call.
      const sessions = await admin.query(
        'SELECT count(*)::int AS count FROM circles_app."applicationSessions"',
      );
      expect(sessions.rows[0].count).toBe(3);

      // Generic source access is closed outside a system/actor transaction.
      expect(await getDb()).toBeNull();
      await closePostgresPool();
      await expect(sdk.verifySession(ownerToken)).resolves.toMatchObject({
        openId: "db03-owner",
        userId: 1,
      });
    }, 60_000);

    afterAll(async () => {
      const { closePostgresPool } = await import("../../server/db");
      await http?.close().catch(() => undefined);
      await closePostgresPool().catch(() => undefined);
      await admin?.end().catch(() => undefined);
      if (started) {
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
    }, 60_000);

    it("keeps approved guest public discovery, owner/member reads, and direct-message actor refusal on real HTTP", async () => {
      assert(http);
      const guest = await httpQuery(http.origin, "social.circles", {});
      expect(guest.status).toBe(200);
      const guestBody = (await guest.json()) as {
        result: { data: { json: { id: number; name: string }[] } };
      };
      expect(guestBody.result.data.json).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 10, name: "Public discovery" }),
        ]),
      );

      const actorProbe = await httpQuery(
        http.origin,
        "db03.actorProbe",
        {},
        ownerToken,
      );
      expect(actorProbe.status).toBe(200);
      const actorProbeBody = (await actorProbe.json()) as {
        result: { data: { json: { actor: string; kind: string } } };
      };
      expect(actorProbeBody.result.data.json).toEqual({
        actor: "1",
        kind: "user",
      });

      const ownerMembers = await httpQuery(
        http.origin,
        "social.members",
        { circleId: 20 },
        ownerToken,
      );
      expect(ownerMembers.status, await ownerMembers.clone().text()).toBe(200);
      const ownerMembersBody = (await ownerMembers.json()) as {
        result: { data: { json: { user: { id: number } }[] } };
      };
      expect(
        ownerMembersBody.result.data.json.map((row) => row.user.id).sort(),
      ).toEqual([1, 2]);

      const [ownerMessages, memberMessages] = await Promise.all([
        httpQuery(
          http.origin,
          "social.messages",
          { conversationId: 500 },
          ownerToken,
        ),
        httpQuery(
          http.origin,
          "social.messages",
          { conversationId: 500 },
          memberToken,
        ),
      ]);
      expect(ownerMessages.status).toBe(200);
      expect(memberMessages.status).toBe(200);
      const memberBody = (await memberMessages.json()) as {
        result: { data: { json: { author: { id: number }; text: string }[] } };
      };
      expect(memberBody.result.data.json).toEqual([
        expect.objectContaining({
          author: expect.objectContaining({ id: 1 }),
          text: "owner to member",
        }),
      ]);

      const outsider = await httpQuery(
        http.origin,
        "social.messages",
        { conversationId: 500 },
        outsiderToken,
      );
      expect(outsider.status).toBe(404);
      const outsiderBody = (await outsider.json()) as {
        error: { json: { data: { code: string } } };
      };
      expect(outsiderBody.error.json.data.code).toBe("NOT_FOUND");
    });

    it("rolls back a handled tRPC error and closes/reopens the runtime pool without actor leakage", async () => {
      assert(http && admin);
      const failed = await httpMutation(
        http.origin,
        "db03.failAfterInsert",
        undefined,
        ownerToken,
      );
      expect(failed.status).toBe(403);
      const writes = await admin.query(
        "SELECT count(*)::int AS count FROM circles_app.messages WHERE id = 2",
      );
      expect(writes.rows[0].count).toBe(0);

      const { closePostgresPool } = await import("../../server/db");
      const { createRuntimeRolePool } =
        await import("../../server/runtime-role-pool");
      await closePostgresPool();
      const pool = createRuntimeRolePool({
        host: "127.0.0.1",
        port: runtime.port,
        user: "db03_actor_synthetic_login",
        database: "postgres",
        max: 1,
        idleTimeoutMillis: 0,
      });
      try {
        const settings = await pool.query(
          "SELECT current_setting('circles.actor_id', true) AS actor, current_setting('circles.actor_kind', true) AS kind",
        );
        expect(settings.rows[0].actor).not.toBe("1");
        expect(settings.rows[0].actor).not.toBe("2");
        expect(settings.rows[0].actor).not.toBe("3");
        expect(settings.rows[0].kind).not.toBe("user");
      } finally {
        await pool.end();
      }
    });
  },
);
