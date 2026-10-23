import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  APPLICATION_RUNTIME_ROLE,
  PROJECT_ROOT,
  REQUIRED_APPLICATION_COLUMNS,
  REQUIRED_APPLICATION_TABLES,
  callReadOnlyQuery,
  checkApplicationSchema,
  checkDatabaseReady,
  deriveEndpointInventory,
  loadEndpointManifest,
  loadVerificationAuth,
  parseCliArguments,
  restartKnownApiService,
  runRecovery,
  validateVerificationConfiguration,
  waitForApiReadiness,
} from "../scripts/recover-api.mjs";

const temporaryDirectories: string[] = [];

function temporaryDirectory() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "circles-recover-api-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length) {
    fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function configuration() {
  return {
    MANUS_PROJECT_ID: "synthetic-project",
    MANUS_OAUTH_PORTAL_URL: "https://oauth.example.test",
    MANUS_OAUTH_API_URL: "https://oauth-api.example.test",
    MANUS_JWT_SECRET: "s".repeat(32),
    SUPABASE_DATABASE_URL:
      "postgresql://postgres.vvclcsqletcxzoaayqzq:synthetic-password@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
    // Retained only to prove recovery never uses this managed MySQL source at runtime.
    DATABASE_URL: "mysql://synthetic.example.test/circles",
    BUILT_IN_FORGE_API_URL: "https://storage.example.test",
    BUILT_IN_FORGE_API_KEY: "synthetic-storage-key",
    EXPO_PUBLIC_API_BASE_URL: "http://127.0.0.1:3000",
    EXPO_PACKAGER_PROXY_URL: "http://127.0.0.1:8081",
  };
}

function clearedEnvironment(
  overrides: Record<string, string | undefined> = {},
) {
  return {
    NODE_ENV: "test",
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    ...overrides,
  };
}

function trustedPreviewConfiguration() {
  return {
    EXPO_PUBLIC_API_BASE_URL: "https://current-preview.manus.computer",
  };
}

const existingIds = {
  circleId: 11,
  profileId: 12,
  postId: 13,
  conversationId: 14,
  streamId: 15,
  liveGeneration: 16,
};

type MockCall = {
  route: string;
  method: string;
  authenticated: boolean;
  input?: unknown;
};

// Equivalent to the current server/live-router.ts live.signals input boundary.
const liveSignalsInput = z
  .object({
    streamId: z.number().int().positive(),
    generation: z.number().int().positive(),
  })
  .strict();

function mockTrpcFetch(calls: MockCall[]) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const route = url.pathname.replace("/api/trpc/", "");
    const headers = new Headers(init?.headers);
    const authenticated = headers.has("Authorization");
    const encodedInput = url.searchParams.get("input");
    const queryInput = encodedInput
      ? (JSON.parse(encodedInput) as { json?: unknown }).json
      : undefined;
    calls.push({
      route,
      method: init?.method ?? "GET",
      authenticated,
      input: queryInput,
    });
    if (
      ["live.signals", "live.relay"].includes(route) &&
      !liveSignalsInput.safeParse(queryInput).success
    ) {
      return new Response(
        JSON.stringify({ error: { data: { code: "BAD_REQUEST" } } }),
        {
          status: 400,
        },
      );
    }
    const protectedRoute = [
      "auth.me",
      "social.conversations",
      "social.messages",
      "live.signals",
      "live.relay",
      "live.chat",
    ].includes(route);
    if (protectedRoute && !authenticated && route !== "auth.me") {
      return new Response(
        JSON.stringify({ error: { data: { code: "UNAUTHORIZED" } } }),
        {
          status: 401,
        },
      );
    }
    const value =
      route === "auth.me"
        ? authenticated
          ? { id: 1, openId: "synthetic" }
          : null
        : route === "system.health"
          ? { ok: true }
          : route === "live.relay"
            ? { ice: null }
            : ["social.circle", "social.profile"].includes(route)
              ? { id: 1 }
              : [];
    return new Response(JSON.stringify({ result: { data: { json: value } } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

describe("guarded API recovery", () => {
  it("restarts only the named API and verifies every current query with synthetic responses", async () => {
    const calls: MockCall[] = [];
    let restartCalls = 0;

    const report = await runRecovery({
      mode: "apply",
      configuration: configuration(),
      referenceEnvironment: clearedEnvironment(),
      auth: { bearerToken: "synthetic-bearer", ids: existingIds },
      serviceName: "circles-api",
      databaseReady: async () => true,
      schemaCheck: async () => true,
      restart: ({ serviceName }: { serviceName: string }) => {
        restartCalls += 1;
        return { ok: serviceName === "circles-api", reason: "synthetic" };
      },
      fetchImpl: mockTrpcFetch(calls),
    });

    expect(report.ok).toBe(true);
    expect(restartCalls).toBe(1);
    expect(report.inventory.declaredQueries).toBe(15);
    expect(report.verification.summary).toMatchObject({
      failed: 0,
      skipped: 0,
      completedPositiveQueries: 15,
    });
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(
      calls.some((call) =>
        /create|join|send|update|delete|logout|react/.test(call.route),
      ),
    ).toBe(false);
    const signalInputs = calls
      .filter((call) => call.route === "live.signals")
      .map((call) => call.input);
    expect(signalInputs).toEqual([
      {
        streamId: existingIds.streamId,
        generation: existingIds.liveGeneration,
      },
      {
        streamId: existingIds.streamId,
        generation: existingIds.liveGeneration,
      },
    ]);
    expect(
      signalInputs.every((input) => liveSignalsInput.safeParse(input).success),
    ).toBe(true);
  });

  it("uses a reviewed live.signals manifest generation when no auth-file generation is supplied", async () => {
    const directory = temporaryDirectory();
    const endpointManifest = path.join(directory, "recover-api.manifest.json");
    fs.writeFileSync(
      endpointManifest,
      JSON.stringify({
        version: 1,
        endpoints: {
          "live.signals": { input: { generation: 27 } },
          "live.relay": { input: { generation: 27 } },
        },
      }),
    );
    const calls: MockCall[] = [];
    const { liveGeneration: _liveGeneration, ...idsWithoutGeneration } =
      existingIds;

    const report = await runRecovery({
      mode: "verify-only",
      strict: true,
      projectDir: PROJECT_ROOT,
      configuration: trustedPreviewConfiguration(),
      operatorBaseUrl: "https://current-preview.manus.computer",
      endpointManifest,
      auth: { bearerToken: "synthetic-bearer", ids: idsWithoutGeneration },
      fetchImpl: mockTrpcFetch(calls),
    });

    expect(report.ok).toBe(true);
    expect(
      calls
        .filter((call) => call.route === "live.signals")
        .map((call) => call.input),
    ).toEqual([
      { streamId: existingIds.streamId, generation: 27 },
      { streamId: existingIds.streamId, generation: 27 },
    ]);
  });

  it("skips live.signals without a current generation, makes no signals request, and fails strict coverage", async () => {
    const calls: MockCall[] = [];
    const { liveGeneration: _liveGeneration, ...idsWithoutGeneration } =
      existingIds;

    const report = await runRecovery({
      mode: "verify-only",
      strict: true,
      projectDir: PROJECT_ROOT,
      configuration: trustedPreviewConfiguration(),
      operatorBaseUrl: "https://current-preview.manus.computer",
      auth: { bearerToken: "synthetic-bearer", ids: idsWithoutGeneration },
      fetchImpl: mockTrpcFetch(calls),
    });

    expect(report.ok).toBe(false);
    expect(report.verification.complete).toBe(false);
    expect(report.verification.checks).toContainEqual({
      name: "live.signals",
      check: "positive",
      status: "skipped",
      reason: "missing_current_live_generation",
    });
    expect(calls.some((call) => call.route === "live.signals")).toBe(false);
  });

  it("reports an invalid trusted auth-file live generation as incomplete without issuing live.signals", async () => {
    const directory = temporaryDirectory();
    const authFile = path.join(directory, "verify-auth.json");
    fs.writeFileSync(
      authFile,
      JSON.stringify({
        bearerToken: "synthetic-bearer",
        ids: { ...existingIds, liveGeneration: 0 },
      }),
    );
    fs.chmodSync(authFile, 0o600);
    const calls: MockCall[] = [];

    const report = await runRecovery({
      mode: "verify-only",
      strict: true,
      projectDir: PROJECT_ROOT,
      configuration: trustedPreviewConfiguration(),
      operatorBaseUrl: "https://current-preview.manus.computer",
      authFile,
      fetchImpl: mockTrpcFetch(calls),
    });

    expect(report.ok).toBe(false);
    expect(report.verification.checks).toContainEqual({
      name: "live.signals",
      check: "positive",
      status: "skipped",
      reason: "invalid_current_live_generation",
    });
    expect(calls.some((call) => call.route === "live.signals")).toBe(false);
  });

  it("rejects stale configuration before any restart or query", async () => {
    let restarted = false;
    const report = await runRecovery({
      mode: "apply",
      configuration: { ...configuration(), MANUS_JWT_SECRET: "too-short" },
      referenceEnvironment: clearedEnvironment(),
      restart: () => {
        restarted = true;
        return { ok: true, reason: "synthetic" };
      },
    });

    expect(report.ok).toBe(false);
    expect(JSON.stringify(report.configuration.errors)).toContain(
      "MANUS_JWT_SECRET",
    );
    expect(restarted).toBe(false);
    expect(report.restart.attempted).toBe(false);
  });

  it("refuses an unrelated service name without spawning a process", () => {
    let spawned = false;
    const result = restartKnownApiService({
      serviceName: "unrelated-worker",
      serviceManager: "systemd",
      configuration: configuration(),
      referenceEnvironment: clearedEnvironment(),
      spawn: () => {
        spawned = true;
        throw new Error("must not spawn");
      },
    });

    expect(result).toEqual({ ok: false, reason: "unsafe_service_target" });
    expect(spawned).toBe(false);
  });

  it("reports protected verification as incomplete and fails strict mode without an auth file", async () => {
    const calls: { route: string; method: string; authenticated: boolean }[] =
      [];
    const report = await runRecovery({
      mode: "apply",
      strict: true,
      configuration: configuration(),
      referenceEnvironment: clearedEnvironment(),
      auth: { bearerToken: null, ids: existingIds },
      serviceName: "circles-api",
      databaseReady: async () => true,
      schemaCheck: async () => true,
      restart: () => ({ ok: true, reason: "synthetic" }),
      fetchImpl: mockTrpcFetch(calls),
    });

    expect(report.ok).toBe(false);
    expect(report.verification.summary.skipped).toBeGreaterThan(0);
    expect(report.verification.checks).toContainEqual(
      expect.objectContaining({
        name: "social.conversations",
        check: "positive",
        status: "skipped",
        reason: "missing_verification_auth",
      }),
    );
    expect(report.verification.checks).toContainEqual(
      expect.objectContaining({
        name: "social.conversations",
        check: "anonymous_denial",
        status: "passed",
      }),
    );
  });

  it("keeps strict dry runs incomplete because no endpoint request is allowed", async () => {
    const report = await runRecovery({
      mode: "dry-run",
      strict: true,
      configuration: configuration(),
      referenceEnvironment: clearedEnvironment(),
      auth: { bearerToken: null, ids: {} },
      databaseReady: async () => true,
      schemaCheck: async () => true,
    });

    expect(report.ok).toBe(false);
    expect(report.verification.complete).toBe(false);
    expect(report.verification.checks).toContainEqual(
      expect.objectContaining({
        name: "social.conversations",
        status: "skipped",
        reason: "missing_verification_auth",
      }),
    );
  });

  it("redacts configuration values when preflight fails", async () => {
    const secret = "do-not-print-this-token";
    const report = await runRecovery({
      mode: "dry-run",
      configuration: { ...configuration(), MANUS_JWT_SECRET: secret },
      referenceEnvironment: clearedEnvironment({
        MANUS_JWT_SECRET: "different-stable-secret-value",
      }),
      databaseReady: async () => true,
      schemaCheck: async () => true,
    });

    expect(report.ok).toBe(false);
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(JSON.stringify(report)).not.toContain(
      "different-stable-secret-value",
    );
    expect(report.configuration.errors).toContainEqual(
      expect.objectContaining({ name: "MANUS_JWT_SECRET" }),
    );
  });

  it("flags newly discovered query routes as inventory drift rather than invoking them", () => {
    const root = temporaryDirectory();
    fs.cpSync(path.join(PROJECT_ROOT, "server"), path.join(root, "server"), {
      recursive: true,
    });
    const socialRouter = path.join(root, "server", "social-router.ts");
    fs.appendFileSync(
      socialRouter,
      "\n// Source-only test route: inventory must force an operator update.\n  driftProbe: publicProcedure.query(() => []),\n",
    );

    const inventory = deriveEndpointInventory(root);
    expect(inventory.drift.unsupported).toContain("social.driftProbe");
    expect(inventory.endpoints).toContainEqual(
      expect.objectContaining({
        name: "social.driftProbe",
        supported: false,
        drift: "missing_definition",
      }),
    );
  });

  it("rejects secret-like manifest fields before they can reach a query URL", () => {
    const root = temporaryDirectory();
    const manifestPath = path.join(root, "manifest.json");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        version: 1,
        endpoints: { "social.feed": { input: { token: "not-allowed" } } },
      }),
    );

    expect(() =>
      loadEndpointManifest(manifestPath, deriveEndpointInventory()),
    ).toThrow("endpoint_manifest_invalid");
  });

  it("blocks restart when a durable-session schema check fails", async () => {
    let restarted = false;
    const report = await runRecovery({
      mode: "apply",
      configuration: configuration(),
      referenceEnvironment: clearedEnvironment(),
      forceSessionSchemaCheck: true,
      databaseReady: async () => true,
      schemaCheck: async () => false,
      restart: () => {
        restarted = true;
        return { ok: true, reason: "synthetic" };
      },
    });

    expect(report.ok).toBe(false);
    expect(report.applicationSchema).toEqual({ required: true, ok: false });
    expect(restarted).toBe(false);
  });

  it("performs database readiness before dry-run or apply restart preflight", async () => {
    let databaseChecks = 0;
    let schemaChecks = 0;
    let restarts = 0;

    for (const mode of ["dry-run", "apply"]) {
      const report = await runRecovery({
        mode,
        configuration: configuration(),
        referenceEnvironment: clearedEnvironment(),
        auth: { bearerToken: null, ids: {} },
        databaseReady: async () => {
          databaseChecks += 1;
          return false;
        },
        schemaCheck: async () => {
          schemaChecks += 1;
          return true;
        },
        restart: () => {
          restarts += 1;
          return { ok: true, reason: "synthetic" };
        },
      });

      expect(report.database).toEqual({ required: true, ok: false });
      expect(report.restart.attempted).toBe(false);
    }

    expect(databaseChecks).toBe(2);
    expect(schemaChecks).toBe(0);
    expect(restarts).toBe(0);
  });

  it("uses project-local pg and bounded catalog-only PostgreSQL readiness checks", async () => {
    type Query = { text: string; values: unknown[]; query_timeout: number };
    const makePgModule = (
      onQuery: (query: Query) => { rows: unknown[] },
      onEnd: () => void,
    ) => ({
      Client: class {
        constructor(readonly options: Record<string, unknown>) {
          expect(options.connectionTimeoutMillis).toBe(8_000);
          expect(options.query_timeout).toBe(8_000);
          expect(options.host).toBe("aws-0-eu-west-1.pooler.supabase.com");
          expect(options.database).toBe("postgres");
          expect(options.user).toBe("postgres.vvclcsqletcxzoaayqzq");
          expect(options.ssl).toMatchObject({ rejectUnauthorized: true });
        }
        async connect() {}
        async query(query: Query) {
          return onQuery(query);
        }
        async end() {
          onEnd();
        }
      },
    });
    const readinessQueries: Query[] = [];
    let readinessClosed = false;
    const ready = await checkDatabaseReady(configuration(), {
      projectRoot: PROJECT_ROOT,
      pgModule: makePgModule(
        (query) => {
          readinessQueries.push(query);
          return { rows: [{ database_name: "postgres" }] };
        },
        () => {
          readinessClosed = true;
        },
      ),
    });
    expect(ready).toBe(true);
    expect(readinessQueries).toEqual([
      expect.objectContaining({
        text: "SELECT current_database() AS database_name",
        values: [],
      }),
    ]);
    expect(
      readinessQueries.every((query) => query.text.startsWith("SELECT")),
    ).toBe(true);
    expect(readinessClosed).toBe(true);

    const columns = Object.entries(REQUIRED_APPLICATION_COLUMNS).flatMap(
      ([table, names]) =>
        names.map((column) => ({ table_name: table, column_name: column })),
    );
    const tableRows = REQUIRED_APPLICATION_TABLES.map((table) => ({
      table_name: table,
      rls_enabled: true,
      can_select: true,
      can_insert: table !== "_dataMigrations",
      can_update: table !== "_dataMigrations",
      can_delete: table !== "_dataMigrations",
    }));
    const schemaQueries: Query[] = [];
    let schemaClosed = false;
    const schema = await checkApplicationSchema(configuration(), {
      projectRoot: PROJECT_ROOT,
      pgModule: makePgModule(
        (query) => {
          schemaQueries.push(query);
          if (query.text.includes("FROM pg_roles")) {
            return {
              rows: [
                {
                  rolname: APPLICATION_RUNTIME_ROLE,
                  rolcanlogin: false,
                  rolinherit: false,
                  rolbypassrls: false,
                  rolsuper: false,
                },
              ],
            };
          }
          if (query.text.includes("has_schema_privilege")) {
            return { rows: [{ can_use_schema: true }] };
          }
          if (query.text.includes("information_schema.columns"))
            return { rows: columns };
          if (query.text.includes("c.relkind IN")) return { rows: tableRows };
          if (query.text.includes("FROM pg_indexes")) {
            return {
              rows: [
                { indexname: "application_sessions_user_app_idx" },
                { indexname: "application_sessions_expiry_idx" },
              ],
            };
          }
          if (query.text.includes("c.relkind = 'S'")) {
            return {
              rows: [{ sequence_name: "users_id_seq", can_use_sequence: true }],
            };
          }
          throw new Error("unexpected synthetic catalog query");
        },
        () => {
          schemaClosed = true;
        },
      ),
    });
    expect(schema).toBe(true);
    expect(schemaQueries).toHaveLength(6);
    expect(
      schemaQueries.every((query) => query.text.startsWith("SELECT")),
    ).toBe(true);
    expect(schemaQueries.every((query) => query.query_timeout === 8_000)).toBe(
      true,
    );
    expect(schemaQueries.some((query) => query.text.includes("SELECT 1"))).toBe(
      false,
    );
    expect(schemaClosed).toBe(true);
  });

  it("fails closed when private-schema catalog evidence or project-local pg is unavailable", async () => {
    const noRls = await checkApplicationSchema(configuration(), {
      projectRoot: PROJECT_ROOT,
      connectionOptions: () => ({
        host: "synthetic",
        database: "postgres",
        user: "synthetic",
      }),
      pgModule: {
        Client: class {
          async connect() {}
          async query() {
            return { rows: [] };
          }
          async end() {}
        },
      },
    });
    expect(noRls).toBe(false);

    const absentProject = path.join(temporaryDirectory(), "no-dependencies");
    await expect(
      checkDatabaseReady(configuration(), {
        projectRoot: absentProject,
        connectionOptions: () => ({
          host: "synthetic",
          database: "postgres",
          user: "synthetic",
        }),
      }),
    ).resolves.toBe(false);
  });

  it("keeps the exact trusted PM2 HOME and PM2_HOME context and refuses an ambiguous one", () => {
    let spawnOptions: { env: Record<string, string> } | undefined;
    const preserved = restartKnownApiService({
      serviceName: "circles-api",
      serviceManager: "pm2",
      configuration: { ...configuration(), HOME: "/unsafe/from-config" },
      referenceEnvironment: clearedEnvironment({
        HOME: "/home/synthetic-operator",
        PM2_HOME: "/home/synthetic-operator/.pm2-existing",
      }),
      spawn: (
        _command: string,
        _args: string[],
        options: { env: Record<string, string> },
      ) => {
        spawnOptions = options;
        return { status: 0, signal: null };
      },
    });
    expect(preserved.ok).toBe(true);
    expect(spawnOptions?.env.HOME).toBe("/home/synthetic-operator");
    expect(spawnOptions?.env.PM2_HOME).toBe(
      "/home/synthetic-operator/.pm2-existing",
    );
    expect(spawnOptions?.env.SUPABASE_DATABASE_URL).toContain(
      "pooler.supabase.com",
    );
    expect(spawnOptions?.env.DATABASE_URL).toBeUndefined();

    let spawned = false;
    const ambiguous = restartKnownApiService({
      serviceName: "circles-api",
      serviceManager: "pm2",
      configuration: configuration(),
      referenceEnvironment: clearedEnvironment(),
      spawn: () => {
        spawned = true;
        throw new Error("must not spawn");
      },
    });
    expect(ambiguous).toEqual({
      ok: false,
      reason: "pm2_manager_context_required",
    });
    expect(spawned).toBe(false);
  });

  it("runs verify-only against a public Preview origin without any database, schema, or restart action", async () => {
    const calls: { route: string; method: string; authenticated: boolean }[] =
      [];
    let databaseChecks = 0;
    let schemaChecks = 0;
    let restarts = 0;
    const report = await runRecovery({
      mode: "verify-only",
      projectDir: PROJECT_ROOT,
      configuration: trustedPreviewConfiguration(),
      operatorBaseUrl: "https://current-preview.manus.computer",
      auth: { bearerToken: "synthetic-bearer", ids: existingIds },
      databaseReady: async () => {
        databaseChecks += 1;
        return false;
      },
      schemaCheck: async () => {
        schemaChecks += 1;
        return false;
      },
      restart: () => {
        restarts += 1;
        return { ok: true, reason: "must-not-run" };
      },
      fetchImpl: mockTrpcFetch(calls),
    });

    expect(report.ok).toBe(true);
    expect(report.configuration.ok).toBe(true);
    expect(report.database).toEqual({ required: false, ok: null });
    expect(report.applicationSchema).toEqual({ required: false, ok: null });
    expect(report.restart.attempted).toBe(false);
    expect(databaseChecks).toBe(0);
    expect(schemaChecks).toBe(0);
    expect(restarts).toBe(0);
    expect(report.inventory.declaredQueries).toBe(15);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("uses an explicit project-dir when the verifier script is bundled outside the source tree", () => {
    const bundledDirectory = temporaryDirectory();
    const bundledScript = path.join(bundledDirectory, "recover-api.mjs");
    fs.copyFileSync(
      path.join(PROJECT_ROOT, "scripts", "recover-api.mjs"),
      bundledScript,
    );
    const child = spawnSync(
      process.execPath,
      [
        bundledScript,
        "--verify-only",
        "--api-base-url",
        "http://127.0.0.1:1",
        "--project-dir",
        PROJECT_ROOT,
        "--no-anonymous-gates",
      ],
      {
        cwd: bundledDirectory,
        env: clearedEnvironment() as NodeJS.ProcessEnv,
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(1);
    const report = JSON.parse(child.stdout);
    expect(report.configuration.ok).toBe(true);
    expect(report.inventory.declaredQueries).toBe(15);
    expect(report.restart.attempted).toBe(false);
    expect(report.database.required).toBe(false);
  });

  it("requires private env/auth files and keeps refused paths and contents out of reports", async () => {
    const directory = temporaryDirectory();
    const secret = "private-file-content-must-not-appear";
    const envFile = path.join(directory, "private-path-must-not-appear.env");
    fs.writeFileSync(envFile, `MANUS_JWT_SECRET=${secret}\n`);
    fs.chmodSync(envFile, 0o640);
    const envReport = await runRecovery({
      mode: "dry-run",
      envFile,
      referenceEnvironment: clearedEnvironment(),
    });
    expect(envReport.ok).toBe(false);
    expect(JSON.stringify(envReport)).not.toContain(secret);
    expect(JSON.stringify(envReport)).not.toContain(envFile);
    expect(envReport.configuration.errors).toContainEqual(
      expect.objectContaining({ reason: "environment_file_not_trusted" }),
    );

    const authFile = path.join(
      directory,
      "private-auth-path-must-not-appear.json",
    );
    fs.writeFileSync(
      authFile,
      JSON.stringify({ bearerToken: secret, ids: {} }),
    );
    fs.chmodSync(authFile, 0o640);
    expect(() => loadVerificationAuth(authFile)).toThrow(
      "environment_file_not_trusted",
    );
    const authReport = await runRecovery({
      mode: "verify-only",
      projectDir: PROJECT_ROOT,
      configuration: trustedPreviewConfiguration(),
      operatorBaseUrl: "https://current-preview.manus.computer",
      authFile,
    });
    expect(JSON.stringify(authReport)).not.toContain(secret);
    expect(JSON.stringify(authReport)).not.toContain(authFile);
    expect(authReport.configuration.errors).toContainEqual(
      expect.objectContaining({ reason: "environment_file_not_trusted" }),
    );
  });

  it("never follows redirects with a bearer and categorizes malformed response reads without disclosure", async () => {
    const secret = "response-stream-secret";
    const bearer = "bearer-must-not-be-reported";
    let redirectMode: RequestRedirect | undefined;
    const redirected = await callReadOnlyQuery({
      apiBaseUrl: "https://current-preview.manus.computer",
      endpoint: "social.feed",
      input: undefined,
      bearerToken: bearer,
      fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        redirectMode = init?.redirect;
        throw new Error(secret);
      }) as typeof fetch,
    });
    expect(redirected).toEqual({ ok: false, reason: "network_error" });
    expect(redirectMode).toBe("error");
    expect(JSON.stringify(redirected)).not.toContain(secret);
    expect(JSON.stringify(redirected)).not.toContain(bearer);

    const malformed = await callReadOnlyQuery({
      apiBaseUrl: "https://current-preview.manus.computer",
      endpoint: "social.feed",
      input: undefined,
      bearerToken: bearer,
      fetchImpl: (async () =>
        ({
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => {
                throw new Error(secret);
              },
              releaseLock: () => undefined,
            }),
          },
        }) as unknown as Response) as typeof fetch,
    });
    expect(malformed).toEqual({ ok: false, reason: "response_body_error" });
    expect(JSON.stringify(malformed)).not.toContain(secret);
    expect(JSON.stringify(malformed)).not.toContain(bearer);
  });

  it("uses a bounded non-mutating readiness retry before final inventory work", async () => {
    let attempts = 0;
    let delays = 0;
    const readiness = await waitForApiReadiness({
      apiBaseUrl: "https://current-preview.manus.computer",
      fetchImpl: (async () => {
        attempts += 1;
        if (attempts === 1) return new Response("not-ready", { status: 503 });
        return new Response(
          JSON.stringify({ result: { data: { json: [] } } }),
          {
            status: 200,
          },
        );
      }) as typeof fetch,
      sleep: async () => {
        delays += 1;
      },
    });
    expect(readiness).toEqual({ ok: true, attempts: 2 });
    expect(attempts).toBe(2);
    expect(delays).toBe(1);
  });

  it("rejects ambiguous verify/apply modes and non-absolute project directories", () => {
    expect(() => parseCliArguments(["--apply", "--verify-only"])).toThrow(
      "recovery_mode_ambiguous",
    );
    expect(() =>
      parseCliArguments(["--verify-only", "--service-manager", "pm2"]),
    ).toThrow("verify_only_restart_options_invalid");
    expect(() =>
      parseCliArguments(["--verify-only", "--project-dir", "relative-source"]),
    ).toThrow("project_dir_must_be_absolute");
    expect(
      validateVerificationConfiguration(
        {},
        {
          operatorBaseUrl: "https://current-preview.manus.computer",
        },
      ).apiBaseUrl,
    ).toBe("https://current-preview.manus.computer");
  });
});
