import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as coreSchema from "../drizzle/schema";
import type { CirclesDatabase } from "../server/db";
import {
  createRuntimeRolePool,
  type RuntimeRolePool,
} from "../server/runtime-role-pool";
import { listCommentsPage } from "../server/social-service";

const SHARED_TIMESTAMP_EXACT = "2026-10-29T12:34:56.123456Z";
const LATER_TIMESTAMP_EXACT = "2026-10-29T12:34:56.124000Z";

const dbFacade = vi.hoisted(() => ({ database: null as unknown }));
vi.mock("../server/db", () => ({
  getDb: () => Promise.resolve(dbFacade.database),
}));

type FixtureTarget = { port: number; database: string; token: string };

let target: FixtureTarget | null = null;
let runtimePool: RuntimeRolePool | null = null;
let adminPool: Pool | null = null;
let database: CirclesDatabase | null = null;

function readFixtureTarget(): FixtureTarget {
  const rawPort = process.env.CIRCLE_HOME_E2E_PG_PORT;
  const database = process.env.CIRCLE_HOME_E2E_DB;
  const token = process.env.CIRCLE_HOME_E2E_TOKEN;
  if (
    !rawPort ||
    !/^\d{1,5}$/.test(rawPort) ||
    !database ||
    !/^circle_home_e2e_[a-f0-9]{24}$/.test(database) ||
    !token ||
    !/^[a-f0-9]{64}$/.test(token)
  ) {
    throw new Error("CBA-03 requires the fixed runner-owned PG17 fixture");
  }
  const port = Number(rawPort);
  if (
    !Number.isSafeInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    [3000, 8081].includes(port)
  ) {
    throw new Error(
      "CBA-03 fixture port is not an allowed isolated loopback port",
    );
  }
  return { port, database, token };
}

beforeAll(async () => {
  target = readFixtureTarget();
  const guardPool = new Pool({
    host: "127.0.0.1",
    port: target.port,
    database: target.database,
    user: "postgres",
    max: 1,
    connectionTimeoutMillis: 4_000,
    query_timeout: 4_000,
  });
  try {
    const guard = await guardPool.query<{
      databaseName: string;
      port: number;
      version: number;
      token: string;
    }>(
      `SELECT current_database() AS "databaseName", inet_server_port() AS port,
              current_setting('server_version_num')::int AS version, token
         FROM e2e_fixture.guard WHERE token = $1 LIMIT 1`,
      [target.token],
    );
    expect(guard.rows).toEqual([
      {
        databaseName: target.database,
        port: target.port,
        version: expect.any(Number),
        token: target.token,
      },
    ]);
    expect(guard.rows[0]?.version).toBeGreaterThanOrEqual(170000);
    expect(guard.rows[0]?.version).toBeLessThan(180000);
  } finally {
    await guardPool.end();
  }

  runtimePool = createRuntimeRolePool({
    host: "127.0.0.1",
    port: target.port,
    database: target.database,
    user: "postgres",
    max: 2,
    connectionTimeoutMillis: 4_000,
    query_timeout: 4_000,
    statement_timeout: 4_000,
    lock_timeout: 4_000,
    idle_in_transaction_session_timeout: 4_000,
  });
  adminPool = new Pool({
    host: "127.0.0.1",
    port: target.port,
    database: target.database,
    user: "postgres",
    max: 2,
    connectionTimeoutMillis: 4_000,
    query_timeout: 4_000,
    statement_timeout: 4_000,
  });
  database = drizzle(runtimePool, {
    schema: coreSchema,
  }) as unknown as CirclesDatabase;
  dbFacade.database = database;

  const role = await runtimePool.query<{ current_user: string }>(
    "SELECT current_user",
  );
  expect(role.rows).toEqual([{ current_user: "circles_app_runtime" }]);

  await adminPool.query(
    `INSERT INTO circles_app.comments
       (id, "postId", "authorId", text, "createdAt", "updatedAt")
     VALUES
       (301, 101, 6, 'public tied comment one', $1::timestamptz, $1::timestamptz),
       (302, 101, 6, 'public tied comment two', $1::timestamptz, $1::timestamptz),
       (303, 101, 6, 'public tied comment three', $1::timestamptz, $1::timestamptz),
       (304, 101, 6, 'public later comment', $2::timestamptz, $2::timestamptz),
       (305, 105, 6, 'private member comment', $1::timestamptz, $1::timestamptz)`,
    [SHARED_TIMESTAMP_EXACT, LATER_TIMESTAMP_EXACT],
  );
});

afterAll(async () => {
  dbFacade.database = null;
  database = null;
  await Promise.all([runtimePool?.end(), adminPool?.end()]);
  runtimePool = null;
  adminPool = null;
  target = null;
});

describe.sequential("CBA-03 real PostgreSQL comment pagination", () => {
  it("allows a guest public page while denying a guest private page and retaining approved-member access", async () => {
    const publicPage = await listCommentsPage(null, 101, { limit: 2 });
    expect(publicPage.items.map((comment) => comment.id)).toEqual([301, 302]);
    expect(publicPage.hasMore).toBe(true);

    await expect(
      listCommentsPage(null, 105, { limit: 2 }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const memberPage = await listCommentsPage(3, 105, { limit: 2 });
    expect(memberPage).toMatchObject({
      hasMore: false,
      nextCursor: null,
      items: [{ id: 305, text: "private member comment" }],
    });
  });

  it("uses the exact microsecond timestamp and ID tie-breaker to traverse every real SQL row once", async () => {
    const first = await listCommentsPage(null, 101, { limit: 2 });
    expect(first.items.map((comment) => comment.id)).toEqual([301, 302]);
    expect(first.nextCursor).toEqual({
      createdAt: new Date("2026-10-29T12:34:56.123Z"),
      createdAtExact: SHARED_TIMESTAMP_EXACT,
      id: 302,
    });

    const second = await listCommentsPage(null, 101, {
      cursor: first.nextCursor ?? undefined,
      limit: 2,
    });
    expect(second.items.map((comment) => comment.id)).toEqual([303, 304]);
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
  });
});
