import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as coreSchema from "../drizzle/schema";
import * as liveSchema from "../drizzle/live-schema";
import {
  MAX_LIVE_CHAT_PER_PARTICIPANT_PER_WINDOW,
  MAX_LIVE_CHAT_ROWS_PER_PARTICIPANT,
  MAX_LIVE_CHAT_ROWS_PER_STREAM,
  MAX_LIVE_REACTIONS_PER_PARTICIPANT_PER_WINDOW,
} from "../shared/live-chat-limits";
import {
  createRuntimeRolePool,
  type RuntimeRolePool,
} from "../server/runtime-role-pool";

const FIXTURE_STREAM_ID = 71;
const FIXTURE_USER_ID = 1;
const DEADLINE_MS = 4_000;

/** The router receives only the runner-owned Drizzle facade and synthetic profile. */
const routerDeps = vi.hoisted(() => ({
  database: null as unknown,
  getProfile: vi.fn(),
}));

vi.mock("../server/db", () => ({
  getDb: () => Promise.resolve(routerDeps.database),
}));
vi.mock("../server/social-service", () => ({
  assertCircleCoverImageOwnership: vi.fn(),
  getCircleContentAccessForProtectedRead: vi.fn(),
  getDisplayProfileWithDb: vi.fn(),
  getProfile: routerDeps.getProfile,
}));
vi.mock("../server/turn-config", () => ({
  TurnConfigurationError: class TurnConfigurationError extends Error {},
  createTurnIceConfiguration: vi.fn(),
  loadTurnConfiguration: vi.fn(),
}));

const { liveRouter } = await import("../server/live-router");

const databaseSchema = { ...coreSchema, ...liveSchema };

type FixtureTarget = {
  port: number;
  database: string;
  token: string;
};

type ExplainRow = { "QUERY PLAN": unknown };

let target: FixtureTarget | null = null;
let runtimePool: RuntimeRolePool | null = null;
let adminPool: Pool | null = null;

function readFixtureTarget(): FixtureTarget {
  const rawPort = process.env.CBA04_E2E_PG_PORT;
  const database = process.env.CBA04_E2E_DB;
  const token = process.env.CBA04_E2E_TOKEN;
  if (
    !rawPort ||
    !/^\d{1,5}$/.test(rawPort) ||
    !database ||
    !/^cba04_live_chat_[a-f0-9]{24}$/.test(database) ||
    !token ||
    !/^[a-f0-9]{64}$/.test(token)
  ) {
    throw new Error("CBA-04 requires its dedicated runner-owned PG17 fixture");
  }
  const port = Number(rawPort);
  if (
    !Number.isSafeInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    [3000, 8081].includes(port)
  ) {
    throw new Error(
      "CBA-04 fixture port is not an allowed isolated loopback port",
    );
  }
  return { port, database, token };
}

function caller(userId = FIXTURE_USER_ID) {
  return liveRouter.createCaller({
    user: { id: userId },
    req: {},
    res: {},
  } as never);
}

async function clearLiveChat(): Promise<void> {
  await adminPool!.query(
    'TRUNCATE TABLE circles_app."liveChat" RESTART IDENTITY',
  );
}

async function liveChatCount(
  where = "",
  values: unknown[] = [],
): Promise<number> {
  const result = await adminPool!.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM circles_app."liveChat" ${where}`,
    values,
  );
  return Number(result.rows[0]?.total ?? 0);
}

beforeAll(async () => {
  target = readFixtureTarget();
  const guardPool = new Pool({
    host: "127.0.0.1",
    port: target.port,
    database: target.database,
    user: "postgres",
    max: 1,
    connectionTimeoutMillis: DEADLINE_MS,
    query_timeout: DEADLINE_MS,
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
    max: 8,
    connectionTimeoutMillis: DEADLINE_MS,
    query_timeout: DEADLINE_MS,
    statement_timeout: DEADLINE_MS,
    lock_timeout: DEADLINE_MS,
    idle_in_transaction_session_timeout: DEADLINE_MS,
  });
  adminPool = new Pool({
    host: "127.0.0.1",
    port: target.port,
    database: target.database,
    user: "postgres",
    max: 8,
    connectionTimeoutMillis: DEADLINE_MS,
    query_timeout: DEADLINE_MS,
    statement_timeout: DEADLINE_MS,
    lock_timeout: DEADLINE_MS,
    idle_in_transaction_session_timeout: DEADLINE_MS,
  });
  routerDeps.database = drizzle(runtimePool, { schema: databaseSchema });
  routerDeps.getProfile.mockResolvedValue({
    name: "CBA-04 synthetic host",
    handle: "cba04-host",
    avatar: "",
  });

  const role = await runtimePool.query<{ current_user: string }>(
    "SELECT current_user",
  );
  expect(role.rows).toEqual([{ current_user: "circles_app_runtime" }]);
});

afterAll(async () => {
  routerDeps.database = null;
  routerDeps.getProfile.mockReset();
  await Promise.all([runtimePool?.end(), adminPool?.end()]);
  runtimePool = null;
  adminPool = null;
  target = null;
});

describe.sequential("CBA-04 live chat PostgreSQL admission and indexes", () => {
  it("serializes a concurrent chat flood so only the bounded burst persists", async () => {
    await clearLiveChat();
    const attempts = Array.from(
      { length: MAX_LIVE_CHAT_PER_PARTICIPANT_PER_WINDOW + 7 },
      (_, index) =>
        caller().sendChat({
          streamId: FIXTURE_STREAM_ID,
          text: `flood ${index}`,
        }),
    );
    const settled = await Promise.allSettled(attempts);
    const fulfilled = settled.filter((result) => result.status === "fulfilled");
    const rejected = settled.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(MAX_LIVE_CHAT_PER_PARTICIPANT_PER_WINDOW);
    expect(rejected).toHaveLength(7);
    for (const result of rejected) {
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({ code: "TOO_MANY_REQUESTS" });
      }
    }
    expect(
      await liveChatCount('WHERE "streamId" = $1', [FIXTURE_STREAM_ID]),
    ).toBe(MAX_LIVE_CHAT_PER_PARTICIPANT_PER_WINDOW);
  });

  it("serializes a reaction flood under the stricter reaction policy", async () => {
    await clearLiveChat();
    const attempts = Array.from(
      { length: MAX_LIVE_REACTIONS_PER_PARTICIPANT_PER_WINDOW + 5 },
      () => caller().react({ streamId: FIXTURE_STREAM_ID }),
    );
    const settled = await Promise.allSettled(attempts);
    const fulfilled = settled.filter((result) => result.status === "fulfilled");
    const rejected = settled.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(
      MAX_LIVE_REACTIONS_PER_PARTICIPANT_PER_WINDOW,
    );
    expect(rejected).toHaveLength(5);
    expect(
      await liveChatCount('WHERE "streamId" = $1 AND text = $2', [
        FIXTURE_STREAM_ID,
        "❤",
      ]),
    ).toBe(MAX_LIVE_REACTIONS_PER_PARTICIPANT_PER_WINDOW);
  });

  it("rejects a full stream and a full participant without destructive cleanup", async () => {
    await clearLiveChat();
    await adminPool!.query(
      `INSERT INTO circles_app."liveChat"(
         "streamId", "userId", "userName", avatar, text, "createdAt"
       )
       SELECT $1, 1000 + (series % 4), 'synthetic', '', 'historical', now() - interval '2 minutes'
       FROM generate_series(1, $2) AS series`,
      [FIXTURE_STREAM_ID, MAX_LIVE_CHAT_ROWS_PER_STREAM],
    );
    await expect(
      caller().sendChat({
        streamId: FIXTURE_STREAM_ID,
        text: "blocked stream",
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(
      await liveChatCount('WHERE "streamId" = $1', [FIXTURE_STREAM_ID]),
    ).toBe(MAX_LIVE_CHAT_ROWS_PER_STREAM);

    await clearLiveChat();
    await adminPool!.query(
      `INSERT INTO circles_app."liveChat"(
         "streamId", "userId", "userName", avatar, text, "createdAt"
       )
       SELECT $1, $2, 'synthetic', '', 'historical', now() - interval '2 minutes'
       FROM generate_series(1, $3)`,
      [FIXTURE_STREAM_ID, FIXTURE_USER_ID, MAX_LIVE_CHAT_ROWS_PER_PARTICIPANT],
    );
    await expect(
      caller().sendChat({
        streamId: FIXTURE_STREAM_ID,
        text: "blocked participant",
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(
      await liveChatCount('WHERE "streamId" = $1 AND "userId" = $2', [
        FIXTURE_STREAM_ID,
        FIXTURE_USER_ID,
      ]),
    ).toBe(MAX_LIVE_CHAT_ROWS_PER_PARTICIPANT);
  });

  it("installs the prepared matching poll index and the planner uses it for newest-first polling", async () => {
    await clearLiveChat();
    await adminPool!.query(
      `INSERT INTO circles_app."liveChat"(
         "streamId", "userId", "userName", avatar, text, "createdAt"
       )
       SELECT 100 + (series % 200), 2000 + (series % 8), 'synthetic', '', 'plan',
              now() - (series || ' seconds')::interval
       FROM generate_series(1, 240000) AS series`,
    );
    await adminPool!.query('ANALYZE circles_app."liveChat"');

    const indexes = await adminPool!.query<{ indexname: string }>(
      `SELECT indexname
         FROM pg_catalog.pg_indexes
        WHERE schemaname = 'circles_app'
          AND tablename = 'liveChat'
          AND indexname IN ('live_chat_stream_created_id_idx', 'live_chat_stream_user_created_idx')
        ORDER BY indexname`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "live_chat_stream_created_id_idx",
      "live_chat_stream_user_created_idx",
    ]);

    const plan = await adminPool!.query<ExplainRow>(
      `EXPLAIN (COSTS OFF, FORMAT JSON)
       SELECT id, "createdAt"
         FROM circles_app."liveChat"
        WHERE "streamId" = $1
        ORDER BY "createdAt" DESC, id DESC
        LIMIT 100`,
      [171],
    );
    const serializedPlan = JSON.stringify(plan.rows[0]?.["QUERY PLAN"]);
    expect(serializedPlan).toMatch(/Index(?: Only)? Scan/);
    expect(serializedPlan).toContain("live_chat_stream_created_id_idx");
  });
});
