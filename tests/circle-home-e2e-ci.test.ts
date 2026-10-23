import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);

describe("isolated Circle Home E2E CI", () => {
  it("provisions verified PG17 and the distribution Python driver before E2E", () => {
    const tools = workflow.indexOf(
      "name: Install isolated Circle Home PostgreSQL 17 test tools",
    );
    const run = workflow.indexOf(
      "name: Run isolated Circle Home HTTP and PostgreSQL E2E",
    );
    expect(tools).toBeGreaterThan(-1);
    expect(run).toBeGreaterThan(tools);
    expect(workflow).toContain("postgresql-17 python3-psycopg");
    expect(workflow).toContain("/usr/lib/postgresql/17/bin/initdb --version");
    expect(workflow).toContain("Signed-By:");
    expect(workflow).not.toContain("trusted=yes");
    expect(workflow).toContain("run: pnpm test:e2e:circle-home");
  });

  it("keeps CI read-only without application credential declarations", () => {
    expect(workflow).toContain("contents: read");
    expect(workflow).not.toMatch(
      /secrets\.(SUPABASE_DATABASE_URL|DATABASE_URL)/,
    );
    expect(workflow).not.toContain("contents: write");
  });
});
