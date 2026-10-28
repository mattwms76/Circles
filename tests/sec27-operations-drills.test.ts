import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FUTURE_MANIFEST_FORMAT,
  FutureMigrationTransportError,
  applyFutureOnlyMigrationBundle,
} from "../operations/security-tools/sec27-future-migration-transport.mjs";
import { runSyntheticLocalRecoveryRehearsal } from "../operations/security-tools/sec27-local-recovery-drill.mjs";
import {
  evaluateSyntheticFreshnessWatchdog,
  runSyntheticFreshnessWatchdogDrill,
} from "../operations/security-tools/sec27-health-watchdog-evaluator.mjs";

const temporaryRoots: string[] = [];

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function createFutureBundle(entries: { ordinal: number; sql: string }[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sec27-transport-test-"));
  temporaryRoots.push(root);
  const directory = path.join(root, "operations", "future-migrations");
  await mkdir(directory, { recursive: true });

  const manifestEntries = await Promise.all(
    entries.map(async ({ ordinal, sql }) => {
      const relativePath = `operations/future-migrations/${String(ordinal).padStart(4, "0")}-synthetic.sql`;
      await writeFile(path.join(root, relativePath), sql, "utf8");
      return { ordinal, path: relativePath, sha256: sha256(sql) };
    }),
  );
  await writeFile(
    path.join(root, "future-manifest.json"),
    `${JSON.stringify({ format: FUTURE_MANIFEST_FORMAT, entries: manifestEntries })}\n`,
    "utf8",
  );
  return { root, manifestEntries };
}

async function replaceManifest(root: string, entries: unknown) {
  await writeFile(
    path.join(root, "future-manifest.json"),
    `${JSON.stringify({ format: FUTURE_MANIFEST_FORMAT, entries })}\n`,
    "utf8",
  );
}

function expectValueFreeProof(value: unknown) {
  if (typeof value === "boolean" || typeof value === "number") return;
  if (typeof value === "string") {
    expect(value).toMatch(/^[a-f0-9]{64}$/);
    return;
  }
  expect(value).toBeTypeOf("object");
  for (const nested of Object.values(value as Record<string, unknown>)) {
    expectValueFreeProof(nested);
  }
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("SEC27 executable operations drills", () => {
  it("reads and verifies the future-only manifest before BEGIN, executes ordered bytes, and records its receipt only after COMMIT", async () => {
    const { root } = await createFutureBundle([
      { ordinal: 1, sql: "SELECT 'sec27-first';" },
      { ordinal: 2, sql: "SELECT 'sec27-second';" },
    ]);
    const events: string[] = [];
    const pgClient = {
      query: vi.fn(async (sql: string) => {
        events.push(sql);
        return { rowCount: 0 };
      }),
    };
    const receipts: unknown[] = [];

    const receipt = await applyFutureOnlyMigrationBundle({
      pgClient,
      repositoryRoot: root,
      manifestRelativePath: "future-manifest.json",
      recordReceipt: async (committedReceipt: unknown) => {
        events.push("receipt-after-commit");
        receipts.push(committedReceipt);
      },
    });

    expect(events).toEqual([
      "BEGIN",
      "SELECT 'sec27-first';",
      "SELECT 'sec27-second';",
      "COMMIT",
      "receipt-after-commit",
    ]);
    expect(receipts).toEqual([receipt]);
    expect(receipt).toMatchObject({
      outcome: "committed",
      migrationCount: 2,
      entries: [
        { ordinal: 1, path: "operations/future-migrations/0001-synthetic.sql" },
        { ordinal: 2, path: "operations/future-migrations/0002-synthetic.sql" },
      ],
    });
  });

  it("fails manifest traversal, checksum mismatch, and ordinal gaps before the passed client is asked to BEGIN", async () => {
    const { root, manifestEntries } = await createFutureBundle([
      { ordinal: 1, sql: "SELECT 'sec27-only';" },
    ]);
    const pgClient = { query: vi.fn() };

    await replaceManifest(root, [
      {
        ...manifestEntries[0],
        path: "operations/future-migrations/../0001-synthetic.sql",
      },
    ]);
    await expect(
      applyFutureOnlyMigrationBundle({
        pgClient,
        repositoryRoot: root,
        manifestRelativePath: "future-manifest.json",
      }),
    ).rejects.toMatchObject({ code: "manifest_path_invalid" });

    await replaceManifest(root, [
      { ...manifestEntries[0], sha256: "a".repeat(64) },
    ]);
    await expect(
      applyFutureOnlyMigrationBundle({
        pgClient,
        repositoryRoot: root,
        manifestRelativePath: "future-manifest.json",
      }),
    ).rejects.toMatchObject({ code: "manifest_checksum_mismatch" });

    await replaceManifest(root, [{ ...manifestEntries[0], ordinal: 2 }]);
    await expect(
      applyFutureOnlyMigrationBundle({
        pgClient,
        repositoryRoot: root,
        manifestRelativePath: "future-manifest.json",
      }),
    ).rejects.toMatchObject({ code: "manifest_ordinal_gap" });
    expect(pgClient.query).not.toHaveBeenCalled();
  });

  it("uses the same passed-client path to roll back a synthetic invalid final statement and never records a receipt", async () => {
    const { root } = await createFutureBundle([
      { ordinal: 1, sql: "SELECT 'sec27-baseline';" },
      { ordinal: 2, sql: "SEC27_SYNTHETIC_INVALID_FINAL_STATEMENT" },
    ]);
    const events: string[] = [];
    const pgClient = {
      query: vi.fn(async (sql: string) => {
        events.push(sql);
        if (sql === "SEC27_SYNTHETIC_INVALID_FINAL_STATEMENT") {
          throw new Error("synthetic statement rejection");
        }
        return { rowCount: 0 };
      }),
    };
    const receiptRecorder = vi.fn();

    await expect(
      applyFutureOnlyMigrationBundle({
        pgClient,
        repositoryRoot: root,
        manifestRelativePath: "future-manifest.json",
        recordReceipt: receiptRecorder,
      }),
    ).rejects.toMatchObject({
      code: "transaction_rolled_back",
      rollbackAttempted: true,
      retryForbidden: false,
    } satisfies Partial<FutureMigrationTransportError>);
    expect(events).toEqual([
      "BEGIN",
      "SELECT 'sec27-baseline';",
      "SEC27_SYNTHETIC_INVALID_FINAL_STATEMENT",
      "ROLLBACK",
    ]);
    expect(receiptRecorder).not.toHaveBeenCalled();
  });

  it("performs an actual private synthetic AES-GCM package/decrypt/restore rehearsal and exposes only value-free proof", async () => {
    const proof = await runSyntheticLocalRecoveryRehearsal();

    expect(proof).toMatchObject({
      synthetic_only: true,
      source_metadata_records: 2,
      source_media_objects: 2,
      restored_media_objects: 2,
      checksum_verified_objects: 2,
      corruption_rejected: true,
      wrong_material_rejected: true,
      missing_media_rejected: true,
      external_provider_calls: 0,
      database_calls: 0,
      production_key_reads: 0,
      private_temporary_cleanup_confirmed: true,
    });
    expectValueFreeProof(proof);
  });

  it("evaluates stale and unhealthy synthetic inputs to opens, a fresh input to recovery, and marks delivery as mocked without I/O", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const stale = evaluateSyntheticFreshnessWatchdog({
      freshness: "stale",
      aggregateHealthy: true,
      lagMinutes: 61,
      incidentOpen: false,
    });
    const unhealthy = evaluateSyntheticFreshnessWatchdog({
      freshness: "fresh",
      aggregateHealthy: false,
      lagMinutes: 1,
      incidentOpen: false,
    });
    const recovery = evaluateSyntheticFreshnessWatchdog({
      freshness: "fresh",
      aggregateHealthy: true,
      lagMinutes: 1,
      incidentOpen: true,
    });
    const proof = runSyntheticFreshnessWatchdogDrill();

    expect(stale).toMatchObject({
      transition: "condition_open",
      nextIncidentOpen: true,
      delivery: {
        mocked: true,
        externalAttempted: false,
        externalDelivered: false,
      },
    });
    expect(unhealthy.transition).toBe("condition_open");
    expect(recovery).toMatchObject({
      transition: "condition_recovered",
      nextIncidentOpen: false,
      delivery: {
        mocked: true,
        externalAttempted: false,
        externalDelivered: false,
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(proof).toMatchObject({
      stale_condition_open: true,
      unhealthy_condition_open: true,
      fresh_recovery_confirmed: true,
      mocked_delivery_records: 3,
      external_delivery_attempts: 0,
      scheduler_queries: 0,
      database_queries: 0,
      new_schedules: 0,
      new_watchdogs: 0,
      maximum_synthetic_lag_minutes: 61,
    });
    expectValueFreeProof(proof);
  });
});
