import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import express from "express";
import {
  createExpressMiddleware,
  type CreateExpressContextOptions,
} from "@trpc/server/adapters/express";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as coreSchema from "../drizzle/schema";
import * as liveSchema from "../drizzle/live-schema";
import * as sessionSchema from "../drizzle/session-schema";
import * as postPublishReceiptSchema from "../drizzle/post-publish-receipt-schema";
import type { User } from "../drizzle/schema";
import type { TrpcContext } from "../server/_core/context";
import { router } from "../server/_core/trpc";
import { socialRouter } from "../server/social-router";
import {
  createRuntimeRolePool,
  type RuntimeRolePool,
} from "../server/runtime-role-pool";
import {
  decryptSocialMedia,
  SOCIAL_MEDIA_FRAME_OVERHEAD,
} from "../server/social-service";
import { syntheticRecordedMp4 } from "../tests/fixtures/recorded-mp4";

const ACTOR_HEADER = "x-post-publish-e2e-user";
const HTTP_TIMEOUT_MS = 4_000;
const FIXTURE_USERS = new Map<number, User>();
const OWNED_VIDEO_KEY =
  "social-encrypted/1/123e4567-e89b-42d3-a456-426614174000.mp4.enc";
const OWNED_VIDEO_URL = `/manus-storage/${OWNED_VIDEO_KEY}`;
const SYNTHETIC_MEDIA_SECRET =
  "post-publish-e2e-fixed-local-media-secret-not-a-provider-key";
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const RECORDED_MP4_FIXTURE = readFileSync(
  new URL("./fixtures/record-preview-publish-720p.mp4", import.meta.url),
);

/**
 * The only mock is the application database facade. It receives a real local Drizzle instance
 * backed by the runner-owned PG17 database; HTTP, router, service, SQL, and RLS are production code.
 */
const dbFacade = vi.hoisted(() => ({ database: null as unknown }));
const storageFacade = vi.hoisted(() => {
  const encryptedWrites: {
    key: string;
    bytes: Buffer;
    contentType: string;
    stableKey: boolean;
    signalAborted: boolean;
  }[] = [];
  return {
    encryptedWrites,
    storagePut: vi.fn(
      async (
        key: string,
        data: Buffer | Uint8Array | string,
        contentType = "application/octet-stream",
        options?: { stableKey?: boolean; signal?: AbortSignal },
      ) => {
        encryptedWrites.push({
          key,
          bytes: Buffer.from(data),
          contentType,
          stableKey: options?.stableKey === true,
          signalAborted: options?.signal?.aborted === true,
        });
        return { key, url: `/manus-storage/${key}` };
      },
    ),
  };
});
vi.mock("../server/db", () => ({
  getDb: () => Promise.resolve(dbFacade.database),
}));
// Explicit external object-store seam only; router/service/crypto/SQL remain production code.
vi.mock("../server/storage", () => ({
  storagePut: storageFacade.storagePut,
}));

const databaseSchema = {
  ...coreSchema,
  ...liveSchema,
  ...sessionSchema,
  ...postPublishReceiptSchema,
};
const publicationHttpRouter = router({ social: socialRouter });

type TrpcWireResult = {
  status: number;
  data: unknown;
  errorCode: string | null;
  errorMessage: string | null;
};
type PublicationInput = {
  text: string;
  mediaType: "text" | "photo" | "video";
  media?: string;
  circleId?: number;
  clientPublishId?: string;
};
type UploadInput = {
  base64: string;
  mimeType: string;
  recording?: { maxDurationSeconds: 30 | 60 };
};

let runtimePool: RuntimeRolePool | null = null;
let adminPool: Pool | null = null;
let httpServer: Server | null = null;
let apiBaseUrl = "";
let fixturePort = 0;
let fixtureDatabase = "";
let priorMediaSecret: string | undefined;

function readFixturePort(): number {
  const raw = process.env.CIRCLE_HOME_E2E_PG_PORT;
  if (!raw || !/^\d{1,5}$/.test(raw)) {
    throw new Error(
      "Post publication E2E fixture port was not supplied by the isolated runner",
    );
  }
  const port = Number(raw);
  if (
    !Number.isSafeInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    [3000, 8081].includes(port)
  ) {
    throw new Error(
      "Post publication E2E fixture port is not an allowed loopback port",
    );
  }
  return port;
}

function fixtureUser(id: number): User | null {
  return FIXTURE_USERS.get(id) ?? null;
}

/** Test-only context injection; shipped session/authentication code is never changed. */
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
  // 32 MiB is test-server-only and admits a just-over-20-MiB base64 body so the route's own
  // byte limit—not Express's parser—can fail it within the finite loopback request deadline.
  app.use(express.json({ limit: "32mb" }));
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: publicationHttpRouter,
      createContext: createFixtureContext,
    }),
  );
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
      "Post publication E2E HTTP listener was not assigned an isolated loopback port",
    );
  }
  httpServer = server;
  return `http://127.0.0.1:${address.port}`;
}

async function trpc(
  procedure:
    | "social.createPost"
    | "social.deletePost"
    | "social.publicationStatus"
    | "social.upload",
  input: Record<string, unknown>,
  actorId: number | null,
): Promise<TrpcWireResult> {
  const url = new URL(`/api/trpc/${procedure}`, apiBaseUrl);
  const isQuery = procedure === "social.publicationStatus";
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (actorId !== null) headers[ACTOR_HEADER] = String(actorId);
  const request: RequestInit = {
    method: isQuery ? "GET" : "POST",
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  };
  if (isQuery) {
    if (Object.keys(input).length) {
      url.searchParams.set("input", JSON.stringify({ json: input }));
    }
  } else {
    headers["Content-Type"] = "application/json";
    request.body = JSON.stringify({ json: input });
  }
  const response = await fetch(url, request);
  const payload = (await response.json()) as {
    result?: { data?: { json?: unknown } };
    error?: {
      data?: { code?: unknown };
      message?: unknown;
      json?: { data?: { code?: unknown }; message?: unknown };
    };
  };
  const errorData = payload.error?.json?.data ?? payload.error?.data;
  const errorMessage = payload.error?.json?.message ?? payload.error?.message;
  return {
    status: response.status,
    data: payload.result?.data?.json,
    errorCode: typeof errorData?.code === "string" ? errorData.code : null,
    errorMessage: typeof errorMessage === "string" ? errorMessage : null,
  };
}

function expectSuccess(
  result: TrpcWireResult,
): asserts result is TrpcWireResult & { data: Record<string, unknown> } {
  expect(result.status).toBe(200);
  expect(result.errorCode).toBeNull();
  expect(result.data).toBeTruthy();
}

async function publish(actorId: number | null, input: PublicationInput) {
  return trpc("social.createPost", input, actorId);
}

async function upload(actorId: number | null, input: UploadInput) {
  return trpc("social.upload", input, actorId);
}

function postId(result: TrpcWireResult): number {
  expectSuccess(result);
  expect(result.data.id).toEqual(expect.any(Number));
  return result.data.id as number;
}

async function postCount(text: string): Promise<number> {
  const result = await adminPool!.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM circles_app.posts WHERE text = $1",
    [text],
  );
  return Number(result.rows[0]?.count ?? 0);
}

function resetStorageCapture() {
  storageFacade.storagePut.mockClear();
  storageFacade.encryptedWrites.length = 0;
}

beforeAll(async () => {
  fixturePort = readFixturePort();
  fixtureDatabase = process.env.CIRCLE_HOME_E2E_DB ?? "";
  const fixtureToken = process.env.CIRCLE_HOME_E2E_TOKEN ?? "";
  if (
    !/^circle_home_e2e_[a-f0-9]{24}$/.test(fixtureDatabase) ||
    !/^[a-f0-9]{64}$/.test(fixtureToken)
  ) {
    throw new Error(
      "Post publication E2E requires a fresh runner-owned database marker",
    );
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
      databaseName: string;
      version: number;
      port: number;
      token: string;
    }>(
      `SELECT current_database() AS "databaseName",
        current_setting('server_version_num')::int AS version,
        inet_server_port() AS port, token
       FROM e2e_fixture.guard WHERE token = $1 LIMIT 1`,
      [fixtureToken],
    );
    const row = guard.rows[0];
    if (
      guard.rows.length !== 1 ||
      row.databaseName !== fixtureDatabase ||
      row.port !== fixturePort ||
      row.version < 170000 ||
      row.version >= 180000 ||
      row.token !== fixtureToken
    ) {
      throw new Error(
        "Post publication E2E target does not match the owned local fixture",
      );
    }
  } finally {
    await guardPool.end();
  }

  priorMediaSecret = process.env.MANUS_JWT_SECRET;
  process.env.MANUS_JWT_SECRET = SYNTHETIC_MEDIA_SECRET;
  const now = new Date("2026-10-27T07:00:00.000Z");
  for (const id of [1, 2, 3, 4, 5, 6, 7]) {
    FIXTURE_USERS.set(id, {
      id,
      openId: `post-publish-e2e-${id}`,
      name: `Fixture ${id}`,
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
  dbFacade.database = drizzle(runtimePool, { schema: databaseSchema });
  adminPool = new Pool({
    host: "127.0.0.1",
    port: fixturePort,
    database: fixtureDatabase,
    user: "postgres",
    max: 2,
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
  await adminPool.query(
    `INSERT INTO circles_app."socialUploads"("userId", "storageKey", url, "mimeType", bytes)
     VALUES ($1, $2, $3, 'video/mp4', 96)`,
    [1, OWNED_VIDEO_KEY, OWNED_VIDEO_URL],
  );
  apiBaseUrl = await startLoopbackServer();
});

afterAll(async () => {
  const closeServer = httpServer
    ? new Promise<void>((resolve) => {
        httpServer!.closeAllConnections?.();
        httpServer!.close(() => resolve());
      })
    : Promise.resolve();
  await closeServer;
  await Promise.all([runtimePool?.end(), adminPool?.end()]);
  dbFacade.database = null;
  resetStorageCapture();
  if (priorMediaSecret === undefined) delete process.env.MANUS_JWT_SECRET;
  else process.env.MANUS_JWT_SECRET = priorMediaSecret;
});

describe.sequential("Post publication idempotency isolated HTTP E2E", () => {
  it("keeps the receipt table private, forced-RLS, and writable only by the runtime role", async () => {
    const legacyColumns = await adminPool!.query<{ name: string }>(
      `SELECT attribute_catalog.attname AS name
         FROM pg_catalog.pg_attribute AS attribute_catalog
        WHERE attribute_catalog.attrelid = 'circles_publish."postPublishReceipts"'::pg_catalog.regclass
          AND attribute_catalog.attnum > 0
          AND NOT attribute_catalog.attisdropped
        ORDER BY attribute_catalog.attnum`,
    );
    expect(legacyColumns.rows).toEqual([
      { name: "actorId" },
      { name: "operationId" },
      { name: "payloadHash" },
      { name: "postId" },
      { name: "createdAt" },
    ]);
    const result = await adminPool!.query<{
      rls: boolean;
      forced: boolean;
      runtimeSelect: boolean;
      runtimeInsert: boolean;
      runtimeUpdate: boolean;
      runtimeDelete: boolean;
      anonSelect: boolean;
      authenticatedSelect: boolean;
      serviceRoleSelect: boolean;
    }>(
      `SELECT relation_catalog.relrowsecurity AS rls,
              relation_catalog.relforcerowsecurity AS forced,
              has_table_privilege('circles_app_runtime', relation_catalog.oid, 'SELECT') AS "runtimeSelect",
              has_table_privilege('circles_app_runtime', relation_catalog.oid, 'INSERT') AS "runtimeInsert",
              has_table_privilege('circles_app_runtime', relation_catalog.oid, 'UPDATE') AS "runtimeUpdate",
              has_table_privilege('circles_app_runtime', relation_catalog.oid, 'DELETE') AS "runtimeDelete",
              has_table_privilege('anon', relation_catalog.oid, 'SELECT') AS "anonSelect",
              has_table_privilege('authenticated', relation_catalog.oid, 'SELECT') AS "authenticatedSelect",
              has_table_privilege('service_role', relation_catalog.oid, 'SELECT') AS "serviceRoleSelect"
         FROM pg_catalog.pg_class AS relation_catalog
         JOIN pg_catalog.pg_namespace AS namespace_catalog
           ON namespace_catalog.oid = relation_catalog.relnamespace
        WHERE namespace_catalog.nspname = 'circles_publish'
          AND relation_catalog.relname = 'postPublishReceipts'`,
    );
    expect(result.rows).toEqual([
      {
        rls: true,
        forced: true,
        runtimeSelect: true,
        runtimeInsert: true,
        runtimeUpdate: true,
        runtimeDelete: false,
        anonSelect: false,
        authenticatedSelect: false,
        serviceRoleSelect: false,
      },
    ]);
    expect(await trpc("social.publicationStatus", {}, null)).toMatchObject({
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    const status = await trpc("social.publicationStatus", {}, 1);
    expectSuccess(status);
    expect(status.data).toEqual({ ready: true });
  });

  it("takes a real recorded MP4 through HTTP validation, encryption, upload recording, and an ignored-result publication retry", async () => {
    resetStorageCapture();
    expect(RECORDED_MP4_FIXTURE.byteLength).toBeLessThan(50 * 1024);

    const uploaded = await upload(1, {
      base64: RECORDED_MP4_FIXTURE.toString("base64"),
      mimeType: "video/mp4",
      recording: { maxDurationSeconds: 30 },
    });
    expectSuccess(uploaded);
    expect(uploaded.data.url).toEqual(expect.any(String));
    const mediaUrl = uploaded.data.url as string;
    expect(mediaUrl).toMatch(
      /^\/manus-storage\/social-encrypted\/1\/[0-9a-f-]{36}\.mp4\.enc$/,
    );

    expect(storageFacade.storagePut).toHaveBeenCalledTimes(1);
    expect(storageFacade.encryptedWrites).toHaveLength(1);
    const encryptedWrite = storageFacade.encryptedWrites[0]!;
    expect(encryptedWrite).toMatchObject({
      key: mediaUrl.slice("/manus-storage/".length),
      contentType: "application/octet-stream",
      stableKey: true,
      signalAborted: false,
    });
    expect(encryptedWrite.bytes).not.toEqual(RECORDED_MP4_FIXTURE);
    expect(encryptedWrite.bytes.byteLength).toBe(
      RECORDED_MP4_FIXTURE.byteLength + SOCIAL_MEDIA_FRAME_OVERHEAD,
    );
    expect(
      decryptSocialMedia(encryptedWrite.bytes, SYNTHETIC_MEDIA_SECRET),
    ).toEqual(RECORDED_MP4_FIXTURE);

    const recorded = await adminPool!.query<{
      userId: number;
      storageKey: string;
      url: string;
      mimeType: string;
      bytes: number;
      claimedAt: Date | null;
    }>(
      `SELECT "userId" AS "userId", "storageKey" AS "storageKey", url,
              "mimeType" AS "mimeType", bytes, "claimedAt" AS "claimedAt"
         FROM circles_app."socialUploads"
        WHERE url = $1`,
      [mediaUrl],
    );
    expect(recorded.rows).toEqual([
      {
        userId: 1,
        storageKey: encryptedWrite.key,
        url: mediaUrl,
        mimeType: "video/mp4",
        bytes: RECORDED_MP4_FIXTURE.byteLength,
        claimedAt: null,
      },
    ]);

    const forkedActor = await publish(3, {
      text: "forked actor cannot publish another recorded upload",
      media: mediaUrl,
      mediaType: "video",
      clientPublishId: "recorded-forked-actor-001",
    });
    expect(forkedActor).toMatchObject({
      status: 403,
      errorCode: "FORBIDDEN",
    });
    expect(
      await postCount("forked actor cannot publish another recorded upload"),
    ).toBe(0);

    const publication: PublicationInput = {
      text: "record preview publication survives response loss",
      media: mediaUrl,
      mediaType: "video",
      clientPublishId: "record-preview-retry-0001",
    };
    // The first request completes at the server, but this caller deliberately ignores its body to
    // model response loss. The identical retry is the only result the simulated caller consumes.
    await publish(1, publication);
    const retry = await publish(1, publication);
    const id = postId(retry);
    expect(await postCount(publication.text)).toBe(1);
    expect(storageFacade.storagePut).toHaveBeenCalledTimes(1);

    const receipt = await adminPool!.query<{
      postId: number;
      payloadHash: string;
      claimedAt: Date | null;
    }>(
      `SELECT receipt."postId" AS "postId", receipt."payloadHash" AS "payloadHash",
              upload."claimedAt" AS "claimedAt"
         FROM circles_publish."postPublishReceipts" AS receipt
         JOIN circles_app."socialUploads" AS upload ON upload.url = $1
        WHERE receipt."actorId" = 1 AND receipt."operationId" = $2`,
      [mediaUrl, publication.clientPublishId],
    );
    expect(receipt.rows).toHaveLength(1);
    expect(receipt.rows[0]?.postId).toBe(id);
    expect(receipt.rows[0]?.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.rows[0]?.claimedAt).toEqual(expect.any(Date));
  });

  it("rejects declared MOV, incomplete MP4, and over-30-second recording bytes before object storage while permitting the same real clip at 60", async () => {
    resetStorageCapture();
    const base64 = RECORDED_MP4_FIXTURE.toString("base64");

    const declaredMov = await upload(1, {
      base64,
      mimeType: "video/quicktime",
      recording: { maxDurationSeconds: 30 },
    });
    expect(declaredMov).toMatchObject({
      status: 400,
      errorCode: "BAD_REQUEST",
    });

    const truncated = await upload(1, {
      base64: RECORDED_MP4_FIXTURE.subarray(0, -8).toString("base64"),
      mimeType: "video/mp4",
      recording: { maxDurationSeconds: 30 },
    });
    expect(truncated).toMatchObject({
      status: 400,
      errorCode: "BAD_REQUEST",
      errorMessage: expect.stringContaining("incomplete or damaged"),
    });

    const overThirtySeconds = await upload(1, {
      base64: Buffer.from(
        syntheticRecordedMp4({ durationMs: 30_001 }),
      ).toString("base64"),
      mimeType: "video/mp4",
      recording: { maxDurationSeconds: 30 },
    });
    expect(overThirtySeconds).toMatchObject({
      status: 400,
      errorCode: "BAD_REQUEST",
      errorMessage: "This recording is longer than the selected time limit.",
    });
    expect(storageFacade.storagePut).not.toHaveBeenCalled();
    expect(storageFacade.encryptedWrites).toEqual([]);

    const sixtySecondSelection = await upload(1, {
      base64,
      mimeType: "video/mp4",
      recording: { maxDurationSeconds: 60 },
    });
    expectSuccess(sixtySecondSelection);
    expect(sixtySecondSelection.data).toMatchObject({
      url: expect.stringMatching(
        /^\/manus-storage\/social-encrypted\/1\/[0-9a-f-]{36}\.mp4\.enc$/,
      ),
    });
    // This validates the 60-second contract with the same one-second bytes, not a device capture.
    expect(storageFacade.storagePut).toHaveBeenCalledTimes(1);
  });

  it("rejects unauthenticated and over-20-MiB HTTP uploads before storage or upload recording", async () => {
    resetStorageCapture();
    const initialUploads = await adminPool!.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM circles_app."socialUploads"',
    );
    const validInput: UploadInput = {
      base64: RECORDED_MP4_FIXTURE.toString("base64"),
      mimeType: "video/mp4",
      recording: { maxDurationSeconds: 30 },
    };
    expect(await upload(null, validInput)).toMatchObject({
      status: 401,
      errorCode: "UNAUTHORIZED",
    });

    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0xa5);
    const rejected = await upload(1, {
      ...validInput,
      base64: oversized.toString("base64"),
    });
    expect(rejected).toMatchObject({
      status: 400,
      errorCode: "BAD_REQUEST",
      errorMessage: "Upload must be between 1 byte and 20 MB",
    });
    expect(storageFacade.storagePut).not.toHaveBeenCalled();
    expect(storageFacade.encryptedWrites).toEqual([]);
    const finalUploads = await adminPool!.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM circles_app."socialUploads"',
    );
    expect(finalUploads.rows).toEqual(initialUploads.rows);
  });

  it("returns the exact same authorized post for normalized matching retry and claims media once", async () => {
    const input: PublicationInput = {
      text: "  exact receipt publication  ",
      media: OWNED_VIDEO_URL,
      mediaType: "video",
      clientPublishId: "publish-exact-000001",
    };
    const first = await publish(1, input);
    const retry = await publish(1, {
      ...input,
      text: "exact receipt publication",
    });
    const id = postId(first);
    expect(postId(retry)).toBe(id);
    expect(await postCount("exact receipt publication")).toBe(1);

    const receipt = await adminPool!.query<{
      postId: number;
      payloadHash: string;
      claimedAt: Date | null;
    }>(
      `SELECT receipt."postId" AS "postId", receipt."payloadHash" AS "payloadHash",
              upload."claimedAt" AS "claimedAt"
         FROM circles_publish."postPublishReceipts" AS receipt
         JOIN circles_app."socialUploads" AS upload ON upload."storageKey" = $1
        WHERE receipt."actorId" = 1 AND receipt."operationId" = $2`,
      [OWNED_VIDEO_KEY, input.clientPublishId],
    );
    expect(receipt.rows).toHaveLength(1);
    expect(receipt.rows[0]?.postId).toBe(id);
    expect(receipt.rows[0]?.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.rows[0]?.claimedAt).toEqual(expect.any(Date));
  });

  it("serializes concurrent HTTP retries for one actor and operation into one post", async () => {
    const input: PublicationInput = {
      text: "concurrent receipt publication",
      mediaType: "text",
      clientPublishId: "publish-concurrent-01",
    };
    const [first, second] = await Promise.all([
      publish(1, input),
      publish(1, input),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(postId(first)).toBe(postId(second));
    expect(await postCount(input.text)).toBe(1);
  });

  it("rejects changed-payload reuse without a second post and scopes the same operation ID per actor", async () => {
    const operationId = "publish-conflict-00001";
    const original = await publish(3, {
      text: "original publication payload",
      mediaType: "text",
      clientPublishId: operationId,
    });
    expectSuccess(original);
    const changed = await publish(3, {
      text: "changed publication payload",
      mediaType: "text",
      clientPublishId: operationId,
    });
    expect(changed).toMatchObject({ status: 409, errorCode: "CONFLICT" });
    expect(await postCount("changed publication payload")).toBe(0);

    const actorOne = await publish(1, {
      text: "actor isolated operation",
      mediaType: "text",
      clientPublishId: "publish-actor-isolation",
    });
    const actorThree = await publish(3, {
      text: "actor isolated operation",
      mediaType: "text",
      clientPublishId: "publish-actor-isolation",
    });
    expect(postId(actorOne)).not.toBe(postId(actorThree));
    expect(await postCount("actor isolated operation")).toBe(2);
  });

  it("rechecks protected circle membership and managed-media ownership inside publication", async () => {
    const privateInput: PublicationInput = {
      text: "private receipt publication",
      mediaType: "text",
      circleId: 12,
      clientPublishId: "publish-private-member-01",
    };
    expect(await publish(null, privateInput)).toMatchObject({
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    for (const actorId of [4, 5]) {
      expect(await publish(actorId, privateInput)).toMatchObject({
        status: 403,
        errorCode: "FORBIDDEN",
      });
    }
    const member = await publish(3, privateInput);
    expectSuccess(member);
    expect(member.data.circleId).toBe(12);

    const foreignMedia = await publish(3, {
      text: "foreign managed media must fail",
      media: OWNED_VIDEO_URL,
      mediaType: "video",
      clientPublishId: "publish-foreign-media-01",
    });
    expect(foreignMedia).toMatchObject({ status: 403, errorCode: "FORBIDDEN" });
    const forgedMime = await publish(1, {
      text: "caller media type must match stored metadata",
      media: OWNED_VIDEO_URL,
      mediaType: "photo",
      clientPublishId: "publish-forged-mime-001",
    });
    expect(forgedMime).toMatchObject({ status: 400, errorCode: "BAD_REQUEST" });
    const foreignReceipt = await adminPool!.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM circles_publish."postPublishReceipts"
        WHERE ("actorId" = 3 AND "operationId" = 'publish-foreign-media-01')
           OR ("actorId" = 1 AND "operationId" = 'publish-forged-mime-001')`,
    );
    expect(Number(foreignReceipt.rows[0]?.count ?? 0)).toBe(0);
  });

  it("preserves a deleted-post tombstone and never recreates that operation", async () => {
    const input: PublicationInput = {
      text: "deleted publication tombstone",
      mediaType: "text",
      clientPublishId: "publish-tombstone-0001",
    };
    const created = await publish(1, input);
    const deletedPostId = postId(created);
    expectSuccess(
      await trpc("social.deletePost", { postId: deletedPostId }, 1),
    );
    const retry = await publish(1, input);
    expect(retry).toMatchObject({ status: 409, errorCode: "CONFLICT" });
    expect(await postCount(input.text)).toBe(0);
    const tombstone = await adminPool!.query<{ postId: number | null }>(
      `SELECT "postId" AS "postId" FROM circles_publish."postPublishReceipts"
        WHERE "actorId" = 1 AND "operationId" = $1`,
      [input.clientPublishId],
    );
    expect(tombstone.rows).toEqual([{ postId: null }]);
  });

  it("retries through the current six-column generated-bigint receipt identity without exposing it", async () => {
    // All legacy cases above use the unmodified five-column migration fixture. This local DDL
    // deliberately upgrades only the remaining disposable fixture before the final DROP TABLE case.
    await adminPool!.query(
      `ALTER TABLE circles_publish."postPublishReceipts"
         ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`,
    );
    const identity = await adminPool!.query<{
      sequence: string;
      generatedAlways: boolean;
      bigint: boolean;
      primaryKey: boolean;
    }>(
      `SELECT pg_catalog.pg_get_serial_sequence(
                'circles_publish."postPublishReceipts"',
                'id'
              ) AS sequence,
              attribute_catalog.attidentity = 'a' AS "generatedAlways",
              pg_catalog.format_type(
                attribute_catalog.atttypid,
                attribute_catalog.atttypmod
              ) = 'bigint' AS bigint,
              EXISTS (
                SELECT 1
                  FROM pg_catalog.pg_constraint AS constraint_catalog
                 WHERE constraint_catalog.conrelid = attribute_catalog.attrelid
                   AND constraint_catalog.contype = 'p'
                   AND constraint_catalog.conkey = ARRAY[attribute_catalog.attnum]::smallint[]
              ) AS "primaryKey"
         FROM pg_catalog.pg_attribute AS attribute_catalog
        WHERE attribute_catalog.attrelid = 'circles_publish."postPublishReceipts"'::pg_catalog.regclass
          AND attribute_catalog.attname = 'id'
          AND NOT attribute_catalog.attisdropped`,
    );
    expect(identity.rows).toEqual([
      {
        sequence: expect.any(String),
        generatedAlways: true,
        bigint: true,
        primaryKey: true,
      },
    ]);
    await adminPool!.query("SELECT setval($1::regclass, $2::bigint, true)", [
      identity.rows[0]!.sequence,
      BigInt(Number.MAX_SAFE_INTEGER).toString(),
    ]);

    const input: PublicationInput = {
      text: "current generated receipt identity",
      mediaType: "text",
      clientPublishId: "publish-current-six-001",
    };
    const first = await publish(2, input);
    const retry = await publish(2, input);
    const id = postId(first);
    expect(postId(retry)).toBe(id);
    expect(Number.isSafeInteger(id)).toBe(true);
    expect(first.data).not.toHaveProperty("receiptId");

    const receipt = await adminPool!.query<{ id: string; postId: number }>(
      `SELECT id::text AS id, "postId" AS "postId"
         FROM circles_publish."postPublishReceipts"
        WHERE "actorId" = 2 AND "operationId" = $1`,
      [input.clientPublishId],
    );
    expect(receipt.rows).toEqual([
      {
        id: (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString(),
        postId: id,
      },
    ]);
  });

  it("fails ID-bearing publication safely when the receipt migration is absent while legacy publication remains available", async () => {
    await adminPool!.query('DROP TABLE circles_publish."postPublishReceipts"');
    const status = await trpc("social.publicationStatus", {}, 1);
    expectSuccess(status);
    expect(status.data).toEqual({ ready: false });
    const retrySafe = await publish(1, {
      text: "missing receipt migration",
      mediaType: "text",
      clientPublishId: "publish-schema-missing-01",
    });
    expect(retrySafe).toMatchObject({
      status: 412,
      errorCode: "PRECONDITION_FAILED",
    });
    const legacy = await publish(1, {
      text: "legacy after receipt schema removed",
      mediaType: "text",
    });
    expectSuccess(legacy);
    expect(await postCount("legacy after receipt schema removed")).toBe(1);
  });
});
