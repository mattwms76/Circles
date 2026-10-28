#!/usr/bin/env node
/**
 * Opt-in, disposable PG17 HTTP drill for the email/password REST routes.
 *
 * This fixture applies the repository's PostgreSQL baseline and reviewed private
 * migrations through 0014 to a new loopback-only cluster. It uses a mocked
 * in-process provider boundary only; it never reads application/provider
 * credentials, accepts a DSN, or opens a network connection outside 127.0.0.1.
 *
 * Run from the repository root with the pinned runtime:
 *   env -i HOME=/home/ubuntu \
 *     PATH=/home/ubuntu/.cache/circles-node-runtime/node-v22.23.4-linux-x64/bin:/usr/bin:/bin \
 *     LANG=C.UTF-8 CI=1 CIRCLES_EMAIL_AUTH_LOCAL_PG17=1 \
 *     POSTGRES17_BIN=/usr/lib/postgresql/17/bin \
 *     node --import tsx scripts/run-email-auth-http-e2e.mjs
 */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const OPT_IN_ENV = "CIRCLES_EMAIL_AUTH_LOCAL_PG17";
const REQUIRED_NODE_VERSION = "v22.23.4";
const LOOPBACK_HOST = "127.0.0.1";
const RESERVED_PORTS = new Set([3000, 8081]);
const PROJECT_ROOT = process.cwd();
const POSTGRES_BIN = process.env.POSTGRES17_BIN ?? "/usr/lib/postgresql/17/bin";
const INITDB = join(POSTGRES_BIN, "initdb");
const PG_CTL = join(POSTGRES_BIN, "pg_ctl");
const MAX_PROCESS_OUTPUT_BYTES = 4096;
const TOOL_TIMEOUT_MS = 30_000;
const RUNNER_TIMEOUT_MS = 5 * 60_000;
const SYNTHETIC_AUTH_URL = "https://vvclcsqletcxzoaayqzq.supabase.co";
const SYNTHETIC_PUBLISHABLE_KEY =
  "sb_publishable_synthetic_email_http_pg17_key_20261026";
const SYNTHETIC_PROJECT_ID = "circles-email-http-pg17-fixture";
const SYNTHETIC_JWT_SECRET =
  "synthetic-local-only-jwt-secret-never-used-outside-this-disposable-fixture";
const SYNTHETIC_OWNER_OPEN_ID = "fixture-owner";
const SYNTHETIC_WEB_ORIGIN = "https://web.synthetic.invalid";
const PROVIDER_ACCESS_TOKEN =
  "provider-fixture-access-token-not-a-real-credential";

// This is the reviewed local-fixture ordering from the Circle Home PG17 E2E
// harness, extended with the current email-identity migration. It applies the
// actual migration sources, not a hand-written table substitute.
const FIXTURE_MIGRATIONS = [
  "drizzle/postgres/0000_circles_app.sql",
  "operations/migrations/0001_circles_ops_daily_migration_health.sql",
  "operations/migrations/0002_circles_auth_oauth_pending.sql",
  "operations/migrations/0004_circles_app_integrity.sql",
  "operations/migrations/0005_circles_message_trigger_least_privilege.sql",
  "operations/migrations/0003_circles_ops_history_fallback.sql",
  "operations/migrations/0006_circles_profile_onboarding.sql",
  "operations/migrations/0007_circles_ops_onboarding_health.sql",
  "operations/migrations/0008_circles_home.sql",
  "operations/migrations/0009_circles_ops_circle_home_health.sql",
  "operations/migrations/0010_circles_activity_inbox.sql",
  "operations/migrations/0011_circles_ops_activity_health.sql",
  "operations/migrations/0012_circles_moderation.sql",
  "operations/migrations/0013_circles_ops_moderation_health.sql",
  "operations/migrations/0014_circles_email_identity.sql",
];

const subjects = {
  source: "7a8b4821-a2bf-4a84-8dd7-e9f2723e5eb1",
  unconfirmed: "1b8b4821-a2bf-4a84-8dd7-e9f2723e5eb1",
  collision: "2b8b4821-a2bf-4a84-8dd7-e9f2723e5eb1",
  actor: "3b8b4821-a2bf-4a84-8dd7-e9f2723e5eb1",
  secondActor: "4b8b4821-a2bf-4a84-8dd7-e9f2723e5eb1",
  runtime: "5b8b4821-a2bf-4a84-8dd7-e9f2723e5eb1",
};

const fixtureEnvironment = {
  CIRCLES_EMAIL_AUTH_ENABLED: "true",
  CIRCLES_PLATFORM_SETTINGS_ENABLED: "true",
  SUPABASE_AUTH_URL: SYNTHETIC_AUTH_URL,
  SUPABASE_AUTH_PUBLISHABLE_KEY: SYNTHETIC_PUBLISHABLE_KEY,
  MANUS_PROJECT_ID: SYNTHETIC_PROJECT_ID,
  MANUS_JWT_SECRET: SYNTHETIC_JWT_SECRET,
  MANUS_OAUTH_API_URL: "http://127.0.0.1:1",
  OWNER_OPEN_ID: SYNTHETIC_OWNER_OPEN_ID,
  FRONTEND_ORIGIN: SYNTHETIC_WEB_ORIGIN,
  NODE_ENV: "test",
};

const fixtureTrustedOperations = new Set([
  "application-session-persistence",
  "email-identity-readiness",
  "verified-email-identity",
]);

async function runFixtureTrustedDatabaseTransaction(operation, work) {
  // This disposable suite owns its restricted RuntimeRolePool instead of
  // server/db's configured runtime pool. Keep the fixture seam closed so an
  // unexpected direct-server operation cannot silently gain local access.
  assert(fixtureTrustedOperations.has(operation));
  return work();
}

if (process.env[OPT_IN_ENV] !== "1") {
  console.log(
    "SKIP: set CIRCLES_EMAIL_AUTH_LOCAL_PG17=1 for the disposable local PostgreSQL 17 email-auth HTTP drill",
  );
  process.exit(0);
}

function safeFailureCategory(error) {
  if (error && typeof error === "object" && "name" in error) {
    const name = error.name;
    if (typeof name === "string" && /^[A-Za-z0-9_]+$/.test(name)) return name;
  }
  return "LocalFixtureError";
}

function toolEnvironment(directory) {
  return {
    HOME: directory,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: `${POSTGRES_BIN}:/usr/bin:/bin`,
  };
}

function boundedProcess(
  command,
  args,
  environment,
  timeoutMs = TOOL_TIMEOUT_MS,
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let outputBytes = 0;
    let settled = false;
    const onOutput = (chunk) => {
      outputBytes = Math.min(
        MAX_PROCESS_OUTPUT_BYTES,
        outputBytes + Buffer.byteLength(chunk),
      );
    };
    child.stdout.on("data", onOutput);
    child.stderr.on("data", onOutput);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (!settled) {
        settled = true;
        reject(new Error("LocalFixtureProcessTimeout"));
      }
    }, timeoutMs);
    child.once("error", () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(new Error("LocalFixtureProcessError"));
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      // Output is intentionally neither surfaced nor persisted: subprocesses
      // receive no secrets, and a failure must not make future additions leak any.
      void outputBytes;
      if (code === 0) resolve();
      else reject(new Error("LocalFixtureProcessFailed"));
    });
  });
}

async function assertLocalPostgres17(directory) {
  if (process.version !== REQUIRED_NODE_VERSION) {
    throw new Error("PinnedNodeRuntimeRequired");
  }
  await boundedProcess(INITDB, ["--version"], toolEnvironment(directory));
  const version = await new Promise((resolve, reject) => {
    const child = spawn(INITDB, ["--version"], {
      cwd: PROJECT_ROOT,
      env: toolEnvironment(directory),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 256)
        stdout += String(chunk).slice(0, 256 - stdout.length);
    });
    child.once("error", () => reject(new Error("PostgresVersionUnavailable")));
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error("PostgresVersionUnavailable"));
    });
  });
  if (!String(version).includes("(PostgreSQL) 17.")) {
    throw new Error("Postgres17Required");
  }
}

async function unusedLoopbackPort() {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const reservation = createNetServer();
    await new Promise((resolve, reject) => {
      reservation.once("error", reject);
      reservation.listen(0, LOOPBACK_HOST, resolve);
    });
    const address = reservation.address();
    assert(address && typeof address === "object");
    const port = address.port;
    await new Promise((resolve, reject) =>
      reservation.close((error) => (error ? reject(error) : resolve())),
    );
    if (!RESERVED_PORTS.has(port)) return port;
  }
  throw new Error("EphemeralPortUnavailable");
}

function localClient(port) {
  return new pg.Client({
    host: LOOPBACK_HOST,
    port,
    user: "postgres",
    database: "postgres",
  });
}

async function expectPgError(operation, code) {
  await assert.rejects(operation, (error) => error?.code === code);
}

async function countRows(admin, statement, values = []) {
  const result = await admin.query(statement, values);
  return Number(result.rows[0]?.count ?? 0);
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Strict in-process provider boundary. It accepts only the four public auth
 * requests used by this API and makes no network call itself.
 */
function createMockProvider() {
  const usersByEmail = new Map([
    [
      "source@example.test",
      {
        password: "source-fixture-password",
        id: subjects.source,
        email: "source@example.test",
        confirmed: true,
        name: "Source Fixture",
      },
    ],
    [
      "unconfirmed@example.test",
      {
        password: "unconfirmed-fixture-password",
        id: subjects.unconfirmed,
        email: "unconfirmed@example.test",
        confirmed: false,
        name: "Unconfirmed Fixture",
      },
    ],
    [
      "collision@example.test",
      {
        password: "collision-fixture-password",
        id: subjects.collision,
        email: "collision@example.test",
        confirmed: true,
        name: "Collision Fixture",
      },
    ],
    [
      "actor@example.test",
      {
        password: "actor-fixture-password",
        id: subjects.actor,
        email: "actor@example.test",
        confirmed: true,
        name: "Actor Fixture",
      },
    ],
    [
      "second-actor@example.test",
      {
        password: "second-actor-fixture-password",
        id: subjects.secondActor,
        email: "second-actor@example.test",
        confirmed: true,
        name: "Second Actor Fixture",
      },
    ],
  ]);
  const calls = { settings: 0, token: 0, user: 0, signup: 0 };
  let authenticatedUser = null;

  return {
    calls,
    async fetchImpl(input, init = {}) {
      const url = new URL(String(input));
      assert.equal(url.origin, SYNTHETIC_AUTH_URL);
      assert.equal(url.username, "");
      assert.equal(url.password, "");
      assert.equal(
        new Headers(init.headers).get("apikey"),
        SYNTHETIC_PUBLISHABLE_KEY,
      );

      if (url.pathname === "/auth/v1/settings" && url.search === "") {
        assert.equal(init.method, "GET");
        assert.equal(new Headers(init.headers).get("authorization"), null);
        calls.settings += 1;
        return jsonResponse({ external: { email: true } });
      }

      if (
        url.pathname === "/auth/v1/token" &&
        url.search === "?grant_type=password"
      ) {
        assert.equal(init.method, "POST");
        calls.token += 1;
        const body = JSON.parse(String(init.body));
        const candidate =
          body && typeof body.email === "string"
            ? usersByEmail.get(body.email)
            : null;
        if (!candidate || body.password !== candidate.password) {
          authenticatedUser = null;
          return new Response(null, { status: 400 });
        }
        authenticatedUser = candidate;
        return jsonResponse({ access_token: PROVIDER_ACCESS_TOKEN });
      }

      if (url.pathname === "/auth/v1/user" && url.search === "") {
        assert.equal(init.method, "GET");
        assert.equal(
          new Headers(init.headers).get("authorization"),
          `Bearer ${PROVIDER_ACCESS_TOKEN}`,
        );
        calls.user += 1;
        if (!authenticatedUser) return new Response(null, { status: 401 });
        return jsonResponse({
          id: authenticatedUser.id,
          email: authenticatedUser.email,
          ...(authenticatedUser.confirmed
            ? {
                email_confirmed_at: "2026-10-26T00:00:00.000Z",
                identities: [{ provider: "email" }],
              }
            : {
                email_confirmed_at: null,
                identities: [{ provider: "email" }],
              }),
          user_metadata: { full_name: authenticatedUser.name },
        });
      }

      if (url.pathname === "/auth/v1/signup" && url.search === "") {
        assert.equal(init.method, "POST");
        calls.signup += 1;
        return jsonResponse({
          id: "provider-response-is-intentionally-ignored",
        });
      }

      throw new Error("UnexpectedMockProviderPath");
    },
  };
}

async function applyFixtureSchema(admin) {
  await admin.query(`
    CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
    CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
    CREATE ROLE service_role NOLOGIN NOSUPERUSER NOBYPASSRLS;
  `);
  for (const migration of FIXTURE_MIGRATIONS) {
    await admin.query(await readFile(join(PROJECT_ROOT, migration), "utf8"));
  }

  // This fixture-only feature reader makes the real transaction-aware source
  // allocation exercise the active/open registration gate. It is not a source
  // migration, application configuration, or production setting.
  await admin.query(`
    CREATE SCHEMA circles_admin AUTHORIZATION postgres;
    CREATE TABLE circles_admin.feature_state (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      registrations_open boolean NOT NULL,
      available boolean NOT NULL
    );
    INSERT INTO circles_admin.feature_state (singleton, registrations_open, available)
      VALUES (true, true, true);
    CREATE FUNCTION circles_admin.read_mobile_feature_settings()
      RETURNS jsonb
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog, circles_admin
      AS $$
      DECLARE settings jsonb;
      BEGIN
        SELECT CASE WHEN feature_state.available THEN jsonb_build_object(
          'registrationsOpen', feature_state.registrations_open,
          'circleCreationEnabled', true,
          'liveStreamingEnabled', true,
          'maintenanceMode', false,
          'maxUploadMb', 20
        ) ELSE NULL END
          INTO settings
          FROM circles_admin.feature_state AS feature_state
          WHERE feature_state.singleton
          FOR SHARE;
        RETURN settings;
      END;
      $$;
    REVOKE ALL ON SCHEMA circles_admin
      FROM PUBLIC, anon, authenticated, service_role, circles_app_runtime;
    GRANT USAGE ON SCHEMA circles_admin TO circles_app_runtime;
    REVOKE ALL ON FUNCTION circles_admin.read_mobile_feature_settings() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION circles_admin.read_mobile_feature_settings()
      TO circles_app_runtime;

    INSERT INTO circles_app.users (id, "openId", name, email, "loginMethod", role)
      VALUES
        (100, 'fixture-owner', 'Fixture owner', 'owner@example.test', 'manus', 'admin'),
        (101, 'fixture-actor-a', 'Fixture actor A', 'actor-a@example.test', 'manus', 'user'),
        (102, 'fixture-actor-b', 'Fixture actor B', 'actor-b@example.test', 'manus', 'admin'),
        (103, 'legacy:collision', 'Legacy collision', 'collision@example.test', 'manus', 'user');
    SELECT pg_catalog.setval('circles_app.users_id_seq', 103, true);
  `);
}

async function startLoopbackHttp(app) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const server = await new Promise((resolve, reject) => {
      const listener = app.listen(0, LOOPBACK_HOST, () => resolve(listener));
      listener.once("error", reject);
    });
    const address = server.address();
    assert(address && typeof address === "object");
    if (!RESERVED_PORTS.has(address.port)) {
      return { server, baseUrl: `http://${LOOPBACK_HOST}:${address.port}` };
    }
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  throw new Error("HttpEphemeralPortUnavailable");
}

function loopbackRequest(baseUrl, path, method, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(path, baseUrl);
    assert.equal(target.protocol, "http:");
    assert.equal(target.hostname, LOOPBACK_HOST);
    assert(target.port && !RESERVED_PORTS.has(Number(target.port)));
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers = {
      accept: "application/json",
      ...extraHeaders,
      ...(payload === undefined
        ? {}
        : {
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(payload)),
          }),
    };
    const request = httpRequest(target, { method, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    request.once("error", reject);
    if (payload !== undefined) request.write(payload);
    request.end();
  });
}

function parseJson(response) {
  return JSON.parse(response.body);
}

function assertNoProviderToken(response) {
  assert.equal(response.body.includes(PROVIDER_ACCESS_TOKEN), false);
}

async function closeHttpServer(server) {
  if (!server) return;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function runDrill() {
  const startedAt = Date.now();
  const evidence = {
    suite: "email-auth-http-local-pg17",
    executed: false,
    passed: false,
    state: "unfinished",
    postgres_major: 17,
    production_access: false,
    production_writes: false,
    provider_boundary: "in-process-mock",
    credential_free: true,
    schema_fixture:
      "actual drizzle/postgres/0000 baseline plus reviewed operations migrations 0001-0014",
    migration_count: FIXTURE_MIGRATIONS.length,
    actual_case_count: 0,
    cleanup: {
      http_server_closed: false,
      runtime_pool_closed: false,
      postgres_stopped: false,
      disposable_fixture_removed: false,
    },
  };
  let directory;
  let postgresStarted = false;
  let admin;
  let runtimePool;
  let httpServer;

  try {
    if (
      !FIXTURE_MIGRATIONS.every(
        (path) =>
          path.startsWith("drizzle/") ||
          path.startsWith("operations/migrations/"),
      )
    ) {
      throw new Error("UnexpectedFixtureMigrationPath");
    }
    directory = await mkdtemp(join(tmpdir(), "circles-email-auth-http-pg17-"));
    await chmod(directory, 0o700);
    await assertLocalPostgres17(directory);
    const port = await unusedLoopbackPort();
    const dataDirectory = join(directory, "data");

    await boundedProcess(
      INITDB,
      [
        "-D",
        dataDirectory,
        "-A",
        "trust",
        "-U",
        "postgres",
        "--no-locale",
        "-E",
        "UTF8",
      ],
      toolEnvironment(directory),
    );
    await boundedProcess(
      PG_CTL,
      [
        "-D",
        dataDirectory,
        "-o",
        `-h ${LOOPBACK_HOST} -p ${port} -k ${directory}`,
        "-w",
        "start",
      ],
      toolEnvironment(directory),
    );
    postgresStarted = true;
    admin = localClient(port);
    await admin.connect();
    await applyFixtureSchema(admin);

    // All imported modules read this synthetic-only environment at import time.
    // Explicitly remove external database variables instead of accepting them.
    delete process.env.DATABASE_URL;
    delete process.env.SUPABASE_DATABASE_URL;
    Object.assign(process.env, fixtureEnvironment);

    const [
      expressModule,
      drizzleModule,
      runtimeModule,
      identityModule,
      sessionModule,
      sdkModule,
      emailAuthModule,
      cookieModule,
      drizzleOrm,
      coreSchema,
      sessionSchema,
      liveSchema,
      activitySchema,
      moderationSchema,
      joseModule,
    ] = await Promise.all([
      import("express"),
      import("drizzle-orm/node-postgres"),
      import("../server/runtime-role-pool.ts"),
      import("../server/_core/email-identity.ts"),
      import("../server/_core/application-sessions.ts"),
      import("../server/_core/sdk.ts"),
      import("../server/_core/email-auth.ts"),
      import("../server/_core/cookies.ts"),
      import("drizzle-orm"),
      import("../drizzle/schema.ts"),
      import("../drizzle/session-schema.ts"),
      import("../drizzle/live-schema.ts"),
      import("../drizzle/activity-schema.ts"),
      import("../drizzle/moderation-schema.ts"),
      import("jose"),
    ]);
    const express = expressModule.default;
    const { drizzle } = drizzleModule;
    const { RuntimeRolePool } = runtimeModule;
    const { EmailIdentityStore } = identityModule;
    const { DrizzleApplicationSessionStore, fingerprintApplicationSession } =
      sessionModule;
    const { SDKServer } = sdkModule;
    const { registerEmailAuthRoutes, EMAIL_AUTH_JSON_BODY_LIMIT } =
      emailAuthModule;
    const { clearAcceptedSessionCookies } = cookieModule;
    const { eq } = drizzleOrm;
    const { users } = coreSchema;
    const { decodeJwt } = joseModule;

    runtimePool = new RuntimeRolePool({
      host: LOOPBACK_HOST,
      port,
      user: "postgres",
      database: "postgres",
      max: 8,
    });
    // Match server/db.ts rather than supplying a narrow test-only schema. This
    // keeps the injected local getter source-equivalent to CirclesDatabase.
    const databaseSchema = {
      ...coreSchema,
      ...liveSchema,
      ...sessionSchema,
      ...activitySchema,
      ...moderationSchema,
    };
    const database = drizzle(runtimePool, { schema: databaseSchema });
    const identityStore = new EmailIdentityStore({
      getDatabase: async () => database,
      runTrustedDatabaseTransaction: runFixtureTrustedDatabaseTransaction,
    });
    const localSessionStore = new DrizzleApplicationSessionStore({
      getDatabase: async () => database,
      runTrustedDatabaseTransaction: runFixtureTrustedDatabaseTransaction,
    });
    // This is the production SDK signing/verifying/revoking implementation. The
    // supplied store is a durable Drizzle store pointed only at the local fixture.
    const sdkServer = new SDKServer(undefined, localSessionStore);

    // Fixture-only actor lookup adapter. Production authenticateRequest resolves
    // users through its global database getter, which is deliberately not injected.
    // This adapter still invokes the real SDK verifySession path and performs the
    // actor lookup/binding check against the real fixture Drizzle database.
    const fixtureSdkAdapter = {
      createSessionToken: sdkServer.createSessionToken.bind(sdkServer),
      async authenticateRequest(req) {
        const authorization = req.headers.authorization;
        const token =
          typeof authorization === "string" &&
          authorization.startsWith("Bearer ")
            ? authorization.slice("Bearer ".length).trim()
            : undefined;
        const session = await sdkServer.verifySession(token);
        if (!session) throw new Error("FixtureSessionRejected");
        const rows = await database
          .select({ id: users.id, openId: users.openId, name: users.name })
          .from(users)
          .where(eq(users.openId, session.openId))
          .limit(1);
        const actor = rows[0];
        if (
          !actor ||
          !Number.isSafeInteger(session.userId) ||
          session.userId < 1 ||
          actor.id !== session.userId
        ) {
          throw new Error("FixtureActorBindingRejected");
        }
        return actor;
      },
    };

    const provider = createMockProvider();
    const app = express();
    app.use("/api/auth/email", (req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      if (req.method === "POST" && !req.is("application/json")) {
        res.status(415).json({
          error: "Email authentication request was not accepted",
          code: "REQUEST_NOT_ACCEPTED",
        });
        return;
      }
      next();
    });
    app.use(
      "/api/auth/email",
      express.json({ limit: EMAIL_AUTH_JSON_BODY_LIMIT }),
    );
    registerEmailAuthRoutes(app, {
      fetchImpl: provider.fetchImpl,
      identityStore,
      sdkServer: fixtureSdkAdapter,
      environment: fixtureEnvironment,
    });
    // This endpoint is intentionally fixture-only. It mirrors the production
    // logout mutation's real SDK revocation and production cookie-clearing helper;
    // it is not a production route or a claim that tRPC routing is exercised here.
    app.post("/fixture/logout", async (req, res) => {
      try {
        await sdkServer.revokeRequestSessions(req);
        // The production mutation's finally runs before tRPC serializes its
        // response. The direct fixture route must clear before res.json() too.
        clearAcceptedSessionCookies(req, res);
        res.setHeader("Cache-Control", "no-store");
        res.json({ success: true });
      } catch (error) {
        clearAcceptedSessionCookies(req, res);
        throw error;
      }
    });
    const listening = await startLoopbackHttp(app);
    httpServer = listening.server;
    const { baseUrl } = listening;

    const runCase = async (work) => {
      await work();
      evidence.actual_case_count += 1;
    };

    await runCase(async () => {
      const response = await loopbackRequest(
        baseUrl,
        "/api/auth/email/status",
        "GET",
      );
      assert.equal(response.status, 200);
      assert.deepEqual(parseJson(response), {
        enabled: true,
        ready: true,
        emailEnabled: true,
        googleEnabled: false,
        confirmationRequired: true,
      });
      assert.equal(provider.calls.settings, 1);
    });

    await runCase(async () => {
      const beforeUsers = await countRows(
        admin,
        `SELECT count(*) FROM circles_app.users
         WHERE "openId" = $1`,
        [`supabase:${subjects.source}`],
      );
      const beforeLinks = await countRows(
        admin,
        `SELECT count(*) FROM circles_identity.provider_links
         WHERE provider_subject = $1::uuid`,
        [subjects.source],
      );
      const response = await loopbackRequest(
        baseUrl,
        "/api/auth/email/sign-in",
        "POST",
        {
          email: "source@example.test",
          password: "incorrect-synthetic-password",
          client: "native",
        },
      );
      assert.equal(response.status, 401);
      assert.deepEqual(parseJson(response), {
        error: "Invalid email or password",
        code: "INVALID_CREDENTIALS",
      });
      assert.equal(
        await countRows(
          admin,
          `SELECT count(*) FROM circles_app.users WHERE "openId" = $1`,
          [`supabase:${subjects.source}`],
        ),
        beforeUsers,
      );
      assert.equal(
        await countRows(
          admin,
          `SELECT count(*) FROM circles_identity.provider_links
           WHERE provider_subject = $1::uuid`,
          [subjects.source],
        ),
        beforeLinks,
      );
    });

    await runCase(async () => {
      const response = await loopbackRequest(
        baseUrl,
        "/api/auth/email/sign-in",
        "POST",
        {
          email: "unconfirmed@example.test",
          password: "unconfirmed-fixture-password",
          client: "native",
        },
      );
      assert.equal(response.status, 401);
      assert.deepEqual(parseJson(response), {
        error: "Invalid email or password",
        code: "INVALID_CREDENTIALS",
      });
      assert.equal(
        await countRows(
          admin,
          `SELECT count(*) FROM circles_app.users WHERE "openId" = $1`,
          [`supabase:${subjects.unconfirmed}`],
        ),
        0,
      );
      assert.equal(
        await countRows(
          admin,
          `SELECT count(*) FROM circles_identity.provider_links
           WHERE provider_subject = $1::uuid`,
          [subjects.unconfirmed],
        ),
        0,
      );
    });

    let firstSourceToken;
    let secondSourceToken;
    await runCase(async () => {
      const first = await loopbackRequest(
        baseUrl,
        "/api/auth/email/sign-in",
        "POST",
        {
          email: "source@example.test",
          password: "source-fixture-password",
          client: "native",
        },
      );
      assert.equal(first.status, 200);
      assertNoProviderToken(first);
      const firstBody = parseJson(first);
      assert.equal(firstBody.success, true);
      assert.equal(typeof firstBody.sessionToken, "string");
      firstSourceToken = firstBody.sessionToken;
      const firstSession = await sdkServer.verifySession(firstSourceToken);
      assert(firstSession);
      assert.equal(firstSession.openId, `supabase:${subjects.source}`);
      assert.equal(firstSession.userId, 104);

      const second = await loopbackRequest(
        baseUrl,
        "/api/auth/email/sign-in",
        "POST",
        {
          email: "source@example.test",
          password: "source-fixture-password",
          client: "native",
        },
      );
      assert.equal(second.status, 200);
      assertNoProviderToken(second);
      const secondBody = parseJson(second);
      assert.equal(secondBody.success, true);
      assert.equal(typeof secondBody.sessionToken, "string");
      secondSourceToken = secondBody.sessionToken;
      assert.notEqual(firstSourceToken, secondSourceToken);
      assert.notEqual(
        decodeJwt(firstSourceToken).jti,
        decodeJwt(secondSourceToken).jti,
      );
      const secondSession = await sdkServer.verifySession(secondSourceToken);
      assert(secondSession);
      assert.equal(secondSession.userId, 104);

      const sourceRows = await admin.query(
        `SELECT id, role::text AS role, "loginMethod" AS "loginMethod"
         FROM circles_app.users
         WHERE "openId" = $1`,
        [`supabase:${subjects.source}`],
      );
      assert.deepEqual(sourceRows.rows, [
        { id: 104, role: "user", loginMethod: "email" },
      ]);
      assert.equal(
        await countRows(
          admin,
          `SELECT count(*) FROM circles_identity.provider_links
           WHERE provider_subject = $1::uuid AND user_id = 104`,
          [subjects.source],
        ),
        1,
      );
      assert.equal(
        await countRows(
          admin,
          `SELECT count(*) FROM circles_app."applicationSessions"
           WHERE "userOpenId" = $1`,
          [`supabase:${subjects.source}`],
        ),
        2,
      );
    });

    await runCase(async () => {
      const response = await loopbackRequest(
        baseUrl,
        "/api/auth/email/sign-up",
        "POST",
        { email: "signup@example.test", password: "signup-fixture-password" },
        { origin: SYNTHETIC_WEB_ORIGIN, "sec-fetch-site": "same-site" },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(parseJson(response), {
        success: true,
        confirmationRequired: true,
      });
      assertNoProviderToken(response);
      assert.equal(provider.calls.signup, 1);
    });

    await runCase(async () => {
      const response = await loopbackRequest(
        baseUrl,
        "/api/auth/email/sign-in",
        "POST",
        {
          email: "collision@example.test",
          password: "collision-fixture-password",
          client: "native",
        },
      );
      assert.equal(response.status, 409);
      assert.deepEqual(parseJson(response), {
        error: "Email identity requires account linking",
        code: "LINK_REQUIRED",
      });
      assert.equal(
        await countRows(
          admin,
          `SELECT count(*) FROM circles_app.users
           WHERE lower(email) = lower($1)`,
          ["collision@example.test"],
        ),
        1,
      );
      assert.equal(
        await countRows(
          admin,
          `SELECT count(*) FROM circles_identity.provider_links
           WHERE provider_subject = $1::uuid`,
          [subjects.collision],
        ),
        0,
      );
    });

    let actorAToken;
    let actorBToken;
    await runCase(async () => {
      const withoutBearer = await loopbackRequest(
        baseUrl,
        "/api/auth/email/connect",
        "POST",
        {
          email: "actor@example.test",
          password: "actor-fixture-password",
          client: "native",
        },
      );
      assert.equal(withoutBearer.status, 401);
      assert.deepEqual(parseJson(withoutBearer), {
        error: "Not authenticated",
        code: "NOT_AUTHENTICATED",
      });

      actorAToken = await sdkServer.createSessionToken("fixture-actor-a", {
        userId: 101,
        name: "Fixture actor A",
      });
      const forgedCallerId = await loopbackRequest(
        baseUrl,
        "/api/auth/email/connect",
        "POST",
        {
          email: "actor@example.test",
          password: "actor-fixture-password",
          client: "native",
          userId: 102,
        },
        { authorization: `Bearer ${actorAToken}` },
      );
      // Fixed credential-body validation rejects caller-supplied identity before
      // the provider or fixture actor lookup can treat it as authority.
      assert.equal(forgedCallerId.status, 401);
      assert.deepEqual(parseJson(forgedCallerId), {
        error: "Invalid email or password",
        code: "INVALID_CREDENTIALS",
      });
      assert.equal(
        await countRows(
          admin,
          `SELECT count(*) FROM circles_identity.provider_links
           WHERE provider_subject = $1::uuid`,
          [subjects.actor],
        ),
        0,
      );
    });

    await runCase(async () => {
      const response = await loopbackRequest(
        baseUrl,
        "/api/auth/email/connect",
        "POST",
        {
          email: "actor@example.test",
          password: "actor-fixture-password",
          client: "native",
        },
        { authorization: `Bearer ${actorAToken}` },
      );
      assert.equal(response.status, 200);
      assertNoProviderToken(response);
      const body = parseJson(response);
      assert.equal(body.success, true);
      assert.equal(typeof body.sessionToken, "string");
      const session = await sdkServer.verifySession(body.sessionToken);
      assert(session);
      assert.equal(session.openId, "fixture-actor-a");
      assert.equal(session.userId, 101);
      assert.equal(
        await countRows(
          admin,
          `SELECT count(*) FROM circles_identity.provider_links
           WHERE provider_subject = $1::uuid AND user_id = 101`,
          [subjects.actor],
        ),
        1,
      );
    });

    await runCase(async () => {
      actorBToken = await sdkServer.createSessionToken("fixture-actor-b", {
        userId: 102,
        name: "Fixture actor B",
      });
      const subjectConflict = await loopbackRequest(
        baseUrl,
        "/api/auth/email/connect",
        "POST",
        {
          email: "actor@example.test",
          password: "actor-fixture-password",
          client: "native",
        },
        { authorization: `Bearer ${actorBToken}` },
      );
      assert.equal(subjectConflict.status, 409);
      assert.deepEqual(parseJson(subjectConflict), {
        error: "Email identity requires account linking",
        code: "LINK_REQUIRED",
      });

      const userConflict = await loopbackRequest(
        baseUrl,
        "/api/auth/email/connect",
        "POST",
        {
          email: "second-actor@example.test",
          password: "second-actor-fixture-password",
          client: "native",
        },
        { authorization: `Bearer ${actorAToken}` },
      );
      assert.equal(userConflict.status, 409);
      assert.deepEqual(parseJson(userConflict), {
        error: "Email identity requires account linking",
        code: "LINK_REQUIRED",
      });

      const actorRows = await admin.query(`
        SELECT id, role::text AS role, "loginMethod" AS "loginMethod"
        FROM circles_app.users
        WHERE id IN (101, 102)
        ORDER BY id
      `);
      assert.deepEqual(actorRows.rows, [
        { id: 101, role: "user", loginMethod: "manus" },
        { id: 102, role: "admin", loginMethod: "manus" },
      ]);
      assert.equal(
        await countRows(
          admin,
          `SELECT count(*) FROM circles_identity.provider_links
           WHERE provider_subject IN ($1::uuid, $2::uuid)`,
          [subjects.actor, subjects.secondActor],
        ),
        1,
      );
    });

    await runCase(async () => {
      const mismatchedActorToken = await sdkServer.createSessionToken(
        "fixture-actor-a",
        { userId: 102, name: "Fixture actor A" },
      );
      const response = await loopbackRequest(
        baseUrl,
        "/api/auth/email/connect",
        "POST",
        {
          email: "second-actor@example.test",
          password: "second-actor-fixture-password",
          client: "native",
        },
        { authorization: `Bearer ${mismatchedActorToken}` },
      );
      assert.equal(response.status, 401);
      assert.deepEqual(parseJson(response), {
        error: "Not authenticated",
        code: "NOT_AUTHENTICATED",
      });
    });

    await runCase(async () => {
      const response = await loopbackRequest(
        baseUrl,
        "/fixture/logout",
        "POST",
        undefined,
        { authorization: `Bearer ${firstSourceToken}` },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(parseJson(response), { success: true });
      assertNoProviderToken(response);
      const cleared = response.headers["set-cookie"];
      assert(Array.isArray(cleared));
      assert(
        cleared.some((cookie) => cookie.startsWith("webdev_app_session=")),
      );
      assert(cleared.every((cookie) => cookie.includes("HttpOnly")));
      assert.equal(await sdkServer.verifySession(firstSourceToken), null);
      assert(await sdkServer.verifySession(secondSourceToken));

      const firstSessionId = decodeJwt(firstSourceToken).jti;
      const secondSessionId = decodeJwt(secondSourceToken).jti;
      assert.equal(typeof firstSessionId, "string");
      assert.equal(typeof secondSessionId, "string");
      const firstFingerprint = fingerprintApplicationSession(firstSessionId);
      const secondFingerprint = fingerprintApplicationSession(secondSessionId);
      const revocationRows = await admin.query(
        `SELECT "sessionFingerprint", "revokedAt"
         FROM circles_app."applicationSessions"
         WHERE "sessionFingerprint" = ANY($1::varchar[])
         ORDER BY "sessionFingerprint"`,
        [[firstFingerprint, secondFingerprint]],
      );
      assert.equal(revocationRows.rows.length, 2);
      const revokedByFingerprint = new Map(
        revocationRows.rows.map((row) => [
          row.sessionFingerprint,
          row.revokedAt,
        ]),
      );
      assert.notEqual(revokedByFingerprint.get(firstFingerprint), null);
      assert.equal(revokedByFingerprint.get(secondFingerprint), null);
      assert.equal(
        Array.from(revokedByFingerprint.values()).filter(
          (revokedAt) => revokedAt !== null,
        ).length,
        1,
      );

      const sessionRows = await admin.query(
        `SELECT "sessionFingerprint", "userOpenId", "appId"
         FROM circles_app."applicationSessions"`,
      );
      assert(
        sessionRows.rows.every(
          (row) =>
            !Object.values(row).some((value) =>
              String(value).includes(PROVIDER_ACCESS_TOKEN),
            ),
        ),
      );
    });

    await runCase(async () => {
      const metadata = await admin.query(`
        SELECT relrowsecurity AS rls, relforcerowsecurity AS force_rls
        FROM pg_catalog.pg_class AS relation_catalog
        JOIN pg_catalog.pg_namespace AS namespace_catalog
          ON namespace_catalog.oid = relation_catalog.relnamespace
        WHERE namespace_catalog.nspname = 'circles_identity'
          AND relation_catalog.relname = 'provider_links'
        LIMIT 1
      `);
      assert.deepEqual(metadata.rows, [{ rls: true, force_rls: true }]);
      const policies = await admin.query(`
        SELECT policy_catalog.polcmd, role_catalog.rolname
        FROM pg_catalog.pg_policy AS policy_catalog
        JOIN pg_catalog.pg_roles AS role_catalog
          ON role_catalog.oid = ANY(policy_catalog.polroles)
        WHERE policy_catalog.polrelid = 'circles_identity.provider_links'::pg_catalog.regclass
        ORDER BY policy_catalog.polcmd
      `);
      assert.deepEqual(policies.rows, [
        { polcmd: "a", rolname: "circles_app_runtime" },
        { polcmd: "r", rolname: "circles_app_runtime" },
      ]);
      const privileges = await admin.query(`
        SELECT
          has_schema_privilege('anon', 'circles_identity', 'USAGE') AS anon_schema,
          has_schema_privilege('authenticated', 'circles_identity', 'USAGE') AS authenticated_schema,
          has_table_privilege('circles_app_runtime', 'circles_identity.provider_links', 'SELECT') AS runtime_select,
          has_table_privilege('circles_app_runtime', 'circles_identity.provider_links', 'INSERT') AS runtime_insert,
          has_table_privilege('circles_app_runtime', 'circles_identity.provider_links', 'UPDATE') AS runtime_update,
          has_table_privilege('circles_app_runtime', 'circles_identity.provider_links', 'DELETE') AS runtime_delete
      `);
      assert.deepEqual(privileges.rows, [
        {
          anon_schema: false,
          authenticated_schema: false,
          runtime_select: true,
          runtime_insert: true,
          runtime_update: false,
          runtime_delete: false,
        },
      ]);

      await admin.query("SET ROLE anon");
      await expectPgError(
        () => admin.query("SELECT * FROM circles_identity.provider_links"),
        "42501",
      );
      await admin.query("RESET ROLE");
      await admin.query("SET ROLE authenticated");
      await expectPgError(
        () => admin.query("SELECT * FROM circles_identity.provider_links"),
        "42501",
      );
      await admin.query("RESET ROLE");

      const runtimeClient = await runtimePool.connect();
      try {
        await runtimeClient.query(
          `INSERT INTO circles_identity.provider_links (provider_subject, user_id)
           VALUES ($1::uuid, 102)`,
          [subjects.runtime],
        );
        const readable = await runtimeClient.query(
          `SELECT provider_subject::text AS subject, user_id AS "userId"
           FROM circles_identity.provider_links
           WHERE provider_subject = $1::uuid`,
          [subjects.runtime],
        );
        assert.deepEqual(readable.rows, [
          { subject: subjects.runtime, userId: 102 },
        ]);
        await expectPgError(
          () =>
            runtimeClient.query(
              "UPDATE circles_identity.provider_links SET user_id = 101 WHERE user_id = 102",
            ),
          "42501",
        );
        await expectPgError(
          () =>
            runtimeClient.query(
              "DELETE FROM circles_identity.provider_links WHERE user_id = 102",
            ),
          "42501",
        );
      } finally {
        runtimeClient.release();
      }
    });

    assert.equal(provider.calls.settings, 1);
    assert(provider.calls.token >= 8);
    assert(provider.calls.user >= 7);
    assert.equal(provider.calls.signup, 1);
    evidence.executed = true;
    evidence.passed = true;
    evidence.state = "completed";
    evidence.provider_calls = provider.calls;
  } catch (error) {
    evidence.failure_category = safeFailureCategory(error);
  } finally {
    try {
      await closeHttpServer(httpServer);
      evidence.cleanup.http_server_closed = true;
    } catch {
      evidence.cleanup.http_server_closed = false;
    }
    try {
      if (runtimePool) await runtimePool.end();
      evidence.cleanup.runtime_pool_closed = true;
    } catch {
      evidence.cleanup.runtime_pool_closed = false;
    }
    try {
      if (admin) await admin.end();
    } catch {
      // The cluster stop below still bounds the owned local server if a client close fails.
    }
    try {
      if (postgresStarted && directory) {
        await boundedProcess(
          PG_CTL,
          ["-D", join(directory, "data"), "-m", "immediate", "-w", "stop"],
          toolEnvironment(directory),
        );
      }
      evidence.cleanup.postgres_stopped = true;
    } catch {
      evidence.cleanup.postgres_stopped = false;
    }
    try {
      if (directory && evidence.cleanup.postgres_stopped) {
        await rm(directory, { recursive: true, force: true });
        evidence.cleanup.disposable_fixture_removed = true;
      }
    } catch {
      evidence.cleanup.disposable_fixture_removed = false;
    }
    if (
      !evidence.cleanup.http_server_closed ||
      !evidence.cleanup.runtime_pool_closed ||
      !evidence.cleanup.postgres_stopped ||
      !evidence.cleanup.disposable_fixture_removed
    ) {
      evidence.passed = false;
      evidence.state = "unfinished";
    }
    evidence.duration_ms = Date.now() - startedAt;
    if (evidence.duration_ms > RUNNER_TIMEOUT_MS) {
      evidence.passed = false;
      evidence.state = "unfinished";
      evidence.failure_category ??= "RunnerTimeBudgetExceeded";
    }
    console.log(JSON.stringify(evidence));
  }

  return evidence.passed ? 0 : 1;
}

process.exitCode = await runDrill();
