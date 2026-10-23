import { describe, expect, it } from "vitest";
import {
  checkApplicationSchema,
  REQUIRED_APPLICATION_COLUMNS,
} from "../scripts/recover-api.mjs";

const configuration = { SUPABASE_DATABASE_URL: "synthetic-private-config" };

function catalogModule(extra: { table_name: string; column_name: string }[]) {
  return {
    Client: class {
      async connect() {}
      async end() {}
      async query(query: { text: string }) {
        if (query.text.includes("information_schema.columns")) {
          return {
            rows: [
              ...Object.entries(REQUIRED_APPLICATION_COLUMNS).flatMap(
                ([table, columns]) =>
                  columns.map((column) => ({
                    table_name: table,
                    column_name: column,
                  })),
              ),
              ...extra,
            ],
          };
        }
        if (query.text.includes("has_schema_privilege"))
          return { rows: [{ can_use_schema: true }] };
        throw new Error(
          "Exact column rejection must precede other schema checks",
        );
      }
    },
  };
}

describe("exact private recovery column contract", () => {
  it.each([
    [{ table_name: "messages", column_name: "unexpected_extra_column" }],
    [{ table_name: "unreviewed_table", column_name: "id" }],
  ])("rejects extra columns or unreviewed table rows", async (row) => {
    expect(
      await checkApplicationSchema(configuration, {
        projectRoot: process.cwd(),
        connectionOptions: () => ({
          host: "synthetic",
          user: "synthetic",
          database: "postgres",
        }),
        pgModule: catalogModule([row]),
      }),
    ).toBe(false);
  });
});
