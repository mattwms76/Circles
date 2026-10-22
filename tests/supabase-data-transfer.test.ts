import { describe, expect, it } from "vitest";
import {
  buildSourcePageQuery,
  buildTargetPageQuery,
  beginSourceSnapshot,
  canonicalRow,
  createMigrationSummary,
  emptyDigest,
  normalizeCell,
  parseCliArguments,
  resetIdentity,
  sourceEngineForVersion,
  WRITE_PAUSE_ACKNOWLEDGEMENT,
} from "../scripts/migrate-to-supabase.mjs";
import {
  DATA_MIGRATION_COLUMNS,
  DATA_MIGRATION_KEY,
  LEGACY_TABLES,
  PRIVATE_SCHEMA,
  SOURCE_TREE,
} from "../scripts/supabase-data-manifest.mjs";

describe("Supabase data-transfer guardrails", () => {
  it("has a complete explicit legacy application inventory and excludes only the historical Drizzle journal", () => {
    const names = LEGACY_TABLES.map((table) => table.name);
    expect(names).toEqual([
      "users",
      "profiles",
      "circles",
      "memberships",
      "posts",
      "reactions",
      "bookmarks",
      "comments",
      "conversations",
      "conversationParticipants",
      "messages",
      "follows",
      "reports",
      "socialUploads",
      "socialSeedMarkers",
      "applicationSessions",
      "streams",
      "activeHostLeases",
      "liveViewers",
      "liveSignals",
      "liveChat",
    ]);
    expect(names).not.toContain("__drizzle_migrations");
    expect(PRIVATE_SCHEMA).toBe("circles_app");
    expect(DATA_MIGRATION_KEY).toBe("circles-mysql-to-supabase-v1");
    expect(DATA_MIGRATION_COLUMNS).toEqual([
      "key",
      "sourceTree",
      "completedAt",
      "summary",
    ]);
    expect(SOURCE_TREE).toMatch(/^manifest-sha256:[a-f0-9]{64}$/);
  });

  it("preserves durable sessions, seed markers, uploads, message watermarks, and all live context columns", () => {
    const columns = Object.fromEntries(
      LEGACY_TABLES.map((table) => [table.name, table.columns]),
    );
    expect(columns.applicationSessions).toEqual([
      "sessionFingerprint",
      "userOpenId",
      "appId",
      "expiresAt",
      "revokedAt",
      "createdAt",
    ]);
    expect(columns.socialSeedMarkers).toEqual(["key", "completedAt"]);
    expect(columns.socialUploads).toContain("storageKey");
    expect(columns.conversationParticipants).toContain("lastReadMessageId");
    expect(columns.liveViewers).toEqual([
      "streamId",
      "userId",
      "joinedAt",
      "lastSeenAt",
      "generation",
      "leftAt",
    ]);
    expect(columns.liveSignals).toEqual([
      "id",
      "streamId",
      "fromId",
      "toId",
      "kind",
      "fromGeneration",
      "toGeneration",
      "payload",
      "createdAt",
    ]);
    expect(columns.streams).toContain("hostGeneration");
    expect(columns.activeHostLeases).toEqual([
      "hostId",
      "streamId",
      "lastHeartbeatAt",
    ]);
  });

  it("requires exactly one explicit mode and a write-pause acknowledgement for apply", () => {
    expect(() => parseCliArguments([])).toThrow("exactly_one_mode_required");
    expect(() => parseCliArguments(["--preflight", "--verify"])).toThrow(
      "exactly_one_mode_required",
    );
    expect(() => parseCliArguments(["--apply"])).toThrow(
      "write_pause_acknowledgement_required",
    );
    expect(() =>
      parseCliArguments([
        "--verify",
        `--acknowledge-write-pause=${WRITE_PAUSE_ACKNOWLEDGEMENT}`,
      ]),
    ).toThrow("write_pause_acknowledgement_only_valid_for_apply");
    expect(
      parseCliArguments([
        "--apply",
        `--acknowledge-write-pause=${WRITE_PAUSE_ACKNOWLEDGEMENT}`,
        "--batch-size=17",
      ]),
    ).toMatchObject({ mode: "apply", batchSize: 17 });
    expect(() =>
      parseCliArguments(["--preflight", "--batch-size=501"]),
    ).toThrow("batch_size_out_of_range");
  });

  it("uses documented normal START TRANSACTION for TiDB and never claims its READ ONLY syntax enforces writes", async () => {
    const commands: string[] = [];
    const source = {
      query: async ({ sql }: { sql: string }) => {
        commands.push(sql);
        if (sql === "SELECT VERSION() AS version")
          return [[{ version: "8.0.11-TiDB-v8.5.3-serverless" }], []];
        return [{ affectedRows: 0 }, []];
      },
    };
    await expect(beginSourceSnapshot(source)).resolves.toEqual({
      engine: "tidb",
      snapshotBegin: "START TRANSACTION",
    });
    expect(commands).toEqual([
      "SELECT VERSION() AS version",
      "SET time_zone = '+00:00'",
      "SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ",
      "START TRANSACTION",
    ]);
    expect(commands.join(" ")).not.toContain("READ ONLY");
    expect(sourceEngineForVersion("8.0.11-TiDB-v8.5.3-serverless")).toBe(
      "tidb",
    );
  });

  it("uses MySQL consistent-snapshot read-only syntax only for non-TiDB sources", async () => {
    const commands: string[] = [];
    const source = {
      query: async ({ sql }: { sql: string }) => {
        commands.push(sql);
        if (sql === "SELECT VERSION() AS version")
          return [[{ version: "8.0.36" }], []];
        return [{ affectedRows: 0 }, []];
      },
    };
    await expect(beginSourceSnapshot(source)).resolves.toEqual({
      engine: "mysql",
      snapshotBegin: "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY",
    });
    expect(commands.at(-1)).toBe(
      "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY",
    );
  });

  it("uses fixed-column bounded keyset pages rather than data exports or offsets", () => {
    const source = buildSourcePageQuery("liveViewers", [3, 4], 23);
    expect(source.sql).toContain(
      "SELECT `streamId`, `userId`, `joinedAt`, `lastSeenAt`, `generation`, `leftAt`",
    );
    expect(source.sql).toContain(
      "(`streamId` > ?) OR (`streamId` = ? AND `userId` > ?)",
    );
    expect(source.sql).toContain("LIMIT ?");
    expect(source.values).toEqual([3, 3, 4, 23]);

    const target = buildTargetPageQuery("conversationParticipants", [11], 23);
    expect(target.sql).toContain(
      'FROM "circles_app"."conversationParticipants"',
    );
    expect(target.sql).toContain('WHERE "id" > $1');
    expect(target.sql).toContain("LIMIT $2");
    expect(target.values).toEqual([11, 23]);
  });

  it("canonicalizes source UTC timestamp text and target Date values identically", () => {
    const users = LEGACY_TABLES.find((table) => table.name === "users")!;
    const source = {
      id: 7,
      openId: "synthetic-open-id",
      name: null,
      email: null,
      loginMethod: "oauth",
      role: "user",
      createdAt: normalizeCell("createdAt", "2026-10-22 12:34:56"),
      updatedAt: normalizeCell("updatedAt", "2026-10-22 12:34:56"),
      lastSignedIn: normalizeCell("lastSignedIn", "2026-10-22 12:34:56"),
    };
    const target = {
      ...source,
      createdAt: new Date("2026-10-22T12:34:56.000Z"),
      updatedAt: new Date("2026-10-22T12:34:56.000Z"),
      lastSignedIn: new Date("2026-10-22T12:34:56.000Z"),
    };
    expect(canonicalRow(users, source)).toBe(canonicalRow(users, target));
  });

  it("requires every manifest table before recording a completion summary", () => {
    const complete = Object.fromEntries(
      LEGACY_TABLES.map((table) => [table.name, emptyDigest()]),
    );
    const summary = createMigrationSummary(complete);
    expect(summary.totalRows).toBe(0);
    expect(Object.keys(summary.tables)).toHaveLength(21);
    delete complete.users;
    expect(() => createMigrationSummary(complete)).toThrow(
      "invalid_table_summary",
    );
  });
});

it("casts identity lookup parameters explicitly and restores the next numeric ID", async () => {
  const queries: { text: string; values: unknown[] }[] = [];
  const target = {
    query: async (query: { text: string; values: unknown[] }) => {
      queries.push(query);
      if (query.text.includes("pg_get_serial_sequence")) {
        return { rows: [{ sequence_name: "circles_app.users_id_seq" }] };
      }
      if (query.text.includes("COUNT(*)")) {
        return { rows: [{ count: "5", maximum: "5" }] };
      }
      return { rows: [] };
    },
  };
  await resetIdentity(
    target,
    LEGACY_TABLES.find((table) => table.name === "users")!,
  );
  expect(queries[0].text).toContain(
    "format('%I.%I', $1::text, $2::text), $3::text",
  );
  expect(queries[0].values).toEqual(["circles_app", "users", "id"]);
  expect(queries[2].values).toEqual(["circles_app.users_id_seq", 5, true]);
});
