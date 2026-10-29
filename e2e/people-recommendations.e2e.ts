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
import type { TrpcContext } from "../server/_core/context";
import { router } from "../server/_core/trpc";
import {
  createRuntimeRolePool,
  type RuntimeRolePool,
} from "../server/runtime-role-pool";
import { socialRouter } from "../server/social-router";

const ACTOR_HEADER = "x-people-recommendations-e2e-user";
const HTTP_TIMEOUT_MS = 4_000;
const FIXTURE_USERS = new Map<number, User>();

/**
 * Only the DB facade is substituted: the router, service query, runtime role, SQL, and HTTP
 * serialization are all current production source against the runner-owned PostgreSQL 17 fixture.
 */
const dbFacade = vi.hoisted(() => ({ database: null as unknown }));
vi.mock("../server/db", () => ({
  getDb: () => Promise.resolve(dbFacade.database),
}));

const databaseSchema = { ...coreSchema, ...liveSchema, ...sessionSchema };
const peopleHttpRouter = router({ social: socialRouter });

type ProfileItem = {
  id: number;
  name: string;
  handle: string;
  bio: string;
  avatar: string;
  followers: number;
  following: number;
  isFollowing?: boolean;
};
type ProfilePage = {
  items: ProfileItem[];
  nextCursor: { id: number } | null;
  hasMore: boolean;
};
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

function fixturePort(): number {
  const raw = process.env.CIRCLE_HOME_E2E_PG_PORT;
  if (!raw || !/^\d{1,5}$/.test(raw)) {
    throw new Error("People recommendation E2E fixture port was not supplied");
  }
  const port = Number(raw);
  if (
    !Number.isSafeInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    [3000, 8081].includes(port)
  ) {
    throw new Error("People recommendation E2E fixture port is not allowed");
  }
  return port;
}

function fixtureUser(id: number): User | null {
  return FIXTURE_USERS.get(id) ?? null;
}

/** Test-only header selection is confined to this loopback fixture context. */
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
      router: peopleHttpRouter,
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
    throw new Error("People recommendation HTTP listener is not isolated");
  }
  httpServer = server;
  return `http://127.0.0.1:${address.port}`;
}

async function profilesPage(
  input: { search?: string; cursor?: { id: number }; limit?: number },
  actorId: number | null,
): Promise<TrpcWireResult> {
  const url = new URL("/api/trpc/social.profilesPage", apiBaseUrl);
  url.searchParams.set("input", JSON.stringify({ json: input }));
  const headers: Record<string, string> = { Accept: "application/json" };
  if (actorId !== null) headers[ACTOR_HEADER] = String(actorId);
  const response = await fetch(url, {
    method: "GET",
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
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

function page(result: TrpcWireResult): ProfilePage {
  expect(result.status).toBe(200);
  expect(result.errorCode).toBeNull();
  expect(result.data).toBeTruthy();
  return result.data as ProfilePage;
}

function ids(result: ProfilePage): number[] {
  return result.items.map((item) => item.id);
}

beforeAll(async () => {
  const port = fixturePort();
  const database = process.env.CIRCLE_HOME_E2E_DB ?? "";
  const token = process.env.CIRCLE_HOME_E2E_TOKEN ?? "";
  if (
    !/^circle_home_e2e_[a-f0-9]{24}$/.test(database) ||
    !/^[a-f0-9]{64}$/.test(token)
  ) {
    throw new Error(
      "People recommendation E2E requires a runner-owned fixture",
    );
  }
  const guardPool = new Pool({
    host: "127.0.0.1",
    port,
    database,
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
      [token],
    );
    const row = guard.rows[0];
    if (
      guard.rows.length !== 1 ||
      row?.database_name !== database ||
      row.port !== port ||
      row.version < 170000 ||
      row.version >= 180000 ||
      row.token !== token
    ) {
      throw new Error(
        "People recommendation target does not match owned fixture",
      );
    }
  } finally {
    await guardPool.end();
  }

  const now = new Date("2026-10-29T00:00:00.000Z");
  for (let id = 1; id <= 15; id += 1) {
    FIXTURE_USERS.set(id, {
      id,
      openId: `people-recommendations-${id}`,
      name: `Synthetic ${id}`,
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
    port,
    database,
    user: "postgres",
    max: 6,
    connectionTimeoutMillis: HTTP_TIMEOUT_MS,
    query_timeout: HTTP_TIMEOUT_MS,
    statement_timeout: HTTP_TIMEOUT_MS,
    lock_timeout: HTTP_TIMEOUT_MS,
    idle_in_transaction_session_timeout: HTTP_TIMEOUT_MS,
  });
  dbFacade.database = drizzle(runtimePool, { schema: databaseSchema });
  adminPool = new Pool({
    host: "127.0.0.1",
    port,
    database,
    user: "postgres",
    max: 2,
    connectionTimeoutMillis: HTTP_TIMEOUT_MS,
    query_timeout: HTTP_TIMEOUT_MS,
  });
  expect(
    await runtimePool.query<{ current_user: string }>("SELECT current_user"),
  ).toMatchObject({ rows: [{ current_user: "circles_app_runtime" }] });
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

describe.sequential("People recommendations isolated HTTP E2E", () => {
  const viewerOneOrder = [4, 9, 6, 11, 13, 8, 10, 2, 3, 5, 12, 7, 14, 15];

  it("ranks exact overlap, capped two-hop paths, and followed fallback deterministically", async () => {
    const result = page(await profilesPage({ limit: 50 }, 1));
    expect(ids(result)).toEqual(viewerOneOrder);
    expect(result.items.find((item) => item.id === 4)).toMatchObject({
      isFollowing: false,
    });
    expect(result.items.find((item) => item.id === 7)).toMatchObject({
      isFollowing: true,
    });
    // Candidate 9 combines one exact interest with one two-hop path. Candidate 8 has twelve
    // paths but is capped at nine, so it cannot displace the 100-point exact-overlap tier.
    expect(ids(result).indexOf(9)).toBeLessThan(ids(result).indexOf(6));
    expect(ids(result).indexOf(13)).toBeLessThan(ids(result).indexOf(8));
    // Candidate 13 has duplicate/unknown legacy array values, yet ties the one-interest tier.
    expect(ids(result).slice(2, 5)).toEqual([6, 11, 13]);
  });

  it("changes order for contrasting viewers and still lets a cold-start viewer use social paths", async () => {
    const gaming = page(await profilesPage({ limit: 50 }, 2));
    const coldStart = page(await profilesPage({ limit: 50 }, 3));
    expect(ids(gaming)[0]).toBe(5);
    expect(ids(gaming).at(-1)).toBe(6);
    expect(gaming.items.find((item) => item.id === 6)?.isFollowing).toBe(true);
    expect(ids(coldStart).slice(0, 2)).toEqual([8, 9]);
    expect(ids(coldStart).at(-1)).toBe(14);
  });

  it("traverses a static ranked result without duplicate or skipped profiles", async () => {
    const collected: number[] = [];
    const cursors: (number | null)[] = [];
    let cursor: { id: number } | undefined;
    do {
      const current = page(
        await profilesPage({ limit: 2, ...(cursor ? { cursor } : {}) }, 1),
      );
      collected.push(...ids(current));
      cursors.push(current.nextCursor?.id ?? null);
      cursor = current.nextCursor ?? undefined;
    } while (cursor);
    expect(collected).toEqual(viewerOneOrder);
    expect(new Set(collected).size).toBe(collected.length);
    expect(cursors).toEqual([9, 11, 8, 2, 5, 7, null]);
  });

  it("rejects a missing, self, or search-ineligible cursor with a refresh-safe bad request", async () => {
    for (const input of [
      { cursor: { id: 999 } },
      { cursor: { id: 1 } },
      { search: "Lumen Atlas", cursor: { id: 5 } },
    ]) {
      const result = await profilesPage(input, 1);
      expect(result).toMatchObject({
        status: 400,
        errorCode: "BAD_REQUEST",
        errorMessage: "People recommendations changed. Refresh to continue.",
      });
    }
  });

  it("keeps guest, search, and public DTO behavior while hiding recommendation inputs", async () => {
    const guest = page(await profilesPage({ limit: 50 }, null));
    const nameSearch = page(
      await profilesPage({ search: "  lUmEn aTlAs  ", limit: 50 }, null),
    );
    const handleSearch = page(
      await profilesPage({ search: "  @mUsIc-dUp  ", limit: 50 }, null),
    );
    const privateInterestSearch = page(
      await profilesPage({ search: "technology", limit: 50 }, null),
    );
    expect(ids(guest)).toEqual(
      Array.from({ length: 15 }, (_, index) => index + 1),
    );
    expect(guest.items.every((item) => !("isFollowing" in item))).toBe(true);
    expect(ids(nameSearch)).toEqual([4]);
    expect(ids(handleSearch)).toEqual([13]);
    expect(ids(privateInterestSearch)).toEqual([]);

    const publicItem = page(await profilesPage({ limit: 50 }, 1)).items[0]!;
    expect(Object.keys(publicItem).sort()).toEqual([
      "avatar",
      "bio",
      "followers",
      "following",
      "handle",
      "id",
      "isFollowing",
      "name",
    ]);
    expect(JSON.stringify(publicItem)).not.toMatch(
      /interest|score|two.?hop|intermediate/i,
    );
  });

  it("treats a historical non-array JSON interest value as no overlap without failing the page", async () => {
    const malformed = await adminPool!.query<{ interests: unknown }>(
      'SELECT interests FROM circles_app.profiles WHERE "userId" = $1',
      [12],
    );
    expect(malformed.rows[0]?.interests).toEqual({ music: true });
    const result = page(await profilesPage({ limit: 50 }, 1));
    expect(ids(result).indexOf(12)).toBeGreaterThan(ids(result).indexOf(5));
    expect(ids(result).indexOf(12)).toBeLessThan(ids(result).indexOf(7));
  });
});
