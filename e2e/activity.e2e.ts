import { createServer, type Server } from "node:http";
import { once } from "node:events";
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
import type { ActivityItem, ActivityPage } from "../shared/activity";
import type { TrpcContext } from "../server/_core/context";
import { router } from "../server/_core/trpc";
import { recordCommentActivity } from "../server/activity-events";
import { activityRouter } from "../server/activity-router";
import type { CirclesDatabase } from "../server/db";
import {
  createRuntimeRolePool,
  type RuntimeRolePool,
} from "../server/runtime-role-pool";
import { socialRouter } from "../server/social-router";

const ACTOR_HEADER = "x-circle-home-e2e-user";
const HTTP_TIMEOUT_MS = 4_000;
const FIXTURE_USERS = new Map<number, User>();

/**
 * This is the sole mock in the E2E process. It substitutes only the server/db connection
 * facade with a real Drizzle database on the runner-owned PostgreSQL 17 fixture. Routers,
 * source actions, services, transactions, and query results remain production code.
 */
const dbFacade = vi.hoisted(() => ({ database: null as unknown }));
vi.mock("../server/db", () => ({
  getDb: () => Promise.resolve(dbFacade.database),
}));

const databaseSchema = {
  ...coreSchema,
  ...liveSchema,
  ...sessionSchema,
  ...activitySchema,
};
const activityHttpRouter = router({
  activity: activityRouter,
  social: socialRouter,
});

type TrpcWireResult = {
  status: number;
  data: unknown;
  errorCode: string | null;
  errorMessage: string | null;
};
type CommentWire = { id: number };
type StoredActivity = {
  id: number;
  recipientId: number;
  actorId: number | null;
  kind: "comment_on_your_post" | "membership_approved";
  sourceId: number;
  circleId: number | null;
  postId: number | null;
  readAt: Date | null;
};

let runtimePool: RuntimeRolePool | null = null;
let adminPool: Pool | null = null;
let database: CirclesDatabase | null = null;
let httpServer: Server | null = null;
let apiBaseUrl = "";
let fixturePort = 0;
let fixtureDatabase = "";

function readFixturePort(): number {
  const raw = process.env.CIRCLE_HOME_E2E_PG_PORT;
  if (!raw || !/^\d{1,5}$/.test(raw)) {
    throw new Error(
      "Activity E2E fixture port was not supplied by the isolated runner",
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
      "Activity E2E fixture port is not an allowed loopback port",
    );
  }
  return port;
}

function fixtureUser(id: number): User | null {
  return FIXTURE_USERS.get(id) ?? null;
}

/** Test-only loopback context injection; production OAuth/session handling is not modified. */
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
      router: activityHttpRouter,
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
      "Activity E2E HTTP listener was not assigned an isolated loopback port",
    );
  }
  httpServer = server;
  return `http://127.0.0.1:${address.port}`;
}

function isQueryProcedure(procedure: string): boolean {
  return [
    "activity.list",
    "activity.unreadCount",
    "activity.preferences",
    "activity.resolveTarget",
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

async function listActivity(
  actorId = 6,
  input: Record<string, unknown> = {},
): Promise<ActivityPage> {
  return resultData<ActivityPage>(await trpc("activity.list", input, actorId));
}

async function comment(
  postId: number,
  text: string,
  actorId = 3,
): Promise<CommentWire> {
  return resultData<CommentWire>(
    await trpc("social.comment", { postId, text }, actorId),
  );
}

async function approve(
  circleId: number,
  userId: number,
  actorId = 1,
): Promise<void> {
  expectSuccess(
    await trpc("social.approveMember", { circleId, userId }, actorId),
  );
}

async function storedActivityForSource(
  sourceId: number,
  recipientId = 6,
): Promise<StoredActivity> {
  const result = await adminPool!.query<StoredActivity>(
    `SELECT id, "recipientId", "actorId", kind, "sourceId", "circleId", "postId", "readAt"
       FROM circles_app."activityItems"
      WHERE "recipientId" = $1 AND "sourceId" = $2
      ORDER BY id DESC
      LIMIT 1`,
    [recipientId, sourceId],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0]!;
}

async function activityCount(recipientId = 6): Promise<number> {
  const result = await adminPool!.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM circles_app."activityItems" WHERE "recipientId" = $1',
    [recipientId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

function listedItem(page: ActivityPage, id: number): ActivityItem {
  const item = page.items.find((candidate) => candidate.id === id);
  expect(item).toBeDefined();
  return item!;
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
      "Activity E2E requires a fresh runner-owned database marker",
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
        "Activity E2E target does not match the owned local fixture",
      );
    }
  } finally {
    await guardPool.end();
  }

  const now = new Date("2026-10-23T12:00:00.000Z");
  for (const id of [1, 2, 3, 4, 5, 6]) {
    FIXTURE_USERS.set(id, {
      id,
      openId: `circle-home-e2e-${["owner", "moderator", "member", "pending", "outsider", "author"][id - 1]}`,
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

describe.sequential("Activity Inbox isolated HTTP E2E", () => {
  it("starts empty and exposes only the documented bounded default preferences", async () => {
    expect(await listActivity()).toMatchObject({
      viewerId: 6,
      items: [],
      nextCursor: null,
    });
    expect(resultData(await trpc("activity.unreadCount", {}, 6))).toMatchObject(
      {
        viewerId: 6,
        count: 0,
        throughId: 0,
      },
    );
    expect(resultData(await trpc("activity.preferences", {}, 6))).toEqual({
      viewerId: 6,
      commentsEnabled: true,
      membershipApprovalsEnabled: true,
      circle: null,
    });
  });

  it("persists metadata-only comment activity from a real authorized social source action", async () => {
    const source = await comment(101, "recipient source comment");
    const stored = await storedActivityForSource(source.id);
    expect(stored).toMatchObject({
      recipientId: 6,
      actorId: 3,
      kind: "comment_on_your_post",
      sourceId: source.id,
      circleId: 11,
      postId: 101,
      readAt: null,
    });

    const item = listedItem(await listActivity(), stored.id);
    expect(item).toMatchObject({
      id: stored.id,
      kind: "comment_on_your_post",
      readAt: null,
      available: true,
      actorName: "Fixture member",
      circleName: "Public fixture",
    });
    // The inbox DTO and durable table never carry a comment/DM body.
    expect(Object.keys(item).sort()).toEqual([
      "actorName",
      "available",
      "circleName",
      "createdAt",
      "id",
      "kind",
      "readAt",
    ]);
    expect(JSON.stringify(item)).not.toContain("recipient source comment");
    const bodyColumns = await adminPool!.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'circles_app'
          AND table_name = 'activityItems'
          AND column_name IN ('body', 'commentBody', 'text')`,
    );
    expect(bodyColumns.rows).toEqual([]);
  });

  it("isolates recipients and rejects guest or stale viewer scopes before inbox state changes", async () => {
    const seed = await storedActivityForSource(
      resultData<CommentWire>(
        await trpc(
          "social.comment",
          { postId: 101, text: "isolation source" },
          3,
        ),
      ).id,
    );
    const before = await activityCount();
    const guest = await trpc("activity.list", {}, null);
    const otherRecipient = await trpc("activity.list", {}, 3);
    const staleList = await trpc("activity.list", { viewerScope: 5 }, 6);
    const staleMark = await trpc(
      "activity.markRead",
      { id: seed.id, viewerScope: 5 },
      6,
    );
    expect(guest).toMatchObject({ status: 401, errorCode: "UNAUTHORIZED" });
    expect(resultData<ActivityPage>(otherRecipient)).toMatchObject({
      viewerId: 3,
      items: [],
    });
    for (const denied of [staleList, staleMark]) {
      expect(denied).toMatchObject({
        status: 409,
        errorCode: "CONFLICT",
        errorMessage: "Activity response belongs to a different account",
      });
    }
    expect(await activityCount()).toBe(before);
  });

  it("suppresses self-events and deduplicates a repeated real helper emission for one real comment", async () => {
    const beforeSelf = await activityCount();
    await comment(101, "self comment", 6);
    expect(await activityCount()).toBe(beforeSelf);

    const source = await comment(101, "deduplicated source");
    const beforeDuplicateEmitter = await activityCount();
    await database!.transaction(async (tx) => {
      const repeated = {
        recipientId: 6,
        actorId: 3,
        sourceId: source.id,
        postId: 101,
        circleId: 11,
      };
      await recordCommentActivity(tx, repeated);
      await recordCommentActivity(tx, repeated);
    });
    expect(await activityCount()).toBe(beforeDuplicateEmitter);
    const deduplicated = await adminPool!.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM circles_app."activityItems"
        WHERE "recipientId" = 6
          AND kind = 'comment_on_your_post'
          AND "sourceId" = $1`,
      [source.id],
    );
    expect(Number(deduplicated.rows[0]?.count ?? 0)).toBe(1);
  });

  it("honors global category desired state only for future events and preserves a partial category patch", async () => {
    const before = await activityCount();
    expect(
      resultData(
        await trpc("activity.updateCategories", { commentsEnabled: false }, 6),
      ),
    ).toMatchObject({
      viewerId: 6,
      commentsEnabled: false,
      membershipApprovalsEnabled: true,
    });
    await comment(101, "comment while globally disabled");
    expect(await activityCount()).toBe(before);

    const partial = resultData<{
      commentsEnabled: boolean;
      membershipApprovalsEnabled: boolean;
    }>(
      await trpc(
        "activity.updateCategories",
        { membershipApprovalsEnabled: false },
        6,
      ),
    );
    expect(partial).toMatchObject({
      commentsEnabled: false,
      membershipApprovalsEnabled: false,
    });
    const restoredComments = resultData<{
      commentsEnabled: boolean;
      membershipApprovalsEnabled: boolean;
    }>(await trpc("activity.updateCategories", { commentsEnabled: true }, 6));
    expect(restoredComments).toMatchObject({
      commentsEnabled: true,
      membershipApprovalsEnabled: false,
    });
    await comment(101, "comment after category restore");
    expect(await activityCount()).toBe(before + 1);
    // Prepare the positive approval source case without changing its independent comment setting.
    expect(
      resultData(
        await trpc(
          "activity.updateCategories",
          { membershipApprovalsEnabled: true },
          6,
        ),
      ),
    ).toMatchObject({
      commentsEnabled: true,
      membershipApprovalsEnabled: true,
    });
  });

  it("mutes a circle only for future comments and lets a pending requester mute a future approval", async () => {
    const beforeMuted = await activityCount();
    expect(
      resultData(
        await trpc("activity.setCircleMuted", { circleId: 11, muted: true }, 6),
      ),
    ).toMatchObject({
      circle: { id: 11, name: "Public fixture", muted: true },
    });
    await comment(101, "comment while circle muted");
    expect(await activityCount()).toBe(beforeMuted);

    expectSuccess(
      await trpc("activity.setCircleMuted", { circleId: 11, muted: false }, 6),
    );
    await comment(101, "comment after circle unmute");
    expect(await activityCount()).toBe(beforeMuted + 1);

    // User 4 is still pending in private circle 12; pending status is enough to set their own mute.
    expect(
      resultData(
        await trpc("activity.setCircleMuted", { circleId: 12, muted: true }, 4),
      ),
    ).toMatchObject({
      viewerId: 4,
      circle: { id: 12, name: "Private fixture", muted: true },
    });
    await approve(12, 4);
    expect(await activityCount(4)).toBe(0);
  });

  it("creates an approval event through social.approveMember and freshly resolves its authorized circle target", async () => {
    await approve(11, 4);
    const approval = await adminPool!.query<StoredActivity>(
      `SELECT id, "recipientId", "actorId", kind, "sourceId", "circleId", "postId", "readAt"
         FROM circles_app."activityItems"
        WHERE "recipientId" = 4 AND kind = 'membership_approved'
        ORDER BY id DESC LIMIT 1`,
    );
    expect(approval.rows).toHaveLength(1);
    const stored = approval.rows[0]!;
    expect(stored).toMatchObject({
      recipientId: 4,
      actorId: 1,
      circleId: 11,
      postId: null,
    });
    const target = resultData<{ target: unknown }>(
      await trpc(
        "activity.resolveTarget",
        { id: stored.id, viewerScope: 4 },
        4,
      ),
    );
    expect(target).toMatchObject({ target: { type: "circle", circleId: 11 } });
  });

  it("uses descending keyset pages without duplicate items when a newer source arrives between pages", async () => {
    await comment(101, "keyset source one");
    await comment(101, "keyset source two");
    await comment(101, "keyset source three");
    const first = await listActivity(6, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const pageOneIds = first.items.map((item) => item.id);
    const newSource = await comment(
      101,
      "keyset source inserted after first page",
    );
    const newest = await storedActivityForSource(newSource.id);
    const second = await listActivity(6, {
      limit: 40,
      cursor: first.nextCursor!,
    });
    const pageTwoIds = second.items.map((item) => item.id);
    expect(new Set([...pageOneIds, ...pageTwoIds]).size).toBe(
      pageOneIds.length + pageTwoIds.length,
    );
    expect(pageTwoIds.every((id) => id < first.nextCursor!.beforeId)).toBe(
      true,
    );
    expect([...pageOneIds, ...pageTwoIds]).not.toContain(newest.id);
  });

  it("makes individual read desired-state idempotent and bounds mark-all at the supplied watermark", async () => {
    const firstSource = await comment(101, "read idempotence source");
    const first = await storedActivityForSource(firstSource.id);
    const unreadBefore = resultData<{ count: number }>(
      await trpc("activity.unreadCount", {}, 6),
    );
    expectSuccess(await trpc("activity.markRead", { id: first.id }, 6));
    const unreadAfterOne = resultData<{ count: number }>(
      await trpc("activity.unreadCount", {}, 6),
    );
    expect(unreadAfterOne.count).toBe(unreadBefore.count - 1);
    expectSuccess(await trpc("activity.markRead", { id: first.id }, 6));
    expect(
      resultData<{ count: number }>(await trpc("activity.unreadCount", {}, 6))
        .count,
    ).toBe(unreadAfterOne.count);

    const watermark = resultData<{ throughId: number }>(
      await trpc("activity.unreadCount", {}, 6),
    ).throughId;
    const newSource = await comment(101, "new arrival after watermark");
    const newArrival = await storedActivityForSource(newSource.id);
    expect(newArrival.id).toBeGreaterThan(watermark);
    expectSuccess(
      await trpc("activity.markAllRead", { throughId: watermark }, 6),
    );
    const after = listedItem(await listActivity(), newArrival.id);
    expect(after.readAt).toBeNull();
  });

  it("serializes a preference update with a real source event without corrupting preference or duplicate state", async () => {
    const before = await activityCount();
    const [preference, source] = await Promise.all([
      trpc("activity.updateCategories", { commentsEnabled: false }, 6),
      comment(101, "preference race source"),
    ]);
    expectSuccess(preference);
    expect(source.id).toBeGreaterThan(0);
    expect(
      resultData<{ commentsEnabled: boolean }>(
        await trpc("activity.preferences", {}, 6),
      ).commentsEnabled,
    ).toBe(false);
    const after = await activityCount();
    // The lock defines a real serial order: the source is wholly before or wholly after the desired state.
    expect([before, before + 1]).toContain(after);
    const duplicate = await adminPool!.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM circles_app."activityItems"
        WHERE "recipientId" = 6
          AND kind = 'comment_on_your_post'
          AND "sourceId" = $1`,
      [source.id],
    );
    expect(Number(duplicate.rows[0]?.count ?? 0)).toBeLessThanOrEqual(1);
    expectSuccess(
      await trpc("activity.updateCategories", { commentsEnabled: true }, 6),
    );
  });

  it("returns generic unavailable metadata and no target after post deletion, membership revocation, or circle deletion", async () => {
    const deletedPostSource = await comment(103, "post deletion source");
    const deletedPostItem = await storedActivityForSource(deletedPostSource.id);
    expectSuccess(await trpc("social.deletePost", { postId: 103 }, 6));

    const revokedSource = await comment(105, "membership revocation source");
    const revokedItem = await storedActivityForSource(revokedSource.id);
    expectSuccess(
      await trpc("social.removeMember", { circleId: 12, userId: 6 }, 1),
    );

    const deletedCircleSource = await comment(101, "circle deletion source");
    const deletedCircleItem = await storedActivityForSource(
      deletedCircleSource.id,
    );
    await adminPool!.query(
      "DELETE FROM circles_app.circles WHERE id = $1",
      [11],
    );

    const page = await listActivity();
    for (const itemId of [
      deletedPostItem.id,
      revokedItem.id,
      deletedCircleItem.id,
    ]) {
      expect(listedItem(page, itemId)).toMatchObject({
        available: false,
        actorName: null,
        circleName: null,
      });
      expect(
        resultData<{ target: unknown }>(
          await trpc("activity.resolveTarget", { id: itemId }, 6),
        ),
      ).toEqual({
        viewerId: 6,
        activityId: itemId,
        target: null,
      });
    }
  });

  it("keeps all 25 app tables private with Activity RLS/runtime grants and a healthy catalog-only operations check", async () => {
    const tableCount = await adminPool!.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM pg_catalog.pg_class relation_catalog
         JOIN pg_catalog.pg_namespace namespace_catalog
           ON namespace_catalog.oid = relation_catalog.relnamespace
        WHERE namespace_catalog.nspname = 'circles_app'
          AND relation_catalog.relkind IN ('r', 'p')`,
    );
    expect(Number(tableCount.rows[0]?.count ?? 0)).toBe(25);

    const boundary = await adminPool!.query<{
      relname: string;
      relrowsecurity: boolean;
      runtime_select: boolean;
      runtime_insert: boolean;
      runtime_update: boolean;
      runtime_delete: boolean;
      anon_select: boolean;
      authenticated_select: boolean;
      service_role_select: boolean;
      policy_count: string;
    }>(
      `SELECT relation_catalog.relname,
              relation_catalog.relrowsecurity,
              has_table_privilege('circles_app_runtime', relation_catalog.oid, 'SELECT') AS runtime_select,
              has_table_privilege('circles_app_runtime', relation_catalog.oid, 'INSERT') AS runtime_insert,
              has_table_privilege('circles_app_runtime', relation_catalog.oid, 'UPDATE') AS runtime_update,
              has_table_privilege('circles_app_runtime', relation_catalog.oid, 'DELETE') AS runtime_delete,
              has_table_privilege('anon', relation_catalog.oid, 'SELECT') AS anon_select,
              has_table_privilege('authenticated', relation_catalog.oid, 'SELECT') AS authenticated_select,
              has_table_privilege('service_role', relation_catalog.oid, 'SELECT') AS service_role_select,
              (SELECT count(*)::text FROM pg_catalog.pg_policy policy_catalog WHERE policy_catalog.polrelid = relation_catalog.oid) AS policy_count
         FROM pg_catalog.pg_class relation_catalog
         JOIN pg_catalog.pg_namespace namespace_catalog
           ON namespace_catalog.oid = relation_catalog.relnamespace
        WHERE namespace_catalog.nspname = 'circles_app'
          AND relation_catalog.relname = ANY($1::name[])
        ORDER BY relation_catalog.relname`,
      [["activityCirclePreferences", "activityItems", "activityPreferences"]],
    );
    expect(boundary.rows).toHaveLength(3);
    for (const row of boundary.rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(
        row.runtime_select &&
          row.runtime_insert &&
          row.runtime_update &&
          row.runtime_delete,
      ).toBe(true);
      expect(
        row.anon_select || row.authenticated_select || row.service_role_select,
      ).toBe(false);
      expect(Number(row.policy_count)).toBe(1);
    }

    const health = await adminPool!.query<{
      healthy: boolean;
      error_code: string | null;
    }>(
      "SELECT healthy, error_code FROM circles_ops.run_daily_migration_health()",
    );
    expect(health.rows).toHaveLength(1);
    expect(health.rows[0]).toEqual({ healthy: true, error_code: null });
  });
});
