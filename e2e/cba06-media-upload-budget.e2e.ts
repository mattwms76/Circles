import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as mediaBudgetSchema from "../drizzle/media-upload-budget-schema";
import * as coreSchema from "../drizzle/schema";
import type { CirclesDatabase } from "../server/db";
import { MEDIA_UPLOAD_BUDGET_AUDIT_SQL } from "../server/media-upload-budget-contract";
import {
  confirmSocialUploadPut,
  isMediaUploadBudgetReady,
  listMediaUploadReconciliationCandidates,
  MAX_SOCIAL_UPLOAD_RESERVED_BYTES,
  MediaUploadBudgetExhaustedError,
  MediaUploadBudgetUnavailableError,
  reserveSocialUploadBudget,
} from "../server/media-upload-budget";
import {
  createRuntimeRolePool,
  type RuntimeRolePool,
} from "../server/runtime-role-pool";
import { recordUpload } from "../server/social-service";

const FIXTURE_USER_IDS = {
  concurrent: 1,
  metadataFailure: 2,
  legacy: 3,
  byteLimit: 4,
};
const ENCRYPTED_OBJECT_BYTES = 4 * 1024 * 1024;
const LEGACY_STORAGE_KEY =
  "social-encrypted/3/33333333-3333-4333-8333-333333333333.jpg.enc";
const LEGACY_URL = `/manus-storage/${LEGACY_STORAGE_KEY}`;
const MIGRATION = "operations/migrations/0025_circles_media_upload_budget.sql";
const API_ROLES = ["anon", "authenticated", "service_role"] as const;

type FixtureTarget = { port: number; database: string; token: string };
let target: FixtureTarget | null = null;
let runtimePool: RuntimeRolePool | null = null;
let adminPool: Pool | null = null;
let database: CirclesDatabase | null = null;

function readFixtureTarget(): FixtureTarget {
  const rawPort = process.env.CBA06_E2E_PG_PORT;
  const database = process.env.CBA06_E2E_DB;
  const token = process.env.CBA06_E2E_TOKEN;
  if (
    !rawPort ||
    !/^\d{1,5}$/.test(rawPort) ||
    !database ||
    !/^cba06_media_budget_[a-f0-9]{24}$/.test(database) ||
    !token ||
    !/^[a-f0-9]{64}$/.test(token)
  ) {
    throw new Error("CBA-06 requires its dedicated runner-owned PG17 fixture");
  }
  const port = Number(rawPort);
  if (
    !Number.isSafeInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    [3000, 8081].includes(port)
  ) {
    throw new Error(
      "CBA-06 fixture port is not an allowed isolated loopback port",
    );
  }
  return { port, database, token };
}

function reservationInput(
  userId: number,
  objectBytes = ENCRYPTED_OBJECT_BYTES,
) {
  const id = randomUUID();
  return {
    userId,
    storageKey: `social-encrypted/${userId}/${id}.jpg.enc`,
    objectBytes,
  };
}

async function expectApiRoleLedgerDenial(
  role: (typeof API_ROLES)[number],
): Promise<void> {
  const client = await adminPool!.connect();
  try {
    await client.query(`SET ROLE ${role}`);
    await expect(
      client.query('SELECT * FROM circles_media."socialUploadBudgets" LIMIT 1'),
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    try {
      await client.query("RESET ROLE");
    } finally {
      client.release();
    }
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
    max: 12,
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
    max: 4,
    connectionTimeoutMillis: 4_000,
    query_timeout: 4_000,
    statement_timeout: 4_000,
    lock_timeout: 4_000,
    idle_in_transaction_session_timeout: 4_000,
  });
  database = drizzle(runtimePool, {
    schema: { ...coreSchema, ...mediaBudgetSchema },
  }) as unknown as CirclesDatabase;
  const role = await runtimePool.query<{ current_user: string }>(
    "SELECT current_user",
  );
  expect(role.rows).toEqual([{ current_user: "circles_app_runtime" }]);

  await adminPool.query(
    `INSERT INTO circles_app."socialUploads"("userId", "storageKey", url, "mimeType", bytes, "createdAt")
     VALUES ($1, $2, $3, 'image/jpeg', 100, now() - interval '2 days')`,
    [FIXTURE_USER_IDS.legacy, LEGACY_STORAGE_KEY, LEGACY_URL],
  );
});

afterAll(async () => {
  await Promise.all([runtimePool?.end(), adminPool?.end()]);
  runtimePool = null;
  adminPool = null;
  database = null;
  target = null;
});

describe.sequential(
  "CBA-06 durable private media upload budget PostgreSQL lifecycle",
  () => {
    it("fails closed while the exact ledger contract is absent, then activates only in the synthetic fixture", async () => {
      expect(await isMediaUploadBudgetReady(database)).toBe(false);
      await expect(
        reserveSocialUploadBudget(database!, reservationInput(1, 36)),
      ).rejects.toBeInstanceOf(MediaUploadBudgetUnavailableError);

      await adminPool!.query(readFileSync(MIGRATION, "utf8"));
      expect(await isMediaUploadBudgetReady(database)).toBe(true);

      const backfill = await adminPool!.query<{
        reservedObjects: number;
        reservedBytes: string;
        reservations: string;
      }>(
        `SELECT budget."reservedObjects" AS "reservedObjects",
              budget."reservedBytes" AS "reservedBytes",
              (SELECT count(*)::text FROM circles_media."socialUploadReservations"
                WHERE "userId" = $1) AS reservations
         FROM circles_media."socialUploadBudgets" AS budget
        WHERE budget."userId" = $1`,
        [FIXTURE_USER_IDS.legacy],
      );
      expect(backfill.rows).toEqual([
        { reservedObjects: 1, reservedBytes: "136", reservations: "1" },
      ]);
    });

    it("keeps the private ledger inaccessible to every API role while the runtime role remains ready", async () => {
      for (const role of API_ROLES) {
        await expectApiRoleLedgerDenial(role);
      }
      expect(await isMediaUploadBudgetReady(database)).toBe(true);
    });

    it("rejects every restrictive runtime-role attribute drift before reservation or provider admission", async () => {
      for (const attribute of [
        "LOGIN",
        "INHERIT",
        "SUPERUSER",
        "BYPASSRLS",
      ] as const) {
        const client = await adminPool!.connect();
        try {
          await adminPool!.query(`ALTER ROLE circles_app_runtime ${attribute}`);
          await client.query("SET ROLE circles_app_runtime");
          const direct = await client.query<{ contract_variant: string }>(
            MEDIA_UPLOAD_BUDGET_AUDIT_SQL,
          );
          expect(direct.rows).toEqual([
            { contract_variant: "unavailable_or_drifted" },
          ]);
          const existingSession = drizzle(client, {
            schema: { ...coreSchema, ...mediaBudgetSchema },
          }) as unknown as CirclesDatabase;
          expect(await isMediaUploadBudgetReady(existingSession)).toBe(false);
          await expect(
            reserveSocialUploadBudget(existingSession, reservationInput(1, 36)),
          ).rejects.toBeInstanceOf(MediaUploadBudgetUnavailableError);
        } finally {
          await client.query("RESET ROLE");
          client.release();
          await adminPool!.query(
            "ALTER ROLE circles_app_runtime NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS",
          );
        }
        expect(await isMediaUploadBudgetReady(database)).toBe(true);
      }
      const unchanged = await adminPool!.query(
        'SELECT "userId" FROM circles_media."socialUploadBudgets" WHERE "userId" = 1 LIMIT 1',
      );
      expect(unchanged.rows).toEqual([]);
    });

    it("serializes 65 concurrent reservations so only the durable 64-object aggregate can charge", async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 65 }, () =>
          reserveSocialUploadBudget(database!, reservationInput(1)),
        ),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(64);
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected).toMatchObject({
        reason: expect.any(MediaUploadBudgetExhaustedError),
      });

      const budget = await adminPool!.query<{
        reservedObjects: number;
        reservedBytes: string;
        reservations: string;
      }>(
        `SELECT budget."reservedObjects" AS "reservedObjects",
              budget."reservedBytes" AS "reservedBytes",
              (SELECT count(*)::text FROM circles_media."socialUploadReservations"
                WHERE "userId" = $1) AS reservations
         FROM circles_media."socialUploadBudgets" AS budget
        WHERE budget."userId" = $1`,
        [FIXTURE_USER_IDS.concurrent],
      );
      expect(budget.rows).toEqual([
        {
          reservedObjects: 64,
          reservedBytes: String(64 * ENCRYPTED_OBJECT_BYTES),
          reservations: "64",
        },
      ]);
    });

    it("enforces the independent 512 MiB aggregate even before the 64-object bound", async () => {
      const halfBudget = MAX_SOCIAL_UPLOAD_RESERVED_BYTES / 2;
      await reserveSocialUploadBudget(
        database!,
        reservationInput(FIXTURE_USER_IDS.byteLimit, halfBudget),
      );
      await reserveSocialUploadBudget(
        database!,
        reservationInput(FIXTURE_USER_IDS.byteLimit, halfBudget),
      );
      await expect(
        reserveSocialUploadBudget(
          database!,
          reservationInput(FIXTURE_USER_IDS.byteLimit, 1),
        ),
      ).rejects.toBeInstanceOf(MediaUploadBudgetExhaustedError);

      const budget = await adminPool!.query<{
        reservedObjects: number;
        reservedBytes: string;
      }>(
        `SELECT "reservedObjects" AS "reservedObjects", "reservedBytes" AS "reservedBytes"
         FROM circles_media."socialUploadBudgets" WHERE "userId" = $1`,
        [FIXTURE_USER_IDS.byteLimit],
      );
      expect(budget.rows).toEqual([
        {
          reservedObjects: 2,
          reservedBytes: String(MAX_SOCIAL_UPLOAD_RESERVED_BYTES),
        },
      ]);
    });

    it("retains an acknowledged object charge when recording authorization metadata fails", async () => {
      const reservation = await reserveSocialUploadBudget(
        database!,
        reservationInput(FIXTURE_USER_IDS.metadataFailure, 136),
      );
      await confirmSocialUploadPut(database!, reservation);
      await adminPool!.query(
        `INSERT INTO circles_app."socialUploads"("userId", "storageKey", url, "mimeType", bytes)
       VALUES ($1, $2, $3, 'image/jpeg', 100)`,
        [reservation.userId, reservation.storageKey, reservation.url],
      );

      await expect(
        recordUpload(
          reservation.userId,
          {
            key: reservation.storageKey,
            url: reservation.url,
            mimeType: "image/jpeg",
            bytes: 100,
            reservation,
          },
          database!,
        ),
      ).rejects.toBeDefined();

      const retained = await adminPool!.query<{
        state: string;
        reservedObjects: number;
        reservedBytes: string;
      }>(
        `SELECT reservation.state,
              budget."reservedObjects" AS "reservedObjects",
              budget."reservedBytes" AS "reservedBytes"
         FROM circles_media."socialUploadReservations" AS reservation
         JOIN circles_media."socialUploadBudgets" AS budget
           ON budget."userId" = reservation."userId"
        WHERE reservation."reservationId" = $1`,
        [reservation.reservationId],
      );
      expect(retained.rows).toEqual([
        { state: "uploaded", reservedObjects: 1, reservedBytes: "136" },
      ]);
    });

    it("keeps deleted authorization metadata charged and returns it only in bounded operator dry-run output", async () => {
      await adminPool!.query(
        `DELETE FROM circles_app."socialUploads" WHERE "storageKey" = $1`,
        [LEGACY_STORAGE_KEY],
      );

      const page = await listMediaUploadReconciliationCandidates(database!, {
        now: new Date(),
        limit: 1,
      });
      expect(page.candidates).toHaveLength(1);
      expect(page.candidates[0]).toMatchObject({
        storageKey: LEGACY_STORAGE_KEY,
        classification: "discarded_metadata",
        objectBytes: 136,
      });
      expect(page.nextCursor).toBeNull();

      const retained = await adminPool!.query<{
        reservedObjects: number;
        reservedBytes: string;
      }>(
        `SELECT "reservedObjects" AS "reservedObjects", "reservedBytes" AS "reservedBytes"
         FROM circles_media."socialUploadBudgets" WHERE "userId" = $1`,
        [FIXTURE_USER_IDS.legacy],
      );
      expect(retained.rows).toEqual([
        { reservedObjects: 1, reservedBytes: "136" },
      ]);
    });

    it("fails closed before a future PUT when an exact private-ledger constraint drifts", async () => {
      await adminPool!.query(
        `ALTER TABLE circles_media."socialUploadReservations"
         DROP CONSTRAINT social_upload_reservations_state_check`,
      );

      expect(await isMediaUploadBudgetReady(database)).toBe(false);
      await expect(
        reserveSocialUploadBudget(database!, reservationInput(1, 36)),
      ).rejects.toBeInstanceOf(MediaUploadBudgetUnavailableError);
    });
  },
);
