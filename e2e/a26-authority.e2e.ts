import { once } from "node:events";
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
import type { User } from "../drizzle/schema";
import { TRUSTED_STARTER_MEDIA_URLS } from "../shared/media";
import type { TrpcContext } from "../server/_core/context";
import { router } from "../server/_core/trpc";
import type { CirclesDatabase } from "../server/db";
import { liveRouter } from "../server/live-router";
import {
  createRuntimeRolePool,
  type RuntimeRolePool,
} from "../server/runtime-role-pool";
import { socialRouter } from "../server/social-router";

const ACTOR_HEADER = "x-circle-home-e2e-user";
const HTTP_TIMEOUT_MS = 4_000;
const FIXTURE_USERS = new Map<number, User>();
const CIRCLE_ID = 12;
const PRIVATE_PREVIEW_TEXT = "A26 private current preview";
const PRIVATE_UNREAD_TEXT = "A26 private current unread message";
const DIRECT_TEXT = "A26 direct participant remains available";
const LIVE_TITLE = "A26 isolated thumbnail authority";
const OWNED_IMAGE_KEY =
  "social-encrypted/1/123e4567-e89b-42d3-a456-426614174000.jpg.enc";
const FOREIGN_IMAGE_KEY =
  "social-encrypted/6/123e4567-e89b-42d3-a456-426614174001.jpg.enc";
const OWNED_VIDEO_KEY =
  "social-encrypted/1/123e4567-e89b-42d3-a456-426614174002.mp4.enc";
const OWNED_IMAGE_URL = `/manus-storage/${OWNED_IMAGE_KEY}`;
const FOREIGN_IMAGE_URL = `/manus-storage/${FOREIGN_IMAGE_KEY}`;
const OWNED_VIDEO_URL = `/manus-storage/${OWNED_VIDEO_KEY}`;

/**
 * This is the only server mock in the suite. It supplies production routers/services with a real
 * local Drizzle instance backed by a runner-owned RuntimeRolePool; no query, route, service, or
 * authorization behavior is substituted. Actor headers below are test-only context injection.
 */
const dbFacade = vi.hoisted(() => ({ database: null as unknown }));
vi.mock("../server/db", () => ({
  getDb: () => Promise.resolve(dbFacade.database),
}));

const databaseSchema = { ...coreSchema, ...liveSchema, ...sessionSchema };
const authorityHttpRouter = router({ social: socialRouter, live: liveRouter });

type TrpcWireResult = {
  status: number;
  data: unknown;
  errorCode: string | null;
  errorMessage: string | null;
};
type ConversationWire = {
  id: number;
  name: string;
  kind: "circle" | "direct";
  circleId: number | null;
  lastMessage: string;
  unread: number;
};
type MessageWire = { id: number; text: string };
type LiveWire = { id: number; thumbnail: string };
type FeedCursorWire = {
  createdAt: string;
  id: number;
  createdAtExact?: string;
};
type FeedPostWire = {
  id: number;
  author: { id: number };
  saved: boolean;
};
type FeedPageWire = {
  items: FeedPostWire[];
  nextCursor: FeedCursorWire | null;
  hasMore: boolean;
};

const A26_FEED_SYNTHETIC_POSTS = 105;
const A26_FEED_EXACT_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

let runtimePool: RuntimeRolePool | null = null;
let adminPool: Pool | null = null;
let database: CirclesDatabase | null = null;
let httpServer: Server | null = null;
let apiBaseUrl = "";
let fixturePort = 0;
let fixtureDatabase = "";
let circleConversationId = 0;
let initialReadMessageId = 0;
let revokedReadMessageId = 0;

function readFixturePort(): number {
  const raw = process.env.CIRCLE_HOME_E2E_PG_PORT;
  if (!raw || !/^\d{1,5}$/.test(raw)) {
    throw new Error(
      "A26 authority E2E fixture port was not supplied by the isolated runner",
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
      "A26 authority E2E fixture port is not an allowed loopback port",
    );
  }
  return port;
}

function fixtureUser(id: number): User | null {
  return FIXTURE_USERS.get(id) ?? null;
}

/** Test-only actor injection; production authentication and route context are not modified. */
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
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: authorityHttpRouter,
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
      "A26 authority E2E HTTP listener was not assigned an isolated loopback port",
    );
  }
  httpServer = server;
  return `http://127.0.0.1:${address.port}`;
}

function isQueryProcedure(procedure: string): boolean {
  return [
    "social.conversations",
    "social.feedPage",
    "social.messages",
  ].includes(procedure);
}

async function trpc(
  procedure: string,
  input: Record<string, unknown>,
  actorId: number | null,
): Promise<TrpcWireResult> {
  const isQuery = isQueryProcedure(procedure);
  const url = new URL(`/api/trpc/${procedure}`, apiBaseUrl);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (actorId !== null) headers[ACTOR_HEADER] = String(actorId);
  const request: RequestInit = {
    method: isQuery ? "GET" : "POST",
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  };
  if (isQuery) {
    url.searchParams.set("input", JSON.stringify({ json: input }));
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
): asserts result is TrpcWireResult & { data: NonNullable<unknown> } {
  expect(result.status).toBe(200);
  expect(result.errorCode).toBeNull();
  expect(result.data).toBeTruthy();
}

function resultData<T>(result: TrpcWireResult): T {
  expectSuccess(result);
  return result.data as T;
}

function expectPrivateTextAbsent(result: TrpcWireResult): void {
  const body = JSON.stringify(result);
  expect(body).not.toContain(PRIVATE_PREVIEW_TEXT);
  expect(body).not.toContain(PRIVATE_UNREAD_TEXT);
  expect(body).not.toContain("Private fixture");
}

async function waitForBlockedCircleReader(): Promise<void> {
  const deadline = Date.now() + HTTP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await adminPool!.query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM pg_catalog.pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND query ILIKE '%for update%'
            AND query LIKE '%"circles_app"."circles"%'
       ) AS waiting`,
    );
    if (result.rows[0]?.waiting) return;
    // This bounded catalog polling interval is only a recheck cadence. The positive observation
    // is PostgreSQL's actual lock wait, rather than a fixed-delay inference.
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    "The real HTTP conversation reader did not block on the parent-circle lock",
  );
}

async function endLiveStream(streamId: number): Promise<void> {
  expectSuccess(await trpc("live.end", { streamId, generation: 1 }, 1));
}

async function createdAuthorityStreams(): Promise<number> {
  const result = await adminPool!.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM circles_app.streams
      WHERE "hostId" = $1 AND title = $2`,
    [1, LIVE_TITLE],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** Seeds fixture-only own posts and native Saved/bookmark rows with PostgreSQL microsecond order. */
async function seedA26FeedContinuation(marker: string): Promise<number[]> {
  const seeded = await adminPool!.query<{ id: number }>(
    `WITH inserted AS (
       INSERT INTO circles_app.posts("authorId", text, "createdAt", "updatedAt")
       SELECT $1,
              $2 || lpad(series::text, 3, '0'),
              TIMESTAMPTZ '2026-10-26 11:22:33.120000+00'
                + series * INTERVAL '1 microsecond',
              TIMESTAMPTZ '2026-10-26 11:22:33.120000+00'
                + series * INTERVAL '1 microsecond'
         FROM generate_series(0, $3 - 1) AS series
       RETURNING id
     ), saved AS (
       INSERT INTO circles_app.bookmarks("postId", "userId", "createdAt")
       SELECT id, $1, TIMESTAMPTZ '2026-10-26 11:22:34.120000+00'
         FROM inserted
       RETURNING "postId"
     )
     SELECT "postId" AS id
       FROM saved
      ORDER BY "postId"`,
    [1, marker, A26_FEED_SYNTHETIC_POSTS],
  );
  const postIds = seeded.rows.map((row) => row.id);
  expect(postIds).toHaveLength(A26_FEED_SYNTHETIC_POSTS);
  expect(new Set(postIds).size).toBe(A26_FEED_SYNTHETIC_POSTS);
  return postIds;
}

/** Removes only rows created by this test; the post FK also provides a final bookmark safety net. */
async function disposeA26FeedContinuation(postIds: number[]): Promise<void> {
  try {
    await adminPool!.query(
      'DELETE FROM circles_app.bookmarks WHERE "postId" = ANY($1::integer[])',
      [postIds],
    );
  } finally {
    await adminPool!.query(
      "DELETE FROM circles_app.posts WHERE id = ANY($1::integer[])",
      [postIds],
    );
  }
}

async function collectA26FeedContinuation(
  input: {
    filter: "for-you" | "saved";
    limit: 24 | 25;
    authorId?: number;
  },
  syntheticPostIds: readonly number[],
): Promise<number> {
  const expected = new Set(syntheticPostIds);
  const occurrences = new Map<number, number>();
  const seenAllResponseIds = new Set<number>();
  const returnedCursors: FeedCursorWire[] = [];
  let cursor: FeedCursorWire | undefined;
  let requests = 0;

  while (requests < 8) {
    const suppliedCursor = cursor;
    if (suppliedCursor) {
      expect(suppliedCursor).toEqual(returnedCursors.at(-1));
    }
    requests += 1;
    const page = resultData<FeedPageWire>(
      await trpc(
        "social.feedPage",
        {
          filter: input.filter,
          limit: input.limit,
          ...(input.authorId ? { authorId: input.authorId } : {}),
          ...(suppliedCursor ? { cursor: suppliedCursor } : {}),
        },
        1,
      ),
    );

    expect(page.items.length).toBeLessThanOrEqual(input.limit);
    for (const item of page.items) {
      expect(seenAllResponseIds.has(item.id)).toBe(false);
      seenAllResponseIds.add(item.id);
      if (input.authorId) expect(item.author.id).toBe(input.authorId);
      if (input.filter === "saved") expect(item.saved).toBe(true);
      if (expected.has(item.id)) {
        occurrences.set(item.id, (occurrences.get(item.id) ?? 0) + 1);
      }
    }

    expect(page.hasMore).toBe(page.nextCursor !== null);
    if (!page.nextCursor) {
      expect(requests).toBeLessThanOrEqual(8);
      expect([...occurrences.keys()].sort((a, b) => a - b)).toEqual(
        [...expected].sort((a, b) => a - b),
      );
      expect([...occurrences.values()]).toEqual(
        Array(A26_FEED_SYNTHETIC_POSTS).fill(1),
      );
      return requests;
    }

    // The returned microsecond companion is the exact exclusive tuple reused by the next HTTP call.
    expect(page.nextCursor.createdAtExact).toMatch(A26_FEED_EXACT_TIMESTAMP);
    if (!page.nextCursor.createdAtExact) {
      throw new Error("A26 feed page omitted its exact PostgreSQL timestamp");
    }
    expect(new Date(page.nextCursor.createdAtExact).getTime()).toBe(
      new Date(page.nextCursor.createdAt).getTime(),
    );
    returnedCursors.push(page.nextCursor);
    cursor = page.nextCursor;
  }

  throw new Error("A26 feed continuation exceeded its eight-request bound");
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
      "A26 authority E2E requires a fresh runner-owned database marker",
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
        "A26 authority E2E target does not match the owned local fixture",
      );
    }
  } finally {
    await guardPool.end();
  }

  const now = new Date("2026-10-26T12:00:00.000Z");
  for (const id of [1, 2, 3, 4, 5, 6]) {
    FIXTURE_USERS.set(id, {
      id,
      openId: `a26-authority-e2e-${["owner", "moderator", "member", "pending", "outsider", "author"][id - 1]}`,
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
    max: 6,
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
    max: 3,
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
  if (adminPool) {
    // Only local records created by this suite are removed; the runner still owns whole-fixture
    // teardown. A failed revocation test also restores its fixture membership here.
    await adminPool
      .query(
        `INSERT INTO circles_app.memberships("circleId", "userId", role)
         VALUES ($1, $2, 'member')
         ON CONFLICT ("circleId", "userId") DO UPDATE SET role = EXCLUDED.role`,
        [CIRCLE_ID, 3],
      )
      .catch(() => undefined);
    await adminPool
      .query(
        'DELETE FROM circles_app.streams WHERE "hostId" = $1 AND title = $2',
        [1, LIVE_TITLE],
      )
      .catch(() => undefined);
    await adminPool
      .query(
        'DELETE FROM circles_app."activeHostLeases" WHERE "hostId" = $1',
        [1],
      )
      .catch(() => undefined);
    await adminPool
      .query(
        'DELETE FROM circles_app."socialUploads" WHERE "storageKey" = ANY($1::text[])',
        [[OWNED_IMAGE_KEY, FOREIGN_IMAGE_KEY, OWNED_VIDEO_KEY]],
      )
      .catch(() => undefined);
  }
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
});

describe.sequential("A26 authority isolated HTTP/Drizzle/PostgreSQL 17", () => {
  it("A26-001 reads a current private circle preview and message page through the actual social router", async () => {
    circleConversationId = resultData<{ id: number }>(
      await trpc("social.openCircleChat", { circleId: CIRCLE_ID }, 3),
    ).id;
    expect(
      resultData<{ id: number }>(
        await trpc("social.openCircleChat", { circleId: CIRCLE_ID }, 1),
      ).id,
    ).toBe(circleConversationId);

    initialReadMessageId = resultData<MessageWire>(
      await trpc(
        "social.sendMessage",
        { conversationId: circleConversationId, text: PRIVATE_PREVIEW_TEXT },
        1,
      ),
    ).id;
    expectSuccess(
      await trpc(
        "social.markRead",
        {
          conversationId: circleConversationId,
          throughMessageId: initialReadMessageId,
        },
        3,
      ),
    );
    revokedReadMessageId = resultData<MessageWire>(
      await trpc(
        "social.sendMessage",
        { conversationId: circleConversationId, text: PRIVATE_UNREAD_TEXT },
        1,
      ),
    ).id;

    const filtered = resultData<ConversationWire[]>(
      await trpc(
        "social.conversations",
        { conversationId: circleConversationId, viewerScope: 3 },
        3,
      ),
    );
    expect(filtered).toEqual([
      expect.objectContaining({
        id: circleConversationId,
        name: "Private fixture",
        kind: "circle",
        circleId: CIRCLE_ID,
        lastMessage: PRIVATE_UNREAD_TEXT,
        unread: 1,
      }),
    ]);

    const page = resultData<MessageWire[]>(
      await trpc(
        "social.messages",
        { conversationId: circleConversationId, limit: 20 },
        3,
      ),
    );
    expect(page.map((message) => message.text)).toEqual([
      PRIVATE_PREVIEW_TEXT,
      PRIVATE_UNREAD_TEXT,
    ]);
  });

  it("A26-001 blocks the real HTTP preview at the parent lock, revokes, then returns no private preview, text, or read-state mutation", async () => {
    const lockClient = await adminPool!.connect();
    let committed = false;
    let pendingPreview: Promise<TrpcWireResult> | null = null;
    try {
      await lockClient.query("BEGIN");
      // This is the same parent-row serialization boundary used by removeMember. The reader is a
      // real HTTP request; PostgreSQL catalog evidence below proves it reached the actual lock.
      await lockClient.query(
        "SELECT id FROM circles_app.circles WHERE id = $1 FOR UPDATE",
        [CIRCLE_ID],
      );
      pendingPreview = trpc(
        "social.conversations",
        { conversationId: circleConversationId, viewerScope: 3 },
        3,
      );
      await waitForBlockedCircleReader();

      // Remove the existing runner fixture membership while the exact parent lock is held. This
      // makes revocation win before the blocked production preview can recheck current access.
      await lockClient.query(
        'DELETE FROM circles_app.memberships WHERE "circleId" = $1 AND "userId" = $2',
        [CIRCLE_ID, 3],
      );
      await lockClient.query("COMMIT");
      committed = true;

      const deniedPreview = await pendingPreview;
      expect(deniedPreview).toMatchObject({
        status: 403,
        errorCode: "FORBIDDEN",
      });
      expectPrivateTextAbsent(deniedPreview);

      // A fresh exact-thread filter has no eligible circle candidate after revocation, so it
      // produces an empty metadata list rather than disclosing the stale preview.
      const freshFiltered = await trpc(
        "social.conversations",
        { conversationId: circleConversationId, viewerScope: 3 },
        3,
      );
      expectSuccess(freshFiltered);
      expect(freshFiltered.data).toEqual([]);
      expectPrivateTextAbsent(freshFiltered);

      const deniedMessages = await trpc(
        "social.messages",
        { conversationId: circleConversationId, limit: 20 },
        3,
      );
      const deniedReceipt = await trpc(
        "social.markRead",
        {
          conversationId: circleConversationId,
          throughMessageId: revokedReadMessageId,
        },
        3,
      );
      for (const denied of [deniedMessages, deniedReceipt]) {
        expect(denied).toMatchObject({ status: 403, errorCode: "FORBIDDEN" });
        expectPrivateTextAbsent(denied);
      }
      const receipt = await adminPool!.query<{ lastReadMessageId: number }>(
        `SELECT "lastReadMessageId"
           FROM circles_app."conversationParticipants"
          WHERE "conversationId" = $1 AND "userId" = $2
          LIMIT 1`,
        [circleConversationId, 3],
      );
      expect(receipt.rows).toEqual([
        { lastReadMessageId: initialReadMessageId },
      ]);
    } finally {
      if (!committed) {
        await lockClient.query("ROLLBACK").catch(() => undefined);
      }
      if (pendingPreview) await pendingPreview.catch(() => undefined);
      lockClient.release();
      // Remaining cases use the normal synthetic fixture state. This is neither production data
      // nor an authorization bypass: the runner-owned record is restored only after assertions.
      await adminPool!.query(
        `INSERT INTO circles_app.memberships("circleId", "userId", role)
         VALUES ($1, $2, 'member')
         ON CONFLICT ("circleId", "userId") DO UPDATE SET role = EXCLUDED.role`,
        [CIRCLE_ID, 3],
      );
    }
  });

  it("DB-15 rolls back a failed second participant and converges concurrent HTTP opens on one complete direct conversation", async () => {
    const directKey = "1:6";
    await adminPool!.query(
      'DELETE FROM circles_app.conversations WHERE "directKey" = $1',
      [directKey],
    );
    await adminPool!.query(`
      CREATE FUNCTION e2e_fixture.reject_second_direct_participant()
      RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
      AS $fixture$
      BEGIN
        IF NEW."userId" = 6 AND EXISTS (
          SELECT 1 FROM circles_app.conversations c
          WHERE c.id = NEW."conversationId" AND c."directKey" = '1:6'
        ) THEN
          RAISE EXCEPTION 'synthetic second participant fault';
        END IF;
        RETURN NEW;
      END;
      $fixture$;
      CREATE TRIGGER db15_synthetic_second_participant_fault
        BEFORE INSERT ON circles_app."conversationParticipants"
        FOR EACH ROW EXECUTE FUNCTION e2e_fixture.reject_second_direct_participant();
    `);
    try {
      const failed = await trpc("social.openDirect", { userId: 6 }, 1);
      expect(failed.status).toBe(500);
      const remaining = await adminPool!.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM circles_app.conversations WHERE "directKey" = $1',
        [directKey],
      );
      expect(remaining.rows).toEqual([{ count: "0" }]);
    } finally {
      await adminPool!.query(`
        DROP TRIGGER IF EXISTS db15_synthetic_second_participant_fault
          ON circles_app."conversationParticipants";
        DROP FUNCTION IF EXISTS e2e_fixture.reject_second_direct_participant();
      `);
    }
    try {
      const results = await Promise.all([
        trpc("social.openDirect", { userId: 6 }, 1),
        trpc("social.openDirect", { userId: 1 }, 6),
        trpc("social.openDirect", { userId: 6 }, 1),
      ]);
      const ids = results.map(
        (result) => resultData<{ id: number }>(result).id,
      );
      expect(new Set(ids).size).toBe(1);
      const participants = await adminPool!.query<{ userId: number }>(
        'SELECT "userId" FROM circles_app."conversationParticipants" WHERE "conversationId" = $1 ORDER BY "userId"',
        [ids[0]],
      );
      expect(participants.rows).toEqual([{ userId: 1 }, { userId: 6 }]);
    } finally {
      await adminPool!.query(
        'DELETE FROM circles_app.conversations WHERE "directKey" = $1',
        [directKey],
      );
    }
  });

  it("keeps direct participants available while pending, nonmember, malformed, and stale-scope circle requests expose no private metadata", async () => {
    const directConversationId = resultData<{ id: number }>(
      await trpc("social.openDirect", { userId: 6 }, 3),
    ).id;
    resultData<MessageWire>(
      await trpc(
        "social.sendMessage",
        { conversationId: directConversationId, text: DIRECT_TEXT },
        6,
      ),
    );
    const directPreview = resultData<ConversationWire[]>(
      await trpc(
        "social.conversations",
        { conversationId: directConversationId, viewerScope: 3 },
        3,
      ),
    );
    expect(directPreview).toEqual([
      expect.objectContaining({
        id: directConversationId,
        kind: "direct",
        circleId: null,
        lastMessage: DIRECT_TEXT,
      }),
    ]);
    const directMessages = resultData<MessageWire[]>(
      await trpc(
        "social.messages",
        { conversationId: directConversationId, limit: 20 },
        3,
      ),
    );
    expect(directMessages.map((message) => message.text)).toContain(
      DIRECT_TEXT,
    );

    for (const actorId of [4, 5]) {
      const deniedOpen = await trpc(
        "social.openCircleChat",
        { circleId: CIRCLE_ID },
        actorId,
      );
      const deniedMessages = await trpc(
        "social.messages",
        { conversationId: circleConversationId, limit: 20 },
        actorId,
      );
      for (const denied of [deniedOpen, deniedMessages]) {
        expect(denied).toMatchObject({ status: 403, errorCode: "FORBIDDEN" });
        expectPrivateTextAbsent(denied);
      }
    }

    const staleScope = await trpc(
      "social.conversations",
      { conversationId: circleConversationId, viewerScope: 6 },
      3,
    );
    expect(staleScope).toMatchObject({ status: 403, errorCode: "FORBIDDEN" });
    expectPrivateTextAbsent(staleScope);
    for (const [procedure, input] of [
      ["social.conversations", { conversationId: 0 }],
      ["social.messages", { conversationId: circleConversationId, cursor: 0 }],
      ["social.messages", { conversationId: circleConversationId, limit: 201 }],
    ] as const) {
      const malformed = await trpc(procedure, input, 3);
      expect(malformed).toMatchObject({
        status: 400,
        errorCode: "BAD_REQUEST",
      });
      expectPrivateTextAbsent(malformed);
    }
  });

  it("A26-002 invokes the actual live.create route and shared ownership validator without a media or live provider", async () => {
    const before = await createdAuthorityStreams();
    const hostile = await trpc(
      "live.create",
      { title: LIVE_TITLE, thumbnail: "https://attacker.example/pixel.png" },
      1,
    );
    expect(hostile).toMatchObject({ status: 400, errorCode: "BAD_REQUEST" });
    expect(await createdAuthorityStreams()).toBe(before);

    // These are local authorization metadata fixtures only. No object is uploaded or fetched;
    // the actual route validates the recorded owner, exact canonical URL, and stored MIME.
    await adminPool!.query(
      `INSERT INTO circles_app."socialUploads"("userId", "storageKey", url, "mimeType", bytes)
       VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $5), ($1, $10, $11, $12, $5)`,
      [
        1,
        OWNED_IMAGE_KEY,
        OWNED_IMAGE_URL,
        "image/jpeg",
        1,
        6,
        FOREIGN_IMAGE_KEY,
        FOREIGN_IMAGE_URL,
        "image/png",
        OWNED_VIDEO_KEY,
        OWNED_VIDEO_URL,
        "video/mp4",
      ],
    );

    const ownerImage = resultData<LiveWire>(
      await trpc(
        "live.create",
        { title: LIVE_TITLE, thumbnail: OWNED_IMAGE_URL },
        1,
      ),
    );
    expect(ownerImage.thumbnail).toBe(OWNED_IMAGE_URL);
    await endLiveStream(ownerImage.id);

    const foreign = await trpc(
      "live.create",
      { title: LIVE_TITLE, thumbnail: FOREIGN_IMAGE_URL },
      1,
    );
    const video = await trpc(
      "live.create",
      { title: LIVE_TITLE, thumbnail: OWNED_VIDEO_URL },
      1,
    );
    expect(foreign).toMatchObject({ status: 403, errorCode: "FORBIDDEN" });
    expect(video).toMatchObject({ status: 400, errorCode: "BAD_REQUEST" });
    expect(await createdAuthorityStreams()).toBe(before + 1);

    const starter = [...TRUSTED_STARTER_MEDIA_URLS][0];
    expect(starter).toBeTruthy();
    const trustedStarter = resultData<LiveWire>(
      await trpc("live.create", { title: LIVE_TITLE, thumbnail: starter }, 1),
    );
    expect(trustedStarter.thumbnail).toBe(starter);
    await endLiveStream(trustedStarter.id);
    expect(await createdAuthorityStreams()).toBe(before + 2);
  });

  it("A26-017 continues more than 100 own Moments through actual HTTP without duplicate or missing rows", async () => {
    let postIds: number[] = [];
    try {
      postIds = await seedA26FeedContinuation("A26-017 moments ");
      const requests = await collectA26FeedContinuation(
        { filter: "for-you", authorId: 1, limit: 24 },
        postIds,
      );
      expect(requests).toBeGreaterThanOrEqual(5);
      expect(requests).toBeLessThanOrEqual(8);
    } finally {
      if (postIds.length) await disposeA26FeedContinuation(postIds);
    }
  });

  it("A26-017 continues more than 100 native Saved items through actual HTTP without duplicate or missing rows", async () => {
    let postIds: number[] = [];
    try {
      postIds = await seedA26FeedContinuation("A26-017 saved ");
      const requests = await collectA26FeedContinuation(
        { filter: "saved", limit: 25 },
        postIds,
      );
      expect(requests).toBeGreaterThanOrEqual(5);
      expect(requests).toBeLessThanOrEqual(8);
    } finally {
      if (postIds.length) await disposeA26FeedContinuation(postIds);
    }
  });
});
