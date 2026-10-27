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
import * as activitySchema from "../drizzle/activity-schema";
import * as coreSchema from "../drizzle/schema";
import * as liveSchema from "../drizzle/live-schema";
import * as sessionSchema from "../drizzle/session-schema";
import type { User } from "../drizzle/schema";
import { TRUSTED_STARTER_MEDIA_URLS } from "../shared/media";
import type { TrpcContext } from "../server/_core/context";
import { router } from "../server/_core/trpc";
import { activityRouter } from "../server/activity-router";
import { circleHomeRouter } from "../server/circle-home-router";
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

const databaseSchema = {
  ...activitySchema,
  ...coreSchema,
  ...liveSchema,
  ...sessionSchema,
};
const authorityHttpRouter = router({
  activity: activityRouter,
  circleHome: circleHomeRouter,
  social: socialRouter,
  live: liveRouter,
});

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
type MemberWire = {
  user: { id: number };
  role: "owner" | "moderator" | "member" | "pending";
};
type MemberPageWire = {
  items: MemberWire[];
  nextCursor: FeedCursorWire | null;
  hasMore: boolean;
};
type ActivityItemWire = {
  id: number;
  available: boolean;
  actorName: string | null;
  circleName: string | null;
};
type ActivityPageWire = { items: ActivityItemWire[] };
type ActivityTargetWire = { target: unknown };

const A26_FEED_SYNTHETIC_POSTS = 105;
const A26_FEED_EXACT_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const A26_MEMBER_SYNTHETIC_START_ID = 26_100;
const A26_MEMBER_SYNTHETIC_COUNT = 7;
const A26_PRIVATE_COMMENT_TEXT = "A26 private reader-first comment";
const A26_ACTIVITY_SOURCE_ID = 926_001;
const A26_REMOVED_HOST_TITLE = "A26 removed host must not acquire a lease";

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
    "activity.list",
    "activity.preferences",
    "activity.resolveTarget",
    "circleHome.get",
    "social.comments",
    "social.conversations",
    "social.circlesPage",
    "social.feedPage",
    "social.members",
    "social.membersPage",
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

/** Catalog observation establishes an actual database wait; polling is only a bounded recheck. */
async function waitForBlockedLockingQuery(
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

async function waitForBlockedCircleReader(): Promise<void> {
  await waitForBlockedLockingQuery(
    '"circles_app"."circles"',
    "real HTTP reader at the parent-circle lock",
  );
}

async function waitForBlockedParentRemoval(): Promise<void> {
  await waitForBlockedLockingQuery(
    '"circles_app"."circles"',
    "real HTTP removeMember at the parent FOR UPDATE lock",
    { forUpdate: true },
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

type ReaderBarrierTable = "profiles" | "activityCirclePreferences";
type ReaderFirstCase = {
  label: string;
  actorId: number;
  barrierTable: ReaderBarrierTable;
  read: () => Promise<TrpcWireResult>;
  assertBeforeRemoval: (result: TrpcWireResult) => void;
  assertAfterRemoval: (result: TrpcWireResult) => void;
};

function barrierTableSql(table: ReaderBarrierTable): string {
  return table === "profiles"
    ? 'circles_app."profiles"'
    : 'circles_app."activityCirclePreferences"';
}

function barrierTableNeedle(table: ReaderBarrierTable): string {
  return `"circles_app"."${table}"`;
}

async function restoreFixtureMember(userId: number): Promise<void> {
  await adminPool!.query(
    `INSERT INTO circles_app.memberships("circleId", "userId", role)
     VALUES ($1, $2, 'member')
     ON CONFLICT ("circleId", "userId") DO UPDATE SET role = EXCLUDED.role`,
    [CIRCLE_ID, userId],
  );
}

/**
 * The external table lock is a fixture-only post-parent-lock barrier. It never substitutes a
 * router/service query: the reader and removal are both actual HTTP procedures using runtime-role
 * Drizzle, and pg_stat_activity must observe both database waits before the barrier is released.
 */
async function runReaderFirstRemoval(
  caseInput: ReaderFirstCase,
): Promise<void> {
  const barrier = await adminPool!.connect();
  let barrierCommitted = false;
  let pendingReader: Promise<TrpcWireResult> | null = null;
  let pendingRemoval: Promise<TrpcWireResult> | null = null;
  try {
    await barrier.query("BEGIN");
    await barrier.query(
      `LOCK TABLE ${barrierTableSql(caseInput.barrierTable)} IN ACCESS EXCLUSIVE MODE`,
    );

    pendingReader = caseInput.read();
    await waitForBlockedLockingQuery(
      barrierTableNeedle(caseInput.barrierTable),
      `${caseInput.label} after its protected parent-circle read`,
    );

    pendingRemoval = trpc(
      "social.removeMember",
      { circleId: CIRCLE_ID, userId: caseInput.actorId },
      1,
    );
    await waitForBlockedParentRemoval();

    await barrier.query("COMMIT");
    barrierCommitted = true;

    const beforeRemoval = await pendingReader;
    caseInput.assertBeforeRemoval(beforeRemoval);

    const removed = await pendingRemoval;
    expectSuccess(removed);

    const afterRemoval = await caseInput.read();
    caseInput.assertAfterRemoval(afterRemoval);
  } finally {
    if (!barrierCommitted) {
      await barrier.query("ROLLBACK").catch(() => undefined);
    }
    if (pendingReader) await pendingReader.catch(() => undefined);
    if (pendingRemoval) await pendingRemoval.catch(() => undefined);
    barrier.release();
    await restoreFixtureMember(caseInput.actorId);
  }
}

async function seedA26MemberCursorFixture(): Promise<number[]> {
  const userIds = Array.from(
    { length: A26_MEMBER_SYNTHETIC_COUNT },
    (_, index) => A26_MEMBER_SYNTHETIC_START_ID + index,
  );
  await adminPool!.query(
    `INSERT INTO circles_app.users(id, "openId", name)
     SELECT id,
            'a26-member-cursor-' || id::text,
            'A26 member cursor ' || id::text
       FROM unnest($1::integer[]) AS seeded(id)`,
    [userIds],
  );
  await adminPool!.query(
    `INSERT INTO circles_app.profiles("userId", name, handle, bio, avatar)
     SELECT id,
            'A26 member cursor ' || id::text,
            'a26-member-' || id::text,
            '',
            ''
       FROM unnest($1::integer[]) AS seeded(id)`,
    [userIds],
  );
  await adminPool!.query(
    `INSERT INTO circles_app.memberships("circleId", "userId", role, "createdAt", "updatedAt")
     SELECT $1,
            id,
            'member',
            TIMESTAMPTZ '2025-10-26 11:22:33.120000+00'
              + ordinal * INTERVAL '1 microsecond',
            TIMESTAMPTZ '2025-10-26 11:22:33.120000+00'
              + ordinal * INTERVAL '1 microsecond'
       FROM unnest($2::integer[]) WITH ORDINALITY AS seeded(id, ordinal)`,
    [CIRCLE_ID, userIds],
  );
  return userIds;
}

async function disposeA26MemberCursorFixture(userIds: number[]): Promise<void> {
  await adminPool!.query(
    'DELETE FROM circles_app.memberships WHERE "userId" = ANY($1::integer[])',
    [userIds],
  );
  await adminPool!.query(
    'DELETE FROM circles_app.profiles WHERE "userId" = ANY($1::integer[])',
    [userIds],
  );
  await adminPool!.query(
    "DELETE FROM circles_app.users WHERE id = ANY($1::integer[])",
    [userIds],
  );
}

async function collectA26MembersWithExactCursor(
  expectedSyntheticUserIds: readonly number[],
): Promise<FeedCursorWire> {
  const allIds = new Set<number>();
  const syntheticOccurrences = new Map<number, number>();
  let cursor: FeedCursorWire | undefined;
  let finalCursor: FeedCursorWire | null = null;
  let pages = 0;

  while (pages < 12) {
    const page = resultData<MemberPageWire>(
      await trpc(
        "social.membersPage",
        {
          circleId: CIRCLE_ID,
          limit: 2,
          ...(cursor ? { cursor } : {}),
        },
        1,
      ),
    );
    pages += 1;
    expect(page.items.length).toBeLessThanOrEqual(2);
    for (const item of page.items) {
      expect(allIds.has(item.user.id)).toBe(false);
      allIds.add(item.user.id);
      if (expectedSyntheticUserIds.includes(item.user.id)) {
        syntheticOccurrences.set(
          item.user.id,
          (syntheticOccurrences.get(item.user.id) ?? 0) + 1,
        );
      }
    }
    expect(page.hasMore).toBe(page.nextCursor !== null);
    if (!page.nextCursor) {
      expect(pages).toBeLessThanOrEqual(12);
      expect([...syntheticOccurrences.keys()].sort((a, b) => a - b)).toEqual(
        [...expectedSyntheticUserIds].sort((a, b) => a - b),
      );
      expect([...syntheticOccurrences.values()]).toEqual(
        Array(expectedSyntheticUserIds.length).fill(1),
      );
      if (!finalCursor) throw new Error("A26 member cursor never advanced");
      return finalCursor;
    }
    expect(page.nextCursor.createdAtExact).toMatch(A26_FEED_EXACT_TIMESTAMP);
    expect(new Date(page.nextCursor.createdAtExact!).getTime()).toBe(
      new Date(page.nextCursor.createdAt).getTime(),
    );
    finalCursor = page.nextCursor;
    cursor = page.nextCursor;
  }

  throw new Error("A26 member cursor traversal exceeded its twelve-page bound");
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
      .query('DELETE FROM circles_app."activityItems" WHERE "sourceId" = $1', [
        A26_ACTIVITY_SOURCE_ID,
      ])
      .catch(() => undefined);
    await adminPool
      .query("DELETE FROM circles_app.comments WHERE text = $1", [
        A26_PRIVATE_COMMENT_TEXT,
      ])
      .catch(() => undefined);
    await adminPool
      .query(
        `UPDATE circles_app.circles
            SET "pinnedPostId" = NULL
          WHERE id = $1 AND "pinnedPostId" = $2`,
        [CIRCLE_ID, 105],
      )
      .catch(() => undefined);
    await adminPool
      .query(
        'DELETE FROM circles_app.memberships WHERE "userId" = ANY($1::integer[])',
        [
          [
            6,
            ...Array.from(
              { length: A26_MEMBER_SYNTHETIC_COUNT },
              (_, index) => A26_MEMBER_SYNTHETIC_START_ID + index,
            ),
          ],
        ],
      )
      .catch(() => undefined);
    await adminPool
      .query(
        'DELETE FROM circles_app.profiles WHERE "userId" >= $1 AND "userId" < $2',
        [
          A26_MEMBER_SYNTHETIC_START_ID,
          A26_MEMBER_SYNTHETIC_START_ID + A26_MEMBER_SYNTHETIC_COUNT,
        ],
      )
      .catch(() => undefined);
    await adminPool
      .query("DELETE FROM circles_app.users WHERE id >= $1 AND id < $2", [
        A26_MEMBER_SYNTHETIC_START_ID,
        A26_MEMBER_SYNTHETIC_START_ID + A26_MEMBER_SYNTHETIC_COUNT,
      ])
      .catch(() => undefined);
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

  it("preserves private pending/nonmember denials, the pending preference exception, and public private-circle teasers", async () => {
    for (const actorId of [null, 4, 5]) {
      const home = await trpc(
        "circleHome.get",
        { circleId: CIRCLE_ID },
        actorId,
      );
      const members = await trpc(
        "social.members",
        { circleId: CIRCLE_ID },
        actorId,
      );
      for (const denied of [home, members]) {
        expect(denied).toMatchObject({ status: 403, errorCode: "FORBIDDEN" });
        expectPrivateTextAbsent(denied);
      }
    }

    const pendingPreference = await trpc(
      "activity.preferences",
      { circleId: CIRCLE_ID },
      4,
    );
    expectSuccess(pendingPreference);
    expect(pendingPreference.data).toMatchObject({
      viewerId: 4,
      circle: { id: CIRCLE_ID, name: "Private fixture", muted: false },
    });

    const directory = resultData<{
      items: Record<string, unknown>[];
    }>(await trpc("social.circlesPage", { limit: 20 }, null));
    const privateTeaser = directory.items.find((item) => item.id === CIRCLE_ID);
    expect(privateTeaser).toMatchObject({
      id: CIRCLE_ID,
      privacy: "private",
    });
    for (const key of [
      "joined",
      "role",
      "welcomeMessage",
      "rules",
      "pinnedPost",
      "members",
    ]) {
      expect(privateTeaser).not.toHaveProperty(key);
    }
  });

  it("A26-018 traverses private members through the actual HTTP exact microsecond cursor without duplication or gaps", async () => {
    let userIds: number[] = [];
    try {
      userIds = await seedA26MemberCursorFixture();
      const finalCursor = await collectA26MembersWithExactCursor(userIds);
      const invalidExactCursor = await trpc(
        "social.membersPage",
        {
          circleId: CIRCLE_ID,
          limit: 2,
          cursor: {
            id: finalCursor.id,
            createdAt: finalCursor.createdAt,
            createdAtExact: "2025-10-26T11:22:33.121000Z",
          },
        },
        1,
      );
      expect(invalidExactCursor).toMatchObject({
        status: 400,
        errorCode: "BAD_REQUEST",
      });
    } finally {
      if (userIds.length) await disposeA26MemberCursorFixture(userIds);
    }
  });

  it("runs private feed, comments, Circle Home, and members readers before a real removal then fails closed afterward", async () => {
    const insertedComment = await adminPool!.query<{ id: number }>(
      `INSERT INTO circles_app.comments("postId", "authorId", text)
       VALUES (105, 1, $1)
       RETURNING id`,
      [A26_PRIVATE_COMMENT_TEXT],
    );
    const priorPin = await adminPool!.query<{ pinnedPostId: number | null }>(
      `SELECT "pinnedPostId"
         FROM circles_app.circles
        WHERE id = $1
        LIMIT 1`,
      [CIRCLE_ID],
    );
    expect(priorPin.rows).toHaveLength(1);
    await adminPool!.query(
      'UPDATE circles_app.circles SET "pinnedPostId" = $2 WHERE id = $1',
      [CIRCLE_ID, 105],
    );

    try {
      await runReaderFirstRemoval({
        label: "private feed final DTO mapping",
        actorId: 3,
        barrierTable: "profiles",
        read: () =>
          trpc(
            "social.feedPage",
            { filter: "for-you", circleId: CIRCLE_ID, limit: 20 },
            3,
          ),
        assertBeforeRemoval: (result) => {
          expect(
            resultData<{ items: { id: number; text: string }[] }>(result).items,
          ).toContainEqual(
            expect.objectContaining({ id: 105, text: "Private fixture post" }),
          );
        },
        assertAfterRemoval: (result) => {
          expectSuccess(result);
          expect(JSON.stringify(result)).not.toContain("Private fixture post");
          expect(JSON.stringify(result)).not.toContain("Private fixture");
        },
      });

      await runReaderFirstRemoval({
        label: "private comments projection",
        actorId: 3,
        barrierTable: "profiles",
        read: () => trpc("social.comments", { postId: 105 }, 3),
        assertBeforeRemoval: (result) => {
          expect(
            resultData<{ id: number; text: string }[]>(result),
          ).toContainEqual(
            expect.objectContaining({
              id: insertedComment.rows[0]?.id,
              text: A26_PRIVATE_COMMENT_TEXT,
            }),
          );
        },
        assertAfterRemoval: (result) => {
          expect(result).toMatchObject({ status: 403, errorCode: "FORBIDDEN" });
          expect(JSON.stringify(result)).not.toContain(
            A26_PRIVATE_COMMENT_TEXT,
          );
        },
      });

      await runReaderFirstRemoval({
        label: "private Circle Home projection",
        actorId: 3,
        barrierTable: "profiles",
        read: () => trpc("circleHome.get", { circleId: CIRCLE_ID }, 3),
        assertBeforeRemoval: (result) => {
          expectSuccess(result);
          expect(result.data).toMatchObject({
            circleId: CIRCLE_ID,
            pinnedPost: { id: 105, text: "Private fixture post" },
          });
        },
        assertAfterRemoval: (result) => {
          expect(result).toMatchObject({ status: 403, errorCode: "FORBIDDEN" });
          expect(JSON.stringify(result)).not.toContain("Private fixture post");
        },
      });

      await runReaderFirstRemoval({
        label: "private member projection",
        actorId: 3,
        barrierTable: "profiles",
        read: () => trpc("social.members", { circleId: CIRCLE_ID }, 3),
        assertBeforeRemoval: (result) => {
          expect(
            resultData<MemberWire[]>(result).map((member) => member.user.id),
          ).toContain(3);
        },
        assertAfterRemoval: (result) => {
          expect(result).toMatchObject({ status: 403, errorCode: "FORBIDDEN" });
          expect(JSON.stringify(result)).not.toContain("Fixture member");
        },
      });
    } finally {
      await adminPool!.query(
        'UPDATE circles_app.circles SET "pinnedPostId" = $2 WHERE id = $1',
        [CIRCLE_ID, priorPin.rows[0]?.pinnedPostId ?? null],
      );
      await adminPool!.query("DELETE FROM circles_app.comments WHERE id = $1", [
        insertedComment.rows[0]?.id ?? 0,
      ]);
    }
  });

  it("runs Activity item projection, circle preference, and target readers before removal and redacts/unsets them afterward", async () => {
    let activityId = 0;
    try {
      await restoreFixtureMember(6);
      const seeded = await adminPool!.query<{ id: number }>(
        `INSERT INTO circles_app."activityItems"(
           "recipientId", "actorId", kind, "sourceId", "circleId", "postId"
         )
         VALUES (6, 3, 'comment_on_your_post', $1, $2, 105)
         RETURNING id`,
        [A26_ACTIVITY_SOURCE_ID, CIRCLE_ID],
      );
      activityId = seeded.rows[0]?.id ?? 0;
      expect(activityId).toBeGreaterThan(0);

      await runReaderFirstRemoval({
        label: "Activity private-item projection",
        actorId: 6,
        barrierTable: "profiles",
        read: () => trpc("activity.list", {}, 6),
        assertBeforeRemoval: (result) => {
          const item = resultData<ActivityPageWire>(result).items.find(
            (candidate) => candidate.id === activityId,
          );
          expect(item).toMatchObject({
            available: true,
            actorName: "Fixture member",
            circleName: "Private fixture",
          });
        },
        assertAfterRemoval: (result) => {
          const item = resultData<ActivityPageWire>(result).items.find(
            (candidate) => candidate.id === activityId,
          );
          expect(item).toEqual({
            id: activityId,
            available: false,
            actorName: null,
            circleName: null,
            kind: "comment_on_your_post",
            createdAt: expect.any(String),
            readAt: null,
          });
        },
      });

      await runReaderFirstRemoval({
        label: "Activity private-circle preference",
        actorId: 6,
        barrierTable: "activityCirclePreferences",
        read: () => trpc("activity.preferences", { circleId: CIRCLE_ID }, 6),
        assertBeforeRemoval: (result) => {
          expectSuccess(result);
          expect(result.data).toMatchObject({
            viewerId: 6,
            circle: { id: CIRCLE_ID, name: "Private fixture", muted: false },
          });
        },
        assertAfterRemoval: (result) => {
          expect(result).toMatchObject({ status: 404, errorCode: "NOT_FOUND" });
          expect(JSON.stringify(result)).not.toContain("Private fixture");
        },
      });

      await runReaderFirstRemoval({
        label: "Activity private post target",
        actorId: 6,
        barrierTable: "profiles",
        read: () => trpc("activity.resolveTarget", { id: activityId }, 6),
        assertBeforeRemoval: (result) => {
          expect(resultData<ActivityTargetWire>(result)).toMatchObject({
            target: { type: "post", post: { id: 105 } },
          });
        },
        assertAfterRemoval: (result) => {
          expect(resultData<ActivityTargetWire>(result)).toEqual({
            viewerId: 6,
            activityId,
            target: null,
          });
        },
      });
    } finally {
      await adminPool!
        .query(
          'DELETE FROM circles_app."activityItems" WHERE "sourceId" = $1',
          [A26_ACTIVITY_SOURCE_ID],
        )
        .catch(() => undefined);
      await adminPool!
        .query(
          'DELETE FROM circles_app.memberships WHERE "circleId" = $1 AND "userId" = $2',
          [CIRCLE_ID, 6],
        )
        .catch(() => undefined);
    }
  });

  it("A26-019 makes removal win over a current private host before any live lease or stream is acquired", async () => {
    const starter = [...TRUSTED_STARTER_MEDIA_URLS][0];
    expect(starter).toBeTruthy();
    const beforeStreams = await adminPool!.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM circles_app.streams
        WHERE "hostId" = 3 AND title = $1`,
      [A26_REMOVED_HOST_TITLE],
    );
    const beforeLease = await adminPool!.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM circles_app."activeHostLeases"
        WHERE "hostId" = 3`,
    );
    const lockClient = await adminPool!.connect();
    let committed = false;
    let pendingCreate: Promise<TrpcWireResult> | null = null;
    try {
      await lockClient.query("BEGIN");
      await lockClient.query(
        "SELECT id FROM circles_app.circles WHERE id = $1 FOR UPDATE",
        [CIRCLE_ID],
      );
      pendingCreate = trpc(
        "live.create",
        {
          title: A26_REMOVED_HOST_TITLE,
          circleId: CIRCLE_ID,
          thumbnail: starter,
        },
        3,
      );
      await waitForBlockedCircleReader();
      await lockClient.query(
        'DELETE FROM circles_app.memberships WHERE "circleId" = $1 AND "userId" = $2',
        [CIRCLE_ID, 3],
      );
      await lockClient.query("COMMIT");
      committed = true;

      const denied = await pendingCreate;
      expect(denied).toMatchObject({ status: 403, errorCode: "FORBIDDEN" });
      const [afterStreams, afterLease] = await Promise.all([
        adminPool!.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM circles_app.streams
            WHERE "hostId" = 3 AND title = $1`,
          [A26_REMOVED_HOST_TITLE],
        ),
        adminPool!.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM circles_app."activeHostLeases"
            WHERE "hostId" = 3`,
        ),
      ]);
      expect(afterStreams.rows[0]?.count).toBe(beforeStreams.rows[0]?.count);
      expect(afterLease.rows[0]?.count).toBe(beforeLease.rows[0]?.count);
    } finally {
      if (!committed) {
        await lockClient.query("ROLLBACK").catch(() => undefined);
      }
      if (pendingCreate) await pendingCreate.catch(() => undefined);
      lockClient.release();
      await restoreFixtureMember(3);
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
