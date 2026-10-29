import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as coreSchema from "../drizzle/schema";
import * as liveSchema from "../drizzle/live-schema";
import * as postReceiptSchema from "../drizzle/post-publish-receipt-schema";
import * as sessionSchema from "../drizzle/session-schema";
import {
  createCircle,
  createPost,
  discardUnusedUpload,
  sendMessage,
  updateProfile,
} from "../server/social-service";
import {
  createRuntimeRolePool,
  type RuntimeRolePool,
} from "../server/runtime-role-pool";

const FIXTURE_USER_ID = 1;
const FIXTURE_CONVERSATION_ID = 41;
const DEADLINE_MS = 4_000;

/** The real service receives only the runner-owned Drizzle facade. */
const dbFacade = vi.hoisted(() => ({ database: null as unknown }));
vi.mock("../server/db", () => ({
  getDb: () => Promise.resolve(dbFacade.database),
}));

const databaseSchema = {
  ...coreSchema,
  ...liveSchema,
  ...postReceiptSchema,
  ...sessionSchema,
};

type AttachmentKind = "post" | "message" | "profile" | "cover";
type FixtureTarget = {
  port: number;
  database: string;
  token: string;
};
type AttachmentResult = Promise<unknown>;

let target: FixtureTarget | null = null;
let runtimePool: RuntimeRolePool | null = null;
let adminPool: Pool | null = null;

function readFixtureTarget(): FixtureTarget {
  const rawPort = process.env.CBA02_E2E_PG_PORT;
  const database = process.env.CBA02_E2E_DB;
  const token = process.env.CBA02_E2E_TOKEN;
  if (
    !rawPort ||
    !/^\d{1,5}$/.test(rawPort) ||
    !database ||
    !/^cba02_upload_claim_[a-f0-9]{24}$/.test(database) ||
    !token ||
    !/^[a-f0-9]{64}$/.test(token)
  ) {
    throw new Error("CBA-02 requires its dedicated runner-owned PG17 fixture");
  }
  const port = Number(rawPort);
  if (
    !Number.isSafeInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    [3000, 8081].includes(port)
  ) {
    throw new Error(
      "CBA-02 fixture port is not an allowed isolated loopback port",
    );
  }
  return { port, database, token };
}

function attachmentFor(kind: AttachmentKind, media: string): AttachmentResult {
  const suffix = randomUUID();
  switch (kind) {
    case "post":
      return createPost(FIXTURE_USER_ID, {
        text: `CBA-02 post ${suffix}`,
        media,
        mediaType: "photo",
      });
    case "message":
      return sendMessage(FIXTURE_USER_ID, FIXTURE_CONVERSATION_ID, {
        text: `CBA-02 message ${suffix}`,
        media,
      });
    case "profile":
      return updateProfile(FIXTURE_USER_ID, {
        name: "CBA-02 owner",
        handle: "cba02-owner",
        bio: "Synthetic CBA-02 fixture",
        avatar: media,
      });
    case "cover":
      return createCircle(FIXTURE_USER_ID, {
        name: `CBA-02 cover ${suffix}`,
        description: "Synthetic CBA-02 fixture circle",
        category: "Testing",
        privacy: "public",
        image: media,
      });
  }
}

async function createUpload(): Promise<string> {
  const suffix = randomUUID();
  const key = `social-encrypted/${FIXTURE_USER_ID}/${suffix}.jpg.enc`;
  const url = `/manus-storage/${key}`;
  await adminPool!.query(
    `INSERT INTO circles_app."socialUploads"("userId", "storageKey", url, "mimeType", bytes)
     VALUES ($1, $2, $3, 'image/jpeg', 96)`,
    [FIXTURE_USER_ID, key, url],
  );
  return url;
}

async function waitForUploadLockWaiters(expected: number): Promise<void> {
  const deadline = Date.now() + DEADLINE_MS;
  while (Date.now() < deadline) {
    const result = await adminPool!.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM pg_catalog.pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND query ILIKE '%socialUploads%'`,
    );
    if (Number(result.rows[0]?.count ?? 0) >= expected) return;
    await delay(20);
  }
  throw new Error(`CBA-02 expected ${expected} waiting socialUploads locks`);
}

async function fixtureReferenceState(media: string): Promise<{
  uploads: number;
  references: number;
}> {
  const result = await adminPool!.query<{
    uploads: string;
    references: string;
  }>(
    `SELECT
       (SELECT count(*) FROM circles_app."socialUploads" WHERE url = $1)::text AS uploads,
       (
         (SELECT count(*) FROM circles_app.profiles WHERE avatar = $1 OR cover = $1) +
         (SELECT count(*) FROM circles_app.circles WHERE image = $1) +
         (SELECT count(*) FROM circles_app.posts WHERE media = $1) +
         (SELECT count(*) FROM circles_app.messages WHERE media = $1)
       )::text AS references`,
    [media],
  );
  return {
    uploads: Number(result.rows[0]?.uploads ?? 0),
    references: Number(result.rows[0]?.references ?? 0),
  };
}

async function runDiscardFirstInterleaving(
  kind: AttachmentKind,
  media: string,
): Promise<{
  discard: PromiseSettledResult<{ success: true }>;
  attach: PromiseSettledResult<unknown>;
}> {
  const lockClient = await adminPool!.connect();
  let released = false;
  try {
    await lockClient.query("BEGIN");
    await lockClient.query(
      `SELECT id FROM circles_app."socialUploads" WHERE url = $1 FOR UPDATE`,
      [media],
    );

    // Queue discard first. In the pre-fix ordering, attachment validation was a plain read, so
    // attachment could insert its reference and queue an unchecked claim behind this delete.
    const discard = discardUnusedUpload(FIXTURE_USER_ID, media);
    await waitForUploadLockWaiters(1);
    const attach = attachmentFor(kind, media);
    await waitForUploadLockWaiters(2);

    await lockClient.query("COMMIT");
    released = true;
    const [discardResult, attachResult] = await Promise.allSettled([
      discard,
      attach,
    ]);
    return { discard: discardResult, attach: attachResult };
  } finally {
    if (!released) {
      await lockClient.query("ROLLBACK").catch(() => undefined);
    }
    lockClient.release();
  }
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
    max: 4,
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
    max: 5,
    connectionTimeoutMillis: DEADLINE_MS,
    query_timeout: DEADLINE_MS,
    statement_timeout: DEADLINE_MS,
    lock_timeout: DEADLINE_MS,
    idle_in_transaction_session_timeout: DEADLINE_MS,
  });
  dbFacade.database = drizzle(runtimePool, { schema: databaseSchema });

  const role = await runtimePool.query<{ current_user: string }>(
    "SELECT current_user",
  );
  expect(role.rows).toEqual([{ current_user: "circles_app_runtime" }]);
});

afterAll(async () => {
  dbFacade.database = null;
  await Promise.all([runtimePool?.end(), adminPool?.end()]);
  runtimePool = null;
  adminPool = null;
  target = null;
});

describe.sequential(
  "CBA-02 upload claim/discard PostgreSQL interleavings",
  () => {
    it.each<AttachmentKind>(["post", "message", "profile", "cover"])(
      "does not leave an orphaned %s reference when discard obtains the upload lock first",
      async (kind) => {
        const media = await createUpload();
        const result = await runDiscardFirstInterleaving(kind, media);

        expect(result.discard).toMatchObject({
          status: "fulfilled",
          value: { success: true },
        });
        expect(result.attach.status).toBe("rejected");
        if (result.attach.status === "rejected") {
          expect(result.attach.reason).toMatchObject({ code: "FORBIDDEN" });
        }
        // The only safe discard-first result is no attachment reference and no upload metadata.
        // The complementary ordering is protected by the same lock: its claim commits before
        // discard can scan the reference and discard returns CONFLICT.
        expect(await fixtureReferenceState(media)).toEqual({
          uploads: 0,
          references: 0,
        });
      },
    );
  },
);
