import { readFileSync } from "node:fs";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import drizzleConfig from "../drizzle.config";
import * as activitySchema from "../drizzle/activity-schema";
import * as liveSchema from "../drizzle/live-schema";
import * as moderationSchema from "../drizzle/moderation-schema";
import * as coreSchema from "../drizzle/schema";
import * as sessionSchema from "../drizzle/session-schema";
import {
  deriveEndpointInventory,
  REQUIRED_APPLICATION_COLUMNS,
} from "../scripts/recover-api.mjs";

const SOURCE_MODULES = [
  { file: "drizzle/schema.ts", exports: coreSchema },
  { file: "drizzle/live-schema.ts", exports: liveSchema },
  { file: "drizzle/session-schema.ts", exports: sessionSchema },
  { file: "drizzle/activity-schema.ts", exports: activitySchema },
  { file: "drizzle/moderation-schema.ts", exports: moderationSchema },
] as const;

const EXPECTED_TABLE_EXPORTS = {
  "drizzle/schema.ts": [
    ["users", "users"],
    ["profiles", "profiles"],
    ["circles", "circles"],
    ["memberships", "memberships"],
    ["posts", "posts"],
    ["reactions", "reactions"],
    ["bookmarks", "bookmarks"],
    ["comments", "comments"],
    ["conversations", "conversations"],
    ["conversationParticipants", "conversationParticipants"],
    ["messages", "messages"],
    ["follows", "follows"],
    ["reports", "reports"],
    ["socialUploads", "socialUploads"],
    ["socialSeedMarkers", "socialSeedMarkers"],
    ["dataMigrations", "_dataMigrations"],
  ],
  "drizzle/live-schema.ts": [
    ["streams", "streams"],
    ["activeHostLeases", "activeHostLeases"],
    ["liveViewers", "liveViewers"],
    ["liveSignals", "liveSignals"],
    ["liveChat", "liveChat"],
  ],
  "drizzle/session-schema.ts": [["applicationSessions", "applicationSessions"]],
  "drizzle/activity-schema.ts": [
    ["activityItems", "activityItems"],
    ["activityPreferences", "activityPreferences"],
    ["activityCirclePreferences", "activityCirclePreferences"],
  ],
  "drizzle/moderation-schema.ts": [
    ["moderationCases", "moderationCases"],
    ["moderationActions", "moderationActions"],
  ],
} as const;

type SourceTable = {
  sourceFile: string;
  exportName: string;
  tableName: string;
  columns: string[];
};

function tableExports(
  sourceFile: string,
  sourceModule: Record<string, unknown>,
): SourceTable[] {
  return Object.entries(sourceModule).flatMap(([exportName, candidate]) => {
    if (!(candidate instanceof PgTable)) return [];
    const table = getTableConfig(candidate);
    return [
      {
        sourceFile,
        exportName,
        tableName: table.name,
        columns: table.columns.map((column) => column.name),
      },
    ];
  });
}

describe("current private database schema parity", () => {
  it("keeps every recovery table in its exact source module with SQL-health column order", () => {
    const sourceTables = SOURCE_MODULES.flatMap(({ file, exports }) =>
      tableExports(file, exports),
    );
    const tablesBySource = Object.fromEntries(
      SOURCE_MODULES.map(({ file }) => [
        file,
        sourceTables
          .filter((table) => table.sourceFile === file)
          .map(({ exportName, tableName }) => [exportName, tableName]),
      ]),
    );
    const tablesByName = new Map(
      sourceTables.map((table) => [table.tableName, table]),
    );

    expect(tablesBySource).toEqual(EXPECTED_TABLE_EXPORTS);
    expect(sourceTables).toHaveLength(27);
    expect([...tablesByName.keys()].sort()).toEqual(
      Object.keys(REQUIRED_APPLICATION_COLUMNS).sort(),
    );
    expect(
      Object.fromEntries(
        Object.keys(REQUIRED_APPLICATION_COLUMNS).map((tableName) => [
          tableName,
          tablesByName.get(tableName)?.columns,
        ]),
      ),
    ).toEqual(REQUIRED_APPLICATION_COLUMNS);
  });

  it("keeps the offline Drizzle artifact list aligned to all five source modules", () => {
    expect(drizzleConfig.schema).toEqual(
      SOURCE_MODULES.map(({ file }) => `./${file}`),
    );
  });

  it("documents the current source-derived query count", () => {
    const documentation = readFileSync(
      new URL("../docs/api-recovery.md", import.meta.url),
      "utf8",
    );
    const documentedCount =
      /This is \*\*(\d+) source-derived query procedures\*\*/.exec(
        documentation,
      )?.[1];
    const inventory = deriveEndpointInventory();

    expect(inventory.drift).toEqual({
      missingConfigured: [],
      unsupported: [],
      classificationMismatch: [],
    });
    expect(inventory.endpoints).toHaveLength(31);
    expect(documentedCount).toBe(String(inventory.endpoints.length));
  });
});
