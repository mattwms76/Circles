import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyFutureOnlyMigrationBundle,
  FUTURE_MANIFEST_FORMAT,
} from "../operations/security-tools/sec27-future-migration-transport.mjs";
import { createServer, type Server } from "node:http";
import express from "express";
import {
  createExpressMiddleware,
  type CreateExpressContextOptions,
} from "@trpc/server/adapters/express";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as coreSchema from "../drizzle/schema";
import * as liveSchema from "../drizzle/live-schema";
import * as sessionSchema from "../drizzle/session-schema";
import type { User } from "../drizzle/schema";
import type { TrpcContext } from "../server/_core/context";
import { router } from "../server/_core/trpc";
import { registerStorageProxy } from "../server/_core/storageProxy";
import type { CirclesDatabase } from "../server/db";
import {
  createRuntimeRolePool,
  type RuntimeRolePool,
} from "../server/runtime-role-pool";
import { encryptSocialMedia } from "../server/social-service";
import { socialRouter } from "../server/social-router";

const ACTOR_HEADER = "x-sec27-e2e-user";
const HTTP_TIMEOUT_MS = 4_000;
const FIXTURE_USERS = new Map<number, User>();
const CIRCLE_ID = 12;
const MEDIA_KEY =
  "social-encrypted/1/123e4567-e89b-42d3-a456-426614174099.jpg.enc";
const MEDIA_URL = `/manus-storage/${MEDIA_KEY}`;
const MEDIA_TEXT = "SEC006 local private media reference";
const SYNTHETIC_MEDIA_SECRET =
  "sec27-local-synthetic-media-secret-not-a-provider-key";
const HISTORICAL_MIGRATION =
  "operations/migrations/0001_circles_ops_daily_migration_health.sql";
const HISTORICAL_MIGRATION_SHA256 =
  "0df6a1076b9adc01e180bb06fca3cb242711038e7b36e5bf36188819ea2ad888";
const HISTORICAL_MIGRATION_BYTES = 33_460;

/**
 * Explicit fixture seams only:
 * - `getDb` receives a real local Drizzle/RuntimeRolePool connection.
 * - `sdk.authenticateRequest` maps the synthetic loopback header; no signer or provider runs.
 * - storage helpers return an in-memory pinned Response; no presigner/object-store request occurs.
 */
const dbFacade = vi.hoisted(() => ({ database: null as unknown }));
const storageMocks = vi.hoisted(() => ({
  storageGetSignedUrl: vi.fn(),
  storageFetchSignedObject: vi.fn(),
  StorageOperationTimeoutError: class StorageOperationTimeoutError extends Error {},
}));
const sdkFixture = vi.hoisted(() => ({
  authenticateRequest: vi.fn(
    async (req: { header: (name: string) => string | undefined }) => {
      const raw = req.header(ACTOR_HEADER);
      if (!raw || !/^\d+$/.test(raw)) throw new Error("synthetic auth denied");
      return { id: Number(raw) };
    },
  ),
}));

vi.mock("../server/db", () => ({
  getDb: () => Promise.resolve(dbFacade.database),
}));
vi.mock("../server/_core/sdk", () => ({
  sdk: { authenticateRequest: sdkFixture.authenticateRequest },
}));
vi.mock("../server/storage", () => ({
  storageGetSignedUrl: storageMocks.storageGetSignedUrl,
  storageFetchSignedObject: storageMocks.storageFetchSignedObject,
  // socialRouter imports this production export but SEC006 does not invoke upload handling.
  storagePut: vi.fn(),
  StorageOperationTimeoutError: storageMocks.StorageOperationTimeoutError,
}));

const databaseSchema = { ...coreSchema, ...liveSchema, ...sessionSchema };
const securityHttpRouter = router({ social: socialRouter });

type TrpcWireResult = {
  status: number;
  data: unknown;
  errorCode: string | null;
};
type DeferredStorageResponse = {
  reached: Promise<void>;
  release: () => void;
};
type SeededMedia = { postId: number; plaintext: Buffer; encrypted: Buffer };

let runtimePool: RuntimeRolePool | null = null;
let adminPool: Pool | null = null;
let database: CirclesDatabase | null = null;
let httpServer: Server | null = null;
let apiBaseUrl = "";
let fixturePort = 0;
let fixtureDatabase = "";
let priorMediaSecret: string | undefined;
let responseSequence = 0;
let successfulMediaEnqueueSequence = 0;

function readFixturePort(): number {
  const raw = process.env.CIRCLE_HOME_E2E_PG_PORT;
  if (!raw || !/^\d{1,5}$/.test(raw)) {
    throw new Error(
      "SEC27 fixture port was not supplied by the isolated runner",
    );
  }
  const port = Number(raw);
  if (
    !Number.isSafeInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    [3000, 8081].includes(port)
  ) {
    throw new Error("SEC27 fixture port is not an allowed loopback port");
  }
  return port;
}

function fixtureUser(id: number): User | null {
  return FIXTURE_USERS.get(id) ?? null;
}

function createFixtureContext(opts: CreateExpressContextOptions): TrpcContext {
  const rawActor = opts.req.header(ACTOR_HEADER);
  const actorId = rawActor && /^\d+$/.test(rawActor) ? Number(rawActor) : null;
  return {
    req: opts.req,
    res: opts.res,
    user: actorId ? fixtureUser(actorId) : null,
  };
}

async function startLoopbackServer(): Promise<string> {
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  // The wrapper is test-server-only instrumentation. It marks the exact synchronous Express
  // enqueue called by the production storage handler; it does not alter database/auth behavior.
  app.use((req, res, next) => {
    const send = res.send.bind(res);
    res.send = ((body?: unknown) => {
      if (req.path.startsWith("/api/media/") && res.statusCode === 200) {
        successfulMediaEnqueueSequence = ++responseSequence;
      }
      return send(body as never);
    }) as typeof res.send;
    next();
  });
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: securityHttpRouter,
      createContext: createFixtureContext,
    }),
  );
  registerStorageProxy(app);
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (
    !address ||
    typeof address === "string" ||
    [3000, 8081].includes(address.port)
  ) {
    server.close();
    throw new Error(
      "SEC27 HTTP listener was not assigned an isolated loopback port",
    );
  }
  httpServer = server;
  return `http://127.0.0.1:${address.port}`;
}

async function trpc(
  procedure: "social.removeMember",
  input: Record<string, unknown>,
  actorId: number,
): Promise<TrpcWireResult> {
  const url = new URL(`/api/trpc/${procedure}`, apiBaseUrl);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      [ACTOR_HEADER]: String(actorId),
    },
    body: JSON.stringify({ json: input }),
    redirect: "error",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const payload = (await response.json()) as {
    result?: { data?: { json?: unknown } };
    error?: { data?: { code?: unknown }; json?: { data?: { code?: unknown } } };
  };
  const errorData = payload.error?.json?.data ?? payload.error?.data;
  return {
    status: response.status,
    data: payload.result?.data?.json,
    errorCode: typeof errorData?.code === "string" ? errorData.code : null,
  };
}

function expectSuccess(result: TrpcWireResult): void {
  expect(result.status).toBe(200);
  expect(result.errorCode).toBeNull();
}

function mediaRequest(): Promise<Response> {
  return fetch(new URL(`/api/media/${MEDIA_KEY}`, apiBaseUrl), {
    headers: { [ACTOR_HEADER]: "3" },
    redirect: "error",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
}

function installPinnedStorageResponse(
  encrypted: Buffer,
): DeferredStorageResponse {
  let reach: (() => void) | null = null;
  let release: (() => void) | null = null;
  const reached = new Promise<void>((resolve) => {
    reach = resolve;
  });
  const response = new Promise<Response>((resolve) => {
    release = () =>
      resolve(
        new Response(Uint8Array.from(encrypted), {
          status: 200,
          headers: { "content-length": String(encrypted.length) },
        }),
      );
  });
  storageMocks.storageGetSignedUrl.mockResolvedValue(
    "https://objects.sec27.fixture.invalid/pinned-object",
  );
  storageMocks.storageFetchSignedObject.mockImplementation(() => {
    reach?.();
    return response;
  });
  return {
    reached,
    release: () => release?.(),
  };
}

async function waitForBlockedQuery(
  queryNeedle: string,
  description: string,
  options: { forUpdate?: boolean } = {},
): Promise<void> {
  const deadline = Date.now() + HTTP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await adminPool!.query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM pg_catalog.pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND query ILIKE '%' || $1 || '%'
            ${options.forUpdate ? "AND query ILIKE '%for update%'" : ""}
       ) AS waiting`,
      [queryNeedle],
    );
    if (result.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `PostgreSQL did not observe the expected lock wait: ${description}`,
  );
}

async function restoreFixtureMember(): Promise<void> {
  await adminPool!.query(
    `INSERT INTO circles_app.memberships("circleId", "userId", role)
     VALUES ($1, 3, 'member')
     ON CONFLICT ("circleId", "userId") DO UPDATE SET role = EXCLUDED.role`,
    [CIRCLE_ID],
  );
}

async function seedPrivateMedia(): Promise<SeededMedia> {
  const plaintext = Buffer.from(
    "SEC006 fixture plaintext; never fetched from a provider",
    "utf8",
  );
  const encrypted = encryptSocialMedia(plaintext);
  await adminPool!.query(
    `INSERT INTO circles_app."socialUploads"("userId", "storageKey", url, "mimeType", bytes)
     VALUES (1, $1, $2, 'image/jpeg', $3)`,
    [MEDIA_KEY, MEDIA_URL, plaintext.length],
  );
  const post = await adminPool!.query<{ id: number }>(
    `INSERT INTO circles_app.posts("authorId", "circleId", text, media, "mediaType")
     VALUES (1, $1, $2, $3, 'photo')
     RETURNING id`,
    [CIRCLE_ID, MEDIA_TEXT, MEDIA_URL],
  );
  const postId = post.rows[0]?.id;
  if (!postId)
    throw new Error("SEC006 private media fixture post was not created");
  return { postId, plaintext, encrypted };
}

async function disposePrivateMedia(postId: number): Promise<void> {
  await adminPool!.query("DELETE FROM circles_app.posts WHERE id = $1", [
    postId,
  ]);
  await adminPool!.query(
    'DELETE FROM circles_app."socialUploads" WHERE "storageKey" = $1',
    [MEDIA_KEY],
  );
}

async function catalogSnapshot(schema: string) {
  const catalog = await adminPool!.query<{
    relname: string;
    relkind: string;
    relacl: string | null;
  }>(
    `SELECT relation.relname, relation.relkind, relation.relacl::text AS relacl
       FROM pg_catalog.pg_class AS relation
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = $1
      ORDER BY relation.relname, relation.relkind`,
    [schema],
  );
  return catalog.rows;
}

beforeAll(async () => {
  fixturePort = readFixturePort();
  fixtureDatabase = process.env.CIRCLE_HOME_E2E_DB ?? "";
  const fixtureToken = process.env.CIRCLE_HOME_E2E_TOKEN ?? "";
  if (
    !/^circle_home_e2e_[a-f0-9]{24}$/.test(fixtureDatabase) ||
    !/^[a-f0-9]{64}$/.test(fixtureToken)
  ) {
    throw new Error("SEC27 requires a fresh runner-owned database marker");
  }
  const guardPool = new Pool({
    host: "127.0.0.1",
    port: fixturePort,
    database: fixtureDatabase,
    user: "postgres",
    max: 1,
    connectionTimeoutMillis: HTTP_TIMEOUT_MS,
    query_timeout: HTTP_TIMEOUT_MS,
  });
  try {
    const guard = await guardPool.query<{
      database_name: string;
      version: number;
      port: number;
      token: string;
    }>(
      `SELECT current_database() AS database_name,
              current_setting('server_version_num')::int AS version,
              inet_server_port() AS port,
              token
         FROM e2e_fixture.guard
        WHERE token = $1
        LIMIT 1`,
      [fixtureToken],
    );
    const row = guard.rows[0];
    if (
      guard.rows.length !== 1 ||
      row?.database_name !== fixtureDatabase ||
      row.port !== fixturePort ||
      row.version < 170000 ||
      row.version >= 180000 ||
      row.token !== fixtureToken
    ) {
      throw new Error(
        "SEC27 target does not match the owned local PG17 fixture",
      );
    }
  } finally {
    await guardPool.end();
  }

  priorMediaSecret = process.env.MANUS_JWT_SECRET;
  process.env.MANUS_JWT_SECRET = SYNTHETIC_MEDIA_SECRET;
  const now = new Date("2026-10-27T12:00:00.000Z");
  for (const id of [1, 2, 3, 4, 5, 6]) {
    FIXTURE_USERS.set(id, {
      id,
      openId: `sec27-security-e2e-${id}`,
      name: `SEC27 fixture ${id}`,
      email: null,
      loginMethod: null,
      role: "user",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    });
  }
  runtimePool = createRuntimeRolePool({
    host: "127.0.0.1",
    port: fixturePort,
    database: fixtureDatabase,
    user: "postgres",
    max: 4,
    connectionTimeoutMillis: HTTP_TIMEOUT_MS,
    query_timeout: HTTP_TIMEOUT_MS,
    statement_timeout: HTTP_TIMEOUT_MS,
    lock_timeout: HTTP_TIMEOUT_MS,
    idle_in_transaction_session_timeout: HTTP_TIMEOUT_MS,
  });
  database = drizzle(runtimePool, {
    schema: databaseSchema,
  }) as CirclesDatabase;
  dbFacade.database = database;
  adminPool = new Pool({
    host: "127.0.0.1",
    port: fixturePort,
    database: fixtureDatabase,
    user: "postgres",
    max: 4,
    connectionTimeoutMillis: HTTP_TIMEOUT_MS,
    query_timeout: HTTP_TIMEOUT_MS,
    statement_timeout: HTTP_TIMEOUT_MS,
    lock_timeout: HTTP_TIMEOUT_MS,
    idle_in_transaction_session_timeout: HTTP_TIMEOUT_MS,
  });
  const role = await runtimePool.query<{ current_user: string }>(
    "SELECT current_user",
  );
  expect(role.rows).toEqual([{ current_user: "circles_app_runtime" }]);
  apiBaseUrl = await startLoopbackServer();
});

afterAll(async () => {
  storageMocks.storageGetSignedUrl.mockReset();
  storageMocks.storageFetchSignedObject.mockReset();
  const closeServer = httpServer
    ? new Promise<void>((resolve) => {
        httpServer!.closeAllConnections?.();
        httpServer!.close(() => resolve());
      })
    : Promise.resolve();
  await closeServer;
  await Promise.all([runtimePool?.end(), adminPool?.end()]);
  database = null;
  dbFacade.database = null;
  if (priorMediaSecret === undefined) delete process.env.MANUS_JWT_SECRET;
  else process.env.MANUS_JWT_SECRET = priorMediaSecret;
});

describe.sequential(
  "SEC27 guarded local HTTP/Drizzle/PostgreSQL 17 security proof",
  () => {
    it("SEC006 keeps storage I/O outside DB locks, then keeps final enqueue ordered before a waiting removeMember commits", async () => {
      let seeded: SeededMedia | null = null;
      let membershipBarrier: PoolClient | null = null;
      let membershipBarrierCommitted = false;
      let removalResolvedSequence = 0;
      let pendingReaderFirstRemoval: Promise<TrpcWireResult> | null = null;
      try {
        seeded = await seedPrivateMedia();

        // Removal wins while an explicitly pinned local storage response is withheld. The actual
        // router mutation succeeds before network response release, proving no DB transaction spans
        // signing/fetch/decryption. The response seam never invokes a signer or remote URL.
        storageMocks.storageGetSignedUrl.mockReset();
        storageMocks.storageFetchSignedObject.mockReset();
        const removalWinsStorage = installPinnedStorageResponse(
          seeded.encrypted,
        );
        const pendingRemovalWinsMedia = mediaRequest();
        await removalWinsStorage.reached;
        expect(storageMocks.storageGetSignedUrl).toHaveBeenCalledTimes(1);
        expect(storageMocks.storageFetchSignedObject).toHaveBeenCalledTimes(1);
        expectSuccess(
          await trpc(
            "social.removeMember",
            { circleId: CIRCLE_ID, userId: 3 },
            1,
          ),
        );
        removalWinsStorage.release();
        const denied = await pendingRemovalWinsMedia;
        expect(denied.status).toBe(404);
        expect(await denied.text()).toBe("Media not found");

        // Reader-first uses the same pinned storage response. Locking memberships only after the
        // initial storage call has begun makes the final authorization take its real parent FOR
        // SHARE lock first, then wait for its approved-role recheck. The actual removeMember route
        // is observed waiting on FOR UPDATE before the test releases that barrier.
        await restoreFixtureMember();
        responseSequence = 0;
        successfulMediaEnqueueSequence = 0;
        storageMocks.storageGetSignedUrl.mockReset();
        storageMocks.storageFetchSignedObject.mockReset();
        const readerFirstStorage = installPinnedStorageResponse(
          seeded.encrypted,
        );
        const pendingReaderFirstMedia = mediaRequest();
        await readerFirstStorage.reached;
        membershipBarrier = await adminPool!.connect();
        await membershipBarrier.query("BEGIN");
        await membershipBarrier.query(
          'LOCK TABLE circles_app."memberships" IN ACCESS EXCLUSIVE MODE',
        );
        readerFirstStorage.release();
        await waitForBlockedQuery(
          '"circles_app"."memberships"',
          "final media authorization role check after parent SHARE lock",
        );
        pendingReaderFirstRemoval = trpc(
          "social.removeMember",
          { circleId: CIRCLE_ID, userId: 3 },
          1,
        ).then((result) => {
          removalResolvedSequence = ++responseSequence;
          return result;
        });
        await waitForBlockedQuery(
          '"circles_app"."circles"',
          "removeMember waiting for the final media parent SHARE lock",
          { forUpdate: true },
        );
        await membershipBarrier.query("COMMIT");
        membershipBarrierCommitted = true;

        const readerFirst = await pendingReaderFirstMedia;
        expect(readerFirst.status).toBe(200);
        expect(Buffer.from(await readerFirst.arrayBuffer())).toEqual(
          seeded.plaintext,
        );
        expect(successfulMediaEnqueueSequence).toBeGreaterThan(0);
        expectSuccess(await pendingReaderFirstRemoval);
        expect(removalResolvedSequence).toBeGreaterThan(
          successfulMediaEnqueueSequence,
        );
      } finally {
        if (membershipBarrier && !membershipBarrierCommitted) {
          await membershipBarrier.query("ROLLBACK").catch(() => undefined);
        }
        membershipBarrier?.release();
        if (pendingReaderFirstRemoval)
          await pendingReaderFirstRemoval.catch(() => undefined);
        await restoreFixtureMember();
        if (seeded) await disposePrivateMedia(seeded.postId);
        storageMocks.storageGetSignedUrl.mockReset();
        storageMocks.storageFetchSignedObject.mockReset();
      }
    });

    it("SEC022 rolls back a future synthetic atomic bundle completely while preserving historical 0001 bytes", async () => {
      const historicalBytes = readFileSync(HISTORICAL_MIGRATION);
      expect(historicalBytes.byteLength).toBe(HISTORICAL_MIGRATION_BYTES);
      expect(createHash("sha256").update(historicalBytes).digest("hex")).toBe(
        HISTORICAL_MIGRATION_SHA256,
      );

      // Only future synthetic bytes are passed to the real helper, using the guarded loopback
      // fixture client. No applied migration or installed history is submitted.
      const schema = "sec27_atomic_rollback_fixture";
      const directory = mkdtempSync(join(tmpdir(), "circles-sec27-atomic-"));
      mkdirSync(join(directory, "operations/future-migrations"), {
        recursive: true,
      });
      const sqlFiles = [
        `CREATE TABLE ${schema}.future_history (manifest_sha text PRIMARY KEY)`,
        `CREATE TABLE ${schema}.future_partial (id integer PRIMARY KEY)`,
        `INSERT INTO ${schema}.future_history(manifest_sha) VALUES ('synthetic-manifest-only')`,
        `SELECT missing_column FROM ${schema}.intentional_failure`,
      ];
      const entries = sqlFiles.map((sql, index) => {
        const relativePath = `operations/future-migrations/${index + 1}.sql`;
        writeFileSync(join(directory, relativePath), sql);
        return {
          ordinal: index + 1,
          path: relativePath,
          sha256: createHash("sha256").update(sql).digest("hex"),
        };
      });
      writeFileSync(
        join(directory, "manifest.json"),
        JSON.stringify({ format: FUTURE_MANIFEST_FORMAT, entries }),
      );
      const client = await adminPool!.connect();
      let schemaCreated = false;
      let rolledBack = false;
      try {
        await client.query(`CREATE SCHEMA ${schema}`);
        schemaCreated = true;
        await client.query(
          `CREATE TABLE ${schema}.baseline_anchor (id integer PRIMARY KEY)`,
        );
        const before = await catalogSnapshot(schema);
        expect(before.map((row) => row.relname)).toContain("baseline_anchor");
        const recordReceipt = vi.fn();
        await expect(
          applyFutureOnlyMigrationBundle({
            pgClient: client,
            repositoryRoot: directory,
            manifestRelativePath: "manifest.json",
            recordReceipt,
          }),
        ).rejects.toMatchObject({
          code: "transaction_rolled_back",
          rollbackAttempted: true,
        });
        expect(recordReceipt).not.toHaveBeenCalled();
        rolledBack = true;
        expect(rolledBack).toBe(true);
        expect(await catalogSnapshot(schema)).toEqual(before);
        const residue = await adminPool!.query<{
          history: string | null;
          partial: string | null;
        }>(
          `SELECT to_regclass($1)::text AS history, to_regclass($2)::text AS partial`,
          [`${schema}.future_history`, `${schema}.future_partial`],
        );
        expect(residue.rows).toEqual([{ history: null, partial: null }]);
      } finally {
        try {
          if (!rolledBack) await client.query("ROLLBACK");
        } catch {
          // No transaction may have been opened if synthetic setup failed.
        }
        client.release();
        rmSync(directory, { recursive: true, force: true });
        if (schemaCreated)
          await adminPool!.query(`DROP SCHEMA ${schema} CASCADE`);
      }
    });
  },
);
