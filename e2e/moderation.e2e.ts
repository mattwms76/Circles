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
import * as moderationSchema from "../drizzle/moderation-schema";
import * as sessionSchema from "../drizzle/session-schema";
import type { User } from "../drizzle/schema";
import type { ModerationDetail, ModerationPage } from "../shared/moderation";
import type { TrpcContext } from "../server/_core/context";
import { router } from "../server/_core/trpc";
import type { CirclesDatabase } from "../server/db";
import { moderationRouter } from "../server/moderation-router";
import {
  createRuntimeRolePool,
  type RuntimeRolePool,
} from "../server/runtime-role-pool";
import { socialRouter } from "../server/social-router";

const ACTOR_HEADER = "x-circle-home-e2e-user";
const HTTP_TIMEOUT_MS = 4_000;
const FIXTURE_USERS = new Map<number, User>();

/**
 * The sole E2E mock substitutes only server/db's connection facade with a real Drizzle database
 * backed by the runner-owned PostgreSQL 17 fixture. Routers, services, source actions, SQL, and
 * response values remain production code.
 */
const dbFacade = vi.hoisted(() => ({ database: null as unknown }));
vi.mock("../server/db", () => ({
  getDb: () => Promise.resolve(dbFacade.database),
}));

const databaseSchema = {
  ...coreSchema,
  ...liveSchema,
  ...sessionSchema,
  ...moderationSchema,
};
const moderationHttpRouter = router({
  moderation: moderationRouter,
  social: socialRouter,
});

type TrpcWireResult = {
  status: number;
  data: unknown;
  errorCode: string | null;
  errorMessage: string | null;
};
type StoredCase = {
  id: number;
  sourcePostId: number;
  postId: number | null;
  status: "open" | "kept" | "removed";
  reportCount: number;
};

let runtimePool: RuntimeRolePool | null = null;
let adminPool: Pool | null = null;
let httpServer: Server | null = null;
let apiBaseUrl = "";
let fixturePort = 0;
let fixtureDatabase = "";

function readFixturePort(): number {
  const raw = process.env.CIRCLE_HOME_E2E_PG_PORT;
  if (!raw || !/^\d{1,5}$/.test(raw)) {
    throw new Error(
      "Moderation E2E fixture port was not supplied by the isolated runner",
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
      "Moderation E2E fixture port is not an allowed loopback port",
    );
  }
  return port;
}

function fixtureUser(id: number): User | null {
  return FIXTURE_USERS.get(id) ?? null;
}

/** Test-only loopback auth injection; shipped OAuth/session processing is not changed. */
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
      router: moderationHttpRouter,
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
      "Moderation E2E HTTP listener was not assigned an isolated loopback port",
    );
  }
  httpServer = server;
  return `http://127.0.0.1:${address.port}`;
}

function isQueryProcedure(procedure: string): boolean {
  return ["moderation.list", "moderation.detail"].includes(procedure);
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

function expectNoReporterIdentity(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) expectNoReporterIdentity(child);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    expect(key.toLowerCase()).not.toContain("reporter");
    expectNoReporterIdentity(child);
  }
}

async function storedCase(sourcePostId: number): Promise<StoredCase> {
  const result = await adminPool!.query<StoredCase>(
    `SELECT id, "sourcePostId", "postId", status, "reportCount"
       FROM circles_app."moderationCases"
      WHERE "circleId" = 11 AND "sourcePostId" = $1
      LIMIT 1`,
    [sourcePostId],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0]!;
}

async function actionCount(caseId: number): Promise<number> {
  const result = await adminPool!.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM circles_app."moderationActions"
      WHERE "caseId" = $1`,
    [caseId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function listCases(
  actorId: number | null,
  filter: "open" | "resolved",
  input: Record<string, unknown> = {},
): Promise<TrpcWireResult> {
  return trpc(
    "moderation.list",
    { circleId: 11, viewerScope: actorId ?? 1, filter, ...input },
    actorId,
  );
}

async function detail(
  actorId: number | null,
  caseId: number,
  input: Record<string, unknown> = {},
): Promise<TrpcWireResult> {
  return trpc(
    "moderation.detail",
    { circleId: 11, viewerScope: actorId ?? 1, caseId, ...input },
    actorId,
  );
}

async function report(
  postId: number,
  reason: string,
  actorId: number,
): Promise<void> {
  expectSuccess(await trpc("social.report", { postId, reason }, actorId));
}

async function resolve(
  caseId: number,
  decision: "keep" | "remove",
  note: string,
  actorId: number,
): Promise<TrpcWireResult> {
  return trpc(
    "moderation.resolve",
    { circleId: 11, viewerScope: actorId, caseId, decision, note },
    actorId,
  );
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
      "Moderation E2E requires a fresh runner-owned database marker",
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
        "Moderation E2E target does not match the owned local fixture",
      );
    }
  } finally {
    await guardPool.end();
  }

  const now = new Date("2026-10-23T12:00:00.000Z");
  const names = [
    "owner",
    "moderator",
    "member",
    "pending",
    "outsider",
    "author",
    "reporter",
  ];
  for (const [index, name] of names.entries()) {
    const id = index + 1;
    FIXTURE_USERS.set(id, {
      id,
      openId: `circle-home-e2e-${name}`,
      name: `Fixture ${name}`,
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
  dbFacade.database = drizzle(runtimePool, {
    schema: databaseSchema,
  }) as CirclesDatabase;
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
  dbFacade.database = null;
});

describe.sequential("Moderator Report Workspace isolated HTTP E2E", () => {
  it("maps eligible pre-0012 circle reports into anonymous aggregate cases without reporter fields", async () => {
    const legacy = await storedCase(101);
    expect(legacy).toMatchObject({
      sourcePostId: 101,
      postId: 101,
      status: "open",
      reportCount: 2,
    });

    const page = resultData<ModerationPage>(await listCases(1, "open"));
    const item = page.items.find((candidate) => candidate.id === legacy.id);
    expect(page).toMatchObject({ circleId: 11, viewerScope: 1 });
    expect(item).toMatchObject({
      id: legacy.id,
      postId: 101,
      status: "open",
      reportCount: 2,
      canResolve: true,
      blockedReason: null,
    });

    const caseDetail = resultData<ModerationDetail>(await detail(1, legacy.id));
    expect(caseDetail).toMatchObject({
      circleId: 11,
      viewerScope: 1,
      item: { id: legacy.id, reportCount: 2 },
      post: { id: 101 },
      reasons: [{ reason: "Legacy abuse", count: 2 }],
      history: [],
    });
    expectNoReporterIdentity(page);
    expectNoReporterIdentity(caseDetail);

    const reporterColumns = await adminPool!.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'circles_app'
          AND table_name IN ('moderationCases', 'moderationActions')
          AND lower(column_name) LIKE '%reporter%'`,
    );
    expect(reporterColumns.rows).toEqual([]);
  });

  it("denies guest, member, pending, and foreign-circle authority and rejects stale account scope before reads", async () => {
    const legacy = await storedCase(101);
    const guest = await listCases(null, "open");
    const mismatched = await listCases(1, "open", { viewerScope: 2 });
    const staleDetail = await detail(1, legacy.id, { viewerScope: 2 });
    expect(guest).toMatchObject({ status: 401, errorCode: "UNAUTHORIZED" });
    expect(mismatched).toMatchObject({ status: 409, errorCode: "CONFLICT" });
    expect(staleDetail).toMatchObject({ status: 409, errorCode: "CONFLICT" });

    for (const actorId of [3, 4, 5]) {
      const denied = await listCases(actorId, "open");
      const deniedDetail = await detail(actorId, legacy.id);
      expect(denied).toMatchObject({ status: 403, errorCode: "FORBIDDEN" });
      expect(deniedDetail).toMatchObject({
        status: 403,
        errorCode: "FORBIDDEN",
      });
    }
  });

  it("aggregates real report retries from the existing source action without duplicate reporter contributions", async () => {
    await report(102, "Retry-safe reason", 3);
    await report(102, "Retry-safe reason", 3);
    await report(102, "Second member reason", 7);

    const case102 = await storedCase(102);
    expect(case102).toMatchObject({
      status: "open",
      reportCount: 2,
      postId: 102,
    });
    const legacyRows = await adminPool!.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM circles_app.reports
        WHERE "postId" = 102`,
    );
    expect(Number(legacyRows.rows[0]?.count ?? 0)).toBe(2);

    const caseDetail = resultData<ModerationDetail>(
      await detail(2, case102.id),
    );
    expect(caseDetail.reasons).toEqual([
      { reason: "Retry-safe reason", count: 1 },
      { reason: "Second member reason", count: 1 },
    ]);
    expectNoReporterIdentity(caseDetail);
  });

  it("uses newest-first keyset pages, separates open/resolved filters, and blocks self-review", async () => {
    await report(103, "Race review source", 3);
    const legacy = await storedCase(101);
    const selfReview = await storedCase(106);
    const first = resultData<ModerationPage>(
      await listCases(1, "open", { limit: 1 }),
    );
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = resultData<ModerationPage>(
      await listCases(1, "open", { limit: 50, cursor: first.nextCursor! }),
    );
    const ids = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(second.items.every((item) => item.id < first.nextCursor!.id)).toBe(
      true,
    );
    expect(ids).toContain(legacy.id);

    const subjectDetail = resultData<ModerationDetail>(
      await detail(1, selfReview.id),
    );
    expect(subjectDetail.item).toMatchObject({
      canResolve: false,
      blockedReason: "self_review",
    });
    expect(
      await resolve(selfReview.id, "keep", "self-review forbidden", 1),
    ).toMatchObject({
      status: 403,
      errorCode: "FORBIDDEN",
    });
    expect(
      resultData<ModerationPage>(await listCases(1, "resolved")),
    ).toMatchObject({ items: [] });
    expectSuccess(
      await resolve(selfReview.id, "keep", "Reviewed by another moderator", 2),
    );
    expect(
      resultData<ModerationDetail>(await detail(1, selfReview.id)).item,
    ).toMatchObject({
      status: "kept",
      canResolve: false,
      blockedReason: "self_review",
    });
    expect(
      resultData<ModerationPage>(await listCases(1, "resolved")).items,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: selfReview.id,
          status: "kept",
          canResolve: false,
          blockedReason: "self_review",
        }),
      ]),
    );
    expect(
      await resolve(selfReview.id, "keep", "Reviewed by another moderator", 1),
    ).toMatchObject({ status: 403, errorCode: "FORBIDDEN" });
  });

  it("keeps final histories after target deletion, preserves final state for later reports, and removes through the existing deletion path", async () => {
    const keepCase = await storedCase(101);
    expectSuccess(
      await resolve(keepCase.id, "keep", "  reviewed and kept  ", 1),
    );
    expectSuccess(await resolve(keepCase.id, "keep", "reviewed and kept", 1));
    expect(await actionCount(keepCase.id)).toBe(1);

    // A later legitimate source report updates aggregate evidence but cannot reopen or rewrite history.
    await report(101, "Later report after final keep", 2);
    const kept = resultData<ModerationDetail>(await detail(1, keepCase.id));
    expect(kept.item).toMatchObject({
      status: "kept",
      canResolve: false,
      blockedReason: "resolved",
      reportCount: 3,
    });
    expect(kept.history).toEqual([
      expect.objectContaining({
        decision: "keep",
        note: "reviewed and kept",
        reviewer: expect.objectContaining({ id: 1, name: expect.any(String) }),
      }),
    ]);

    expectSuccess(await trpc("social.deletePost", { postId: 101 }, 1));
    const unavailableKept = resultData<ModerationDetail>(
      await detail(1, keepCase.id),
    );
    expect(unavailableKept).toMatchObject({
      item: { status: "kept", postId: null },
      post: null,
    });
    expect(unavailableKept.history).toHaveLength(1);

    const removeCase = await storedCase(102);
    expectSuccess(
      await resolve(removeCase.id, "remove", "Remove confirmed", 1),
    );
    const removed = resultData<ModerationDetail>(
      await detail(1, removeCase.id),
    );
    expect(removed).toMatchObject({
      item: { status: "removed", postId: null, blockedReason: "resolved" },
      post: null,
      history: [
        expect.objectContaining({
          decision: "remove",
          note: "Remove confirmed",
        }),
      ],
    });
    expect(await actionCount(removeCase.id)).toBe(1);
    expectNoReporterIdentity(unavailableKept);
    expectNoReporterIdentity(removed);
  });

  it("serializes opposing concurrent final decisions, keeps exact desired retries idempotent, and rejects authority revoked after queue load", async () => {
    const raceCase = await storedCase(103);
    const [owner, moderator] = await Promise.all([
      resolve(raceCase.id, "keep", "race decision", 1),
      resolve(raceCase.id, "remove", "race decision", 2),
    ]);
    expect([owner.status, moderator.status].sort()).toEqual([200, 409]);
    const resolved = resultData<ModerationDetail>(await detail(1, raceCase.id));
    expect(resolved.item.status).toMatch(/^(kept|removed)$/);
    expect(resolved.history).toHaveLength(1);
    expect(await actionCount(raceCase.id)).toBe(1);
    const action = resolved.history[0]!;
    expect(action.reviewer).not.toBeNull();
    expectSuccess(
      await resolve(
        raceCase.id,
        action.decision,
        action.note,
        action.reviewer!.id,
      ),
    );
    expect(await actionCount(raceCase.id)).toBe(1);

    expectSuccess(
      await trpc("social.removeMember", { circleId: 11, userId: 2 }, 1),
    );
    const revokedList = await listCases(2, "resolved");
    const revokedResolve = await resolve(
      raceCase.id,
      action.decision,
      action.note,
      2,
    );
    expect(revokedList).toMatchObject({ status: 403, errorCode: "FORBIDDEN" });
    expect(revokedResolve).toMatchObject({
      status: 403,
      errorCode: "FORBIDDEN",
    });

    const resolvedPage = resultData<ModerationPage>(
      await listCases(1, "resolved"),
    );
    expect(resolvedPage.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        raceCase.id,
        (await storedCase(101)).id,
        (await storedCase(102)).id,
      ]),
    );
  });

  it("keeps the exact 27-table moderation schema private with healthy local operations metadata", async () => {
    const tableCount = await adminPool!.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM pg_catalog.pg_class relation_catalog
         JOIN pg_catalog.pg_namespace namespace_catalog
           ON namespace_catalog.oid = relation_catalog.relnamespace
        WHERE namespace_catalog.nspname = 'circles_app'
          AND relation_catalog.relkind IN ('r', 'p')`,
    );
    expect(Number(tableCount.rows[0]?.count ?? 0)).toBe(27);

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
      [["moderationActions", "moderationCases"]],
    );
    expect(boundary.rows).toHaveLength(2);
    for (const row of boundary.rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.runtime_select && row.runtime_insert).toBe(true);
      expect(row.runtime_update).toBe(row.relname !== "moderationActions");
      expect(row.runtime_delete).toBe(row.relname !== "moderationActions");
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
    expect(health.rows).toEqual([{ healthy: true, error_code: null }]);
  });
});
