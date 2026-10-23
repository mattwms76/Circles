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
import * as coreSchema from "../drizzle/schema";
import * as liveSchema from "../drizzle/live-schema";
import * as sessionSchema from "../drizzle/session-schema";
import type { User } from "../drizzle/schema";
import type { TrpcContext } from "../server/_core/context";
import { router } from "../server/_core/trpc";
import { circleHomeRouter } from "../server/circle-home-router";
import {
  createRuntimeRolePool,
  type RuntimeRolePool,
} from "../server/runtime-role-pool";

const ACTOR_HEADER = "x-circle-home-e2e-user";
const HTTP_TIMEOUT_MS = 4_000;
const FIXTURE_USERS = new Map<number, User>();

/**
 * The only mock in this E2E layer is the server/db connection facade. It supplies a real
 * local Drizzle instance whose $client is a real RuntimeRolePool. No query, service, or router
 * behavior is mocked.
 */
const dbFacade = vi.hoisted(() => ({ database: null as unknown }));
vi.mock("../server/db", () => ({
  getDb: () => Promise.resolve(dbFacade.database),
}));

const databaseSchema = { ...coreSchema, ...liveSchema, ...sessionSchema };
const circleHomeHttpRouter = router({ circleHome: circleHomeRouter });
type TrpcWireResult = {
  status: number;
  data: unknown;
  errorCode: string | null;
  errorMessage: string | null;
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
      "Circle Home E2E fixture port was not supplied by the isolated runner",
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
      "Circle Home E2E fixture port is not an allowed loopback port",
    );
  }
  return port;
}

function fixtureUser(id: number): User | null {
  return FIXTURE_USERS.get(id) ?? null;
}

/** Test-only context injection; production routes/authentication are never modified. */
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
      router: circleHomeHttpRouter,
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
      "Circle Home E2E HTTP listener was not assigned an isolated loopback port",
    );
  }
  httpServer = server;
  return `http://127.0.0.1:${address.port}`;
}

async function trpc(
  procedure: "circleHome.get" | "circleHome.update" | "circleHome.pin",
  input: Record<string, unknown>,
  actorId: number | null,
): Promise<TrpcWireResult> {
  const isQuery = procedure === "circleHome.get";
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
  // The production transformer wraps tRPC errors under `error.json`; accepting the plain
  // envelope too retains a transport-level assertion rather than hard-coding a fake response.
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

async function readHome(
  circleId: number,
  actorId: number | null,
  viewerScope?: number | null,
) {
  return trpc(
    "circleHome.get",
    viewerScope === undefined ? { circleId } : { circleId, viewerScope },
    actorId,
  );
}

async function waitForBlockedCircleMutation(): Promise<void> {
  const deadline = Date.now() + HTTP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const rows = await adminPool!.query<{ waiting: boolean }>(
      `SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND query LIKE '%circles_app%circles%'
          AND query LIKE '%for update%'
      ) AS waiting`,
    );
    if (rows.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Circle Home mutation did not wait on the parent-row lock");
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
      "Circle Home E2E requires a fresh runner-owned database marker",
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
      `SELECT current_database() AS database_name, current_setting('server_version_num')::int AS version,
        inet_server_port() AS port, token FROM e2e_fixture.guard WHERE token = $1 LIMIT 1`,
      [fixtureToken],
    );
    const row = guard.rows[0];
    if (
      guard.rows.length !== 1 ||
      row.database_name !== fixtureDatabase ||
      row.port !== fixturePort ||
      row.version < 170000 ||
      row.version >= 180000 ||
      row.token !== fixtureToken
    ) {
      throw new Error(
        "Circle Home E2E target does not match the owned local fixture",
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
    max: 4,
    connectionTimeoutMillis: HTTP_TIMEOUT_MS,
    query_timeout: HTTP_TIMEOUT_MS,
    statement_timeout: HTTP_TIMEOUT_MS,
    lock_timeout: HTTP_TIMEOUT_MS,
    idle_in_transaction_session_timeout: HTTP_TIMEOUT_MS,
  });
  const localDatabase = drizzle(runtimePool, { schema: databaseSchema });
  dbFacade.database = localDatabase;
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

describe.sequential("Circle Home isolated HTTP E2E", () => {
  it("reads default public home for a guest and gates private reads to approved members", async () => {
    const publicGuest = await readHome(11, null);
    expectSuccess(publicGuest);
    expect(publicGuest.data).toMatchObject({
      circleId: 11,
      viewerId: null,
      welcomeMessage: "",
      rules: [],
      pinnedPost: null,
      canManage: false,
    });

    const privateGuest = await readHome(12, null);
    const privatePending = await readHome(12, 4);
    const privateMember = await readHome(12, 3);
    expect(privateGuest).toMatchObject({ status: 403, errorCode: "FORBIDDEN" });
    expect(privatePending).toMatchObject({
      status: 403,
      errorCode: "FORBIDDEN",
    });
    expectSuccess(privateMember);
    expect(privateMember.data).toMatchObject({
      circleId: 12,
      viewerId: 3,
      canManage: false,
    });
  });

  it("normalizes owner save/retry and permits an independent moderator text edit", async () => {
    const ownerSave = await trpc(
      "circleHome.update",
      {
        circleId: 11,
        viewerScope: 1,
        welcomeMessage: "  Owner welcome.  ",
        rules: ["  Be kind.  ", " Respect privacy. "],
      },
      1,
    );
    expectSuccess(ownerSave);
    const retry = await trpc(
      "circleHome.update",
      {
        circleId: 11,
        viewerScope: 1,
        welcomeMessage: "Owner welcome.",
        rules: ["Be kind.", "Respect privacy."],
      },
      1,
    );
    expectSuccess(retry);

    const moderatorEdit = await trpc(
      "circleHome.update",
      {
        circleId: 11,
        viewerScope: 2,
        welcomeMessage: "Moderator edit.",
        rules: ["Be kind."],
      },
      2,
    );
    expectSuccess(moderatorEdit);
    const visible = await readHome(11, 3, 3);
    expectSuccess(visible);
    expect(visible.data).toMatchObject({
      welcomeMessage: "Moderator edit.",
      rules: ["Be kind."],
      canManage: false,
    });
  });

  it("rejects member, pending, outsider, and anonymous changes while preserving protected-procedure semantics", async () => {
    for (const actorId of [3, 4, 5]) {
      for (const [procedure, input] of [
        [
          "circleHome.update",
          { circleId: 11, welcomeMessage: "Denied", rules: [] },
        ],
        ["circleHome.pin", { circleId: 11, postId: 101 }],
      ] as const) {
        const result = await trpc(procedure, input, actorId);
        expect(result).toMatchObject({ status: 403, errorCode: "FORBIDDEN" });
      }
    }
    for (const [procedure, input] of [
      [
        "circleHome.update",
        { circleId: 11, welcomeMessage: "Denied", rules: [] },
      ],
      ["circleHome.pin", { circleId: 11, postId: 101 }],
    ] as const) {
      const anonymous = await trpc(procedure, input, null);
      expect(anonymous).toMatchObject({
        status: 401,
        errorCode: "UNAUTHORIZED",
      });
    }
  });

  it("rejects viewer scope mismatches before an account can read or mutate", async () => {
    const signedRead = await readHome(11, 1, 2);
    const guestRead = await readHome(11, null, 1);
    const signedUpdate = await trpc(
      "circleHome.update",
      { circleId: 11, viewerScope: 2, welcomeMessage: "No write", rules: [] },
      1,
    );
    const signedPin = await trpc(
      "circleHome.pin",
      { circleId: 11, viewerScope: 2, postId: null },
      1,
    );
    for (const result of [signedRead, guestRead, signedUpdate, signedPin]) {
      expect(result).toMatchObject({
        status: 409,
        errorCode: "CONFLICT",
        errorMessage: "Account changed. Please try again.",
      });
    }
  });

  it("makes foreign and missing pin targets indistinguishable and manages same-circle pins independently of text", async () => {
    const missing = await trpc(
      "circleHome.pin",
      { circleId: 11, postId: 999 },
      1,
    );
    const foreign = await trpc(
      "circleHome.pin",
      { circleId: 11, postId: 104 },
      1,
    );
    expect(missing).toMatchObject({
      status: 404,
      errorCode: "NOT_FOUND",
      errorMessage: "Post is unavailable for this circle",
    });
    expect(foreign).toMatchObject({
      status: 404,
      errorCode: "NOT_FOUND",
      errorMessage: missing.errorMessage,
    });

    for (const postId of [101, 101, 102]) {
      const pin = await trpc("circleHome.pin", { circleId: 11, postId }, 1);
      expectSuccess(pin);
    }
    const afterReplace = await readHome(11, 1, 1);
    expectSuccess(afterReplace);
    expect(afterReplace.data).toMatchObject({
      welcomeMessage: "Moderator edit.",
      rules: ["Be kind."],
      pinnedPost: { id: 102, circleId: 11 },
    });

    const textSave = await trpc(
      "circleHome.update",
      {
        circleId: 11,
        welcomeMessage: "Text changed after pin.",
        rules: ["Rule remains."],
      },
      1,
    );
    expectSuccess(textSave);
    const afterTextSave = await readHome(11, 1, 1);
    expectSuccess(afterTextSave);
    expect(afterTextSave.data).toMatchObject({
      welcomeMessage: "Text changed after pin.",
      rules: ["Rule remains."],
      pinnedPost: { id: 102, circleId: 11 },
    });

    for (const postId of [null, null]) {
      const unpin = await trpc("circleHome.pin", { circleId: 11, postId }, 1);
      expectSuccess(unpin);
    }
    const afterUnpin = await readHome(11, 1, 1);
    expectSuccess(afterUnpin);
    expect(afterUnpin.data).toMatchObject({
      welcomeMessage: "Text changed after pin.",
      rules: ["Rule remains."],
      pinnedPost: null,
    });
  });

  it("clears a pin through the real FK when its local fixture post is deleted", async () => {
    expectSuccess(
      await trpc("circleHome.pin", { circleId: 11, postId: 102 }, 1),
    );
    await adminPool!.query(
      "DELETE FROM circles_app.posts WHERE id = $1",
      [102],
    );
    const afterDelete = await readHome(11, 1, 1);
    expectSuccess(afterDelete);
    expect(afterDelete.data).toMatchObject({
      welcomeMessage: "Text changed after pin.",
      rules: ["Rule remains."],
      pinnedPost: null,
    });
  });

  it("enforces HTTP validation for Unicode and rule bounds", async () => {
    const astral = "😀";
    const accepted = await trpc(
      "circleHome.update",
      {
        circleId: 11,
        welcomeMessage: astral.repeat(2_000),
        rules: [astral.repeat(300)],
      },
      1,
    );
    expectSuccess(accepted);
    const exact = await readHome(11, 1, 1);
    expectSuccess(exact);
    expect(exact.data).toMatchObject({
      welcomeMessage: astral.repeat(2_000),
      rules: [astral.repeat(300)],
    });

    for (const input of [
      { circleId: 11, welcomeMessage: astral.repeat(2_001), rules: [] },
      { circleId: 11, welcomeMessage: "", rules: [astral.repeat(301)] },
      { circleId: 11, welcomeMessage: "", rules: ["one\r\ntwo"] },
      { circleId: 11, welcomeMessage: "", rules: ["same", " SAME "] },
      {
        circleId: 11,
        welcomeMessage: "",
        rules: Array.from({ length: 11 }, (_, index) => `rule-${index}`),
      },
      { circleId: 0, welcomeMessage: "", rules: [] },
    ]) {
      const invalid = await trpc("circleHome.update", input, 1);
      expect(invalid).toMatchObject({ status: 400, errorCode: "BAD_REQUEST" });
    }
  });

  it("serializes a role removal against the protected parent-row mutation lock", async () => {
    const lockClient = await adminPool!.connect();
    try {
      await lockClient.query("BEGIN");
      await lockClient.query(
        "SELECT id FROM circles_app.circles WHERE id = $1 FOR UPDATE",
        [11],
      );
      const pendingMutation = trpc(
        "circleHome.update",
        { circleId: 11, welcomeMessage: "Moderator after removal", rules: [] },
        2,
      );
      await waitForBlockedCircleMutation();
      await lockClient.query(
        'DELETE FROM circles_app.memberships WHERE "circleId" = $1 AND "userId" = $2',
        [11, 2],
      );
      await lockClient.query("COMMIT");
      const denied = await pendingMutation;
      expect(denied).toMatchObject({ status: 403, errorCode: "FORBIDDEN" });
    } finally {
      try {
        await lockClient.query("ROLLBACK");
      } catch {
        // The transaction may already have committed; fixture teardown still owns PostgreSQL cleanup.
      }
      lockClient.release();
    }
  });
});
